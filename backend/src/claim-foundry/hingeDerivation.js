// Knob B derivation. The model emits one article-level thesisHinge; the host derives a
// per-target gradeTarget from it plus the claim's role. gradeTarget names WHAT evidence
// must settle (the saying vs the underlying matter); it never changes verdict-eligibility
// or scoreTransform (Knob A), which compose orthogonally with it.

const THESIS_LOAD_BEARING = new Set(["thesis", "pillar", "pillar_support"]);

/**
 * @param {"substance"|"attribution"|"mixed"} thesisHinge
 * @param {string} articleRole
 * @returns {"substance"|"attribution"}
 */
export function deriveGradeTarget(thesisHinge, articleRole) {
  if (thesisHinge === "attribution" && THESIS_LOAD_BEARING.has(articleRole)) return "attribution";
  return "substance";
}

/** A mixed-hinge, load-bearing claim is the one genuinely ambiguous case; flag, don't guess. */
export function isHingeAmbiguous(thesisHinge, articleRole) {
  return thesisHinge === "mixed" && THESIS_LOAD_BEARING.has(articleRole);
}
