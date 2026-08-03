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
  SEMANTIC_GROUPING_COMMON_RULES,
  SEMANTIC_GROUPING_PROMPTS,
} from "../../../src/claimfoundry/cf7/experiments/semanticGrouping/prompts.js";
import { Gde2ForensicWriter } from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/artifacts.js";
import {
  buildGde2Instruction,
  buildGde2UserPrompt,
  GDE2_REPRESENTATIVE_ADDITIONS,
} from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/prompts.js";
import {
  DEFAULT_GDE2_CONFIG,
  GDE2_EXPERIMENTS,
  runGde2Experiment,
} from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/runExperiment.js";
import {
  GDE2_JSON_SCHEMAS,
  gde2HybridOutputSchema,
  gde2SelectedOutputSchema,
  gde2SynthesizedOutputSchema,
} from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/schema.js";
import type {
  Gde2VariantId,
  SemanticGroupingAssertion,
} from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/types.js";
import { validateGde2Output } from "../../../src/claimfoundry/cf7/experiments/semanticGroupingRepresentative/validate.js";

const assertions: SemanticGroupingAssertion[] = Array.from(
  { length: 267 },
  (_, index) => ({
    assertionId: `H${String(index + 1).padStart(4, "0")}`,
    assertionText: `Frozen assertion ${index + 1}.`,
  }),
);

test("GDE-2 is the exact nine-run G/D/E by A/B/C matrix", () => {
  assert.deepEqual(
    GDE2_EXPERIMENTS.map((row) => row.experimentId),
    ["G-A", "G-B", "G-C", "D-A", "D-B", "D-C", "E-A", "E-B", "E-C"],
  );
});

test("each original grouping prompt remains byte-stable before the authorized addition", () => {
  for (const experiment of GDE2_EXPERIMENTS) {
    const instruction = buildGde2Instruction(experiment);
    assert.equal(
      instruction,
      `${SEMANTIC_GROUPING_PROMPTS[experiment.promptId]}\n\n${
        GDE2_REPRESENTATIVE_ADDITIONS[experiment.variantId]
      }`,
    );
    const user = buildGde2UserPrompt({
      ...experiment,
      assertions,
    });
    const inventory = JSON.parse(user.slice(instruction.length + 2));
    assert.deepEqual(inventory, assertions);
  }
  assert.match(SEMANTIC_GROUPING_COMMON_RULES, /Unless explicitly requested/);
});

test("variant schemas add only the governed representative fields", () => {
  assert.equal(gde2SelectedOutputSchema.safeParse({
    groups: [{
      groupId: "G1",
      assertionIds: ["H0001"],
      representativeAssertionId: "H0001",
    }],
  }).success, true);
  assert.equal(gde2SynthesizedOutputSchema.safeParse({
    groups: [{
      groupId: "G1",
      assertionIds: ["H0001"],
      representativeAssertion: "Frozen assertion 1.",
    }],
  }).success, true);
  assert.equal(gde2HybridOutputSchema.safeParse({
    groups: [{
      groupId: "G1",
      assertionIds: ["H0001"],
      representativeType: "selected",
      representativeAssertionId: "H0001",
    }],
  }).success, true);
  assert.equal(gde2HybridOutputSchema.safeParse({
    groups: [{
      groupId: "G1",
      assertionIds: ["H0001"],
      representativeType: "selected",
      representativeAssertionId: "H0001",
      representativeAssertion: "not permitted on selected branch",
    }],
  }).success, false);
  assert.deepEqual(
    Object.values(GDE2_JSON_SCHEMAS).map((schema) => schema.name),
    [
      "cf7_gde2_representative_selected_v1",
      "cf7_gde2_representative_synthesized_v1",
      "cf7_gde2_representative_hybrid_v1",
    ],
  );
});

test("validation rejects a selected representative outside its group", () => {
  const inspected = validateGde2Output({
    assertions: assertions.slice(0, 2),
    variantId: "A",
    output: {
      groups: [
        {
          groupId: "G1",
          assertionIds: ["H0001"],
          representativeAssertionId: "H0002",
        },
        {
          groupId: "G2",
          assertionIds: ["H0002"],
          representativeAssertionId: "H0002",
        },
      ],
    },
  });
  assert.equal(inspected.validation.status, "FAIL");
  assert.deepEqual(inspected.validation.selectedRepresentativeOutsideGroup, [{
    groupId: "G1",
    representativeAssertionId: "H0002",
  }]);
});

function outputFor(variantId: Gde2VariantId) {
  const assertionIds = assertions.map((row) => row.assertionId);
  if (variantId === "A") {
    return {
      groups: [{
        groupId: "GROUP-001",
        assertionIds,
        representativeAssertionId: "H0001",
      }],
    };
  }
  if (variantId === "B") {
    return {
      groups: [{
        groupId: "GROUP-001",
        assertionIds,
        representativeAssertion: "A concise representative.",
      }],
    };
  }
  return {
    groups: [{
      groupId: "GROUP-001",
      assertionIds,
      representativeType: "selected",
      representativeAssertionId: "H0001",
    }],
  };
}

test("runner makes exactly nine governed calls and preserves every response before validation", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cf7-gde2-"));
  try {
    const outputDirectory = path.join(temporaryRoot, "run");
    const writer = new Gde2ForensicWriter(outputDirectory);
    await writer.initialize();
    const requests: Array<Record<string, unknown>> = [];
    const provider: Cf7StructuredProvider = {
      async invokeStructured(request) {
        requests.push(request as unknown as Record<string, unknown>);
        const schemaName = request.responseSchema.name;
        const variantId: Gde2VariantId = schemaName.includes("selected")
          ? "A"
          : schemaName.includes("synthesized")
            ? "B"
            : "C";
        const output = outputFor(variantId);
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
    const result = await runGde2Experiment({
      assertions,
      assertionInventoryHash: "inventory-hash",
      provider,
      forensicWriter: writer,
      config: { ...DEFAULT_GDE2_CONFIG },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.providerCallCount, 9);
    assert.equal(requests.length, 9);
    assert.ok(requests.every((request) =>
      request.model === "gpt-4o-mini"
      && request.temperature === 0.1
      && request.retryCount === 0
      && request.store === false
      && request.maxOutputTokens === 6_000
      && request.timeoutMs === 180_000));
    for (const experiment of GDE2_EXPERIMENTS) {
      const directory = path.join(
        outputDirectory,
        `request-${experiment.experimentId}`,
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
