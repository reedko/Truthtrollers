export function isMaterialLimitation(candidate) {
  return /\b(?:did not|could not|unable|limited|limitation|reliance|underestimat|missing|incomplete|cannot evaluate|not available)\b/i
    .test(candidate.claimText);
}

export function isSynthesisThesis(candidate) {
  return candidate.articleRole === "thesis"
    && /\b(?:results?|findings?) (?:suggest|indicate|show)|\bas evidenced by\b|\bbased on (?:the )?(?:similar|findings|results)\b/i
      .test(candidate.claimText);
}

export function isContextualRationale(candidate) {
  return /\b(?:aligns? with|consistent with)\b.*\b(?:recommended|timing|expect|practice|guidance)\b/i
    .test(candidate.claimText);
}
