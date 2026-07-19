import test from "node:test";
import assert from "node:assert/strict";
import { deriveScoreTransform } from "../../src/claim-foundry/splitScoreTransform.js";
import { deriveArticleUse } from "../../src/claim-foundry/splitArticleUse.js";
import { classifyAssertionSource } from "../../src/claim-foundry/splitAssertionSourceClass.js";
import { finalizeSplitInventory } from "../../src/claim-foundry/splitHostFinalize.js";
import { CF1_SEMANTIC_INVENTORY_SCHEMA } from "../../src/claim-foundry/prompts/semanticInventorySchema.js";

// ---- scoreTransform (now derived from contentStance, not effects) ----
test("scoreTransform derives from contentStance and blocks an unknown stance", () => {
  assert.equal(deriveScoreTransform({ contentStance: "supports_thesis" }), "normal");
  assert.equal(deriveScoreTransform({ contentStance: "contradicts_thesis" }), "invert");
  assert.equal(deriveScoreTransform({ contentStance: "neutral" }), "none");
  assert.throws(() => deriveScoreTransform({ contentStance: "sorta" }),
    (error) => error.code === "CF1_SPLIT_SCORE_TRANSFORM_INCONSISTENT");
  assert.throws(() => deriveScoreTransform({}));
});

// ---- articleUse (derived from the contentStance/articleDeployment pair) ----
test("articleUse derives from the posture pair and surfaces the inconsistent cells", () => {
  assert.equal(deriveArticleUse({ contentStance: "supports_thesis", articleDeployment: "endorsed" }), "endorsed");
  assert.equal(deriveArticleUse({ contentStance: "supports_thesis", articleDeployment: "reported_neutral" }), "reported");
  assert.equal(deriveArticleUse({ contentStance: "contradicts_thesis", articleDeployment: "reported_neutral" }), "opponent_to_rebut");
  assert.equal(deriveArticleUse({ contentStance: "contradicts_thesis", articleDeployment: "rebutted" }), "rejected");
  assert.equal(deriveArticleUse({ contentStance: "neutral", articleDeployment: "endorsed" }), "qualification");
  assert.equal(deriveArticleUse({ contentStance: "neutral", articleDeployment: "reported_neutral" }), "background");
  // The two genuinely contradictory cells are blocking, never silently resolved.
  assert.throws(() => deriveArticleUse({ contentStance: "supports_thesis", articleDeployment: "rebutted" }),
    (error) => error.code === "CF1_SPLIT_ARTICLE_USE_INCONSISTENT");
  assert.throws(() => deriveArticleUse({ contentStance: "contradicts_thesis", articleDeployment: "endorsed" }),
    (error) => error.code === "CF1_SPLIT_ARTICLE_USE_INCONSISTENT");
});

// ---- assertionSource classification ----
test("assertionSource classifies into the three credibility tiers", () => {
  const authors = { articleAuthors: ["Dana Lowell"] };
  assert.equal(classifyAssertionSource("Dana Lowell", authors), "author_voice");
  assert.equal(classifyAssertionSource("the article", authors), "author_voice");
  assert.equal(classifyAssertionSource("NASA", authors), "institutional"); // generic acronym cue
  assert.equal(classifyAssertionSource("University of Springfield", authors), "institutional");
  assert.equal(classifyAssertionSource("Acme Corporation", authors), "institutional");
  assert.equal(classifyAssertionSource("Michael Sorensen", authors), "attributed_testimony");
  assert.equal(classifyAssertionSource("Sorensen", authors), "attributed_testimony");
});

// ---- finalize pipeline ----
const inventory1a = {
  theme: { text: "theme", sourceUnitIds: ["U0001"] }, thesis: { text: "thesis", sourceUnitIds: ["U0001"] },
  pillars: [{ label: "Tox", text: "t", importance: "load_bearing", sourceUnitIds: ["U0001"] }],
  thesisHinge: "substance",
  candidateClaims: [
    { claimText: "Glyphosate formulations are far more toxic than glyphosate alone",
      sourceUnitIds: ["U0010"], materiality: "high", relatedPillarLabels: ["Tox"],
      scope: "products", evidenceUsefulnessHint: "hint", groundingSpan: "clustered" },
    { claimText: "Regulators rely on industry-funded studies", sourceUnitIds: ["U0037"],
      materiality: "medium", relatedPillarLabels: ["Reg"], scope: "regulation",
      evidenceUsefulnessHint: "hint", groundingSpan: "clustered" },
  ],
};
const call1bOutput = {
  candidateJudgments: [
    { candidateId: "CAND01", assertionSource: "Antoniou", contentStance: "supports_thesis",
      articleDeployment: "endorsed", articleRole: "pillar", sourceUnitIds: ["U0010"],
      responseUnitIds: [], needsSplit: { split: false, reason: null } },
    { candidateId: "CAND02", assertionSource: "the article", contentStance: "neutral",
      articleDeployment: "reported_neutral", articleRole: "pillar_support", sourceUnitIds: ["U0037"],
      responseUnitIds: [], needsSplit: { split: false, reason: null } },
  ],
};
const article = { authors: ["Jill Erzen"], text: "x".repeat(200) };

test("merges 1A + 1B into a clean cf1_semantic_inventory_v1-shaped object", () => {
  const { inventory } = finalizeSplitInventory({ inventory1a, call1bOutput, article });
  assert.deepEqual(inventory.thesisHinge, "substance");
  const first = inventory.candidateClaims.find((c) => c.claimText.startsWith("Glyphosate"));
  assert.equal(first.assertionSource, "Antoniou"); // from 1B
  assert.equal(first.articleUse, "endorsed"); // host-derived: supports_thesis + endorsed
  assert.equal(first.materiality, "high"); // from 1A
  // merged claims carry no host sidecar or effects fields
  for (const claim of inventory.candidateClaims) {
    assert.ok(!("_split" in claim));
    assert.ok(!("ifSupportedEffect" in claim));
    assert.ok(!("scoreTransform" in claim));
  }
});

test("merged claims match cf1_semantic_inventory_v1 exactly (zero downstream changes)", () => {
  const { inventory } = finalizeSplitInventory({ inventory1a, call1bOutput, article });
  assert.deepEqual(Object.keys(inventory).sort(),
    ["candidateClaims", "pillars", "theme", "thesis", "thesisHinge"]);
  const required = [...CF1_SEMANTIC_INVENTORY_SCHEMA.schema.properties.candidateClaims.items.required].sort();
  for (const claim of inventory.candidateClaims) {
    assert.deepEqual(Object.keys(claim).sort(), required,
      "merged claim must carry exactly the live schema's candidate fields");
  }
});

test("ignores legacy census-mint material rather than creating a claim", () => {
  const legacyOutput = { ...call1bOutput, mintedClaims: [{ censusId: "CEN001",
    claimText: "The EPA set safety limits without testing full formulations", assertionSource: "EPA",
    contentStance: "contradicts_thesis", articleDeployment: "reported_neutral",
    articleRole: "opponent_claim", sourceUnitIds: ["U0055"], responseUnitIds: [] }] };
  const { inventory } = finalizeSplitInventory({ inventory1a, call1bOutput: legacyOutput, article });
  assert.ok(!inventory.candidateClaims.some((claim) => claim.claimText.startsWith("The EPA")));
});

test("derives scoreTransform per claim into host signals", () => {
  const { hostSignals } = finalizeSplitInventory({ inventory1a, call1bOutput, article });
  const byText = (p) => hostSignals.find((s) => s.claimText.startsWith(p));
  assert.equal(byText("Glyphosate").scoreTransform, "normal");
  assert.equal(byText("Regulators").scoreTransform, "none");
});

test("collapses same proposition + same source, keeps same proposition + different source", () => {
  const dupSameSource = {
    candidateJudgments: [
      { candidateId: "CAND01", assertionSource: "Antoniou", contentStance: "supports_thesis",
        articleDeployment: "endorsed", articleRole: "pillar", sourceUnitIds: ["U0010"],
        responseUnitIds: [], needsSplit: { split: false, reason: null } },
      { candidateId: "CAND02", assertionSource: "Antoniou", contentStance: "supports_thesis",
        articleDeployment: "endorsed", articleRole: "pillar", sourceUnitIds: ["U0011"],
        responseUnitIds: [], needsSplit: { split: false, reason: null } },
    ],
  };
  const twoSame = { ...inventory1a, candidateClaims: [
    { ...inventory1a.candidateClaims[0] },
    { ...inventory1a.candidateClaims[0], sourceUnitIds: ["U0011"] }] };
  const collapsed = finalizeSplitInventory({ inventory1a: twoSame, call1bOutput: dupSameSource, article });
  assert.equal(collapsed.inventory.candidateClaims.length, 1);
  assert.equal(collapsed.diagnostics.duplicateCollapses.length, 1);

  const dupDiffSource = structuredClone(dupSameSource);
  dupDiffSource.candidateJudgments[1].assertionSource = "EPA";
  const kept = finalizeSplitInventory({ inventory1a: twoSame, call1bOutput: dupDiffSource, article });
  assert.equal(kept.inventory.candidateClaims.length, 2); // same proposition, different source
});

test("promotes a linked unknown duplicate to the concrete source after 1B", () => {
  const duplicateInventory = { ...inventory1a, candidateClaims: [
    { ...inventory1a.candidateClaims[0], sourceUnitIds: ["U0010"], attributionContextUnitIds: [] },
    { ...inventory1a.candidateClaims[0], sourceUnitIds: ["U0040"], attributionContextUnitIds: ["U0039"] },
  ] };
  const output = { candidateJudgments: [
    { candidateId: "CAND01", assertionSource: "unknown", assertionSourceUnitIds: [],
      assertionSourceResolution: "no_candidate_available", contentStance: "supports_thesis",
      articleDeployment: "endorsed", articleRole: "pillar", sourceUnitIds: ["U0010"],
      responseUnitIds: [], needsSplit: { split: false, reason: null } },
    { candidateId: "CAND02", assertionSource: "William Hart", assertionSourceUnitIds: ["U0039"],
      assertionSourceResolution: "resolved_from_context", contentStance: "supports_thesis",
      articleDeployment: "endorsed", articleRole: "pillar", sourceUnitIds: ["U0040"],
      responseUnitIds: [], needsSplit: { split: false, reason: null } },
  ] };
  const packets = [
    { id: "CAND01", sourceCandidateStatus: "no_candidates_detected", sourceCandidates: [] },
    { id: "CAND02", sourceCandidateStatus: "candidates_found",
      sourceCandidates: [{ nameHint: "William Hart", unitIds: ["U0039"] }] },
  ];
  const result = finalizeSplitInventory({ inventory1a: duplicateInventory,
    call1bOutput: output, packets, article });
  assert.equal(result.inventory.candidateClaims.length, 1);
  assert.equal(result.inventory.candidateClaims[0].assertionSource, "William Hart");
  assert.deepEqual(result.hostSignals[0].mergedCandidateIds.sort(), ["CAND01", "CAND02"]);
  assert.equal(result.diagnostics.duplicateCollapses[0].reason,
    "same_proposition_unknown_promoted_to_concrete");
});

test("does not collapse two unresolved occurrences merely because proposition text matches", () => {
  const duplicateInventory = { ...inventory1a, candidateClaims: [
    { ...inventory1a.candidateClaims[0], sourceUnitIds: ["U0010"], attributionContextUnitIds: [] },
    { ...inventory1a.candidateClaims[0], sourceUnitIds: ["U0040"], attributionContextUnitIds: [] },
  ] };
  const output = { candidateJudgments: ["CAND01", "CAND02"].map((candidateId, index) => ({
    candidateId, assertionSource: "unknown", assertionSourceUnitIds: [],
    assertionSourceResolution: "no_candidate_available", contentStance: "supports_thesis",
    articleDeployment: "endorsed", articleRole: "pillar",
    sourceUnitIds: [index ? "U0040" : "U0010"], responseUnitIds: [],
    needsSplit: { split: false, reason: null },
  })) };
  const result = finalizeSplitInventory({ inventory1a: duplicateInventory,
    call1bOutput: output, packets: ["CAND01", "CAND02"].map((id) => ({ id,
      sourceCandidateStatus: "no_candidates_detected", sourceCandidates: [] })), article });
  assert.equal(result.inventory.candidateClaims.length, 2);
});

test("selection respects the target maximum", () => {
  const many = { ...inventory1a, candidateClaims: Array.from({ length: 20 }, (_, i) => ({
    claimText: `Subject${i}alpha triggers Object${i}beta`, sourceUnitIds: [`U${String(i + 1).padStart(4, "0")}`],
    materiality: "medium", relatedPillarLabels: [], scope: "s", evidenceUsefulnessHint: "h", groundingSpan: "clustered" })) };
  const judgments = { candidateJudgments: many.candidateClaims.map((_, i) => ({
    candidateId: `CAND${String(i + 1).padStart(2, "0")}`, assertionSource: "EPA", contentStance: "neutral",
    articleDeployment: "reported_neutral", articleRole: "pillar_support",
    sourceUnitIds: [`U${String(i + 1).padStart(4, "0")}`], responseUnitIds: [], needsSplit: { split: false, reason: null } })),
  };
  const { inventory } = finalizeSplitInventory({ inventory1a: many, call1bOutput: judgments,
    article: { authors: [], text: "x".repeat(200) }, options: { targetMax: 12 } });
  assert.equal(inventory.candidateClaims.length, 12);
});
