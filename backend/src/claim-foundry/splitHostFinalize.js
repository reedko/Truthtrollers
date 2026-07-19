// Host merge + selection for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Steps after Call 1B).
// Deterministic, no model call. Reassembles 1A discovery + 1B source/posture into
// ONE object shaped exactly like cf1_semantic_inventory_v1 so hostSemanticCritic,
// Call 2, and everything downstream need zero changes. Runs, in order:
//   merge -> assertionSource classification -> duplicate detection ->
//   scoreTransform derivation -> selection (8-12).
// Selection happens ONLY here, once posture/effects/source class/duplicate status
// are known. The census is an external observation-only diagnostic.
import { semanticWords, semanticOverlap } from "./semanticGrounding.js";
import { classifyGroundingSpan } from "./candidateGroundingSpan.js";
import { deriveScoreTransform } from "./splitScoreTransform.js";
import { deriveArticleUse } from "./splitArticleUse.js";
import { classifyAssertionSource, SOURCE_CLASS_RANK } from "./splitAssertionSourceClass.js";

const candidateId = (index) => `CAND${String(index + 1).padStart(2, "0")}`;
const MATERIALITY_RANK = { high: 3, medium: 2, low: 1 };
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normSource = (value) => clean(value).toLowerCase().replace(/^the\s+/, "").replace(/[.,]+$/, "");
const normClaim = (value) => clean(value).toLowerCase().replace(/\W+/g, " ").trim();
const UNKNOWN_SOURCE = new Set(["", "unknown", "unresolved", "not available", "not identified"]);
const isUnknownSource = (value) => UNKNOWN_SOURCE.has(normSource(value));
const union = (...lists) => [...new Set(lists.flat().filter(Boolean))];

// claimText near-duplicate: high symmetric word overlap. assertionSource match:
// normalized equality or containment. Two claims are duplicates only when BOTH
// hold — same proposition from a DIFFERENT source is two distinct claims.
function claimTextSimilar(a, b) {
  const overlap = semanticOverlap(a, b);
  const size = Math.min(semanticWords(a).size, semanticWords(b).size) || 1;
  return overlap >= 3 && overlap / size >= 0.7;
}
function assertionSourceMatch(a, b) {
  const left = normSource(a); const right = normSource(b);
  if (!left || !right || isUnknownSource(a) || isUnknownSource(b)) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function provenanceIds(claim) {
  return union(claim.sourceUnitIds, claim._split?.attributionContextUnitIds,
    claim._split?.assertionSourceUnitIds);
}

function unknownConcreteLink(unknownClaim, concreteClaim) {
  if (normClaim(unknownClaim.claimText) === normClaim(concreteClaim.claimText)) return true;
  const concrete = normSource(concreteClaim.assertionSource);
  if ((unknownClaim._split?.sourceCandidates ?? []).some((item) => {
    const hint = normSource(item.nameHint);
    return hint && (hint === concrete || hint.includes(concrete) || concrete.includes(hint));
  })) return true;
  const concreteIds = new Set(provenanceIds(concreteClaim));
  return provenanceIds(unknownClaim).some((id) => concreteIds.has(id));
}

function duplicateRelation(a, b) {
  if (!claimTextSimilar(a.claimText, b.claimText)) return null;
  if (assertionSourceMatch(a.assertionSource, b.assertionSource)) return "same_proposition_same_source";
  const aUnknown = isUnknownSource(a.assertionSource); const bUnknown = isUnknownSource(b.assertionSource);
  if (aUnknown !== bUnknown) {
    const unknownClaim = aUnknown ? a : b; const concreteClaim = aUnknown ? b : a;
    return unknownConcreteLink(unknownClaim, concreteClaim)
      ? "same_proposition_unknown_promoted_to_concrete" : null;
  }
  if (aUnknown && bUnknown) {
    const ids = new Set(provenanceIds(a));
    return provenanceIds(b).some((id) => ids.has(id))
      ? "same_proposition_same_unresolved_occurrence" : null;
  }
  return null;
}

function mergeProvenance(primary, secondary) {
  primary.sourceUnitIds = union(primary.sourceUnitIds, secondary.sourceUnitIds).slice(0, 12);
  primary._split.attributionContextUnitIds = union(primary._split.attributionContextUnitIds,
    secondary._split.attributionContextUnitIds).slice(0, 8);
  primary._split.assertionSourceUnitIds = union(primary._split.assertionSourceUnitIds,
    secondary._split.assertionSourceUnitIds).slice(0, 8);
  primary._split.mergedCandidateIds = union(primary._split.mergedCandidateIds,
    secondary._split.mergedCandidateIds, primary._split.candidateId, secondary._split.candidateId);
  primary._split.mergedSourceUnitIds = union(primary._split.mergedSourceUnitIds,
    secondary._split.mergedSourceUnitIds, secondary.sourceUnitIds);
  return primary;
}

function mergeCandidates(inventory1a, judgmentById, packetById, blocking, sourceResolutionIssues) {
  return (inventory1a?.candidateClaims ?? []).map((claim, index) => {
    const id = candidateId(index);
    const judgment = judgmentById.get(id);
    const packet = packetById.get(id) ?? {};
    if (!judgment) {
      blocking.push({ code: "CF1_SPLIT_MISSING_JUDGMENT", candidateId: id });
      return null;
    }
    const merged = {
      claimText: claim.claimText, sourceUnitIds: claim.sourceUnitIds ?? [],
      materiality: claim.materiality, relatedPillarLabels: claim.relatedPillarLabels ?? [],
      scope: claim.scope, evidenceUsefulnessHint: claim.evidenceUsefulnessHint,
      articleRole: judgment.articleRole, assertionSource: judgment.assertionSource,
      // articleUse is host-derived (deriveArticleUse) after merge — never model-copied.
      _split: { origin: "candidate", candidateId: id,
        contentStance: judgment.contentStance, articleDeployment: judgment.articleDeployment,
        attributionContextUnitIds: claim.attributionContextUnitIds ?? [],
        assertionSourceUnitIds: judgment.assertionSourceUnitIds ?? [],
        assertionSourceResolution: judgment.assertionSourceResolution ?? null,
        sourceCandidateStatus: packet.sourceCandidateStatus ?? "not_evaluated",
        sourceCandidates: packet.sourceCandidates ?? [],
        mergedCandidateIds: [id], mergedSourceUnitIds: [],
        responseUnitIds: judgment.responseUnitIds ?? [], needsSplit: judgment.needsSplit ?? null,
        groundingSpan: claim.groundingSpan
          ?? classifyGroundingSpan(claim.sourceUnitIds).groundingSpan },
    };
    if (judgment.assertionSourceResolution) {
      const resolved = judgment.assertionSourceResolution.startsWith("resolved_from_");
      const sourceIds = judgment.assertionSourceUnitIds ?? [];
      const allowed = new Set([...(packet.claimUnits ?? []), ...(packet.attributionContextUnits ?? []),
        ...(packet.localResponseUnits ?? []), ...(packet.alternateOccurrenceUnits ?? [])]
        .map((item) => item.unitId));
      if (resolved && (isUnknownSource(judgment.assertionSource) || !sourceIds.length)) {
        sourceResolutionIssues.push({ candidateId: id, code: "resolved_source_missing_name_or_basis" });
      }
      if (!resolved && (!isUnknownSource(judgment.assertionSource) || sourceIds.length)) {
        sourceResolutionIssues.push({ candidateId: id, code: "unresolved_source_has_name_or_basis" });
      }
      if (sourceIds.some((unitId) => !allowed.has(unitId))) {
        sourceResolutionIssues.push({ candidateId: id, code: "source_basis_outside_claim_or_attribution_context" });
      }
      if (judgment.assertionSourceResolution === "no_candidate_available"
        && packet.sourceCandidateStatus !== "no_candidates_detected") {
        sourceResolutionIssues.push({ candidateId: id, code: "no_candidate_resolution_status_mismatch" });
      }
      if (judgment.assertionSourceResolution === "resolved_from_candidate"
        && packet.sourceCandidateStatus !== "candidates_found") {
        sourceResolutionIssues.push({ candidateId: id, code: "resolved_candidate_status_mismatch" });
      }
      if (judgment.assertionSourceResolution === "candidates_present_unresolved"
        && packet.sourceCandidateStatus !== "candidates_found") {
        sourceResolutionIssues.push({ candidateId: id, code: "candidate_resolution_status_mismatch" });
      }
    }
    return merged;
  }).filter(Boolean);
}

function collapseDuplicates(claims, collapses) {
  const kept = [];
  for (const claim of claims) {
    const twin = kept.find((existing) => duplicateRelation(existing, claim));
    if (!twin) { kept.push(claim); continue; }
    const relation = duplicateRelation(twin, claim);
    // Prefer the stronger source; tie -> keep the original candidate over a mint.
    const rankTwin = SOURCE_CLASS_RANK[twin._split.assertionSourceClass] ?? 0;
    const rankClaim = SOURCE_CLASS_RANK[claim._split.assertionSourceClass] ?? 0;
    const concretePromotion = isUnknownSource(twin.assertionSource) !== isUnknownSource(claim.assertionSource);
    const replace = concretePromotion ? isUnknownSource(twin.assertionSource)
      : rankClaim > rankTwin
      || (rankClaim === rankTwin && twin._split.origin !== "candidate" && claim._split.origin === "candidate");
    const primary = replace ? claim : twin; const secondary = replace ? twin : claim;
    mergeProvenance(primary, secondary);
    collapses.push({ reason: relation, kept: primary.claimText.slice(0, 80),
      keptSource: primary.assertionSource, dropped: secondary.claimText.slice(0, 80),
      droppedSource: secondary.assertionSource,
      mergedCandidateIds: primary._split.mergedCandidateIds });
    if (replace) kept[kept.indexOf(twin)] = primary;
  }
  return kept;
}

function selectionScore(claim) {
  return (MATERIALITY_RANK[claim.materiality] ?? 1) * 10
    + (SOURCE_CLASS_RANK[claim._split.assertionSourceClass] ?? 0)
    + (claim._split.origin === "candidate" ? 0.5 : 0);
}

export function finalizeSplitInventory({ inventory1a, call1bOutput, packets = [],
  article, options = {} } = {}) {
  const targetMax = options.targetMax ?? 12;
  const minimum = options.minimumCandidates
    ?? (String(article?.text ?? "").length >= 5_000 ? 8 : 1);
  const articleAuthors = (article?.authors ?? [])
    .map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean);

  const diagnostics = { backfillCount: 0, blockingErrors: [], duplicateCollapses: [],
    sourceResolutionIssues: [] };
  const judgmentById = new Map((call1bOutput?.candidateJudgments ?? [])
    .map((judgment) => [judgment.candidateId, judgment]));

  const packetById = new Map(packets.map((packet) => [packet.id, packet]));
  let claims = mergeCandidates(inventory1a, judgmentById, packetById,
    diagnostics.blockingErrors, diagnostics.sourceResolutionIssues);

  // assertionSource classification (tie-breaker signal) for every claim.
  for (const claim of claims) {
    claim._split.assertionSourceClass = classifyAssertionSource(claim.assertionSource, { articleAuthors });
  }
  // articleUse (live-schema field) and scoreTransform are both host-derived from the
  // contentStance/articleDeployment pair. An inconsistent pair is surfaced as a
  // blocking diagnostic (never silently resolved); the claim still carries a valid
  // "unclear" articleUse so it stays visible for repair/review.
  for (const claim of claims) {
    try { claim.articleUse = deriveArticleUse(claim._split); }
    catch (error) {
      claim.articleUse = "unclear";
      diagnostics.blockingErrors.push({ code: error.code, claimText: claim.claimText.slice(0, 80),
        contentStance: claim._split.contentStance, articleDeployment: claim._split.articleDeployment });
    }
    try { claim._split.scoreTransform = deriveScoreTransform(claim._split); }
    catch (error) {
      claim._split.scoreTransform = null;
      diagnostics.blockingErrors.push({ code: error.code, claimText: claim.claimText.slice(0, 80) });
    }
  }
  claims = collapseDuplicates(claims, diagnostics.duplicateCollapses);

  const ranked = [...claims].sort((a, b) => selectionScore(b) - selectionScore(a));
  const selected = ranked.slice(0, Math.max(minimum, Math.min(targetMax, ranked.length)));
  const selectedSet = new Set(selected);

  const inventory = {
    theme: inventory1a?.theme, thesis: inventory1a?.thesis,
    pillars: inventory1a?.pillars, thesisHinge: inventory1a?.thesisHinge,
    candidateClaims: selected.map(({ _split, ...schemaClaim }) => schemaClaim),
  };
  return { inventory,
    hostSignals: selected.map((claim) => ({ claimText: claim.claimText, ...claim._split })),
    diagnostics: { ...diagnostics, selectedCount: selected.length,
      deselectedCount: claims.length - selected.length },
    droppedFromSelection: ranked.filter((c) => !selectedSet.has(c)).map((c) => c.claimText.slice(0, 80)),
  };
}
