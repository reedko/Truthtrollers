import { Cf1Error } from "./errors.js";
import { CF1_THESIS_HINGES, CF1_VERIFICATION_TARGETS } from "./contract.js";
import { CF1_STRATEGY_FIELDS, resolveEvidenceStrategy } from "./evidenceStrategyMap.js";
import { deriveGradeTarget, isHingeAmbiguous } from "./hingeDerivation.js";
import { buildNamedWorkPool } from "./namedWorkPool.js";
import { minimumGroundingOverlap, semanticOverlap, semanticWords } from "./semanticGrounding.js";
import { detectTextNamedWorkCues } from "./textNamedWorkCues.js";

function fail(message) {
  throw new Cf1Error("CF1_AGENT_SEMANTIC_INVALID", message, { status: 422 });
}

function words(value) {
  return semanticWords(value);
}

function overlap(left, right) {
  return semanticOverlap(left, right);
}

function directWorkOverlap(left, right) {
  const generic = new Set(["several", "study", "studies", "review", "report"]);
  const wanted = [...words(left)].filter((word) => !generic.has(word));
  const available = words(right);
  return wanted.filter((word) => available.has(word)).length;
}

const criteriaText = (items) => items.join("; ");
const PROPOSED_ACTIVITY = /^(?:further|future|additional|comparative) (?:stud|research|analys|investigat)|^investigat/i;

function restatementExclusion(disputedQuestion) {
  if (disputedQuestion?.stipulatedByArticle == null
    || String(disputedQuestion.stipulatedByArticle).trim() === ""
    || !["substantive", "both_needed"].includes(disputedQuestion.verificationTarget)) return null;
  return ("A source only repeats or reports the statement the article already stipulates, without "
    + `independent evidence about: ${disputedQuestion.disputedProposition}`).slice(0, 220);
}

function containsProtectedText(value, protectedStrings) {
  const text = String(value ?? "").toLowerCase();
  return protectedStrings.some((protectedValue) =>
    text.includes(String(protectedValue).toLowerCase()));
}

function sanitizedModelText(values, protectedStrings, fallbackValues = []) {
  const retained = values.filter((value) => !containsProtectedText(value, protectedStrings));
  if (retained.length) return retained;
  return fallbackValues.filter((value) => !containsProtectedText(value, protectedStrings)).slice(0, 3);
}

function hostThemeBearing(original) {
  const pillars = original.relatedPillarLabels.join(", ").slice(0, 160);
  return `If refuted, this would weaken the article's ${pillars} pillar${original.relatedPillarLabels.length === 1 ? "" : "s"}.`;
}

export function verifySemanticInventory(output, { sourceUnits, minimumCandidates = 1, article } = {}) {
  if (!output?.theme?.text || !output?.thesis?.text || !Array.isArray(output.pillars)
    || !Array.isArray(output.candidateClaims)) fail("Call 1 omitted orientation or candidates");
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
  if (!CF1_THESIS_HINGES.includes(normalized.thesisHinge)) normalized.thesisHinge = "substance";
  const unitOrder = new Map(sourceUnits.map((unit) => [unit.unitId, unit.order]));
  for (const item of [normalized.theme, normalized.thesis, ...normalized.pillars,
    ...normalized.candidateClaims, ...(normalized.namedWorks ?? [])]) {
    if (Array.isArray(item.sourceUnitIds)) item.sourceUnitIds = [...new Set(item.sourceUnitIds)]
      .sort((left, right) => unitOrder.get(left) - unitOrder.get(right));
  }
  const unitText = new Map(sourceUnits.map((unit) => [unit.unitId, unit.text]));
  const modelWorks = (normalized.namedWorks ?? []).filter((work) => work.sourceUnitIds?.length
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
  // Non-destructive theme diagnostics. Never overwrite theme with thesis (that clobber
  // manufactured byte-identical theme==thesis; MCT open issue 6). Record a soft warning
  // that surfaces for review without failing the run or mutating the text.
  normalized.themeWarnings = [];
  const themeText = normalized.theme.text.replace(/\s+/g, " ").trim();
  const thesisText = normalized.thesis.text.replace(/\s+/g, " ").trim();
  const themeIsProposition = /\b(?:is|are|was|were|has|have|had|caus|found|shows?|reports?|concludes?|struck|occurred|issued)\b/i
    .test(normalized.theme.text);
  if (themeText.toLowerCase() === thesisText.toLowerCase()) {
    normalized.themeWarnings.push("CF1_THEME_EQUALS_THESIS");
  } else if (!themeIsProposition) {
    normalized.themeWarnings.push("CF1_THEME_NOT_PROPOSITION");
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
  const sourceOrder = new Map(sourceUnits.map((unit) => [unit.unitId, unit.order]));
  const namedWorkPool = new Map((inventory.namedWorks ?? []).map((work) => [work.namedWorkId, work]));
  const thesisHinge = CF1_THESIS_HINGES.includes(inventory.thesisHinge) ? inventory.thesisHinge : "substance";
  const merged = enriched.map((item) => {
    const original = originals.get(item.candidateId);
    const cited = original.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.unitId === id)?.text ?? "").join(" ");
    // Step 1 contract: the host validates and carries the model's disputed-question
    // decision verbatim. No strategy remapping or posture change keys off it yet.
    const disputed = item.disputedQuestion;
    if (!CF1_VERIFICATION_TARGETS.includes(disputed?.verificationTarget)
      || !disputed.disputedProposition?.trim() || !disputed.whyThisTarget?.trim()
      || disputed.stipulatedByArticle === undefined) {
      fail(`${item.candidateId} omitted a valid disputedQuestion`);
    }
    const requestedIds = item.relevantNamedWorkIds ?? [];
    if (new Set(requestedIds).size !== requestedIds.length) {
      fail(`${item.candidateId} repeated a named-work ID`);
    }
    if (requestedIds.some((id) => !namedWorkPool.has(id))) {
      fail(`${item.candidateId} referenced a named work outside the host pool`);
    }
    const claimText = item.revisedClaimText ?? original.claimText;
    const relevanceText = [claimText, ...item.mustMatch, ...item.searchConcepts].join(" ");
    const relevantNamedWorkIds = requestedIds.filter((id) =>
      directWorkOverlap(namedWorkPool.get(id)?.mentionText, relevanceText) > 0).slice(0, 6);
    const namedWorkHints = relevantNamedWorkIds.map((id) => structuredClone(namedWorkPool.get(id)));
    const protectedStrings = [article?.title, ...(article?.authors ?? []).map((author) => author?.name ?? author),
      ...namedWorkHints.map((work) => work.mentionText)]
      .filter((value) => String(value ?? "").length >= 8);
    const searchConcepts = sanitizedModelText(item.searchConcepts, protectedStrings, item.mustMatch);
    const cautions = sanitizedModelText(item.cautions, protectedStrings);
    const pillarLabels = new Set(original.relatedPillarLabels.map((label) => label.toLowerCase()));
    const onlyPillarLabels = item.mustMatch.every((value) => pillarLabels.has(value.toLowerCase()));
    const concreteMustMatch = onlyPillarLabels ? [] : item.mustMatch;
    const mustMatch = concreteMustMatch.length ? concreteMustMatch : item.searchConcepts.slice(0, 3);
    const concreteQualifications = item.qualifyCriteria.filter((value) => !PROPOSED_ACTIVITY.test(value));
    const qualifyCriteria = concreteQualifications.length ? concreteQualifications
      : [`Evidence supports the finding only within this scope: ${original.scope}`.slice(0, 240)];
    const externalWork = relevantNamedWorkIds.length > 0 && (original.articleUse === "background"
      || !/^(?:the )?(?:article|authors?|study)$/i.test(original.assertionSource));
    const semanticGuidance = [...item.supportCriteria, ...item.mustMatch,
      ...searchConcepts].join(" ");
    const { sourceStrategy, adjustment } = resolveEvidenceStrategy({ modelStrategy: item.sourceStrategy,
      disputedQuestion: disputed, semanticGuidance, externalWork });
    const strategy = CF1_STRATEGY_FIELDS[sourceStrategy];
    if (!strategy) fail(`${item.candidateId} supplied an unknown source strategy`);
    // both_needed keeps a substantive strategy but also needs the statement's provenance.
    const requiredEvidenceRoles = disputed.verificationTarget === "both_needed"
      ? [...new Set([...strategy.roles, "attribution-provenance"])] : strategy.roles;
    const claimMode = /\b(?:caus|caused|causal|led to|resulted in)\b/i.test(claimText) ? "causal"
      : /\b(?:percent|rate|odds|risk|significant|association|confidence interval)\b|\d+%/i.test(claimText) ? "statistical"
        : (original.namedWorkHints ?? []).some((work) => work.workType === "study") ? "study_result"
          : original.articleRole === "opponent_claim" ? "attribution" : "factual";
    const gradeTarget = deriveGradeTarget(thesisHinge, original.articleRole);
    const hingeWarning = isHingeAmbiguous(thesisHinge, original.articleRole)
      ? "Host could not resolve attribution vs. substance for a mixed-hinge load-bearing claim; graded as substance." : null;
    const shouldMatch = searchConcepts.filter((concept) => !mustMatch.some((required) =>
      required.toLowerCase().includes(concept.toLowerCase())
      || concept.toLowerCase().includes(required.toLowerCase())));
    const exclusion = restatementExclusion(disputed);
    const rejectIfOnly = exclusion && !item.rejectIfOnly.includes(exclusion)
      ? [...item.rejectIfOnly, exclusion].slice(0, 6) : item.rejectIfOnly;
    return { candidateId: item.candidateId, claimText,
      warrant: item.warrant ?? null,
      disputedQuestion: structuredClone(disputed), gradeTarget,
      verificationQuestion: `Does independent evidence resolve the disputed question: ${disputed.disputedProposition}`.slice(0, 360),
      claimTrueIf: criteriaText(item.supportCriteria), claimFalseIf: criteriaText(item.refuteCriteria),
      claimQualifiedIf: criteriaText(qualifyCriteria), themeBearing: hostThemeBearing(original),
      bestSourceTypes: strategy.sourceTypes, requiredEvidenceRoles,
      mustMatch, shouldMatch, rejectIfOnly,
      weakBearing: original.materiality === "low",
      warnings: [...(adjustment ? [adjustment] : []), ...(hingeWarning ? [hingeWarning] : []), ...cautions].slice(0, 5),
      identifierHints: { doi: [], pmid: [], canonicalSourceIds: [] },
      relevantNamedWorkIds, namedWorkRelevanceNote: null, namedWorkHints,
      sourceStrategy, searchConcepts,
      sourceUnitIds: [...original.sourceUnitIds]
        .sort((left, right) => sourceOrder.get(left) - sourceOrder.get(right)),
      assertionSource: original.assertionSource, articleUse: original.articleUse,
      origin: original.origin ?? "model",
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
    thesisHinge, pillars: inventory.pillars.map(({ label, text, importance }) => ({ label, text, importance })) },
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
    if (overlap(claim.claimText, cited) < minimumGroundingOverlap(claim.sourceUnitIds)) {
      fail(`Call 2 overbroadened ${claim.candidateId}`);
    }
    if (!claim.relatedPillarLabels.length) fail(`${claim.candidateId} lost pillar bearing`);
    if (!claim.verificationQuestion || !claim.claimTrueIf || !claim.claimFalseIf
      || !claim.mustMatch.length || !claim.requiredEvidenceRoles.length) {
      fail(`${claim.candidateId} has incomplete ER1 enrichment`);
    }
    const protectedStrings = [article?.title, ...(article?.authors ?? []).map((author) => author?.name ?? author),
      ...(claim.namedWorkHints ?? []).map((work) => work.mentionText)]
      .filter((value) => String(value ?? "").length >= 8);
    const modelMetadata = [...claim.searchConcepts, ...claim.warnings].join(" ").toLowerCase();
    if (protectedStrings.some((value) => modelMetadata.includes(String(value).toLowerCase()))) {
      fail(`${claim.candidateId} repeated host-owned named-work text in Call 2 metadata`);
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
