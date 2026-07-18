import { verifyOneCallAgentOutput } from "./oneCallAgentVerification.js";
import { deriveClaimPosture } from "./claimPosture.js";

const candidateId = (index) => `candidate-${index}`;
const revisedId = (index) => `revised-${index}`;
const selectedId = (index) => `selected-${index}`;
const pillarId = (index) => `pillar-${index}`;

function unitMaps(structuralBlocks) {
  const blocksByUnit = new Map();
  for (const block of structuralBlocks) {
    for (const unitId of block.sourceUnitIds ?? []) blocksByUnit.set(unitId, block.blockId);
  }
  return blocksByUnit;
}

function sourceBlockIds(indexes, candidates, blocksByUnit) {
  return [...new Set(indexes.flatMap((index) => candidates[index].sourceUnitIds)
    .map((unitId) => blocksByUnit.get(unitId)).filter(Boolean))];
}

function mappedProposition(text, indexes, candidates, blocksByUnit) {
  return { text, sourceBlockIds: sourceBlockIds(indexes, candidates, blocksByUnit),
    rawAssertionIds: indexes.map(candidateId) };
}

function words(value) {
  return new Set(String(value).toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

function bestCandidateIndexes(text, candidates, maximum = 3) {
  const wanted = words(text);
  const ranked = candidates.map((candidate, index) => ({ index,
    score: [...words(candidate.claimText)].filter((word) => wanted.has(word)).length }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const matched = ranked.filter((item) => item.score > 0).slice(0, maximum).map((item) => item.index);
  return matched.length ? matched : [0];
}

function namedWorkStrings(candidate) {
  return (candidate.namedWorkHints ?? []).map((work) => [work.mentionText, work.year,
    ...(work.peopleOrOrganizations ?? []), ...(work.identifiers ?? [])].filter(Boolean).join(" "));
}

function identifierHints(candidates, article) {
  const works = candidates.flatMap((item) => item.namedWorkHints ?? []);
  const identifiers = works.flatMap((work) => work.identifiers ?? []);
  const articleDoi = String(article?.url ?? "").match(/doi\.org\/(10\.\d{4,9}\/\S+)/i)?.[1];
  return {
    doi: [...new Set([...identifiers.filter((value) => /^10\.\d{4,9}\//i.test(value)),
      ...(articleDoi ? [articleDoi] : [])])],
    pmid: identifiers.filter((value) => /^(?:pmid[:\s]*)?\d{1,10}$/i.test(value))
      .map((value) => value.replace(/^pmid[:\s]*/i, "")),
    titleExact: [], authorYear: [],
    quotedDocumentNames: works.map((work) => work.mentionText),
    canonicalSourceIds: [],
  };
}

function querySeed(claim) {
  const work = (claim.namedWorkHints ?? [])[0];
  const source = !/^(?:the )?(?:article|authors?|study)$/i.test(claim.assertionSource)
    ? claim.assertionSource : null;
  const base = claim.claimText;
  const additions = [...new Set([work?.mentionText, work?.year, source].filter(Boolean)
    .map(String))].filter((value) => !base.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  return [base, ...additions].join(" ").slice(0, 1_000);
}

function evidenceRoles(claim) {
  const roles = new Set(["target-primary"]);
  if ((claim.namedWorkHints ?? []).some((work) => ["study", "report", "dataset"].includes(work.workType))) {
    roles.add("study-identity");
  }
  if (!/^(?:the )?(?:article|study|authors?)$/i.test(claim.assertionSource)) {
    roles.add("attribution-provenance");
  }
  roles.add("primary-record");
  return [...roles].slice(0, 8);
}

function mustMatch(claim) {
  const externalSource = !/^(?:the )?(?:article|study|authors?)$/i.test(claim.assertionSource)
    ? claim.assertionSource : null;
  return [...new Set([claim.scope, externalSource,
    ...(claim.namedWorkHints ?? []).map((work) => work.mentionText)].filter(Boolean))];
}

function nonBearingRule(claim) {
  return `A source only discusses ${claim.scope} or repeats the proposition without reporting evidence that directly tests it.`;
}

export function expandOneCallAgentOutput(output, { structuralBlocks, article, skipVerification = false }) {
  if (!skipVerification) verifyOneCallAgentOutput(output);
  const candidates = output.initialCandidates;
  const blocksByUnit = unitMaps(structuralBlocks);
  const rawAssertion = (item, rawAssertionId, rationale) => ({
    rawAssertionId, text: item.claimText,
    sourceUnitIds: item.sourceUnitIds, speakerEntity: item.assertionSource ?? "article",
    assertionForm: item.assertionForm ?? "other", articleUse: item.articleUse ?? "unclear",
    namedEntities: [...new Set([item.assertionSource,
      ...(item.namedWorkHints ?? []).flatMap((work) => work.peopleOrOrganizations ?? [])]
      .filter(Boolean))],
    namedWorks: namedWorkStrings(item),
    numbersAndDates: (item.namedWorkHints ?? []).map((work) => work.year).filter(Boolean).map(String),
    reconciliation: { canonicalRawAssertionId: rawAssertionId, relationship: "unique",
      relatedRawAssertionIds: [], rationale },
  });
  const rawAssertions = candidates.map((item, index) => rawAssertion(item,
    candidateId(index), "Initial one-call candidate."));
  const assertionForm = { factual: "direct", causal: "causal", statistical: "statistical",
    attribution: "attributed", study_result: "study_document", policy_legal: "legal_policy",
    methodology: "inference" };
  rawAssertions.push(...output.selectedClaims.map((item, index) => rawAssertion({ ...item,
    assertionForm: assertionForm[item.claimMode] ?? "other" }, revisedId(index),
  "Revised after semantic critique.")));
  const pillars = output.orientation.pillars.map((item, index) => ({
    pillarId: pillarId(index), label: item.label, importance: item.importance,
    ...mappedProposition(item.text, bestCandidateIndexes(item.text, candidates), candidates, blocksByUnit),
  }));
  const articleMap = {
    theme: output.orientation.theme,
    thesisHinge: output.orientation.thesisHinge ?? null,
    thesis: mappedProposition(output.orientation.thesis,
      bestCandidateIndexes(output.orientation.thesis, candidates), candidates, blocksByUnit),
    pillars,
    clusters: pillars.map((item, index) => ({ clusterId: `cluster-${index}`, label: item.label,
      rawAssertionIds: item.rawAssertionIds, relationship: "reasoning_chain" })),
    opponentPositions: candidates.map((item, index) => ({ item, index }))
      .filter(({ item }) => ["opponent_to_rebut", "rejected"].includes(item.articleUse))
      .map(({ index }) => mappedProposition(
      candidates[index].claimText, [index], candidates, blocksByUnit)),
    qualifications: candidates.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.articleUse === "qualification")
      .map(({ index }) => mappedProposition(
      candidates[index].claimText, [index], candidates, blocksByUnit)),
    mapWarnings: [],
  };
  const claimsWithPosture = output.selectedClaims.map((claim) => ({
    claim,
    // Knob A only: the attribution/substance hinge remains the separate gradeTarget field.
    posture: deriveClaimPosture(claim),
  }));
  const selectedEvaluationClaims = claimsWithPosture.map(({ claim, posture }, index) => {
    const labels = new Set(claim.relatedPillarLabels.map((label) => label.toLocaleLowerCase()));
    const related = pillars.filter((pillar) => labels.has(pillar.label.toLocaleLowerCase()));
    const relatedPillarIds = related.map((pillar) => pillar.pillarId);
    const relatedSummary = related.map((pillar) => `${pillar.label} (${pillar.importance})`).join(", ");
    return { selectedClaimId: selectedId(index), claimText: claim.claimText,
      sourceRawAssertionIds: [revisedId(index)], articleRole: claim.articleRole, relatedPillarIds,
      materiality: claim.materiality, origin: claim.origin ?? "model",
      counterfactualImpact: claim.themeBearing,
      selectionRationale: `Theme gate (${relatedSummary}): ${claim.themeBearing}`,
      scoreTransform: posture.scoreTransform, searchEligible: true,
      verdictEligible: posture.verdictEligible, gradeTarget: claim.gradeTarget ?? null,
      confidence: 0.8, claimMode: claim.claimMode, warrant: claim.warrant ?? null };
  });
  const phase3Targets = claimsWithPosture.map(({ claim, posture }, index) => {
    return { targetId: `target-${index}`, selectedClaimId: selectedId(index),
      targetText: claim.claimText, targetType: posture.targetType,
      scoreTransform: posture.scoreTransform, searchEligible: true,
      verdictEligible: posture.verdictEligible, gradeTarget: claim.gradeTarget ?? null,
      sourceRawAssertionIds: [revisedId(index)], mappingStatus: "resolved",
      mappingRationale: "Derived from the revised selected claim." };
  });
  const evidenceNeedCards = output.selectedClaims.map((claim, index) => {
    const rejectIfOnly = nonBearingRule(claim);
    return { targetId: `target-${index}`, evidenceRolesNeeded: evidenceRoles(claim),
      warrant: claim.warrant ?? null,
      bearingCriteria: { mustMatch: mustMatch(claim), shouldMatch: [claim.scope],
        rejectIfOnly: [rejectIfOnly], weak: false },
      queryLaneSeeds: [{ laneType: "primary", query: querySeed(claim),
        purpose: "Find evidence bearing directly on the falsifiable target.",
        sourceFieldsUsed: ["claimText", "namedWorkHints", "assertionSource"] }],
      identifierHints: identifierHints([claim], article),
      falsifiability: { wouldSupportIf: claim.claimTrueIf, wouldRefuteIf: claim.claimFalseIf,
        wouldQualifyIf: claim.claimQualifiedIf, notEnoughIfOnly: rejectIfOnly },
      scope: claim.scope, assertionSource: claim.assertionSource,
      namedWorkHints: claim.namedWorkHints,
    };
  });
  return { semanticBlockAnnotations: [], rawAssertions, articleMap,
    internalConsistencyFindings: [], selectedEvaluationClaims, phase3Targets,
    evidenceNeedCards, selectionCountException: null, agentWarnings: output.hostWarnings ?? [] };
}
