import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidencePacket } from "../../src/core/evidencePacketBuilder.js";
import { clusterAssertions } from "../../src/core/assertionClustering.js";

// Step 22 regression for claim 54064 substantive target 173.
// Repeated GlobeNewswire/Vaccine Impact allegation copies must not fill the
// packet while study_identity / methodology / attribution candidates exist.

const claim = {
  id: 54064,
  text: "data linking the MMR vaccine to autism had been manipulated by the CDC.",
  evidenceNeed: {
    subjectTerms: ["CDC", "William Thompson"],
    relationTerms: ["manipulated", "omitted", "excluded"],
    objectTerms: ["MMR", "autism", "data", "study"],
  },
  evaluationTargets: [
    { evaluationTargetId: 173, evaluationTargetType: "substantive", targetText: "the CDC manipulated data linking MMR to autism" },
  ],
};

const ALLEGATION = "The CDC manipulated data linking the MMR vaccine to autism, according to whistleblower fraud claims.";

// 10 assertions on target 173 — 3 are syndicated allegation copies.
const evidence = [
  { id: "gnw", url: "https://www.globenewswire.com/news-release/2016/cdc-whistleblower.html", title: "CDC Whistleblower to Extend MMR Vaccine Fraud", quote: ALLEGATION, summary: "", stance: "support", bearingScore: 0.62, bearingType: "direct", claimComponentAddressed: "whole_claim", evidenceTargetId: 173, evidenceTargetType: "substantive" },
  { id: "vi", url: "https://vaccineimpact.com/2016/cdc-whistleblower-mmr-fraud/", title: "CDC Whistleblower MMR Fraud", quote: ALLEGATION, summary: "", stance: "support", bearingScore: 0.61, bearingType: "direct", claimComponentAddressed: "whole_claim", evidenceTargetId: 173, evidenceTargetType: "substantive" },
  { id: "vi2", url: "https://healthimpactnews.com/2016/cdc-mmr-fraud-repost/", title: "CDC MMR Fraud (repost)", quote: ALLEGATION, summary: "", stance: "support", bearingScore: 0.60, bearingType: "direct", claimComponentAddressed: "whole_claim", evidenceTargetId: 173, evidenceTargetType: "substantive" },
  // study identity / official study page
  { id: "cdc", url: "https://archive.cdc.gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html", title: "CDC Statement: 2004 MMR and Autism Study", quote: "The 2004 study examined age at first MMR vaccination among children with autism in metropolitan Atlanta.", summary: "", stance: "nuance", bearingScore: 0.5, bearingType: "origin", claimComponentAddressed: "subject", evidenceTargetId: 173, evidenceTargetType: "substantive", identityRole: "official_study_page" },
  // methodology / reanalysis
  { id: "hooker", url: "https://doi.org/10.1016/j.taap.2013.12.017", title: "Reanalysis of MMR autism data", quote: "A reanalysis of the study data examined the omitted subgroup and methodology.", summary: "", stance: "nuance", bearingScore: 0.48, bearingType: "indirect", claimComponentAddressed: "warrant", evidenceTargetId: 173, evidenceTargetType: "substantive", identityRole: "reanalysis" },
];

test("54064 clustering groups the syndicated allegation copies together", () => {
  const { clusters, clusterIdByIndex } = clusterAssertions(evidence);
  // gnw, vi, vi2 share near-identical text on the same target+stance -> one cluster.
  assert.equal(clusterIdByIndex[0], clusterIdByIndex[1]);
  assert.equal(clusterIdByIndex[1], clusterIdByIndex[2]);
  const cluster = clusters.get(clusterIdByIndex[0]);
  assert.equal(cluster.size, 3);
  assert.ok(cluster.syndicated, "copies across different families are flagged syndicated");
  // The study page and reanalysis are their own clusters.
  assert.notEqual(clusterIdByIndex[3], clusterIdByIndex[0]);
  assert.notEqual(clusterIdByIndex[4], clusterIdByIndex[0]);
});

test("54064 packet keeps at most one allegation-cluster representative and includes diverse evidence", () => {
  const packet = buildEvidencePacket({ claim, evidence, minBearing: 0.35, maxItems: 5 });
  const urls = packet.items.map((i) => i.url);

  // At most one of the three syndicated allegation copies is present.
  const allegationCount = urls.filter((u) =>
    u.includes("globenewswire") || u.includes("vaccineimpact") || u.includes("healthimpactnews"),
  ).length;
  assert.ok(allegationCount <= 1, `expected <=1 allegation copy, got ${allegationCount}`);

  // The study page and reanalysis (available role-compatible evidence) are included.
  assert.ok(urls.some((u) => u.includes("archive.cdc.gov")), "study identity page included");
  assert.ok(urls.some((u) => u.includes("taap.2013.12.017")), "reanalysis included");

  // Distinct assertion clusters across the packet (no duplicate cluster).
  const clusterIds = packet.items.map((i) => i.assertionClusterId);
  assert.equal(new Set(clusterIds).size, clusterIds.length, "no cluster occupies two slots");
});

test("54064 allegation copies cannot occupy a direct substantive support slot", () => {
  const packet = buildEvidencePacket({ claim, evidence, minBearing: 0.35, maxItems: 5 });
  const supportItems = packet.items.filter((i) => i.stance === "support");
  for (const item of supportItems) {
    // No support item may be an allegation_repetition label.
    assert.notEqual(item.compatibilityLabel, "allegation_repetition");
  }
});

test("54064 a generic MMR/autism refute cannot occupy the direct substantive refute slot", () => {
  const withReview = [
    ...evidence,
    { id: "review", url: "https://openalex.org/W-mmr-review", title: "MMR autism meta-analysis", quote: "A systematic review found no link between the MMR vaccine and autism.", summary: "", stance: "refute", bearingScore: 0.55, bearingType: "indirect", claimComponentAddressed: "object", evidenceTargetId: 173, evidenceTargetType: "substantive" },
  ];
  const packet = buildEvidencePacket({ claim, evidence: withReview, minBearing: 0.35, maxItems: 5 });
  const review = packet.items.find((i) => i.url.includes("openalex"));
  // If present at all, it is not a direct substantive refute (labelled background_causal).
  if (review) {
    assert.notEqual(review.compatibilityLabel, "direct_substantive");
    assert.equal(review.stance !== "refute" || review.compatibilityLabel === "background_causal", true);
  }
});
