import test from "node:test";
import assert from "node:assert/strict";
import { CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA, CF1_SPLIT_CALL1B_ENUMS }
  from "./prompt-benchmark/promptSets/splitCall1bSourcePostureSchemaV1.js";
import { buildSplitCall1bPrompt }
  from "./prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV1.js";
import { CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA_V2 }
  from "./prompt-benchmark/promptSets/splitCall1bSourcePostureSchemaV2.js";
import { buildSplitCall1bAttributionPrompt }
  from "./prompt-benchmark/promptSets/splitCall1bSourcePosturePromptV2.js";

const schema = CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA.schema;
const judgment = schema.properties.candidateJudgments.items;

test("schema is strict with the candidate-judgment output only", () => {
  assert.equal(CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA.strict, true);
  assert.deepEqual(schema.required, ["candidateJudgments"]);
  assert.equal(schema.additionalProperties, false);
  assert.ok(!("censusOutcomes" in schema.properties));
  assert.ok(!("mintedClaims" in schema.properties));
});

test("1B emits no claimText for existing candidates, and no host-owned fields", () => {
  assert.ok(!("claimText" in judgment.properties));
  // scoreTransform + the thesis-effect fields are host-derived from contentStance now,
  // so 1B must not emit any of them (nor a warrant).
  for (const banned of ["scoreTransform", "scoreTransformCheck", "warrant", "articleUse",
    "ifSupportedEffect", "ifRefutedEffect"]) {
    assert.ok(!(banned in judgment.properties), `1B judgment must not carry ${banned}`);
  }
});

test("candidate judgment carries source, the two posture judgments, response units, needsSplit", () => {
  assert.deepEqual([...judgment.required].sort(),
    ["articleDeployment", "articleRole", "assertionSource", "candidateId", "contentStance",
      "needsSplit", "responseUnitIds", "sourceUnitIds"].sort());
  assert.deepEqual(judgment.properties.contentStance.enum, CF1_SPLIT_CALL1B_ENUMS.CONTENT_STANCE);
  assert.deepEqual(judgment.properties.articleDeployment.enum, CF1_SPLIT_CALL1B_ENUMS.ARTICLE_DEPLOYMENT);
});

test("needsSplit is present-but-optional: boolean split + nullable reason", () => {
  const ns = judgment.properties.needsSplit;
  assert.equal(ns.properties.split.type, "boolean");
  assert.deepEqual(ns.properties.reason.type, ["string", "null"]);
  assert.deepEqual(ns.required, ["split", "reason"]);
});

test("prompt states the immutability and flagged-split rules; sends no full article", () => {
  const prompt = buildSplitCall1bPrompt({
    orientation: { theme: { text: "T" }, thesis: { text: "Th" }, thesisHinge: "substance",
      pillars: [{ label: "P", importance: "major" }] },
    articleAuthors: ["Jill Erzen"],
    packets: [{ id: "CAND01", origin: "candidate", claimText: "X", groundingSpan: "distant",
      claimUnits: "grounding text" }],
  });
  const sys = prompt.system.replace(/\s+/g, " "); // tolerate line wrapping
  assert.match(sys, /claimText is immutable/i);
  assert.match(sys, /Never negate it, rebut it, paraphrase it into the article's position/i);
  assert.match(sys, /whether they carry different assertionSources/i);
  assert.ok(!/CENSUS PACKETS|mintedClaims|censusOutcomes/i.test(sys));
  assert.match(sys, /host derives the transform deterministically from contentStance/i);
  // The two posture judgments are separate; contentStance is content-vs-thesis alone.
  assert.match(sys, /Decide from claimText and the thesis ALONE/i);
  // Anti-inversion: contrarian thesis + no alarming/source-reputation shortcut.
  assert.match(sys, /thesis may be contrarian/i);
  assert.match(sys, /source plays NO part in this field/i);
  assert.match(sys, /claim asserting that same matter is NOT fine.*supports_thesis/i);
  assert.match(sys, /contentStance and articleDeployment MAY disagree/i);
  assert.match(sys, /possibleResponse.*inform\s+articleDeployment/i);
  assert.match(sys, /must NEVER change contentStance/i);
  // Never default to byline; no warrant anywhere.
  assert.match(sys, /Never default to the article's byline/i);
  assert.ok(!/warrant/i.test(sys));
  // Orientation + the packet ride along, but not a full article body.
  assert.match(prompt.user, /ORIENTATION:/);
  assert.match(prompt.user, /grounding text/);
  assert.equal(prompt.responseSchema.name, "cf1_call1b_source_posture_v1");
});

test("attribution V2 requires a source basis and an explicit resolution outcome", () => {
  const item = CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA_V2.schema
    .properties.candidateJudgments.items;
  assert.ok(item.required.includes("assertionSourceUnitIds"));
  assert.ok(item.required.includes("assertionSourceResolution"));
  assert.deepEqual(item.properties.assertionSourceResolution.enum, [
    "resolved_from_candidate", "resolved_from_context", "no_candidate_available",
    "candidates_present_unresolved", "not_evaluated_unresolved",
  ]);
});

test("attribution V2 distinguishes zero source candidates from unresolved candidates", () => {
  const prompt = buildSplitCall1bAttributionPrompt({
    orientation: { thesis: { text: "A contrarian conclusion." }, pillars: [] },
    packets: [{ id: "CAND01", claimText: "A proposition.", sourceCandidateStatus: "no_candidates_detected",
      sourceCandidates: [], claimUnits: [], attributionContextUnits: [], localResponseUnits: [] }],
  });
  const sys = prompt.system.replace(/\s+/g, " ");
  assert.match(sys, /sourceCandidates are deterministic textual hints, not answers/i);
  assert.match(sys, /no_candidates_detected.*no_candidate_available/i);
  assert.match(sys, /candidates are present.*candidates_present_unresolved/i);
  assert.match(sys, /localResponseUnit may also establish the supplier only when it completes/i);
  assert.match(sys, /no_candidates_detected.*only that the host found no pattern/i);
  assert.match(sys, /Never infer one field from another/i);
  assert.match(sys, /article_voice candidate is not a default/i);
  assert.match(sys, /ordinary unattributed narrative prose/i);
  assert.doesNotMatch(sys, /resolved author source/i);
  assert.equal(prompt.responseSchema.name, "cf1_call1b_source_posture_attribution_v2");
});
