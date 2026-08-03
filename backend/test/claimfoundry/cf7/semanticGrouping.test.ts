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
import {
  SemanticGroupingForensicWriter,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/artifacts.js";
import {
  buildSemanticGroupingUserPrompt,
  SEMANTIC_GROUPING_COMMON_RULES,
  SEMANTIC_GROUPING_PROMPTS,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/prompts.js";
import {
  DEFAULT_SEMANTIC_GROUPING_CONFIG,
  runSemanticGroupingExperiment,
  SEMANTIC_GROUPING_PROMPT_IDS,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/runExperiment.js";
import {
  semanticGroupingOutputSchema,
  SEMANTIC_GROUPING_JSON_SCHEMA,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/schema.js";
import type {
  SemanticGroupingAssertion,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/types.js";
import {
  validateSemanticGrouping,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/validateGrouping.js";

const assertions: SemanticGroupingAssertion[] = Array.from(
  { length: 267 },
  (_, index) => ({
    assertionId: `H${String(index + 1).padStart(4, "0")}`,
    assertionText: `Frozen assertion ${index + 1}.`,
  }),
);

test("all seven governed prompt texts are present verbatim and unextended", () => {
  assert.deepEqual(SEMANTIC_GROUPING_PROMPT_IDS, [
    "A", "B", "C", "D", "E", "F", "G",
  ]);
  assert.equal(Object.keys(SEMANTIC_GROUPING_PROMPTS).length, 7);
  assert.match(
    SEMANTIC_GROUPING_PROMPTS.A,
    /Groups should reflect substantive meaning, not where the assertions appeared/,
  );
  assert.match(
    SEMANTIC_GROUPING_PROMPTS.B,
    /Separate background, mechanisms, evidence, conclusions, counterarguments, and consequences/,
  );
  assert.match(
    SEMANTIC_GROUPING_PROMPTS.E,
    /smallest number of coherent reasoning units/,
  );
  assert.match(
    SEMANTIC_GROUPING_PROMPTS.G,
    /Imagine the article has been shredded/,
  );
  assert.match(
    SEMANTIC_GROUPING_COMMON_RULES,
    /No provenance except assertion IDs/,
  );
});

test("every prompt receives an identical assertion-only inventory in identical order", () => {
  const inventories = SEMANTIC_GROUPING_PROMPT_IDS.map((promptId) => {
    const prompt = SEMANTIC_GROUPING_PROMPTS[promptId];
    const user = buildSemanticGroupingUserPrompt({ promptId, assertions });
    return JSON.parse(user.slice(prompt.length + 2));
  });
  for (const inventory of inventories) assert.deepEqual(inventory, assertions);
  assert.deepEqual(Object.keys(inventories[0]![0]!), [
    "assertionId",
    "assertionText",
  ]);
});

test("strict schema permits only group IDs and assertion IDs", () => {
  assert.equal(semanticGroupingOutputSchema.safeParse({
    groups: [{ groupId: "G1", assertionIds: ["H0001"] }],
  }).success, true);
  assert.equal(semanticGroupingOutputSchema.safeParse({
    groups: [{
      groupId: "G1",
      assertionIds: ["H0001"],
      summary: "not allowed",
    }],
  }).success, false);
  assert.equal(SEMANTIC_GROUPING_JSON_SCHEMA.name, "cf7_semantic_grouping_v1");
  assert.doesNotMatch(
    JSON.stringify(SEMANTIC_GROUPING_JSON_SCHEMA),
    /assertionText|summary|reasoning/,
  );
});

test("coverage validator reports duplicate, missing, and invented assignments", () => {
  const inspected = validateSemanticGrouping({
    assertions: assertions.slice(0, 3),
    output: {
      groups: [
        { groupId: "G1", assertionIds: ["H0001", "H0002"] },
        { groupId: "G2", assertionIds: ["H0002", "H9999"] },
      ],
    },
  });
  assert.equal(inspected.validation.status, "FAIL");
  assert.deepEqual(
    inspected.validation.duplicateAssertionAssignments,
    ["H0002"],
  );
  assert.deepEqual(
    inspected.validation.missingAssertionAssignments,
    ["H0003"],
  );
  assert.deepEqual(
    inspected.validation.inventedAssertionAssignments,
    ["H9999"],
  );
});

test("runner makes exactly seven calls with identical settings and preserves every response", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "cf7-semantic-grouping-"),
  );
  try {
    const outputDirectory = path.join(temporaryRoot, "run");
    const writer = new SemanticGroupingForensicWriter(outputDirectory);
    await writer.initialize();
    const requests: Array<Record<string, unknown>> = [];
    const provider: Cf7StructuredProvider = {
      async invokeStructured(request) {
        requests.push(request as unknown as Record<string, unknown>);
        const output = {
          groups: [{
            groupId: "GROUP-001",
            assertionIds: assertions.map((row) => row.assertionId),
          }],
        };
        return {
          output,
          rawResponse: {
            id: `response-${requests.length}`,
            output,
          },
          model: "gpt-4o-mini",
          usage: {
            inputTokens: 1_000,
            cachedInputTokens: 0,
            outputTokens: 300,
            totalTokens: 1_300,
          },
          responseId: `response-${requests.length}`,
          requestId: `request-${requests.length}`,
        };
      },
    };
    const result = await runSemanticGroupingExperiment({
      assertions,
      assertionInventoryHash: "inventory-hash",
      provider,
      forensicWriter: writer,
      config: { ...DEFAULT_SEMANTIC_GROUPING_CONFIG },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.providerCallCount, 7);
    assert.equal(requests.length, 7);
    assert.ok(requests.every((request) =>
      request.model === "gpt-4o-mini"
      && request.temperature === 0.1
      && request.retryCount === 0
      && request.store === false
      && request.responseSchema === SEMANTIC_GROUPING_JSON_SCHEMA));
    assert.equal(new Set(requests.map((request) =>
      JSON.stringify(request).match(/H0001/g)?.length)).size, 1);
    for (const promptId of SEMANTIC_GROUPING_PROMPT_IDS) {
      const directory = path.join(outputDirectory, `request-${promptId}`);
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
      const validation = JSON.parse(await readFile(
        path.join(directory, "validation.json"),
        "utf8",
      ));
      assert.equal(validation.status, "PASS");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
