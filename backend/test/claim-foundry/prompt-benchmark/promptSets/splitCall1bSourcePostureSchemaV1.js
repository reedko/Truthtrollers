// Call 1B schema for the Call-1 split arm (pipeline-y-canonical-relation-split-v1).
// 1B decides SOURCE + POSTURE from compact host packets — it never sees the full
// article and never rewrites an existing claimText. It emits TWO orthogonal posture
// judgments instead of a single fused articleUse:
//   contentStance     — supports_thesis | contradicts_thesis | neutral. Judged from
//     claimText vs thesis CONTENT ALONE (ignore source, framing, tone). This drives
//     the host scoreTransform and NEVER depends on finding an opposing passage.
//   articleDeployment — endorsed | rebutted | reported_neutral. How the article
//     itself treats the claim. May disagree with contentStance — that is informative.
// The host derives the live-schema articleUse deterministically from that pair.
// One output array, fully-required and meaningful (OpenAI strict mode; optionality
// via nullable types). The observation-only census is intentionally not a 1B input
// and never appears in this contract.
//   candidateJudgments — one per existing 1A candidate (articleRole + the posture pair
//     + assertionSource; responseUnitIds/needsSplit are host signals for selection).
const CONTENT_STANCE = ["supports_thesis", "contradicts_thesis", "neutral"];
const ARTICLE_DEPLOYMENT = ["endorsed", "rebutted", "reported_neutral"];
const ARTICLE_ROLE = ["thesis", "pillar", "pillar_support", "opponent_claim", "qualification", "consistency_hinge"];
const unitIds = (maxItems = 12) => ({ type: "array", maxItems,
  items: { type: "string", pattern: "^U\\d{4}$" } });

const posture = {
  assertionSource: { type: "string", minLength: 1, maxLength: 300 },
  contentStance: { type: "string", enum: CONTENT_STANCE },
  articleDeployment: { type: "string", enum: ARTICLE_DEPLOYMENT },
  articleRole: { type: "string", enum: ARTICLE_ROLE },
  sourceUnitIds: unitIds(),
  responseUnitIds: unitIds(),
};

const candidateJudgment = {
  type: "object", additionalProperties: false,
  required: ["candidateId", ...Object.keys(posture), "needsSplit"],
  properties: {
    candidateId: { type: "string", pattern: "^CAND\\d{2}$" },
    ...posture,
    // Optional in spirit, always present in strict mode: split=false, reason=null
    // when there is nothing to flag. 1B flags fusion but never rewrites claimText.
    needsSplit: { type: "object", additionalProperties: false, required: ["split", "reason"],
      properties: { split: { type: "boolean" },
        reason: { type: ["string", "null"], minLength: 1, maxLength: 200 } } },
  },
};

export const CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA = Object.freeze({
  name: "cf1_call1b_source_posture_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["candidateJudgments"],
    properties: {
      candidateJudgments: { type: "array", maxItems: 30, items: candidateJudgment },
    },
  },
});

export const CF1_SPLIT_CALL1B_ENUMS = Object.freeze({ CONTENT_STANCE, ARTICLE_DEPLOYMENT, ARTICLE_ROLE });
