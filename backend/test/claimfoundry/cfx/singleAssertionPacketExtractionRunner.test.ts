import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCfxSingleAssertionPacketExtraction } from "../../../src/claimfoundry/cfx/experiments/singleAssertionPacketExtraction/runExtraction.js";
import type { CfxRetrievedPacket } from "../../../src/claimfoundry/cfx/experiments/singleAssertionPacketExtraction/extraction.js";
import type { Cf7StructuredModelRequest, Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const baselineRoot = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802",
);
const goldenRunRoot = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-single-assertion-packet-extraction-20260802090828",
);

type GoldenActualOutput = {
  assertionId: string;
  documentId: string;
  selectedPackets: Array<CfxRetrievedPacket & Record<string, unknown>>;
  diagnostics: { documentCharacterCount: number };
};

type GoldenExactRequest = {
  callId: string;
  assertionId: string;
  documentId: string;
  requestHash: string;
  request: Cf7StructuredModelRequest;
};

const config = {
  model: "gpt-4o-mini",
  temperature: 0.1,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
};

function projectPacket(packet: CfxRetrievedPacket & Record<string, unknown>): CfxRetrievedPacket {
  return {
    packetId: packet.packetId,
    blockIds: [...packet.blockIds],
    charStart: packet.charStart,
    charEnd: packet.charEnd,
    text: packet.text,
  };
}

async function loadGolden() {
  const actualOutputs = JSON.parse(
    await readFile(path.join(baselineRoot, "actual_outputs.json"), "utf8"),
  ) as GoldenActualOutput[];
  const baseline = JSON.parse(await readFile(path.join(baselineRoot, "baseline_input.json"), "utf8")) as {
    scope: { assertions: Record<string, { text: string }> };
  };
  const exactRequests = JSON.parse(
    await readFile(path.join(goldenRunRoot, "exact-model-requests.json"), "utf8"),
  ) as GoldenExactRequest[];
  const nonEmpty = actualOutputs.filter((row) => row.selectedPackets.length > 0);
  return { nonEmpty, assertions: baseline.scope.assertions, exactRequests };
}

function stubProvider(output: unknown, options: { delayMs?: number } = {}): Cf7StructuredProvider {
  return {
    async invokeStructured() {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return {
        output,
        rawResponse: { output },
        model: config.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp",
        requestId: "req",
      };
    },
  };
}

test("reusable extractor reconstructs byte-identical request payloads for all 9 golden requests", async () => {
  const { nonEmpty, assertions, exactRequests } = await loadGolden();
  assert.equal(nonEmpty.length, 9);
  assert.equal(exactRequests.length, 9);

  for (let index = 0; index < nonEmpty.length; index += 1) {
    const row = nonEmpty[index]!;
    const golden = exactRequests[index]!;
    assert.equal(row.assertionId, golden.assertionId, `row ${index} assertionId order must match the golden run`);
    assert.equal(row.documentId, golden.documentId, `row ${index} documentId order must match the golden run`);

    let capturedRequest: Cf7StructuredModelRequest | null = null;
    const result = await runCfxSingleAssertionPacketExtraction({
      assertionId: row.assertionId,
      assertionText: assertions[row.assertionId]!.text,
      documentId: row.documentId,
      selectedPackets: row.selectedPackets.map(projectPacket),
      provider: stubProvider({ assertionId: row.assertionId, documentId: row.documentId, assertions: [] }),
      ...config,
      async beforeInvoke(request) { capturedRequest = request; },
    });

    assert.deepEqual(capturedRequest, golden.request, `${golden.callId} request payload must be byte-identical`);
    assert.equal(result.requestHash, golden.requestHash, `${golden.callId} request hash must match the golden hash`);
    assert.equal(result.status, "completed");
    assert.equal(result.providerCallCount, 1);
  }
});

test("one invocation carries exactly one assertion and one document", async () => {
  const packets: CfxRetrievedPacket[] = [
    { packetId: "PACKET-0001", blockIds: ["B0001"], charStart: 0, charEnd: 10, text: "some text" },
  ];
  let capturedRequest: Cf7StructuredModelRequest | null = null;
  await runCfxSingleAssertionPacketExtraction({
    assertionId: "P1",
    assertionText: "The agency omitted evidence.",
    documentId: "DOC-1",
    selectedPackets: packets,
    provider: stubProvider({ assertionId: "P1", documentId: "DOC-1", assertions: [] }),
    ...config,
    async beforeInvoke(request) { capturedRequest = request; },
  });
  assert.notEqual(capturedRequest, null);
  const user = (capturedRequest as unknown as Cf7StructuredModelRequest).user;
  assert.equal((user.match(/ASSERTION_ID:/gu) ?? []).length, 1);
  assert.equal((user.match(/DOCUMENT_ID:/gu) ?? []).length, 1);
  assert.ok(user.includes("ASSERTION_ID: P1"));
  assert.ok(user.includes("DOCUMENT_ID: DOC-1"));
});

test("no unselected document text enters the request", async () => {
  const excludedSentence = "This sentence lives in a block that was never selected.";
  const selectedPackets: CfxRetrievedPacket[] = [
    { packetId: "PACKET-0001", blockIds: ["B0001"], charStart: 0, charEnd: 30, text: "The agency denied the claim." },
  ];
  let capturedRequest: Cf7StructuredModelRequest | null = null;
  await runCfxSingleAssertionPacketExtraction({
    assertionId: "P1",
    assertionText: "The agency omitted evidence.",
    documentId: "DOC-1",
    selectedPackets,
    provider: stubProvider({ assertionId: "P1", documentId: "DOC-1", assertions: [] }),
    ...config,
    async beforeInvoke(request) { capturedRequest = request; },
  });
  assert.notEqual(capturedRequest, null);
  const user = (capturedRequest as unknown as Cf7StructuredModelRequest).user;
  assert.equal(user.includes(excludedSentence), false);
  assert.ok(user.includes("The agency denied the claim."));
});

test("empty packet input produces no model call and an empty result", async () => {
  let providerCalls = 0;
  const result = await runCfxSingleAssertionPacketExtraction({
    assertionId: "P1",
    assertionText: "The agency omitted evidence.",
    documentId: "DOC-1",
    selectedPackets: [],
    provider: {
      async invokeStructured() {
        providerCalls += 1;
        throw new Error("should never be called for empty packet input");
      },
    },
    ...config,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.status, "empty");
  assert.equal(result.providerCallCount, 0);
  assert.deepEqual(result.acceptedRows, []);
  assert.deepEqual(result.rejectedRows, []);
  assert.equal(result.requestHash, null);
  assert.equal(result.rawOutput, null);
});

test("exact excerpts must occur literally in supplied packets", async () => {
  const selectedPackets: CfxRetrievedPacket[] = [
    { packetId: "PACKET-0001", blockIds: ["B0001"], charStart: 0, charEnd: 30, text: "The agency denied the claim." },
  ];
  const literalResult = await runCfxSingleAssertionPacketExtraction({
    assertionId: "P1",
    assertionText: "The agency omitted evidence.",
    documentId: "DOC-1",
    selectedPackets,
    provider: stubProvider({
      assertionId: "P1",
      documentId: "DOC-1",
      assertions: [{
        exactExcerpt: "The agency denied the claim.",
        sourceAssertion: "The agency denies the claim.",
        relevanceType: "contradicts",
        reason: "Direct denial.",
        packetIds: ["PACKET-0001"],
        blockIds: ["B0001"],
      }],
    }),
    ...config,
  });
  assert.equal(literalResult.status, "completed");
  assert.equal(literalResult.acceptedRows.length, 1);
  assert.equal(literalResult.rejectedRows.length, 0);

  const inventedResult = await runCfxSingleAssertionPacketExtraction({
    assertionId: "P1",
    assertionText: "The agency omitted evidence.",
    documentId: "DOC-1",
    selectedPackets,
    provider: stubProvider({
      assertionId: "P1",
      documentId: "DOC-1",
      assertions: [{
        exactExcerpt: "This exact sentence was never supplied to the model.",
        sourceAssertion: "Invented.",
        relevanceType: "affirms",
        reason: "Invented.",
        packetIds: ["PACKET-0001"],
        blockIds: ["B0001"],
      }],
    }),
    ...config,
  });
  assert.equal(inventedResult.acceptedRows.length, 0);
  assert.equal(inventedResult.rejectedRows.length, 1);
  assert.ok(inventedResult.rejectedRows[0]!.reasons.some((reason) => reason.code === "EXACT_EXCERPT_NOT_LITERAL"));
});

test("concurrency can be bounded externally without shared mutable state", async () => {
  const inputs = Array.from({ length: 6 }, (_, index) => ({
    assertionId: `P${index + 1}`,
    assertionText: `Case assertion number ${index + 1}.`,
    documentId: `DOC-${index + 1}`,
    selectedPackets: [{
      packetId: `PACKET-000${index + 1}`,
      blockIds: [`B000${index + 1}`],
      charStart: 0,
      charEnd: 20,
      text: `Passage for document ${index + 1}.`,
    }] as CfxRetrievedPacket[],
  }));

  async function runBounded(concurrency: number) {
    const results: Array<Awaited<ReturnType<typeof runCfxSingleAssertionPacketExtraction>>> = new Array(inputs.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < inputs.length) {
        const index = cursor;
        cursor += 1;
        const item = inputs[index]!;
        results[index] = await runCfxSingleAssertionPacketExtraction({
          assertionId: item.assertionId,
          assertionText: item.assertionText,
          documentId: item.documentId,
          selectedPackets: item.selectedPackets,
          provider: stubProvider(
            { assertionId: item.assertionId, documentId: item.documentId, assertions: [] },
            { delayMs: (6 - index) % 4 },
          ),
          ...config,
        });
      }
    }));
    return results;
  }

  const results = await runBounded(3);
  assert.equal(results.length, inputs.length);
  results.forEach((result, index) => {
    assert.equal(result.status, "completed");
    assert.equal(result.rejectedRows.length, 0);
  });

  // Re-running with a different external concurrency cap must not change any
  // per-call outcome -- there is no module-level state for concurrency to corrupt.
  const rerun = await runBounded(1);
  assert.deepEqual(
    rerun.map((result) => result.requestHash),
    results.map((result) => result.requestHash),
  );
});
