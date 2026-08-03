import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAiCf7StructuredProvider,
  type Cf7StructuredModelResponse,
  type Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import {
  buildCf7S3BatchPlan,
} from "../../../src/claimfoundry/cf7/atomicity/batching.js";
import {
  completeCf7S3Grounding,
} from "../../../src/claimfoundry/cf7/atomicity/groundingCompleteness.js";
import {
  runCf7S3Atomicity,
} from "../../../src/claimfoundry/cf7/atomicity/runAtomicity.js";
import {
  buildCf7S3RoutingManifest,
  classifyCf7S3CompoundCandidate,
} from "../../../src/claimfoundry/cf7/atomicity/routing.js";
import {
  CF7_S3_JSON_SCHEMA,
  cf7S3DecisionSchema,
} from "../../../src/claimfoundry/cf7/atomicity/schema.js";
import type {
  Cf7S3Decision,
  Cf7S3ParentRow,
} from "../../../src/claimfoundry/cf7/atomicity/types.js";
import {
  validateCf7S3BatchResponse,
} from "../../../src/claimfoundry/cf7/atomicity/validateAtomicity.js";
import type {
  Cf7SourceUnit,
} from "../../../src/claimfoundry/cf7/types/index.js";

const config = {
  model: "test-model",
  maximumConcurrency: 2,
  maxOutputTokens: 6_000,
  timeoutMs: 1_000,
  temperature: 0.1,
  retryCount: 0 as const,
  store: false as const,
};

function unit(
  unitId: string,
  text: string,
  index: number,
  contextUnitIds?: string[],
): Cf7SourceUnit {
  return {
    unitId,
    text,
    charStart: index * 100,
    charEnd: index * 100 + text.length,
    regionId: "REGION-001",
    quarter: 1,
    ...(contextUnitIds ? { contextUnitIds } : {}),
  };
}

function parent(
  harvestRowId: string,
  assertionText: string,
  groundingUnitIds = ["U0001"],
  chunkId = "CHUNK-001",
): Cf7S3ParentRow {
  return {
    harvestRowId,
    chunkId,
    chunkIndex: Number(chunkId.slice(-3)),
    rowKind: "assertion",
    assertionText,
    groundingUnitIds,
  };
}

function keep(row: Cf7S3ParentRow): Cf7S3Decision {
  return {
    parentHarvestRowId: row.harvestRowId,
    action: "keep_verbatim",
  };
}

function split(
  row: Cf7S3ParentRow,
  children: Array<{ assertionText: string; groundingUnitIds: string[] }>,
): Cf7S3Decision {
  return {
    parentHarvestRowId: row.harvestRowId,
    action: "split",
    children,
  };
}

function response(output: unknown): Cf7StructuredModelResponse {
  return {
    output,
    rawResponse: { id: "response-test", output },
    model: "test-model",
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
    },
    responseId: "response-test",
    requestId: "request-test",
  };
}

test("keep_verbatim has no model-authored child and host copies canonical parent bytes", () => {
  const row = parent("H0001", "The report listed 10 cases.");
  const result = validateCf7S3BatchResponse({
    expectedParents: [row],
    units: [unit("U0001", row.assertionText, 0)],
    output: { results: [keep(row)] },
  });
  assert.equal(result[0]!.action, "keep_verbatim");
  assert.equal(result[0]!.decisionSource, "model");
  assert.deepEqual(result[0]!.children, [{
    assertionText: row.assertionText,
    groundingUnitIds: row.groundingUnitIds,
    derivation: "preserved",
  }]);
});

test("keep_verbatim rejects replacement fields through the strict minimal schema", () => {
  assert.equal(cf7S3DecisionSchema.safeParse({
    parentHarvestRowId: "H0001",
    action: "keep_verbatim",
    children: [],
  }).success, false);
});

test("split accepts two independently grounded children", () => {
  const text = "The study found benefit and the agency rejected approval.";
  const row = parent("H0001", text);
  const result = validateCf7S3BatchResponse({
    expectedParents: [row],
    units: [unit("U0001", text, 0)],
    output: { results: [split(row, [
      { assertionText: "The study found benefit.", groundingUnitIds: ["U0001"] },
      {
        assertionText: "The agency rejected approval.",
        groundingUnitIds: ["U0001"],
      },
    ])] },
  });
  assert.equal(result[0]!.children.length, 2);
  assert.ok(result[0]!.children.every(
    (child) => child.derivation === "split_component",
  ));
});

test("split accepts three children and preserves parent lineage", () => {
  const text = "The report found A, the agency rejected B, and the board approved C.";
  const row = parent("H0001", text);
  const result = validateCf7S3BatchResponse({
    expectedParents: [row],
    units: [unit("U0001", text, 0)],
    output: { results: [split(row, [
      { assertionText: "The report found A.", groundingUnitIds: ["U0001"] },
      { assertionText: "The agency rejected B.", groundingUnitIds: ["U0001"] },
      { assertionText: "The board approved C.", groundingUnitIds: ["U0001"] },
    ])] },
  });
  assert.equal(result[0]!.parentHarvestRowId, "H0001");
  assert.equal(result[0]!.children.length, 3);
});

test("split rejects protected content absent from effective grounding", () => {
  const row = parent("H0216", "High exposure was studied.");
  assert.throws(() => validateCf7S3BatchResponse({
    expectedParents: [row],
    units: [unit("U0001", row.assertionText, 0)],
    output: { results: [split(row, [
      {
        assertionText: "High exposure caused a 7.6-fold autism risk.",
        groundingUnitIds: ["U0001"],
      },
      { assertionText: "High exposure was studied.", groundingUnitIds: ["U0001"] },
    ])] },
  }), /protected content/);
});

test("split rejects foreign grounding and duplicate children", () => {
  const text = "The study found benefit and the agency rejected approval.";
  const row = parent("H0001", text);
  assert.throws(() => validateCf7S3BatchResponse({
    expectedParents: [row],
    units: [
      unit("U0001", text, 0),
      unit("U0002", "Foreign context.", 1),
    ],
    output: { results: [split(row, [
      { assertionText: "The study found benefit.", groundingUnitIds: ["U0002"] },
      { assertionText: "The study found benefit.", groundingUnitIds: ["U0002"] },
    ])] },
  }), /outside its parent/);
});

test("missing, duplicate, and unknown parent decisions are rejected", () => {
  const first = parent("H0001", "One.");
  const second = parent("H0002", "Two.");
  const units = [unit("U0001", "One. Two.", 0)];
  assert.throws(() => validateCf7S3BatchResponse({
    expectedParents: [first, second],
    units,
    output: { results: [keep(first)] },
  }), /Missing decision/);
  assert.throws(() => validateCf7S3BatchResponse({
    expectedParents: [first],
    units,
    output: { results: [keep(first), keep(first)] },
  }), /Duplicate decision/);
  assert.throws(() => validateCf7S3BatchResponse({
    expectedParents: [first],
    units,
    output: { results: [{
      parentHarvestRowId: "H9999",
      action: "keep_verbatim",
    }] },
  }), /Unknown parent/);
});

test("grounding completion joins an incomplete honorific to its continuation", () => {
  const units = [
    unit("U0001", "In 1999 the agency commissioned epidemiologist Dr.", 0),
    unit("U0002", "Thomas Rivera to conduct the study.", 1),
  ];
  const row = parent("H0001", "The agency commissioned Dr. Thomas Rivera.", ["U0001"]);
  const completed = completeCf7S3Grounding({ parents: [row], units });
  assert.deepEqual(
    completed.parents[0]!.groundingUnitIds,
    ["U0001", "U0002"],
  );
  assert.equal(
    completed.completions[0]!.reasons[0]!.reason,
    "incomplete_terminal_continuation",
  );
});

test("grounding completion declares antecedent context without rewriting source text", () => {
  const units = [
    unit("U0001", "The regulator rejected the filing.", 0),
    unit("U0002", "It later approved a revision.", 1, ["U0001"]),
  ];
  const row = parent("H0001", units[1]!.text, ["U0002"]);
  const completed = completeCf7S3Grounding({ parents: [row], units });
  assert.deepEqual(
    completed.parents[0]!.groundingUnitIds,
    ["U0001", "U0002"],
  );
  assert.equal(units[1]!.text, "It later approved a revision.");
});

test("compound gate routes truth-condition candidates and bypasses simple claims", () => {
  const compound = parent(
    "H0001",
    "The study found benefit and the agency rejected approval.",
  );
  const simple = parent("H0002", "The report listed 10 cases.");
  assert.equal(classifyCf7S3CompoundCandidate(compound).routed, true);
  assert.ok(
    classifyCf7S3CompoundCandidate(compound).signals.includes(
      "multiple_clausal_conjunction",
    ),
  );
  assert.equal(classifyCf7S3CompoundCandidate(simple).routed, false);
});

test("compound routing manifest is byte-stable and accounts for every parent", () => {
  const parents = [
    parent("H0001", "The report listed 10 cases."),
    parent("H0002", "The study found benefit and the agency rejected approval."),
  ];
  const first = buildCf7S3RoutingManifest(parents);
  const second = buildCf7S3RoutingManifest(parents);
  assert.deepEqual(first, second);
  assert.equal(first.totalParentCount, 2);
  assert.equal(first.routedParentCount, 1);
  assert.equal(first.bypassedParentCount, 1);
});

test("simple rows bypass the provider and are copied verbatim", async () => {
  const text = "The report listed 10 cases.";
  const row = parent("H0001", text);
  let providerCalls = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured() {
      providerCalls += 1;
      throw new Error("provider must not be called");
    },
  };
  const result = await runCf7S3Atomicity({
    parents: [row],
    units: [unit("U0001", text, 0)],
    provider,
    config,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.expectedRequestCount, 0);
  assert.equal(result.status, "completed");
  assert.equal(result.bypassedParentCount, 1);
  assert.equal(result.atomicInventory[0]!.assertionText, text);
});

test("only routed parents reach the provider and all parents reassemble in source order", async () => {
  const simple = parent("H0001", "The report listed 10 cases.");
  const compoundText = "The study found benefit and the agency rejected approval.";
  const compound = parent("H0002", compoundText);
  let providerCalls = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured() {
      providerCalls += 1;
      return response({ results: [keep(compound)] });
    },
  };
  const result = await runCf7S3Atomicity({
    parents: [simple, compound],
    units: [unit("U0001", `${simple.assertionText} ${compoundText}`, 0)],
    provider,
    config,
  });
  assert.equal(providerCalls, 1);
  assert.equal(result.routedParentCount, 1);
  assert.equal(result.bypassedParentCount, 1);
  assert.deepEqual(
    result.evaluations.map((row) => row.parentHarvestRowId),
    ["H0001", "H0002"],
  );
});

test("zero-retry provider failure is called once and preserves bypassed work", async () => {
  const simple = parent("H0001", "The report listed 10 cases.");
  const compound = parent(
    "H0002",
    "The study found benefit and the agency rejected approval.",
  );
  let providerCalls = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured() {
      providerCalls += 1;
      throw new Error("synthetic provider failure");
    },
  };
  const result = await runCf7S3Atomicity({
    parents: [simple, compound],
    units: [unit("U0001", `${simple.assertionText} ${compound.assertionText}`, 0)],
    provider,
    config,
  });
  assert.equal(providerCalls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.validatedEvaluations.length, 1);
  assert.equal(result.quarantinedRows[0]!.parentHarvestRowId, "H0002");
});

test("batch plan is deterministic and carries only the reduced schema", () => {
  const text = "The study found benefit and the agency rejected approval.";
  const parents = [parent("H0001", text)];
  const units = [unit("U0001", text, 0)];
  const first = buildCf7S3BatchPlan({ parents, units });
  const second = buildCf7S3BatchPlan({ parents, units });
  assert.deepEqual(first, second);
  assert.equal(first.manifest.expectedRequestCount, 1);
  assert.equal(CF7_S3_JSON_SCHEMA.name, "cf7_s3_decomposition_v2");
  assert.doesNotMatch(JSON.stringify(CF7_S3_JSON_SCHEMA), /parentChunkId|reason|derivation/);
});

test("strict schema and governed request settings reach the provider", async () => {
  const text = "The study found benefit and the agency rejected approval.";
  const row = parent("H0001", text);
  let seen: Record<string, unknown> | null = null;
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      seen = request as unknown as Record<string, unknown>;
      return response({ results: [keep(row)] });
    },
  };
  await runCf7S3Atomicity({
    parents: [row],
    units: [unit("U0001", text, 0)],
    provider,
    config,
  });
  const seenRequest = seen as Record<string, unknown> | null;
  assert.ok(seenRequest);
  assert.equal(seenRequest.model, "test-model");
  assert.equal(seenRequest.temperature, 0.1);
  assert.equal(seenRequest.retryCount, 0);
  assert.equal(seenRequest.store, false);
  assert.deepEqual(seenRequest.responseSchema, CF7_S3_JSON_SCHEMA);
});

test("Chat Completions adapter receives one attempt and store false", async () => {
  let generated: Record<string, unknown> | null = null;
  const provider = createOpenAiCf7StructuredProvider({
    async generate(input) {
      generated = input;
      return {
        output: {
          results: [{
            parentHarvestRowId: "H0001",
            action: "keep_verbatim",
          }],
        },
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        rawResponse: { id: "chatcmpl-test", request_id: "request-test" },
      };
    },
  });
  await provider.invokeStructured({
    system: "system",
    user: "user",
    responseSchema: CF7_S3_JSON_SCHEMA,
    model: "gpt-4o-mini",
    temperature: 0.1,
    retryCount: 0,
    store: false,
    maxOutputTokens: 6_000,
    timeoutMs: 180_000,
  });
  const generatedRequest = generated as Record<string, unknown> | null;
  assert.ok(generatedRequest);
  assert.equal(generatedRequest.maxRetries, 1);
  assert.equal(generatedRequest.store, false);
  assert.equal(generatedRequest.temperature, 0.1);
});
