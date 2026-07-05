import assert from "node:assert/strict";
import test from "node:test";

import { loadClaimEvaluationTargets, normalizeEvaluationTarget } from "../../src/core/evaluationTargetStore.js";

test("normalizes explicit evaluation-target fields without conflating target types", () => {
  const target = normalizeEvaluationTarget({
    targetType: "substantive",
    targetText: "CDC researchers omitted an analysis.",
    allegedAction: "omitted analysis",
    studyTitle: "Metropolitan Atlanta MMR study",
    verdictEligible: true,
  }, { contentId: 16337, claimId: 52615 });
  assert.equal(target.claimId, 52615);
  assert.equal(target.targetType, "substantive");
  assert.equal(target.allegedAction, "omitted analysis");
  assert.equal(target.studyTitle, "Metropolitan Atlanta MMR study");
  assert.equal(target.verdictEligible, true);
});

test("loader falls back to object_claim_text when target table is unavailable", async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (sql.includes("claim_evaluation_targets")) throw new Error("table missing");
    return [{
      claim_id: 52615,
      claim_text: "William Thompson revealed that data had been manipulated.",
      object_claim_text: "Data had been manipulated by the CDC.",
      article_stance: "endorses",
      score_transform: "normal",
    }];
  };
  const targets = await loadClaimEvaluationTargets(query, 16337, [52615]);
  assert.equal(targets.get(52615).length, 1);
  assert.equal(targets.get(52615)[0].targetText, "Data had been manipulated by the CDC.");
  assert.equal(targets.get(52615)[0].targetType, "substantive");
  assert.equal(calls.length, 1);
});

test("loader prefers persisted one-to-many targets over the compatibility scalar", async () => {
  const query = async (sql) => {
    if (sql.includes("claim_evaluation_targets")) return [
      { evaluation_target_id: 1, content_id: 16337, claim_id: 52615, target_type: "attribution", target_text: "Thompson made the allegation.", target_order: 0 },
      { evaluation_target_id: 2, content_id: 16337, claim_id: 52615, target_type: "substantive", target_text: "CDC researchers omitted an analysis.", target_order: 1 },
    ];
    throw new Error("legacy fallback should not run");
  };
  const targets = await loadClaimEvaluationTargets(query, 16337, [52615], { enableMultiTarget: true });
  assert.deepEqual(targets.get(52615).map((target) => target.targetType), ["attribution", "substantive"]);
});
