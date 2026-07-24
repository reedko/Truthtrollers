import test from "node:test";
import assert from "node:assert/strict";
import { CF1_SEMANTIC_INVENTORY_SCHEMA }
  from "../../src/claim-foundry/prompts/semanticInventorySchema.js";
import { CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA, EXCLUDED_FROM_1A }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoverySchemaV1.js";
import { buildSplitCall1aPrompt }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptSimpleV2.js";
import { buildSplitCall1aAttributionPrompt }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptAttributionV3.js";
import { CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoverySchemaAttributionV2.js";
import { CF1_SPLIT_CALL1A_ATOMICITY_TRACE_SCHEMA }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoverySchemaAtomicityV1.js";
import { buildSplitCall1aAtomicityPrompt }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptAtomicityV1.js";
import { buildSplitCall1aClaimLanguagePrompt }
  from "../claim-foundry/prompt-benchmark/promptSets/splitCall1aDiscoveryPromptClaimLanguageV3.js";
import { prepareArticle } from "../claim-foundry/prompt-benchmark/generationRun.js";
import { readFileSync } from "node:fs";

const liveClaim = CF1_SEMANTIC_INVENTORY_SCHEMA.schema.properties.candidateClaims.items;
const splitClaim = CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.schema.properties.candidateClaims.items;

test("1A candidate fields are a strict subset of the live schema (no drift)", () => {
  const liveFields = new Set(Object.keys(liveClaim.properties));
  for (const field of Object.keys(splitClaim.properties)) {
    assert.ok(liveFields.has(field), `1A field ${field} must reuse a live field name`);
    assert.deepEqual(splitClaim.properties[field], liveClaim.properties[field],
      `1A field ${field} must match the live definition exactly`);
  }
});

test("1A excludes exactly the posture/source/effects/warrant fields", () => {
  for (const field of EXCLUDED_FROM_1A) {
    assert.ok(!(field in splitClaim.properties), `${field} must not be in 1A properties`);
    assert.ok(!splitClaim.required.includes(field), `${field} must not be required by 1A`);
  }
});

test("1A keeps exactly the discovery fields", () => {
  assert.deepEqual([...splitClaim.required].sort(),
    ["claimText", "evidenceUsefulnessHint", "materiality", "relatedPillarLabels",
      "scope", "sourceUnitIds"].sort());
});

test("1A introduces no propositionCore duplicate of claimText", () => {
  assert.ok("claimText" in splitClaim.properties);
  assert.ok(!("propositionCore" in splitClaim.properties));
});

test("1A schema has a distinct, non-live schema name", () => {
  assert.equal(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.name, "cf1_semantic_inventory_split_discovery_v1");
  assert.notEqual(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.name, CF1_SEMANTIC_INVENTORY_SCHEMA.name);
  assert.equal(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.strict, true);
});

test("orientation fields (theme/thesis/pillars/thesisHinge) pass through unchanged", () => {
  for (const key of ["theme", "thesis", "pillars", "thesisHinge"]) {
    assert.deepEqual(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.schema.properties[key],
      CF1_SEMANTIC_INVENTORY_SCHEMA.schema.properties[key]);
  }
});

test("1A has no schema candidate count constraints and no prompt count", () => {
  const prompt = buildSplitCall1aPrompt({ article: { title: "x", text: "x".repeat(6_000) },
    structuralBlocks: [], sourceUnits: [] });
  const claims = prompt.responseSchema.schema.properties.candidateClaims;
  assert.equal(claims.minItems, undefined);
  assert.equal(claims.maxItems, undefined);
  assert.doesNotMatch(prompt.user, /discovery floor|claim budget|at least\s+\d+|at most|up to\s+\d+/i);
});

test("1A prompt supplies a deterministic complete-article review range", () => {
  const prompt = buildSplitCall1aPrompt({ article: { title: "x", text: "x".repeat(6_000) },
    structuralBlocks: [
      { blockId: "B001", sourceUnitIds: ["U0001"] },
      { blockId: "B002", sourceUnitIds: ["U0002"] },
      { blockId: "B003", sourceUnitIds: ["U0003", "U0004"] },
    ],
    sourceUnits: ["U0001", "U0002", "U0003", "U0004"].map((unitId) => ({ unitId })),
  });
  assert.match(prompt.user, /Review every structural block from B001 through B003/);
  assert.match(prompt.user, /U0001 through U0004/);
});

test("1A prompt builds on a real fixture and carries no posture/source instruction", () => {
  const raw = JSON.parse(readFileSync(
    new URL("../claim-foundry/fixtures/CF1-F02/article.json", import.meta.url)));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const prompt = buildSplitCall1aPrompt({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits });
  assert.ok(prompt.user.includes("STRUCTURED ARTICLE:"));
  assert.ok(prompt.user.includes(article.title));
  assert.ok(/one local passage/i.test(prompt.user));
  assert.ok(/distant passages/i.test(prompt.user));
  assert.match(prompt.system, /original polarity/i);
  assert.match(prompt.system, /Do not negate it, correct it, characterize it as false or\s+unsupported/i);
  assert.match(prompt.user, /direct quotations, attributed assertions, advertisement statements, and list items/i);
  // 1A must not instruct posture/source at all.
  assert.ok(!/assertionSource|articleUse|articleRole/.test(prompt.system + prompt.user));
  assert.equal(prompt.responseSchema.name, "cf1_semantic_inventory_split_discovery_v1");
});

test("atomicity trace arm changes only the response schema", () => {
  const context = { article: { title: "x", text: "x" }, structuralBlocks: [], sourceUnits: [] };
  const baseline = buildSplitCall1aPrompt(context);
  const trace = buildSplitCall1aAtomicityPrompt(context);
  assert.equal(trace.system, baseline.system);
  assert.equal(trace.user, baseline.user);
  assert.equal(trace.responseSchema.name,
    "cf1_semantic_inventory_split_discovery_atomicity_trace_v1");
  const traceClaim = trace.responseSchema.schema.properties.candidateClaims.items;
  assert.equal(Object.keys(traceClaim.properties)[0], "atomicityBasis");
  assert.equal(Object.keys(traceClaim.properties)[1], "claimText");
  assert.equal(traceClaim.required[0], "atomicityBasis");
  assert.deepEqual(Object.fromEntries(Object.entries(traceClaim.properties)
    .filter(([field]) => field !== "atomicityBasis")), splitClaim.properties);
  assert.equal(trace.responseSchema.schema.properties.candidateClaims.minItems, undefined);
  assert.equal(trace.responseSchema.schema.properties.candidateClaims.maxItems, undefined);
  assert.equal(CF1_SPLIT_CALL1A_ATOMICITY_TRACE_SCHEMA.strict, true);
});

test("Simple V3 changes only prose and uses claim terminology consistently", () => {
  const context = { article: { title: "x", text: "x" }, structuralBlocks: [], sourceUnits: [] };
  const baseline = buildSplitCall1aPrompt(context);
  const prompt = buildSplitCall1aClaimLanguagePrompt(context);
  assert.deepEqual(prompt.responseSchema, baseline.responseSchema);
  const instructions = `${prompt.system}\n${prompt.user.split("STRUCTURED ARTICLE:")[0]}`;
  assert.doesNotMatch(instructions, /\bproposition(?:s)?\b/i);
  assert.match(instructions, /one primary subject and one independently testable predicate or relationship/i);
  assert.match(instructions, /additional event, outcome, statistic, classification, effect, or article response/i);
  assert.match(instructions, /write claimText as one atomic, evidence-testable factual claim/i);
  assert.doesNotMatch(instructions, /complete, concise|split chained|combine distant/i);
});

test("attribution V3 adds only provenance units and preserves the unbounded candidate array", () => {
  const claim = CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA.schema.properties.candidateClaims.items;
  const baselineFields = Object.keys(splitClaim.properties).sort();
  assert.deepEqual(Object.keys(claim.properties).filter((field) => field !== "attributionContextUnitIds").sort(),
    baselineFields);
  assert.ok(claim.required.includes("attributionContextUnitIds"));
  assert.equal(Object.keys(claim.properties).indexOf("attributionContextUnitIds"),
    Object.keys(claim.properties).indexOf("sourceUnitIds") + 1);
  assert.equal(CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA.schema.properties.candidateClaims.minItems, undefined);
  assert.equal(CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA.schema.properties.candidateClaims.maxItems, undefined);
});

test("attribution V3 preserves occurrences without assigning assertionSource", () => {
  const prompt = buildSplitCall1aAttributionPrompt({ article: { title: "x" },
    structuralBlocks: [], sourceUnits: [] });
  assert.match(prompt.user, /possible supplier/i);
  assert.match(prompt.user, /different named or quoted suppliers/i);
  assert.match(prompt.user, /do not merge them/i);
  assert.match(prompt.system, /Do not decide assertion source/i);
  assert.doesNotMatch(prompt.user, /at least\s+\d+|at most|up to\s+\d+/i);
  assert.equal(prompt.responseSchema.name, "cf1_semantic_inventory_split_discovery_attribution_v2");
});
