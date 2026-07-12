#!/usr/bin/env node
//
// tm4_evidence_affordance_expansion.test.mjs
//
// GENERALITY tests for the sidecar evidence-affordance / query-expansion
// mechanism. These fixtures are DELIBERATELY NON-VACCINE (business/regulatory
// and public-policy) to prove the mechanism carries no domain-specific rules.
// Standalone assertions (no test framework); exits non-zero on any failure.
//
// Run: node scripts/testing/tm4_evidence_affordance_expansion.test.mjs

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");

const { computeClaimFeatures } = await import(path.join(BACKEND, "src/core/tm4SelectorFeatures.js"));
const { computeEvidenceAffordanceExpansion } = await import(path.join(BACKEND, "src/core/tm4EvidenceAffordanceExpansion.js"));
const { targetizeClaimOccurrences } = await import(path.join(BACKEND, "src/core/phase3Targetizer.js"));

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error(`  ❌ ${msg}`); } else { console.log(`  ✓ ${msg}`); } };

// Minimal readiness-entry factory (only fields the pipeline reads).
const claim = (o) => ({
  claimId: o.claimId, visibleClaimText: o.visibleClaimText || "",
  embeddedSubstantiveClaim: o.embeddedSubstantiveClaim || "",
  claimForm: o.claimForm || "direct_assertion", articleUse: o.articleUse || "endorsed_by_article",
  scoreTransformHint: o.scoreTransformHint || "normal", speakerOrSource: o.speakerOrSource || "",
  evaluationLaneHint: o.evaluationLaneHint || "candidate",
  namedActors: o.namedActors || [], namedOrganizations: o.namedOrganizations || [],
  namedStudiesOrDocuments: o.namedStudiesOrDocuments || [], namedLawsOrPolicies: o.namedLawsOrPolicies || [],
  namedSubstancesOrProducts: o.namedSubstancesOrProducts || [], numbersOrStatistics: o.numbersOrStatistics || [],
  searchText: o.searchText || o.visibleClaimText || "", clusterAnchors: o.clusterAnchors || [],
  phase2ClusterId: o.phase2ClusterId || "", phase2PillarId: o.phase2PillarId || "P1", phase2Role: o.phase2Role || "pillar",
  sourceSentenceIds: o.sourceSentenceIds || [], canonicalExcerpt: o.canonicalExcerpt || o.visibleClaimText || "",
  targetHints: o.targetHints || {}, warrantHint: o.warrantHint || "",
  reconciliation: o.reconciliation || { groupId: null, canonicalOccurrenceId: null },
});

const ctx = { thesis: "", pillars: [{ pillarId: "P1", pillarText: "" }], clusters: [], rebuttalFrame: true };

// ───────────────────────────────────────────────────────────────────────────
// TEST 1 — Business / regulatory-report generality
//   Selected: an endorsed allegation ("company misrepresented test results")
//   Sibling:  an unselected claim pointing at a revised regulatory report.
// Expected: selected claim inherits report/regulatory query hints from the
//   sibling; sibling stays unselected; endorsed posture (normal/verdict) holds.
// ───────────────────────────────────────────────────────────────────────────
console.log("TEST 1 — business/regulatory report");
{
  const selected = claim({
    claimId: "biz-sel",
    visibleClaimText: "The company misrepresented its emissions test results.",
    embeddedSubstantiveClaim: "The company misrepresented its emissions test results.",
    articleUse: "endorsed_by_article", scoreTransformHint: "normal",
    namedOrganizations: ["Acme Motors"], phase2ClusterId: "C1",
    searchText: "Acme Motors emissions test results misrepresented",
  });
  const sibling = claim({
    claimId: "biz-sib",
    visibleClaimText: "The company submitted a revised emissions report to federal regulators.",
    articleUse: "reported_neutrally", scoreTransformHint: "none",
    namedOrganizations: ["Acme Motors"], phase2ClusterId: "C1",
    searchText: "Acme Motors revised emissions report regulators filing",
  });

  const fSel = computeClaimFeatures(selected, ctx);
  const fSib = computeClaimFeatures(sibling, ctx);
  ok(fSib.evidenceAffordance > fSel.evidenceAffordance, `sibling has stronger evidence affordance (${fSib.evidenceAffordance.toFixed(2)} > ${fSel.evidenceAffordance.toFixed(2)})`);
  ok(fSib.primaryDocumentAffordance === true, "sibling points at a primary document (revised report)");

  const { expansionByClaimId } = computeEvidenceAffordanceExpansion([selected], [selected, sibling], ctx, {});
  const exp = expansionByClaimId["biz-sel"];
  ok(!!exp, "selected claim received query expansion");
  ok(exp && exp.queryExpansionSourceClaimIds.includes("biz-sib"), "expansion provenance names the sibling (biz-sib)");
  ok(exp && /report|regulator|filing|revised/i.test(exp.additionalQueryTerms.join(" ")), "expansion adds report/regulatory query terms");

  const { targets } = targetizeClaimOccurrences([selected], { expansionByClaimId });
  ok(!targets.some((t) => t.sourceClaimId === "biz-sib"), "sibling was NOT targetized / not promoted to Workspace");
  const sub = targets.find((t) => t.sourceClaimId === "biz-sel" && t.targetType === "substantive");
  ok(sub && sub.scoreTransform === "normal" && sub.verdictEligible === true, "endorsed substantive target keeps normal/verdict-bearing posture");
  ok(sub && /report|regulator|filing|revised/i.test(sub.queryHints.primaryQueryText), "substantive query text was enriched with report/regulatory terms");
  ok(sub && (sub.queryExpansionSourceClaimIds || []).includes("biz-sib"), "target records queryExpansionSourceClaimIds provenance");
}

// ───────────────────────────────────────────────────────────────────────────
// TEST 2 — Public-policy rebuttal generality
//   Selected: an opponent/setup claim the article rebuts ("city claimed water
//     was safe") with an embedded substantive proposition → invert posture.
//   Sibling:  an unselected claim pointing at internal water-quality reports.
// Expected: opponent posture preserved (substantive invert/verdict, attribution
//   none); evidence search still gains the water-quality report hints; sibling
//   stays unselected.
// ───────────────────────────────────────────────────────────────────────────
console.log("TEST 2 — public-policy rebuttal");
{
  const selected = claim({
    claimId: "pol-sel",
    visibleClaimText: "The city claimed the water was safe.",
    embeddedSubstantiveClaim: "The municipal water supply is safe to drink.",
    claimForm: "quoted_claim", articleUse: "used_as_opponent_claim", scoreTransformHint: "invert",
    speakerOrSource: "the city", phase2ClusterId: "C2",
    searchText: "city municipal water supply safe",
  });
  const sibling = claim({
    claimId: "pol-sib",
    visibleClaimText: "Internal water-quality reports showed elevated lead levels in the supply.",
    articleUse: "endorsed_by_article", scoreTransformHint: "normal",
    phase2ClusterId: "C2", numbersOrStatistics: [],
    searchText: "internal water-quality report elevated lead levels dataset",
  });

  const fSel = computeClaimFeatures(selected, ctx);
  const fSib = computeClaimFeatures(sibling, ctx);
  ok(fSel.opponentClaimFlag === true, "selected claim is detected as an opponent/setup claim");
  ok(fSib.evidenceAffordance > fSel.evidenceAffordance, `sibling has stronger evidence affordance (${fSib.evidenceAffordance.toFixed(2)} > ${fSel.evidenceAffordance.toFixed(2)})`);

  const { expansionByClaimId } = computeEvidenceAffordanceExpansion([selected], [selected, sibling], ctx, {});
  const exp = expansionByClaimId["pol-sel"];
  ok(!!exp && exp.queryExpansionSourceClaimIds.includes("pol-sib"), "opponent claim received expansion from the report sibling");
  ok(!!exp && /report|water-quality|lead|dataset|record/i.test(exp.additionalQueryTerms.join(" ")), "expansion adds water-quality-report query terms");

  const { targets } = targetizeClaimOccurrences([selected], { expansionByClaimId });
  ok(!targets.some((t) => t.sourceClaimId === "pol-sib"), "sibling was NOT targetized / not promoted to Workspace");
  const sub = targets.find((t) => t.sourceClaimId === "pol-sel" && t.targetType === "substantive");
  const attr = targets.find((t) => t.sourceClaimId === "pol-sel" && t.targetType === "attribution");
  ok(sub && sub.scoreTransform === "invert" && sub.verdictEligible === true, "opponent substantive target keeps INVERT / verdict-bearing posture");
  ok(attr && attr.scoreTransform === "none" && attr.verdictEligible === false, "opponent attribution target keeps NONE / non-verdict posture");
  ok(sub && /report|water|lead|dataset|record/i.test(sub.queryHints.primaryQueryText), "opponent substantive query gained water-quality-report hints");
}

console.log("");
if (failures) { console.error(`❌ ${failures} assertion(s) failed`); process.exit(1); }
console.log("✅ ALL GENERALITY TESTS PASS (business/regulatory + public-policy rebuttal)");
