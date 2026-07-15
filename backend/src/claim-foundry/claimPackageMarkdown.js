const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (values) => (values ?? []).filter(Boolean).map((value) => `  - ${text(value)}`);

function claimSection(claim, card, pillars) {
  const relatedPillars = (claim.relatedPillarIds ?? []).map((id) => pillars.get(id)?.label ?? id);
  const lines = [
    `## ${claim.selectedClaimId}: ${text(claim.claimText)}`,
    "",
    `- Role: ${claim.articleRole}; materiality: ${claim.materiality}; mode: ${claim.claimMode ?? "unspecified"}`,
    `- Pillars: ${relatedPillars.join(", ") || "none"}`,
    `- Why it matters: ${text(claim.counterfactualImpact) || "Not supplied"}`,
    "",
    "### Falsifiability",
    "",
    `- Question: ${text(card?.falsifiability?.verificationQuestion) || "Not supplied"}`,
    `- Supports if: ${text(card?.falsifiability?.wouldSupportIf) || "Not supplied"}`,
    `- Refutes if: ${text(card?.falsifiability?.wouldRefuteIf) || "Not supplied"}`,
    `- Qualifies if: ${text(card?.falsifiability?.wouldQualifyIf) || "Not supplied"}`,
    `- Not enough if only: ${text(card?.falsifiability?.notEnoughIfOnly) || "Not supplied"}`,
    "",
    "### EvidenceRun guidance",
    "",
    `- Best source types: ${(card?.bestSourceTypes ?? []).join(", ") || "none supplied"}`,
    `- Required evidence roles: ${(card?.evidenceRolesNeeded ?? []).join(", ") || "none supplied"}`,
    "- Must match:", ...list(card?.bearingCriteria?.mustMatch),
    "- Reject if only:", ...list(card?.bearingCriteria?.rejectIfOnly),
  ];
  if (card?.queryLaneSeeds?.length) lines.push("- Search seeds:",
    ...card.queryLaneSeeds.map((seed) => `  - **${text(seed.laneType)}:** ${text(seed.query)}`));
  if (card?.namedWorkHints?.length) lines.push("- Named works:",
    ...card.namedWorkHints.map((work) => `  - **${work.namedWorkId}:** ${text(work.mentionText)}`
      + `${work.citationCallout ? ` [citation ${text(work.citationCallout)}]` : ""}`));
  if (card?.relatedClaimHints?.length) lines.push("- Related claims:",
    ...card.relatedClaimHints.map((item) => `  - ${text(item.relationshipType)}: ${text(item.relatedClaimText)}`));
  if (claim.sourceExcerpt) lines.push("", "### Article grounding", "",
    ...String(claim.sourceExcerpt).split("\n").map((line) => `> ${line}`));
  return lines;
}

export function buildClaimPackageMarkdown(pkg) {
  if (!pkg) return "# CF1 Claim Package\n\nNo final package was produced.\n";
  const pillars = new Map((pkg.articleMap?.pillars ?? []).map((pillar) => [pillar.pillarId, pillar]));
  const cards = new Map((pkg.evidenceNeedCards ?? []).map((card) => [card.selectedClaimId, card]));
  const usage = pkg.diagnostics?.usage ?? {};
  const lines = [
    "# CF1 Claim Package",
    "",
    `- Article: ${text(pkg.article?.title)}`,
    `- Package: ${pkg.packageId}`,
    `- Valid: ${pkg.verification?.valid ?? false}`,
    `- Selected claims: ${pkg.selectedEvaluationClaims?.length ?? 0}`,
    `- Model calls: ${usage.semanticCalls ?? 0}; tokens: ${usage.totalTokens ?? 0}`,
    "",
    "## Article argument",
    "",
    `- Theme: ${text(pkg.articleMap?.theme)}`,
    `- Thesis: ${text(pkg.articleMap?.thesis?.text)}`,
    "- Pillars:",
    ...(pkg.articleMap?.pillars ?? []).map((pillar) =>
      `  - **${text(pillar.label)}** (${pillar.importance}): ${text(pillar.text)}`),
    "",
    "# Selected claims",
    "",
  ];
  for (const claim of pkg.selectedEvaluationClaims ?? []) {
    lines.push(...claimSection(claim, cards.get(claim.selectedClaimId), pillars), "");
  }
  const works = pkg.articleMap?.contextWorks ?? [];
  if (works.length) lines.push("# Host-validated named works", "",
    ...works.map((work) => `- **${work.namedWorkId}:** ${text(work.mentionText)}`
      + ` (${text(work.workType)}${work.citationCallout ? `; citation ${text(work.citationCallout)}` : ""})`), "");
  const contexts = pkg.articleMap?.contextHints ?? [];
  if (contexts.length) lines.push("# Context retained but not selected", "",
    ...contexts.map((item) => `- ${text(item.claimText)}`), "");
  return `${lines.join("\n")}\n`;
}
