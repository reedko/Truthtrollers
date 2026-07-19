// Deterministic articleUse derivation for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step). 1B emits two orthogonal
// posture judgments — contentStance (content vs thesis) and articleDeployment (how
// the article treats the claim) — and the HOST folds them into the single live-schema
// articleUse value, mirroring the scoreTransform derivation pattern.
//
//   contentStance \ articleDeployment | endorsed  | reported_neutral  | rebutted
//   supports_thesis                   | endorsed  | reported          | INCONSISTENT
//   contradicts_thesis                | INCONSISTENT | opponent_to_rebut | rejected
//   neutral                           | qualification | background     | qualification
//
// The two INCONSISTENT cells (article endorsing a thesis-contradicting claim, or
// rebutting a thesis-supporting one) are surfaced as a blocking error for review —
// never silently resolved — exactly like an inconsistent scoreTransform.
import { Cf1Error } from "./errors.js";

const ARTICLE_USE_MATRIX = {
  supports_thesis: { endorsed: "endorsed", reported_neutral: "reported", rebutted: "__inconsistent__" },
  contradicts_thesis: { endorsed: "__inconsistent__", reported_neutral: "opponent_to_rebut", rebutted: "rejected" },
  neutral: { endorsed: "qualification", reported_neutral: "background", rebutted: "qualification" },
};

export function deriveArticleUse({ contentStance, articleDeployment } = {}) {
  const use = ARTICLE_USE_MATRIX[contentStance]?.[articleDeployment];
  if (!use || use === "__inconsistent__") {
    throw new Cf1Error("CF1_SPLIT_ARTICLE_USE_INCONSISTENT",
      use === "__inconsistent__"
        ? "contentStance and articleDeployment are mutually inconsistent"
        : "contentStance/articleDeployment pair does not resolve to an articleUse",
      { status: 422,
        details: { contentStance: contentStance ?? null, articleDeployment: articleDeployment ?? null } });
  }
  return use;
}
