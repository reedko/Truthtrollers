import { Cf1Error } from "./errors.js";
import { isExplanatoryClaim, relatedResultExplanationPairs } from "./hostClaimRelations.js";
import { isContextualRationale, isMaterialLimitation, isSynthesisThesis } from "./hostClaimPolicy.js";
import { minimumGroundingOverlap, semanticWords } from "./semanticGrounding.js";

const roleRank = { thesis: 0, pillar: 1, consistency_hinge: 2, qualification: 3,
  pillar_support: 4, opponent_claim: 5 };
const materialityRank = { high: 0, medium: 1, low: 2 };
function words(value) {
  return semanticWords(value);
}
function similarity(left, right) {
  const a = words(left); const b = words(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

function grounded(candidate, unitsById) {
  const source = (candidate.sourceUnitIds ?? []).map((id) => unitsById.get(id)?.text ?? "").join(" ");
  const wanted = words(candidate.claimText);
  const available = words(source);
  const overlap = [...wanted].filter((word) => available.has(word)).length;
  return { validRefs: candidate.sourceUnitIds?.length > 0
      && candidate.sourceUnitIds.every((id) => unitsById.has(id)),
    overlap, source };
}

const groundingMinimum = (candidate) => minimumGroundingOverlap(candidate.sourceUnitIds);

function routine(candidate) {
  return candidate.materiality !== "high"
    && /\b(?:study design|methods?|sample size|participants?|subjects?|matched(?: on)?|matching|regression model|surveyed|enrolled|utilized)\b/i
      .test(candidate.claimText);
}

function externalContext(candidate) {
  return candidate.articleUse === "background"
    || /\b(?:previous|prior|background|literature|review)\b/i.test(candidate.assertionSource)
    || (candidate.articleRole === "pillar_support"
      && /\b(?:previous|prior|other studies|review|literature)\b/i.test(candidate.claimText));
}

function contextPillar(pillar) {
  return /\b(?:previous|prior|earlier|other) (?:studies|research|reviews?)\b|\b(?:review|reviewed)\b.*\b(?:hypothesis|evidence|association)\b/i
    .test(`${pillar.label} ${pillar.text}`);
}

const substantivePillars = (inventory) => inventory.pillars.filter((pillar) =>
  pillar.importance !== "supporting" && !contextPillar(pillar));

function compare(left, right) {
  return (materialityRank[left.materiality] ?? 9) - (materialityRank[right.materiality] ?? 9)
    || (roleRank[left.articleRole] ?? 9) - (roleRank[right.articleRole] ?? 9)
    || left._index - right._index;
}

// Backfill stance: adopt the articleUse of model candidates grounded in the pillar's own
// source units only when they all agree; anything else stays "unclear" rather than forcing
// a stance the host cannot verify.
function backfillArticleUse(pillar, candidates) {
  const pillarUnits = new Set(pillar.sourceUnitIds);
  const uses = [...new Set(candidates
    .filter((candidate) => candidate.sourceUnitIds.some((id) => pillarUnits.has(id)))
    .map((candidate) => candidate.articleUse))];
  return uses.length === 1 ? uses[0] : "unclear";
}

export function runHostSemanticCritic(inventory, { sourceUnits, structuralBlocks = [],
  targetMinimum = 8, targetMaximum = 12 } = {}) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const labels = new Set(inventory.pillars.map((pillar) => pillar.label));
  const findings = [];
  for (const item of inventory.candidateClaims) item.origin = item.origin ?? "model";
  const candidates = inventory.candidateClaims.map((item, index) => ({ ...structuredClone(item),
    candidateId: `C${String(index + 1).padStart(2, "0")}`, _index: index }));
  for (const candidate of candidates) {
    if (candidate.relatedPillarLabels.length) continue;
    const candidateUnits = new Set(candidate.sourceUnitIds);
    const ranked = inventory.pillars.map((pillar) => ({ pillar,
      score: pillar.sourceUnitIds.filter((id) => candidateUnits.has(id)).length * 10
        + similarity(candidate.claimText, pillar.text) }))
      .sort((left, right) => right.score - left.score);
    if (ranked[0]?.score > 0.25) {
      candidate.relatedPillarLabels = [ranked[0].pillar.label];
      findings.push({ type: "missing_pillar_link", severity: "material",
        candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
        problem: "Call 1 omitted a pillar link for a grounded claim.",
        recommendedAction: "Host assigned the strongest grounded pillar before selection." });
    } else if (["qualification", "consistency_hinge"].includes(candidate.articleRole)) {
      const primary = substantivePillars(inventory)[0];
      if (primary) candidate.relatedPillarLabels = [primary.label];
    }
  }
  for (const pillar of substantivePillars(inventory)) {
    if (candidates.some((candidate) => candidate.relatedPillarLabels.includes(pillar.label))) continue;
    const promoted = { claimText: pillar.text, sourceUnitIds: [...pillar.sourceUnitIds],
      articleRole: "pillar", articleUse: backfillArticleUse(pillar, candidates),
      assertionSource: "article", origin: "host_pillar_backfill",
      materiality: pillar.importance === "load_bearing" ? "high" : "medium",
      relatedPillarLabels: [pillar.label], namedWorkHints: [],
      scope: pillar.text.slice(0, 400),
      evidenceUsefulnessHint: `External evidence should directly test the ${pillar.label} proposition.`,
      candidateId: `C${String(candidates.length + 1).padStart(2, "0")}`, _index: candidates.length };
    candidates.push(promoted);
    inventory.candidateClaims.push(Object.fromEntries(Object.entries(promoted)
      .filter(([key]) => !["candidateId", "_index"].includes(key))));
    findings.push({ type: "missing_pillar_candidate", severity: "material",
      candidateIds: [promoted.candidateId], pillarLabels: [pillar.label],
      problem: "Call 1 created a major pillar without a corresponding candidate claim.",
      recommendedAction: "Host promoted the grounded pillar proposition into the enrichment portfolio." });
  }
  const rejected = new Map();
  for (const candidate of candidates) {
    let support = grounded(candidate, unitsById);
    const minimumOverlap = groundingMinimum(candidate);
    if (support.validRefs && support.overlap < 3) {
      const linkedMajor = substantivePillars(inventory).filter((pillar) =>
        candidate.relatedPillarLabels.includes(pillar.label));
      const expandedIds = [...new Set([...candidate.sourceUnitIds,
        ...linkedMajor.flatMap((pillar) => pillar.sourceUnitIds)])]
        .sort((left, right) => unitOrder.get(left) - unitOrder.get(right));
      const expanded = grounded({ ...candidate, sourceUnitIds: expandedIds }, unitsById);
      if (expanded.validRefs && expanded.overlap >= groundingMinimum({ ...candidate,
        sourceUnitIds: expandedIds })) {
        candidate.sourceUnitIds = expandedIds;
        support = expanded;
        findings.push({ type: "grounding_context_expanded", severity: "material",
          candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
          problem: "The candidate cited too little context to support its linked major-pillar wording.",
          recommendedAction: "Host added only the linked pillar's grounded source units and revalidated." });
      }
      if (support.overlap < 3) {
        const originalIds = new Set([...candidate.sourceUnitIds,
          ...linkedMajor.flatMap((pillar) => pillar.sourceUnitIds)]);
        const blockUnitIds = new Set(structuralBlocks.filter((block) =>
          block.sourceUnitIds.some((id) => originalIds.has(id))).flatMap((block) => block.sourceUnitIds));
        const claimWords = words(candidate.claimText);
        const siblings = [...blockUnitIds].filter((id) => !originalIds.has(id)).map((id) => ({ id,
          score: [...words(unitsById.get(id)?.text)].filter((word) => claimWords.has(word)).length }))
          .filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 2);
        const structuralIds = [...new Set([...candidate.sourceUnitIds, ...siblings.map((item) => item.id)])]
          .sort((left, right) => unitOrder.get(left) - unitOrder.get(right));
        const structural = grounded({ ...candidate, sourceUnitIds: structuralIds }, unitsById);
        if (structural.overlap >= groundingMinimum({ ...candidate,
          sourceUnitIds: structuralIds })) {
          candidate.sourceUnitIds = structuralIds;
          support = structural;
          findings.push({ type: "grounding_context_expanded", severity: "material",
            candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
            problem: "The candidate omitted supporting units from its existing structural block.",
            recommendedAction: "Host added the two strongest same-block units and revalidated." });
        }
      }
    }
    const unknownLabels = candidate.relatedPillarLabels.filter((label) => !labels.has(label));
    if (!support.validRefs || support.overlap < groundingMinimum(candidate) || unknownLabels.length
      || !candidate.relatedPillarLabels.length) {
      rejected.set(candidate.candidateId, "unsupported_or_overbroad");
      findings.push({ type: "unsupported_or_overbroad", severity: "blocking",
        candidateIds: [candidate.candidateId], pillarLabels: unknownLabels,
        problem: "The candidate lacks valid source grounding or uses an unknown pillar label.",
        recommendedAction: "Drop it before enrichment." });
    } else if (candidate.materiality === "low") {
      rejected.set(candidate.candidateId, "routine_or_low_materiality");
      findings.push({ type: "routine_or_low_materiality", severity: "material",
        candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
        problem: "The candidate is routine method/sample detail or low-materiality background.",
        recommendedAction: "Prefer a claim whose truth changes the article's argument." });
    } else if (routine(candidate)) findings.push({ type: "routine_method_or_sample", severity: "minor",
      candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
      problem: "The candidate is routine method or sample detail.",
      recommendedAction: "Use only if the portfolio otherwise lacks enough distinct material tasks." });
    if (/\b(?:no|not|never|without|failed to|did not|unlikely)\b/i.test(candidate.claimText)) {
      findings.push({ type: "polarity_risk", severity: "material",
        candidateIds: [candidate.candidateId], pillarLabels: candidate.relatedPillarLabels,
        problem: "Negative claim polarity can invert support and refutation criteria.",
        recommendedAction: "Preserve the negative proposition in Call 2 and test that exact polarity." });
    }
  }
  const eligible = candidates.filter((candidate) => !rejected.has(candidate.candidateId));
  for (let index = 0; index < eligible.length; index += 1) {
    if (rejected.has(eligible[index].candidateId)) continue;
    for (let other = index + 1; other < eligible.length; other += 1) {
      if (rejected.has(eligible[other].candidateId)) continue;
      if (similarity(eligible[index].claimText, eligible[other].claimText) < 0.76) continue;
      const [keep, drop] = [eligible[index], eligible[other]].sort(compare);
      rejected.set(drop.candidateId, `duplicate_of_${keep.candidateId}`);
      findings.push({ type: "duplicate_or_fragmented", severity: "material",
        candidateIds: [keep.candidateId, drop.candidateId], pillarLabels: keep.relatedPillarLabels,
        problem: "Two candidates substantially restate the same evidence task.",
        recommendedAction: `Keep ${keep.candidateId} and drop ${drop.candidateId}.` });
    }
  }
  const pool = candidates.filter((candidate) => !rejected.has(candidate.candidateId))
    .sort((left, right) => {
      const priority = (candidate) => Math.min(...candidate.relatedPillarLabels.map((label) =>
        contextPillar(inventory.pillars.find((pillar) => pillar.label === label) ?? {}) ? 2
          : inventory.pillars.find((pillar) => pillar.label === label)?.importance === "supporting" ? 1 : 0));
      return priority(left) - priority(right)
      || Number(externalContext(left)) - Number(externalContext(right))
      || Number(isSynthesisThesis(left)) - Number(isSynthesisThesis(right))
      || Number(isContextualRationale(left)) - Number(isContextualRationale(right))
      || Number(routine(left)) - Number(routine(right)) || compare(left, right);
    });
  const selected = [];
  const portfolioDuplicate = (candidate) => selected.some((chosen) =>
    isExplanatoryClaim(candidate) === isExplanatoryClaim(chosen)
      && candidate.relatedPillarLabels.some((label) => chosen.relatedPillarLabels.includes(label))
      && similarity(candidate.claimText, chosen.claimText) >= 0.4);
  const select = (candidate) => {
    if (candidate && selected.length < targetMaximum && !selected.includes(candidate)
      && !portfolioDuplicate(candidate)) selected.push(candidate);
  };
  for (const pillar of substantivePillars(inventory)) {
    const matches = pool.filter((candidate) => candidate.relatedPillarLabels.includes(pillar.label))
      .sort((left, right) => ({ pillar: 0, qualification: 1, consistency_hinge: 2,
        thesis: 3, pillar_support: 4, opponent_claim: 5 }[left.articleRole] ?? 9)
        - ({ pillar: 0, qualification: 1, consistency_hinge: 2,
          thesis: 3, pillar_support: 4, opponent_claim: 5 }[right.articleRole] ?? 9)
        || compare(left, right));
    select(matches[0]);
  }
  select(pool.find((candidate) => candidate.articleRole === "thesis" && !isSynthesisThesis(candidate)));
  select(pool.find(isMaterialLimitation));
  for (const candidate of pool) {
    if (selected.length >= targetMinimum) break;
    select(candidate);
  }
  const covered = new Set(selected.flatMap((candidate) => candidate.relatedPillarLabels));
  const uncoveredPillarLabels = substantivePillars(inventory).filter((pillar) =>
    !covered.has(pillar.label)).map((pillar) => pillar.label);
  if (uncoveredPillarLabels.length) findings.push({ type: "missing_pillar_coverage", severity: "blocking",
    candidateIds: [], pillarLabels: uncoveredPillarLabels,
    problem: "The selected portfolio does not cover every major/load-bearing pillar.",
    recommendedAction: "Call 2 must not invent coverage; reject the package if enrichment cannot preserve it." });
  if (uncoveredPillarLabels.length) {
    throw new Cf1Error("CF1_MISSING_PILLAR_COVERAGE",
      `Host selection left major pillars uncovered: ${uncoveredPillarLabels.join(", ")}`, { status: 422 });
  }
  const hardMinimum = Math.min(1, pool.length);
  if (selected.length < hardMinimum) {
    throw new Cf1Error("CF1_INSUFFICIENT_SELECTED_CLAIMS",
      `Host selection retained only ${selected.length} usable claims`, { status: 422 });
  }
  if (selected.length < Math.min(targetMinimum, pool.length)) findings.push({ type: "portfolio_below_target",
    severity: "minor", candidateIds: selected.map((item) => item.candidateId),
    pillarLabels: [...covered], problem: `Only ${selected.length} distinct usable claims survived host selection.`,
    recommendedAction: "Accept the smaller portfolio instead of padding it with duplicates or weak claims." });
  const relatedClaimPairs = relatedResultExplanationPairs(selected);
  for (const pair of relatedClaimPairs) findings.push({ type: "related_result_explanation",
    severity: "material", candidateIds: [pair.resultCandidateId, pair.explanationCandidateId],
    pillarLabels: [...new Set(selected.filter((item) => pair.resultCandidateId === item.candidateId
      || pair.explanationCandidateId === item.candidateId).flatMap((item) => item.relatedPillarLabels))],
    problem: "One selected claim reports a result and another gives the article's explanation for it.",
    recommendedAction: "Keep them as distinct evidence tasks and record their relationship." });
  const selectedIds = new Set(selected.map((item) => item.candidateId));
  const candidateDecisions = candidates.map(({ _index, ...candidate }) => ({ candidateId: candidate.candidateId,
    decision: selectedIds.has(candidate.candidateId) ? "select" : "drop",
    reason: selectedIds.has(candidate.candidateId) ? "Selected for pillar coverage and materiality."
      : rejected.get(candidate.candidateId) ?? (externalContext(candidate)
        ? "Demoted external background/context behind the article's own claims."
        : "Lower portfolio priority.") }));
  return { summary: `Host selected ${selected.length} of ${candidates.length} candidates for ER1 enrichment.`,
    findings, candidateDecisions, uncoveredPillarLabels, relatedClaimPairs,
    selectedClaims: selected.map(({ _index, ...candidate }) => candidate) };
}
