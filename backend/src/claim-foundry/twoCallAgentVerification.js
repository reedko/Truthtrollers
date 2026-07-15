import { Cf1Error } from "./errors.js";
import { buildNamedWorkPool } from "./namedWorkPool.js";
import { detectTextNamedWorkCues } from "./textNamedWorkCues.js";

function fail(message) {
  throw new Cf1Error("CF1_AGENT_SEMANTIC_INVALID", message, { status: 422 });
}

function words(value) {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

function overlap(left, right) {
  const wanted = words(left); const available = words(right);
  return [...wanted].filter((word) => available.has(word)).length;
}

export function verifySemanticInventory(output, { sourceUnits, minimumCandidates = 1, article } = {}) {
  if (!output?.theme?.text || !output?.thesis?.text || !Array.isArray(output.pillars)
    || !Array.isArray(output.namedWorks)) fail("Call 1 omitted orientation or named-work inventory");
  if (!Array.isArray(output.candidateClaims) || output.candidateClaims.length < minimumCandidates) {
    fail(`Call 1 needs at least ${minimumCandidates} candidate claims`);
  }
  const ids = new Set(sourceUnits.map((unit) => unit.unitId));
  const labels = output.pillars.map((pillar) => pillar.label);
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) fail("Pillar labels must be unique");
  for (const item of [output.theme, output.thesis, ...output.pillars]) {
    if (!item.sourceUnitIds?.length || item.sourceUnitIds.some((id) => !ids.has(id))) fail("Orientation has invalid sourceUnitIds");
  }
  const normalized = structuredClone(output);
  const unitText = new Map(sourceUnits.map((unit) => [unit.unitId, unit.text]));
  const modelWorks = normalized.namedWorks.filter((work) => work.sourceUnitIds?.length
    && work.sourceUnitIds.every((id) => unitText.has(id))
    && (() => { const cited = work.sourceUnitIds.map((id) => unitText.get(id)).join(" ");
      return cited.toLowerCase().includes(work.mentionText.toLowerCase()) || overlap(work.mentionText, cited) >= 1; })())
    .map((work) => { const cited = work.sourceUnitIds.map((id) => unitText.get(id)).join(" ");
      return { ...work, citationCallout: work.citationCallout
        && cited.includes(work.citationCallout) ? work.citationCallout : null,
      source: "text_mention", linkResolved: false }; });
  const detectedWorks = detectTextNamedWorkCues(sourceUnits);
  normalized.namedWorks = buildNamedWorkPool([...detectedWorks, ...modelWorks]);
  const currentTitle = String(article?.title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (currentTitle) normalized.namedWorks = normalized.namedWorks.filter((work) =>
    work.mentionText.toLowerCase() !== currentTitle)
    .map((work, index) => ({ ...work, namedWorkId: `NW${String(index + 1).padStart(3, "0")}` }));
  for (const candidate of normalized.candidateClaims) {
    const ids = new Set(candidate.sourceUnitIds);
    candidate.namedWorkHints = normalized.namedWorks.filter((work) =>
      work.sourceUnitIds.some((id) => ids.has(id)));
    candidate.relevantNamedWorkIds = candidate.namedWorkHints.map((work) => work.namedWorkId);
  }
  if (!/\b(?:is|are|was|were|has|have|had|caus|found|shows?|reports?|concludes?|struck|occurred|issued)\b/i
    .test(normalized.theme.text)) {
    normalized.theme = structuredClone(normalized.thesis);
  }
  return normalized;
}

export function verifySelectedEnrichment(output, { selectedClaims, inventory, sourceUnits, criticReport, article }) {
  const enriched = output?.enrichedClaims;
  if (!Array.isArray(enriched) || enriched.length !== selectedClaims.length) fail("Call 2 must enrich every selected claim exactly once");
  const expected = new Set(selectedClaims.map((item) => item.candidateId));
  if (new Set(enriched.map((item) => item.candidateId)).size !== enriched.length
      || enriched.some((item) => !expected.has(item.candidateId))) fail("Call 2 changed the selected candidate IDs");
  const originals = new Map(selectedClaims.map((item) => [item.candidateId, item]));
  const namedWorkPool = new Map((inventory.namedWorks ?? []).map((work) => [work.namedWorkId, work]));
  const merged = enriched.map((item) => {
    const original = originals.get(item.candidateId);
    const cited = original.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.unitId === id)?.text ?? "").join(" ");
    const citedLower = cited.toLowerCase();
    const requestedIds = item.relevantNamedWorkIds ?? [];
    if (new Set(requestedIds).size !== requestedIds.length) {
      fail(`${item.candidateId} repeated a named-work ID`);
    }
    if (requestedIds.some((id) => !namedWorkPool.has(id))) {
      fail(`${item.candidateId} referenced a named work outside the host pool`);
    }
    const hostIds = (original.namedWorkHints ?? []).map((work) => work.namedWorkId);
    const relevantNamedWorkIds = [...new Set([...hostIds, ...requestedIds])].slice(0, 6);
    const namedWorkHints = relevantNamedWorkIds.map((id) => structuredClone(namedWorkPool.get(id)));
    const cleanedIdentifiers = Object.fromEntries(Object.entries(item.identifierHints ?? {})
      .map(([field, values]) => [field, values.filter((value) => citedLower.includes(String(value).toLowerCase()))]));
    const claimMode = /\b(?:caus|caused|causal|led to|resulted in)\b/i.test(item.claimText) ? "causal"
      : /\b(?:percent|rate|odds|risk|significant|association|confidence interval)\b|\d+%/i.test(item.claimText) ? "statistical"
        : (original.namedWorkHints ?? []).some((work) => work.workType === "study") ? "study_result"
          : original.articleRole === "opponent_claim" ? "attribution" : "factual";
    return { ...item, relevantNamedWorkIds, namedWorkHints, identifierHints: cleanedIdentifiers,
      mustMatch: item.mustMatch.length ? item.mustMatch : [original.scope],
      sourceUnitIds: original.sourceUnitIds,
      assertionSource: original.assertionSource, articleUse: original.articleUse,
      articleRole: original.articleRole, materiality: original.materiality,
      relatedPillarLabels: original.relatedPillarLabels, scope: original.scope, claimMode };
  });
  const contextWorks = structuredClone(inventory.namedWorks ?? []);
  const decisions = new Map((criticReport?.candidateDecisions ?? []).map((item) => [item.candidateId, item]));
  const contextHints = inventory.candidateClaims.map((candidate, index) => ({ ...structuredClone(candidate),
    candidateId: `C${String(index + 1).padStart(2, "0")}` })).filter((candidate) =>
    decisions.get(candidate.candidateId)?.decision === "drop"
      && (/\b(?:previous|prior|earlier|other) (?:studies|research|reviews?)\b/i.test(candidate.claimText)
        || /\b(?:review|reviewed)\b.*\b(?:hypothesis|evidence|association)\b/i.test(candidate.claimText)));
  const oldShape = { orientation: { theme: inventory.theme.text, thesis: inventory.thesis.text,
    pillars: inventory.pillars.map(({ label, text, importance }) => ({ label, text, importance })) },
    initialCandidates: structuredClone(inventory.candidateClaims), contextWorks, contextHints,
    critic: { summary: "Host critic selected the enrichment portfolio.",
      findings: [{ type: "trivial_overselection", severity: "material",
        problem: "Host removed lower-priority candidates.", recommendedAction: "Enrich only selected claims." }] },
    revisionTrace: [{ findingType: "trivial_overselection",
      beforeClaimText: inventory.candidateClaims.find((item) => !selectedClaims.some((selected) => selected.claimText === item.claimText))?.claimText
        ?? inventory.candidateClaims[0].claimText,
      afterClaimText: null, action: "drop", explanation: "Host portfolio selection." }],
    selectedClaims: merged, relatedClaimPairs: structuredClone(criticReport?.relatedClaimPairs ?? []) };
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit.text]));
  for (const claim of merged) {
    const cited = claim.sourceUnitIds.map((id) => units.get(id) ?? "").join(" ");
    if (overlap(claim.claimText, cited) < 3) fail(`Call 2 overbroadened ${claim.candidateId}`);
    if (!claim.relatedPillarLabels.length) fail(`${claim.candidateId} lost pillar bearing`);
    if (!claim.verificationQuestion || !claim.claimTrueIf || !claim.claimFalseIf
      || !claim.mustMatch.length || !claim.requiredEvidenceRoles.length) {
      fail(`${claim.candidateId} has incomplete ER1 enrichment`);
    }
    const citedLower = cited.toLowerCase();
    for (const work of claim.namedWorkHints ?? []) {
      for (const value of [work.year, ...(work.identifiers ?? [])].filter(Boolean)) {
        if (!citedLower.includes(String(value).toLowerCase())) fail(`${claim.candidateId} invented a named-work identifier`);
      }
    }
    const protectedStrings = [article?.title, ...(article?.authors ?? []).map((author) => author?.name ?? author),
      ...(claim.namedWorkHints ?? []).map((work) => work.mentionText)]
      .filter((value) => String(value ?? "").length >= 8);
    const modelMetadata = [claim.namedWorkRelevanceNote,
      ...(claim.queryLaneSeeds ?? []).flatMap((seed) => [seed.query, seed.purpose])].join(" ").toLowerCase();
    if (protectedStrings.some((value) => modelMetadata.includes(String(value).toLowerCase()))) {
      fail(`${claim.candidateId} repeated host-owned named-work text in Call 2 metadata`);
    }
    for (const values of Object.values(claim.identifierHints ?? {})) {
      for (const value of values) {
        if (!citedLower.includes(String(value).toLowerCase())) fail(`${claim.candidateId} has an ungrounded identifier hint`);
      }
    }
  }
  for (let left = 0; left < merged.length; left += 1) {
    for (let right = left + 1; right < merged.length; right += 1) {
      const a = words(merged[left].claimText); const b = words(merged[right].claimText);
      const shared = [...a].filter((word) => b.has(word)).length;
      if (shared >= 5 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.78) {
        fail(`Call 2 produced duplicate claims ${merged[left].candidateId} and ${merged[right].candidateId}`);
      }
    }
  }
  return oldShape;
}
