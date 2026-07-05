import assert from "node:assert/strict";
import test from "node:test";

import { assessSnippetBearingBatch, scoreCandidatesInBearingShadow, classifyDeterministicBearing, scoreSnippetBearingDeterministic } from "../../src/core/snippetBearing.js";
import { deriveVerifiedDocumentRole } from "../../src/core/candidateSurvival.js";
import { claim54064, evidenceNeed54064, rawProviderResults54064 } from "../fixtures/candidates-54064.js";

// §G snippet-bearing robustness acceptance test for claim 54064, in FORCED
// TIMEOUT mode (LLM always throws) so the role-aware deterministic fallback is
// the thing under test.

function byUrl(candidates) {
  const map = new Map();
  for (const c of candidates) map.set(c.url, c);
  return map;
}

const timeoutLlm = { async generate() { throw new Error("timeout"); } };

async function runFallback() {
  const scored = scoreCandidatesInBearingShadow(evidenceNeed54064, rawProviderResults54064);
  const { candidates } = await assessSnippetBearingBatch({
    claim: claim54064,
    evidenceNeed: evidenceNeed54064,
    candidates: scored,
    llm: timeoutLlm,
    taskContentId: 16833,
  });
  return byUrl(candidates);
}

test("54064 forced timeout: one LLM failure does not collapse the claim; every candidate still has a bearing", async () => {
  const result = await runFallback();
  for (const c of result.values()) {
    assert.equal(c.fallbackUsed, true);
    assert.ok(Number.isFinite(Number(c.bearingPreScore)));
  }
});

test("54064: verified study/official/primary docs keep bearing on a thin snippet (not scored irrelevant)", async () => {
  const result = await runFallback();
  const pubmed = result.get("https://pubmed.ncbi.nlm.nih.gov/14754936/");
  const cdcPage = result.get("https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html");
  const cdcResponse = result.get("https://www.cdc.gov/media/releases/2014/response-mmr-autism.html");

  // Original study page bears on study identity even without "manipulated".
  assert.ok(pubmed.bearingPreScore >= 0.35, `pubmed floored, got ${pubmed.bearingPreScore}`);
  assert.notEqual(pubmed.bearingType, "none");
  assert.notEqual(pubmed.expectedStance, "insufficient");
  assert.equal(pubmed.fallbackReason, "verified_document_floor:original_study_candidate");

  assert.ok(cdcPage.bearingPreScore >= 0.35);
  assert.ok(cdcResponse.bearingPreScore >= 0.35);
});

test("54064: Thompson statement bears on attribution, not automatic substantive proof", async () => {
  const result = await runFallback();
  const thompson = result.get("https://example.org/thompson-statement");
  assert.equal(thompson.claimComponentAddressed, "attribution");
  assert.notEqual(thompson.bearingType, "direct"); // not proof of the substantive misconduct
  assert.match(thompson.fallbackReason, /primary_statement|attribution/);
});

test("54064: GlobeNewswire press release is allegation repetition / press release, never original study", async () => {
  const pr = rawProviderResults54064.find((c) => c.url.includes("globenewswire"));
  const role = deriveVerifiedDocumentRole(pr);
  assert.equal(role.role, "advocacy_or_press_release_candidate");
  assert.notEqual(role.role, "original_study_candidate");

  // The press release restates the article's own allegation, so it classifies as
  // allegation repetition and is capped — it never earns high substantive
  // bearing as "proof".
  const scored = scoreSnippetBearingDeterministic(evidenceNeed54064, pr);
  const classification = classifyDeterministicBearing(evidenceNeed54064, pr, scored);
  assert.equal(classification.fallbackCategory, "allegation_repetition");
  assert.equal(classification.allegationRepetition, true);

  // And in the fallback path it is capped at attribution/context, not proof.
  const result = await runFallback();
  const capped = result.get(pr.url);
  assert.ok(capped.bearingPreScore <= 0.2);
  assert.equal(capped.claimComponentAddressed, "attribution");
});

test("54064: generic MMR/autism cohort review bears on causal background, not direct CDC conduct", async () => {
  const result = await runFallback();
  const review = result.get("https://openalex.org/W-mmr-autism-cohort-review");
  // Verified academic review -> preserved with bearing, addressing object/background,
  // not the direct data-manipulation misconduct.
  assert.ok(review.bearingPreScore >= 0.35);
  assert.notEqual(review.claimComponentAddressed, "relation");
});
