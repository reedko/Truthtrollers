import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildCfxPacketSelectionCliArgs,
  buildCfxPacketSelectionPayload,
  CfxPacketSelectionCliError,
  parseCfxPacketSelectionResult,
  selectCfxAssertionRelativePackets,
} from "../../../src/claimfoundry/cfx/retrieval/assertion_relative/packetSelectionBridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeCliPath = path.join(here, "fixtures/fakeAssertionRelativeCli.py");
const repositoryRoot = path.resolve(here, "../../../..");
const goldenActualOutputsPath = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802/actual_outputs.json",
);
const goldenBaselineInputPath = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802/baseline_input.json",
);

type GoldenOutput = {
  assertionId: string;
  documentId: string;
  selectedPackets: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
};

async function loadGoldenNonemptyEntries(count: number): Promise<GoldenOutput[]> {
  const outputs = JSON.parse(await readFile(goldenActualOutputsPath, "utf8")) as GoldenOutput[];
  const nonEmpty = outputs.filter((row) => row.selectedPackets.length > 0);
  assert.ok(nonEmpty.length >= count, `expected at least ${count} nonempty golden entries`);
  return nonEmpty.slice(0, count);
}

async function withResponsesFile<T>(
  entries: GoldenOutput[],
  run: (responsesPath: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "cfx-packet-selection-test-"));
  try {
    const responsesPath = path.join(dir, "responses.json");
    const responses = Object.fromEntries(entries.map((entry) => [
      `${entry.assertionId}::${entry.documentId}`,
      entry,
    ]));
    await writeFile(responsesPath, JSON.stringify(responses));
    return await run(responsesPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function trivialDocumentFor(entry: GoldenOutput) {
  return { documentId: entry.documentId, blocks: [{ blockId: "B0001", text: "placeholder" }] };
}

test("buildCfxPacketSelectionPayload fills defaults and rejects empty assertion/document input", () => {
  const payload = buildCfxPacketSelectionPayload({
    assertion: { assertionId: "P1", text: "The agency omitted evidence." },
    document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "hello" }] },
  });
  assert.deepEqual(payload.assertion.aliases, []);
  assert.deepEqual(payload.assertion.requiredConceptGroups, []);
  assert.deepEqual(payload.config, {});

  assert.throws(() => buildCfxPacketSelectionPayload({
    assertion: { assertionId: "", text: "x" },
    document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "hello" }] },
  }), /assertionId/);
  assert.throws(() => buildCfxPacketSelectionPayload({
    assertion: { assertionId: "P1", text: "x" },
    document: { documentId: "DOC-1", blocks: [] },
  }), /at least one document block/);
});

test("buildCfxPacketSelectionCliArgs matches cli.py's argument surface", () => {
  const args = buildCfxPacketSelectionCliArgs({
    inputPath: "/tmp/in.json",
    outputPath: "/tmp/out.json",
    lexicalOnly: true,
    embeddingModelCache: "/tmp/models",
    embeddingCache: "/tmp/cache",
  });
  assert.deepEqual(args, [
    "--input", "/tmp/in.json",
    "--output", "/tmp/out.json",
    "--lexical-only",
    "--embedding-model-cache", "/tmp/models",
    "--embedding-cache", "/tmp/cache",
  ]);
  assert.deepEqual(
    buildCfxPacketSelectionCliArgs({ inputPath: "/tmp/in.json", outputPath: "/tmp/out.json" }),
    ["--input", "/tmp/in.json", "--output", "/tmp/out.json"],
  );
});

test("parseCfxPacketSelectionResult projects raw retriever packets and rejects an envelope mismatch", () => {
  const result = parseCfxPacketSelectionResult({
    raw: {
      assertionId: "P1",
      documentId: "DOC-1",
      selectedPackets: [{
        packetId: "PACKET-0001",
        blockIds: ["B0001"],
        charStart: 0,
        charEnd: 5,
        text: "hello",
        combinedScore: 0.91,
        matchedTerms: ["hello"],
      }],
      diagnostics: { windowCount: 3 },
    },
    expectedAssertionId: "P1",
    expectedDocumentId: "DOC-1",
  });
  assert.deepEqual(result.selectedPackets, [{
    packetId: "PACKET-0001", blockIds: ["B0001"], charStart: 0, charEnd: 5, text: "hello",
  }]);
  assert.equal(Object.keys(result.selectedPackets[0]!).length, 5);

  assert.throws(() => parseCfxPacketSelectionResult({
    raw: { assertionId: "P2", documentId: "DOC-1", selectedPackets: [], diagnostics: {} },
    expectedAssertionId: "P1",
    expectedDocumentId: "DOC-1",
  }), /envelope mismatch/);
});

test("bridge reproduces the frozen baseline's selected packets for two golden assertion-document inputs", async (t) => {
  const entries = await loadGoldenNonemptyEntries(2);
  const baseline = JSON.parse(await readFile(goldenBaselineInputPath, "utf8")) as {
    scope: { assertions: Record<string, { text: string }> };
  };

  for (const entry of entries) {
    await t.test(`${entry.assertionId} x ${entry.documentId}`, async () => {
      await withResponsesFile([entry], async (responsesPath) => {
        const result = await selectCfxAssertionRelativePackets({
          assertion: { assertionId: entry.assertionId, text: baseline.scope.assertions[entry.assertionId]!.text },
          document: trivialDocumentFor(entry),
        }, {
          command: ["python3", fakeCliPath],
          env: { CFX_FAKE_CLI_RESPONSES_PATH: responsesPath },
          timeoutMs: 15_000,
        });
        assert.equal(result.assertionId, entry.assertionId);
        assert.equal(result.documentId, entry.documentId);
        const expectedPackets = entry.selectedPackets.map((packet) => ({
          packetId: packet.packetId,
          blockIds: packet.blockIds,
          charStart: packet.charStart,
          charEnd: packet.charEnd,
          text: packet.text,
        }));
        assert.deepEqual(result.selectedPackets, expectedPackets);
      });
    });
  }
});

test("bridge surfaces stderr and a non-zero exit code without hanging", async () => {
  await assert.rejects(
    selectCfxAssertionRelativePackets({
      assertion: { assertionId: "P1", text: "x" },
      document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "y" }] },
    }, {
      command: ["python3", fakeCliPath],
      env: { CFX_FAKE_CLI_MODE: "fail" },
      timeoutMs: 15_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CfxPacketSelectionCliError);
      assert.equal(error.exitCode, 3);
      assert.equal(error.timedOut, false);
      assert.match(error.stderr, /simulated packet-selection failure/);
      return true;
    },
  );
});

test("bridge enforces its bounded timeout instead of hanging indefinitely", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    selectCfxAssertionRelativePackets({
      assertion: { assertionId: "P1", text: "x" },
      document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "y" }] },
    }, {
      command: ["python3", fakeCliPath],
      env: { CFX_FAKE_CLI_MODE: "hang" },
      timeoutMs: 300,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CfxPacketSelectionCliError);
      assert.equal(error.timedOut, true);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 10_000, "bridge should not wait anywhere near the CLI's 60s hang");
});

test("bridge rejects malformed CLI output with a clear error", async () => {
  await assert.rejects(
    selectCfxAssertionRelativePackets({
      assertion: { assertionId: "P1", text: "x" },
      document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "y" }] },
    }, {
      command: ["python3", fakeCliPath],
      env: { CFX_FAKE_CLI_MODE: "bad-json" },
      timeoutMs: 15_000,
    }),
    /not valid JSON/,
  );
});

test("bridge rejects a start failure (missing interpreter) instead of hanging", async () => {
  await assert.rejects(
    selectCfxAssertionRelativePackets({
      assertion: { assertionId: "P1", text: "x" },
      document: { documentId: "DOC-1", blocks: [{ blockId: "B1", text: "y" }] },
    }, {
      command: ["this-executable-does-not-exist-cfx-test"],
      timeoutMs: 15_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CfxPacketSelectionCliError);
      assert.equal(error.exitCode, null);
      return true;
    },
  );
});

test("temp payload/output directory does not survive after a run", async () => {
  const entries = await loadGoldenNonemptyEntries(1);
  const entry = entries[0]!;
  const prefix = `cfx-packet-selection-probe-${Date.now()}-`;
  await withResponsesFile([entry], async (responsesPath) => {
    await selectCfxAssertionRelativePackets({
      assertion: { assertionId: entry.assertionId, text: "irrelevant" },
      document: trivialDocumentFor(entry),
    }, {
      command: ["python3", fakeCliPath],
      env: { CFX_FAKE_CLI_RESPONSES_PATH: responsesPath },
      timeoutMs: 15_000,
      tmpDirPrefix: prefix,
    });
  });
  const leftover = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));
  assert.equal(leftover.length, 0, `expected no leftover temp dirs, found: ${leftover.join(", ")}`);
});
