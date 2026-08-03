import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import { canonicalHash } from "../../../src/claimfoundry/shared/sourceUnits/index.js";
import { Sel1ForensicWriter } from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/artifacts.js";
import {
  buildSel1UserPrompt,
  SEL1_SELECTOR_PROMPTS,
} from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/prompts.js";
import {
  DEFAULT_SEL1_CONFIG,
  runSel1Experiment,
} from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/runExperiment.js";
import {
  SEL1_JSON_SCHEMA,
  sel1OutputSchema,
} from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/schema.js";
import type {
  Sel1FrozenInput,
  Sel1Group,
} from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/types.js";
import {
  inspectSel1ProtectedContent,
  validateSel1Output,
} from "../../../src/claimfoundry/cf7/experiments/selectorExperiment/validate.js";

const groups: Sel1Group[] = Array.from({ length: 24 }, (_, index) => ({
  groupId: `G${index + 1}`,
  groupIndex: index + 1,
  semanticSubThesis: `Frozen semantic sub-thesis ${index + 1}.`,
  assertions: [
    {
      assertionId: `H${String(index * 2 + 1).padStart(4, "0")}`,
      assertionText: `First frozen assertion for group ${index + 1}.`,
    },
    {
      assertionId: `H${String(index * 2 + 2).padStart(4, "0")}`,
      assertionText: `Second frozen assertion for group ${index + 1}.`,
    },
  ],
}));

const frozen: Sel1FrozenInput = {
  sourceRunId: "source-run",
  sourceArtifactAggregateSha256: "source-artifact-hash",
  sourceGde2InventoryHash: "inventory-hash",
  sourceGde2GroupFileSha256: "group-file-hash",
  groupCount: 24,
  assertionAssignmentCount: 48,
  uniqueAssertionCount: 48,
  duplicateAssertionIds: [],
  sourceInputHash: canonicalHash(groups),
  groups,
};

test("Selector B adds only sub-thesis guidance to Selector A's task", () => {
  const guidance = `
Also review the synthesized semantic sub-thesis.

Use the sub-thesis only as semantic guidance.
`;
  assert.equal(
    SEL1_SELECTOR_PROMPTS.B.replace(guidance, ""),
    SEL1_SELECTOR_PROMPTS.A,
  );
  const a = buildSel1UserPrompt({ selectorId: "A", group: groups[0]! });
  const b = buildSel1UserPrompt({ selectorId: "B", group: groups[0]! });
  const aPayload = JSON.parse(a.slice(SEL1_SELECTOR_PROMPTS.A.length + 2));
  const bPayload = JSON.parse(b.slice(SEL1_SELECTOR_PROMPTS.B.length + 2));
  assert.deepEqual(aPayload.assertions, bPayload.assertions);
  assert.equal("semanticSubThesis" in aPayload, false);
  assert.equal(
    bPayload.semanticSubThesis,
    groups[0]!.semanticSubThesis,
  );
  delete bPayload.semanticSubThesis;
  assert.deepEqual(aPayload, bPayload);
});

test("strict schema permits exactly the governed three output fields", () => {
  assert.equal(sel1OutputSchema.safeParse({
    groupId: "G1",
    selectedAssertionId: "H0001",
    atomicAssertion: "First frozen assertion for group 1.",
  }).success, true);
  assert.equal(sel1OutputSchema.safeParse({
    groupId: "G1",
    selectedAssertionId: "H0001",
    atomicAssertion: "First frozen assertion for group 1.",
    reason: "not permitted",
  }).success, false);
  assert.equal(SEL1_JSON_SCHEMA.name, "cf7_sel1_selector_v1");
  assert.deepEqual(
    SEL1_JSON_SCHEMA.schema.required,
    ["groupId", "selectedAssertionId", "atomicAssertion"],
  );
});

test("validator rejects foreign selections and flags protected rewriting", () => {
  const foreign = validateSel1Output({
    group: groups[0]!,
    output: {
      groupId: "G1",
      selectedAssertionId: "H9999",
      atomicAssertion: "Foreign assertion.",
    },
  });
  assert.equal(foreign.validation.status, "FAIL");
  assert.equal(foreign.validation.selectedAssertionInGroup, false);
  const protectedTokens = inspectSel1ProtectedContent(
    "The result was 7.6 times higher after vaccination.",
    "The study examined vaccination.",
  );
  assert.ok(protectedTokens.some((row) => row.token === "7.6"));
  assert.ok(protectedTokens.some((row) => row.token === "higher"));
  assert.ok(protectedTokens.some((row) => row.token === "after"));
});

test("runner schedules exactly 24 A and 24 B calls and preserves every response", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cf7-sel1-"));
  try {
    const outputDirectory = path.join(temporaryRoot, "run");
    const writer = new Sel1ForensicWriter(outputDirectory);
    await writer.initialize();
    const requests: Array<Record<string, unknown>> = [];
    const provider: Cf7StructuredProvider = {
      async invokeStructured(request) {
        requests.push(request as unknown as Record<string, unknown>);
        const payloadText = request.user.slice(
          request.user.lastIndexOf("\n\n") + 2,
        );
        const payload = JSON.parse(payloadText) as {
          groupId: string;
          assertions: Array<{
            assertionId: string;
            assertionText: string;
          }>;
        };
        const output = {
          groupId: payload.groupId,
          selectedAssertionId: payload.assertions[0]!.assertionId,
          atomicAssertion: payload.assertions[0]!.assertionText,
        };
        return {
          output,
          rawResponse: { id: `response-${requests.length}`, output },
          model: "gpt-4o-mini",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 30,
            totalTokens: 130,
          },
          responseId: `response-${requests.length}`,
          requestId: `request-${requests.length}`,
        };
      },
    };
    const result = await runSel1Experiment({
      frozen,
      provider,
      forensicWriter: writer,
      config: { ...DEFAULT_SEL1_CONFIG },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.providerCallCount, 48);
    assert.equal(result.rows.filter((row) => row.selectorId === "A").length, 24);
    assert.equal(result.rows.filter((row) => row.selectorId === "B").length, 24);
    assert.equal(requests.length, 48);
    assert.ok(requests.every((request) =>
      request.model === "gpt-4o-mini"
      && request.temperature === 0.1
      && request.retryCount === 0
      && request.store === false
      && request.maxOutputTokens === 1_000
      && request.timeoutMs === 180_000
      && request.responseSchema === SEL1_JSON_SCHEMA));
    for (const row of result.rows) {
      const directory = path.join(
        outputDirectory,
        `request-${row.requestKey}`,
      );
      for (const name of [
        "request.json",
        "request_hash.txt",
        "raw_response.json",
        "raw_response_hash.txt",
        "response_metadata.json",
        "validation.json",
      ]) {
        await access(path.join(directory, name));
      }
      const metadata = JSON.parse(await readFile(
        path.join(directory, "response_metadata.json"),
        "utf8",
      ));
      assert.equal(metadata.capturedBeforeValidation, true);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
