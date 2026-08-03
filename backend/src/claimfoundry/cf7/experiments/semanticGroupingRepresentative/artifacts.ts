import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  Gde2ExperimentId,
  Gde2Validation,
} from "./types.js";

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeImmutable(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
}

async function writeImmutableJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeImmutable(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export class Gde2ForensicWriter {
  constructor(readonly outputDirectory: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.outputDirectory), { recursive: true });
    await mkdir(this.outputDirectory, { recursive: false });
  }

  private directory(experimentId: Gde2ExperimentId): string {
    return path.join(this.outputDirectory, `request-${experimentId}`);
  }

  async beginRequest(input: {
    experimentId: Gde2ExperimentId;
    request: Record<string, unknown>;
  }): Promise<void> {
    const directory = this.directory(input.experimentId);
    await mkdir(directory, { recursive: false });
    const requestText = `${JSON.stringify(input.request, null, 2)}\n`;
    await writeImmutable(path.join(directory, "request.json"), requestText);
    await writeImmutable(
      path.join(directory, "request_hash.txt"),
      `${sha256(requestText)}\n`,
    );
  }

  async recordResponse(input: {
    experimentId: Gde2ExperimentId;
    rawResponse: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const directory = this.directory(input.experimentId);
    const responseText = `${JSON.stringify(input.rawResponse, null, 2)}\n`;
    await writeImmutable(
      path.join(directory, "raw_response.json"),
      responseText,
    );
    await writeImmutable(
      path.join(directory, "raw_response_hash.txt"),
      `${sha256(responseText)}\n`,
    );
    await writeImmutableJson(
      path.join(directory, "response_metadata.json"),
      input.metadata,
    );
  }

  async recordError(input: {
    experimentId: Gde2ExperimentId;
    error: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const directory = this.directory(input.experimentId);
    await writeImmutableJson(path.join(directory, "provider_error.json"), {
      name: input.error instanceof Error ? input.error.name : "Error",
      message: input.error instanceof Error
        ? input.error.message
        : String(input.error),
    });
    await writeImmutableJson(
      path.join(directory, "response_metadata.json"),
      input.metadata,
    );
  }

  async recordValidation(input: {
    experimentId: Gde2ExperimentId;
    validation: Gde2Validation;
    schemaIssues: unknown[];
  }): Promise<void> {
    await writeImmutableJson(
      path.join(this.directory(input.experimentId), "validation.json"),
      {
        ...input.validation,
        schemaIssues: input.schemaIssues,
      },
    );
  }
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(filePath) : [filePath];
  }));
  return nested.flat().sort();
}

export async function hashGde2Artifacts(
  outputDirectory: string,
): Promise<Array<{ name: string; bytes: number; sha256: string }>> {
  const files = await filesRecursively(outputDirectory);
  return Promise.all(files
    .filter((filePath) => path.basename(filePath) !== "artifact_hashes.json")
    .map(async (filePath) => {
      const content = await readFile(filePath);
      return {
        name: path.relative(outputDirectory, filePath),
        bytes: content.length,
        sha256: sha256(content),
      };
    }));
}

export function aggregateGde2ArtifactHash(
  files: Array<{ name: string; bytes: number; sha256: string }>,
): string {
  return sha256(JSON.stringify(files));
}

export async function freezeGde2Artifacts(
  outputDirectory: string,
): Promise<void> {
  const files = await filesRecursively(outputDirectory);
  for (const filePath of files) await chmod(filePath, 0o444);
  const directories = [
    outputDirectory,
    ...(await readdir(outputDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(outputDirectory, entry.name)),
  ].sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    if ((await stat(directory)).isDirectory()) await chmod(directory, 0o555);
  }
}
