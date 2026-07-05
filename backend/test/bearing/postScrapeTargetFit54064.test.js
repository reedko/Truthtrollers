import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTargetFit, TARGET_FIT_LABELS } from "../../src/core/postScrapeTargetFit.js";

// Step 21 regression for claim 54064
// ("data linking the MMR vaccine to autism had been manipulated by the CDC.").
// Deterministic target-fit guard over existing LLM extraction output.

const claim = {
  id: 54064,
  text: "data linking the MMR vaccine to autism had been manipulated by the CDC.",
  evidenceNeed: {
    subjectTerms: ["CDC", "William Thompson"],
    relationTerms: ["manipulated", "omitted", "excluded"],
    objectTerms: ["MMR", "autism", "data", "study"],
  },
  evaluationTargets: [
    { evaluationTargetId: 172, evaluationTargetType: "attribution", targetText: "William Thompson revealed the allegation" },
    { evaluationTargetId: 173, evaluationTargetType: "substantive", targetText: "the CDC manipulated data linking MMR to autism" },
    { evaluationTargetId: 174, evaluationTargetType: "original_study", targetText: "the 2004 DeStefano study" },
  ],
};

const substantiveTarget = claim.evaluationTargets[1];   // 173
const attributionTarget = claim.evaluationTargets[0];   // 172

test("Thompson statement supports attribution, not substantive proof", () => {
  const evidence = {
    evidenceTargetId: 173,
    evidenceTargetType: "substantive",
    quote: "Senior CDC scientist William Thompson revealed that the CDC manipulated data linking the MMR vaccine to autism.",
    stance: "support",
    url: "https://example.org/thompson-statement",
    sourceTitle: "Statement of William W. Thompson",
    identityRole: "attribution_document", // as study-identity discovery labels it
  };
  const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence });
  // Even though the quote names actor+action+object, it is a reported
  // allegation, so it is attribution_only for the substantive target.
  assert.equal(fit.compatibilityLabel, TARGET_FIT_LABELS.ATTRIBUTION_ONLY);
  assert.equal(fit.persistAsDirectSubstantive, false);

  // On the ATTRIBUTION target it is a legitimate (non-gated) support link.
  const attributionFit = evaluateTargetFit({ claim, target: attributionTarget, evidence: { ...evidence, evidenceTargetId: 172, evidenceTargetType: "attribution" } });
  assert.equal(attributionFit.persistAsDirectSubstantive, true);
});

test("GlobeNewswire / Vaccine Impact are allegation_repetition, not substantive proof", () => {
  for (const url of [
    "https://www.globenewswire.com/news-release/2016/05/03/cdc-whistleblower.html",
    "https://vaccineimpact.com/2016/cdc-whistleblower-mmr-fraud/",
  ]) {
    const evidence = {
      evidenceTargetId: 173,
      evidenceTargetType: "substantive",
      quote: "The CDC manipulated data linking the MMR vaccine to autism, according to whistleblower fraud claims.",
      stance: "support",
      url,
    };
    const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence });
    assert.equal(fit.compatibilityLabel, TARGET_FIT_LABELS.ALLEGATION_REPETITION, url);
    assert.equal(fit.persistAsDirectSubstantive, false, url);
  }
});

test("generic MMR/autism review is background_causal, not direct misconduct refutation", () => {
  const evidence = {
    evidenceTargetId: 173,
    evidenceTargetType: "substantive",
    quote: "A systematic review and meta-analysis found no link between the MMR vaccine and autism.",
    stance: "refute",
    url: "https://openalex.org/W-mmr-autism-review",
  };
  const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence });
  assert.equal(fit.compatibilityLabel, TARGET_FIT_LABELS.BACKGROUND_CAUSAL);
  assert.equal(fit.persistAsDirectSubstantive, false);
});

test("CDC/DeStefano study material is study_identity/methodology context unless it addresses data handling", () => {
  const studyPage = {
    evidenceTargetId: 173,
    evidenceTargetType: "substantive",
    quote: "The 2004 study by DeStefano examined age at first MMR vaccination among children with autism in metropolitan Atlanta.",
    stance: "refute",
    url: "https://archive.cdc.gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
  };
  const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence: studyPage });
  assert.ok([TARGET_FIT_LABELS.STUDY_IDENTITY_CONTEXT, TARGET_FIT_LABELS.OFFICIAL_RESPONSE].includes(fit.compatibilityLabel));
  assert.equal(fit.persistAsDirectSubstantive, false);
});

test("no direct substantive support/refute persists without actor + action + object", () => {
  // Missing the object/study/data element.
  const missingObject = {
    evidenceTargetId: 173,
    evidenceTargetType: "substantive",
    quote: "Officials at the agency acted improperly.",
    stance: "support",
    url: "https://unknown.example.net/report",
  };
  const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence: missingObject });
  assert.equal(fit.persistAsDirectSubstantive, false);
  assert.ok(fit.missingRequiredElements.length > 0);
});

test("an independent, non-attribution source addressing actor+action+object may persist as direct substantive", () => {
  const independent = {
    evidenceTargetId: 173,
    evidenceTargetType: "substantive",
    quote: "The CDC omitted the subgroup data and altered the study protocol before publishing the analysis.",
    stance: "support",
    url: "https://unknown-investigator.example.net/findings",
  };
  const fit = evaluateTargetFit({ claim, target: substantiveTarget, evidence: independent });
  assert.equal(fit.compatibilityLabel, TARGET_FIT_LABELS.DIRECT_SUBSTANTIVE);
  assert.equal(fit.persistAsDirectSubstantive, true);
});

test("non-misconduct substantive targets are not gated (pass through unchanged)", () => {
  const plainClaim = {
    id: 700,
    text: "The 2011 study reported a 20 percent increase in cases.",
    evidenceNeed: { subjectTerms: ["study"], relationTerms: ["increase"], objectTerms: ["cases"] },
    evaluationTargets: [{ evaluationTargetId: 1, evaluationTargetType: "substantive", targetText: "a 20 percent increase" }],
  };
  const evidence = { evidenceTargetId: 1, evidenceTargetType: "substantive", quote: "The study reported a 20 percent increase in cases.", stance: "support", url: "https://example.org/x" };
  const fit = evaluateTargetFit({ claim: plainClaim, target: plainClaim.evaluationTargets[0], evidence });
  assert.equal(fit.gated, false);
  assert.equal(fit.persistAsDirectSubstantive, true);
});
