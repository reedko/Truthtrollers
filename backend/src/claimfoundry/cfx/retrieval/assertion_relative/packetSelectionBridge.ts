// Narrow Node/TypeScript adapter around the existing deterministic Python
// retriever (`assertion_relative/cli.py` / `retriever.py`). This file does not
// reimplement any BM25, embedding, entity, predicate, ranking, windowing, or
// packet-selection logic -- it only shells out to the existing CLI, validates
// its JSON result, and projects it into the `CfxRetrievedPacket` shape the
// single-assertion packet-extraction contract expects. No model calls, no
// database access.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CfxRetrievedPacket } from "../../experiments/singleAssertionPacketExtraction/extraction.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export type CfxPacketSelectionAssertion = {
  assertionId: string;
  text: string;
  aliases?: string[];
  requiredConceptGroups?: string[][];
};

export type CfxPacketSelectionDocumentBlock = {
  blockId: string;
  text: string;
};

export type CfxPacketSelectionDocument = {
  documentId: string;
  blocks: CfxPacketSelectionDocumentBlock[];
};

export type CfxPacketSelectionConfig = Record<string, unknown>;

export type CfxPacketSelectionInput = {
  assertion: CfxPacketSelectionAssertion;
  document: CfxPacketSelectionDocument;
  config?: CfxPacketSelectionConfig;
};

export type CfxPacketSelectionPayload = {
  assertion: Required<CfxPacketSelectionAssertion>;
  document: CfxPacketSelectionDocument;
  config: CfxPacketSelectionConfig;
};

export type CfxPacketSelectionResult = {
  assertionId: string;
  documentId: string;
  selectedPackets: CfxRetrievedPacket[];
  diagnostics: Record<string, unknown>;
};

export function buildCfxPacketSelectionPayload(
  input: CfxPacketSelectionInput,
): CfxPacketSelectionPayload {
  if (!input.assertion.assertionId.trim() || !input.assertion.text.trim()) {
    throw new TypeError("assertion.assertionId and assertion.text are required");
  }
  if (!input.document.documentId.trim() || input.document.blocks.length === 0) {
    throw new TypeError("document.documentId and at least one document block are required");
  }
  for (const block of input.document.blocks) {
    if (!block.blockId.trim()) throw new TypeError("every document block requires a blockId");
  }
  return {
    assertion: {
      assertionId: input.assertion.assertionId,
      text: input.assertion.text,
      aliases: input.assertion.aliases ?? [],
      requiredConceptGroups: input.assertion.requiredConceptGroups ?? [],
    },
    document: {
      documentId: input.document.documentId,
      blocks: input.document.blocks.map((block) => ({ blockId: block.blockId, text: block.text })),
    },
    config: input.config ?? {},
  };
}

const rawPacketSchema = z.object({
  packetId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  text: z.string(),
}).passthrough();

const rawResultSchema = z.object({
  assertionId: z.string().min(1),
  documentId: z.string().min(1),
  selectedPackets: z.array(rawPacketSchema),
  diagnostics: z.record(z.string(), z.unknown()),
}).passthrough();

function projectPacket(packet: z.infer<typeof rawPacketSchema>): CfxRetrievedPacket {
  return {
    packetId: packet.packetId,
    blockIds: [...packet.blockIds],
    charStart: packet.charStart,
    charEnd: packet.charEnd,
    text: packet.text,
  };
}

export function parseCfxPacketSelectionResult(input: {
  raw: unknown;
  expectedAssertionId: string;
  expectedDocumentId: string;
}): CfxPacketSelectionResult {
  const parsed = rawResultSchema.parse(input.raw);
  if (
    parsed.assertionId !== input.expectedAssertionId
    || parsed.documentId !== input.expectedDocumentId
  ) {
    throw new Error(
      `packet-selection result envelope mismatch: expected `
      + `${input.expectedAssertionId}/${input.expectedDocumentId}, received `
      + `${parsed.assertionId}/${parsed.documentId}`,
    );
  }
  return {
    assertionId: parsed.assertionId,
    documentId: parsed.documentId,
    selectedPackets: parsed.selectedPackets.map(projectPacket),
    diagnostics: parsed.diagnostics,
  };
}

export type CfxPacketSelectionBridgeOptions = {
  /** Full override of the spawned command, e.g. ["python3", "/path/fake_cli.py"]. Tests use this to substitute a stand-in CLI; production leaves it unset. */
  command?: string[];
  pythonExecutable?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  lexicalOnly?: boolean;
  embeddingModelCache?: string;
  embeddingCache?: string;
  timeoutMs?: number;
  tmpDirPrefix?: string;
};

export class CfxPacketSelectionCliError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(message: string, info: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    timedOut: boolean;
  }) {
    super(message);
    this.name = "CfxPacketSelectionCliError";
    this.exitCode = info.exitCode;
    this.signal = info.signal;
    this.stderr = info.stderr;
    this.timedOut = info.timedOut;
  }
}

function defaultCommand(pythonExecutable: string): string[] {
  return [pythonExecutable, "-m", "assertion_relative.cli"];
}

export function buildCfxPacketSelectionCliArgs(input: {
  inputPath: string;
  outputPath: string;
  lexicalOnly?: boolean;
  embeddingModelCache?: string;
  embeddingCache?: string;
}): string[] {
  const args = ["--input", input.inputPath, "--output", input.outputPath];
  if (input.lexicalOnly) args.push("--lexical-only");
  if (input.embeddingModelCache) args.push("--embedding-model-cache", input.embeddingModelCache);
  if (input.embeddingCache) args.push("--embedding-cache", input.embeddingCache);
  return args;
}

async function runCli(input: {
  command: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [command, ...prefixArgs] = input.command;
    if (!command) {
      reject(new TypeError("command must contain at least the executable"));
      return;
    }
    const child = spawn(command, [...prefixArgs, ...input.args], {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new CfxPacketSelectionCliError(
        `packet-selection CLI failed to start: ${error.message}`,
        { exitCode: null, signal: null, stderr, timedOut },
      ));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CfxPacketSelectionCliError(
          `packet-selection CLI exceeded bounded timeout of ${input.timeoutMs}ms`,
          { exitCode: code, signal, stderr, timedOut: true },
        ));
        return;
      }
      if (code !== 0) {
        reject(new CfxPacketSelectionCliError(
          `packet-selection CLI exited with code ${code}`,
          { exitCode: code, signal, stderr, timedOut: false },
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Run the deterministic assertion-relative packet-selection CLI for one
 * assertion and one already-acquired document, and return validated,
 * projected packets. Always cleans up its temporary working directory, even
 * on failure. Makes no model calls and no database writes.
 */
export async function selectCfxAssertionRelativePackets(
  input: CfxPacketSelectionInput,
  options: CfxPacketSelectionBridgeOptions = {},
): Promise<CfxPacketSelectionResult> {
  const payload = buildCfxPacketSelectionPayload(input);
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive, finite number of milliseconds");
  }
  const tmpDir = await mkdtemp(path.join(tmpdir(), options.tmpDirPrefix ?? "cfx-packet-selection-"));
  try {
    const inputPath = path.join(tmpDir, "input.json");
    const outputPath = path.join(tmpDir, "output.json");
    await writeFile(inputPath, JSON.stringify(payload));
    const args = buildCfxPacketSelectionCliArgs({
      inputPath,
      outputPath,
      lexicalOnly: options.lexicalOnly,
      embeddingModelCache: options.embeddingModelCache,
      embeddingCache: options.embeddingCache,
    });
    const command = options.command ?? defaultCommand(options.pythonExecutable ?? "python3");
    const cwd = options.cwd ?? path.resolve(here, "..");
    await runCli({ command, cwd, env: options.env, args, timeoutMs });
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      throw new Error(
        `packet-selection CLI output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseCfxPacketSelectionResult({
      raw,
      expectedAssertionId: input.assertion.assertionId,
      expectedDocumentId: input.document.documentId,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
