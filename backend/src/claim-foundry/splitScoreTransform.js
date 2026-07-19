// Deterministic scoreTransform derivation for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step). The model (1B) emits only
// contentStance (supports_thesis | contradicts_thesis | neutral) — a pure
// content-vs-thesis judgment. The HOST derives the authoritative score transform
// from it, so the model never emits a competing value and the transform can never
// collapse to "none" independently of the stance. An unrecognized stance is a
// blocking error, never a silently accepted transform.
//
//   supports_thesis    -> normal   (evidence for the claim strengthens the thesis)
//   contradicts_thesis -> invert   (evidence for the claim weakens the thesis)
//   neutral            -> none
import { Cf1Error } from "./errors.js";

export function deriveScoreTransform({ contentStance } = {}) {
  const transform = { supports_thesis: "normal", contradicts_thesis: "invert", neutral: "none" }[contentStance];
  if (!transform) {
    throw new Cf1Error("CF1_SPLIT_SCORE_TRANSFORM_INCONSISTENT",
      "contentStance does not resolve to a valid score transform", { status: 422,
        details: { contentStance: contentStance ?? null } });
  }
  return transform;
}
