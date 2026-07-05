import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_SLOTS,
  coverageSlotForCandidate,
  rankCandidatesByCoverage,
  requiredCoverageSlotsForClaim,
} from "../../src/core/adaptiveAllocation.js";
import { claim54064, evidenceNeed54064, rawProviderResults54064 } from "../fixtures/candidates-54064.js";

const claim = { ...claim54064, evidenceNeed: evidenceNeed54064 };

function orderIndex(ordered, urlPart) {
  return ordered.findIndex((c) => c.url.includes(urlPart));
}

test("54064 required coverage slots come from the claim's targets", () => {
  const slots = requiredCoverageSlotsForClaim(claim);
  assert.ok(slots.has(COVERAGE_SLOTS.ATTRIBUTION));
  assert.ok(slots.has(COVERAGE_SLOTS.SUBSTANTIVE_CONDUCT));
  assert.ok(slots.has(COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY));
});

test("54064 amplifier sources never occupy a study/substantive coverage slot", () => {
  const gnw = rawProviderResults54064.find((c) => c.url.includes("globenewswire"));
  const cnn = rawProviderResults54064.find((c) => c.url.includes("cnn.com"));
  assert.equal(coverageSlotForCandidate(gnw), null);
  assert.equal(coverageSlotForCandidate(cnn), null);
});

test("54064 generic cohort review covers causal background, not substantive conduct", () => {
  const review = rawProviderResults54064.find((c) => c.url.includes("cohort-review"));
  assert.equal(coverageSlotForCandidate(review), COVERAGE_SLOTS.CAUSAL_BACKGROUND);
  assert.notEqual(coverageSlotForCandidate(review), COVERAGE_SLOTS.SUBSTANTIVE_CONDUCT);
});

test("54064 coverage-first ordering attempts uncovered core roles before general news/press releases", () => {
  const { ordered, auditRows } = rankCandidatesByCoverage(claim, rawProviderResults54064);

  const thompson = orderIndex(ordered, "thompson-statement");
  const cdcPage = orderIndex(ordered, "cdc2004pediatrics");
  const pubmed = orderIndex(ordered, "pubmed.ncbi.nlm.nih.gov/14754936");
  const hooker = orderIndex(ordered, "taap.2013.12.017");
  const cnn = orderIndex(ordered, "cnn.com");
  const gnw = orderIndex(ordered, "globenewswire");

  // Attribution coverage (Thompson) precedes press-release copies.
  assert.ok(thompson < gnw, "Thompson before GlobeNewswire");
  assert.ok(thompson < cnn, "Thompson before CNN");

  // A verified study/official candidate is attempted before general news pages.
  assert.ok(Math.min(cdcPage, pubmed) < cnn, "verified study/official before CNN");
  assert.ok(Math.min(cdcPage, pubmed) < gnw, "verified study/official before GlobeNewswire");

  // Reanalysis/methodology material precedes general news/press-release material.
  assert.ok(hooker < cnn && hooker < gnw, "Hooker reanalysis before general news/PR");

  // Every general-fill / amplifier item is ranked below every coverage item.
  const lastCoverageRank = Math.max(thompson, cdcPage, pubmed);
  assert.ok(cnn > lastCoverageRank && gnw > lastCoverageRank);

  // Audit explains each selection.
  const thompsonRow = auditRows.find((r) => r.canonicalUrl.includes("thompson-statement"));
  assert.equal(thompsonRow.uncoveredCoverageSlot, COVERAGE_SLOTS.ATTRIBUTION);
  assert.equal(thompsonRow.coversUncovered, true);
  const gnwRow = auditRows.find((r) => r.canonicalUrl.includes("globenewswire"));
  assert.equal(gnwRow.coverageSlot, null);
  assert.match(gnwRow.deferredReason, /general_fill|already_covered/);
  assert.ok(auditRows.every((r) => Number.isFinite(r.allocationRank) && Number.isFinite(r.coverageScore)));
});

test("54064 GlobeNewswire cannot satisfy original study or substantive proof slot", () => {
  const gnw = rawProviderResults54064.find((c) => c.url.includes("globenewswire"));
  const slot = coverageSlotForCandidate(gnw);
  assert.notEqual(slot, COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY);
  assert.notEqual(slot, COVERAGE_SLOTS.STUDY_IDENTITY);
  assert.notEqual(slot, COVERAGE_SLOTS.SUBSTANTIVE_CONDUCT);
});
