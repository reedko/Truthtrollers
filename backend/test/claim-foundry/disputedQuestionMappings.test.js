import test from "node:test";
import assert from "node:assert/strict";
import { resolveEvidenceStrategy } from "../../src/claim-foundry/evidenceStrategyMap.js";
import { deriveGradeTarget } from "../../src/claim-foundry/hingeDerivation.js";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { runClaimFoundry } from "../../src/claim-foundry/runClaimFoundry.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createArticleAndBlocks, createSelectedEnrichmentOutput,
  createSemanticInventoryOutput } from "./fixtures/packages.js";

const OPTIONS = {
  model: "fake", modelContextTokens: 100_000, timeoutMs: 1_000,
  blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
  budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 },
};

const dq = (over = {}) => ({ verificationTarget: "substantive",
  disputedProposition: "Whether the underlying matter is true.",
  stipulatedByArticle: "The article reports the statement.", whyThisTarget: "x", ...over });

function runWith({ enrich = () => {}, inventoryEnrich = () => {}, article } = {}) {
  const base = article ?? createArticleAndBlocks().article;
  const inventory = createSemanticInventoryOutput();
  inventoryEnrich(inventory);
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async (request) => {
    if (request.usageContext.stage === "semantic_inventory") {
      return { output: inventory, model: "fake",
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
    }
    const output = createSelectedEnrichmentOutput();
    enrich(output, inventory);
    return { output, model: "fake", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
  return runClaimFoundry({ article: base, options: OPTIONS, dependencies: { modelRunner } });
}

// --- Compatibility matrix (pure) -------------------------------------------------

test("stipulated substantive dispute can never resolve to the article's own text", () => {
  const result = resolveEvidenceStrategy({ modelStrategy: "primary_article_result",
    disputedQuestion: dq(), semanticGuidance: "timeline records", externalWork: false });
  assert.equal(result.sourceStrategy, "independent_corroboration");
  assert.match(result.adjustment, /already stipulates/);
});

test("stipulated substantive dispute with an official signal routes to official_record", () => {
  const result = resolveEvidenceStrategy({ modelStrategy: "primary_article_result",
    disputedQuestion: dq(), semanticGuidance: "official agency audit records", externalWork: false });
  assert.equal(result.sourceStrategy, "official_record");
});

test("a substantive dispute the article does NOT stipulate is left as chosen", () => {
  const result = resolveEvidenceStrategy({ modelStrategy: "primary_article_result",
    disputedQuestion: dq({ stipulatedByArticle: null }), semanticGuidance: "x", externalWork: false });
  assert.equal(result.sourceStrategy, "primary_article_result");
  assert.equal(result.adjustment, null);
});

test("both_needed follows the substantive circularity rule", () => {
  const result = resolveEvidenceStrategy({ modelStrategy: "primary_article_result",
    disputedQuestion: dq({ verificationTarget: "both_needed" }), semanticGuidance: "x", externalWork: false });
  assert.equal(result.sourceStrategy, "independent_corroboration");
});

// --- Knob B: gradeTarget derivation (pure) ---------------------------------------

test("gradeTarget is attribution only for a thesis-hinged, load-bearing claim", () => {
  assert.equal(deriveGradeTarget("attribution", "thesis"), "attribution");
  assert.equal(deriveGradeTarget("attribution", "pillar"), "attribution");
  assert.equal(deriveGradeTarget("attribution", "pillar_support"), "attribution");
  // Attribution thesis but a non-load-bearing role: grade the substance.
  assert.equal(deriveGradeTarget("attribution", "opponent_claim"), "substance");
  // Substance and mixed theses never yield an attribution grade target.
  assert.equal(deriveGradeTarget("substance", "thesis"), "substance");
  assert.equal(deriveGradeTarget("mixed", "thesis"), "substance");
});

// --- Posture: an attribution-hinge claim is still graded and verdict-eligible -----

test("an attribution-hinge claim keeps a scored, verdict-eligible substantive posture", async () => {
  const result = await runWith({ inventoryEnrich: (inventory) => { inventory.thesisHinge = "attribution"; } });
  assert.equal(result.run.status, "ready_for_evidence");
  const target = result.claimPackage.phase3Targets[0];
  // Knob A posture is unchanged (scored), Knob B is carried separately as gradeTarget.
  assert.equal(target.targetType, "article_endorsed_substantive");
  assert.equal(target.scoreTransform, "normal");
  assert.equal(target.verdictEligible, true);
  assert.equal(target.gradeTarget, "attribution");
  assert.equal(result.claimPackage.evidenceNeedCards[0].gradeTarget, "attribution");
  assert.equal(verifyCf1Package(result.claimPackage).valid, true);
});

// --- G3: article-own identity detaches; a cited work's identity survives ----------

test("substantive dispute detaches the article's own DOI but keeps a distinct cited DOI", async () => {
  // Article's own DOI (10.9999/own.1) differs from the cited audit's DOI (10.1234/Bridge.7,
  // present in the body). The own DOI must not reach a substantive card; the cited one must.
  const article = { title: "Bridge repair audit",
    text: "A city audit found that bridge repairs were delayed for two years.\n\n"
      + "The audit, DOI:10.1234/Bridge.7, says procurement began nine months late.",
    authors: ["Alex Rivera"], publishedAt: "2024-04-12T00:00:00Z",
    url: "https://doi.org/10.9999/own.1" };
  const result = await runWith({ article });
  assert.equal(result.run.status, "ready_for_evidence");
  const card = result.claimPackage.evidenceNeedCards[0];
  assert.equal(card.identifierHints.doi.includes("10.9999/own.1"), false);
  assert.ok(card.queryLaneSeeds.every((seed) => !/10\.9999\/own\.1/i.test(seed.query)));
  assert.ok(card.queryLaneSeeds.some((seed) => /10\.1234\/Bridge\.7/i.test(seed.query)));
});
