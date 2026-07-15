import test from "node:test";
import assert from "node:assert/strict";
import { findOrCreateClaim, insertCf1ContentClaim, insertCf1Target,
  countCf1Projection } from "../../src/claim-foundry/veristrata/projectionStore.js";

test("projection store scopes inserts and counts without broad replacement", async () => {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM claims")) return [];
    if (sql.includes("INSERT INTO claims")) return { insertId: 41 };
    if (sql.includes("COUNT(*)")) return [{ count: 1 }];
    return { insertId: 1 };
  };
  const claimId = await findOrCreateClaim(query, "Original wording", "Original wording");
  await insertCf1ContentClaim(query, 2, claimId, { relationshipType: "task", claimRole: "pillar",
    claimOrder: 0, scoreTransform: "normal", articleStance: "endorses", argumentFunction: "pillar",
    searchEligible: 1, verdictEligible: 1, rationale: "{}", confidence: 0.9,
    packageId: "cfp-one", selectedClaimId: "S01", bindingId: 3 });
  await insertCf1Target(query, { contentId: 2, claimId, targetType: "substantive",
    targetText: "Original wording", objectText: "Original wording", sourceExcerpt: "wording",
    articleStance: "endorses", scoreTransform: "normal", searchEligible: 1,
    verdictEligible: 1, resolutionStatus: "resolved", targetOrder: 0,
    mappingRationale: "direct", primaryQueryText: "original wording", queryHintsJson: "{}",
    bearingCriteriaJson: "{}", packageId: "cfp-one", targetId: "T001",
    cardId: "ENC-T001", cardJson: "{}" });
  assert.deepEqual(await countCf1Projection(query, "cfp-one"), { selectedClaims: 1, targets: 1 });
  assert.equal(claimId, 41);
  assert.ok(calls.every(({ sql }) => !/DELETE|UPDATE content_claims|UPDATE claim_evaluation_targets/i.test(sql)));
  assert.ok(calls.some(({ values }) => values?.includes("cfp-one")));
});
