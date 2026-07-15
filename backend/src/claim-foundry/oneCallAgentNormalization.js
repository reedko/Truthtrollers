const UNIT_SUFFIX = /\s*\(U\d{4}\)\.?$/i;

function cleanClaimText(value) {
  return typeof value === "string" ? value.replace(UNIT_SUFFIX, "").trim() : value;
}

function words(value) {
  return new Set((String(value).toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter((word) => !["that", "this", "with", "from", "were", "their", "between"].includes(word)));
}

function thesisScore(claim, thesis) {
  const wanted = words(thesis);
  return [...words(claim.claimText)].filter((word) => wanted.has(word)).length;
}

function inferGroundedWork(claim) {
  if (claim.claimMode !== "attribution" || claim.namedWorkHints?.length
    || /^(?:the )?(?:article|authors?|study)$/i.test(claim.assertionSource)) return;
  if (!/\b(?:study|report|review|reviewed|dataset|law|filing|transcript)\b/i.test(claim.claimText)) return;
  claim.namedWorkHints = [{ mentionText: claim.assertionSource, workType: "other", year: null,
    peopleOrOrganizations: [claim.assertionSource], identifiers: [] }];
}

export function normalizeOneCallAgentOutput(rawOutput) {
  const output = structuredClone(rawOutput);
  for (const candidate of output.initialCandidates ?? []) {
    candidate.claimText = cleanClaimText(candidate.claimText);
  }
  for (const claim of output.selectedClaims ?? []) {
    claim.claimText = cleanClaimText(claim.claimText);
    inferGroundedWork(claim);
  }
  if (output.selectedClaims?.length) {
    const thesisAnchor = output.orientation?.pillars?.find((pillar) =>
      pillar.importance === "load_bearing")?.text ?? output.orientation?.thesis;
    const thesisClaim = output.selectedClaims.reduce((best, claim) =>
      thesisScore(claim, thesisAnchor) > thesisScore(best, thesisAnchor)
        ? claim : best);
    for (const claim of output.selectedClaims) {
      if (claim !== thesisClaim && claim.articleRole === "thesis") claim.articleRole = "pillar";
    }
    thesisClaim.articleRole = "thesis";
  }
  const initial = new Set((output.initialCandidates ?? []).map((item) => item.claimText.toLocaleLowerCase()));
  const selected = new Set((output.selectedClaims ?? []).map((item) => item.claimText.toLocaleLowerCase()));
  const normalizedTrace = [];
  for (const change of output.revisionTrace ?? []) {
    change.beforeClaimText = cleanClaimText(change.beforeClaimText);
    change.afterClaimText = cleanClaimText(change.afterClaimText);
    if (change.action === "drop" && selected.has(change.beforeClaimText?.toLocaleLowerCase())) {
      const replacement = change.afterClaimText?.toLocaleLowerCase();
      if (initial.has(replacement) && !selected.has(replacement)) change.beforeClaimText = change.afterClaimText;
      else continue;
    }
    if (change.action === "drop") change.afterClaimText = null;
    if (change.action === "add" && change.beforeClaimText) {
      const before = change.beforeClaimText.toLocaleLowerCase();
      if (initial.has(before) && !selected.has(before)) normalizedTrace.push({ ...change,
        afterClaimText: null, action: "drop",
        explanation: `Dropped before replacement: ${change.explanation}` });
      change.beforeClaimText = null;
    }
    if (change.action === "rewrite" && change.afterClaimText
      && initial.has(change.afterClaimText.toLocaleLowerCase())) change.action = "replace";
    if (change.action !== "add" || selected.has(change.afterClaimText?.toLocaleLowerCase())) {
      normalizedTrace.push(change);
    }
  }
  output.revisionTrace = normalizedTrace;
  const addressed = new Set(normalizedTrace.map((change) => change.findingType));
  output.hostWarnings = (output.critic?.findings ?? [])
    .filter((finding) => !addressed.has(finding.type))
    .map((finding) => `Critic finding ${finding.type} was not linked to an actual selection change.`);
  return output;
}
