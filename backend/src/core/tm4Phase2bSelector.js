// backend/src/core/tm4Phase2bSelector.js
//
// TM4 Phase 2b — product selection gate.
//
// Sits after Phase 2 organization (pillars/clusters) and before Phase 3
// targetization. Distills the full raw claim-occurrence inventory (~60) down
// to the 8–12 claims most worth evaluating: claims where supporting or
// refuting them would meaningfully support or refute the article.
//
// Staged portfolio architecture (v2 — replaces the order-dependent
// reduceToEvaluationClaims adapter):
//
//   Stage 1  canonical duplicate removal only
//   Stage 2  order-independent intrinsic merit scoring   (tm4SelectorFeatures)
//   Stage 3  claim role / reasoning-move classification  (tm4SelectorFeatures)
//   Stage 4  thesis-spine coverage selection             (greedy by merit + pillar backfill)
//   Stage 5  redundancy/similarity portfolio pruning     (late, predicate-aware)
//   Stage 6  evaluator check / repair loop               (tm4SelectionEvaluator, ≤2 iterations)
//   Stage 7  persist only after pass or explicit acknowledged failure
//
// Principles enforced here:
//   - Claim merit is order-independent (self-checked every run).
//   - Redundancy is portfolio-state-dependent, applied late, and predicate-
//     aware: same topic ≠ same claim; same cluster + different hard predicate
//     must stay representable.
//   - Coverage (pillars, claim-bearing predicate families) is a portfolio
//     objective with repair/backfill, never a per-claim flat score.
//   - maxCount (12) is intentional slack: repairs prefer growing 10→11–12
//     over zero-sum swaps between two central claims.

import { computeClaimFeatures, jaccard, detectRebuttalFrame } from "./tm4SelectorFeatures.js";
import { evaluateSelection, planRepairs } from "./tm4SelectionEvaluator.js";
import logger from "../utils/logger.js";

export const TM4_SELECTION_DEFAULTS = {
  targetCount: 10, // aim; hard bounds below
  minCount: 8,
  maxCount: 12,
  maxInvertClaims: 3, // opponent/invert claims only when structurally important
  // SOFT lane-diversity pressure (NOT hard caps / quotas). A broad lane is
  // penalized only once it already holds `broadLaneFreeSlots` strong claims;
  // each further sibling costs `broadLanePenaltyStep`. A second claim in the
  // same NARROW lane (one entity + one predicate) costs `narrowLanePenaltyStep`.
  // Strong evidenceAffordance buys the penalty down (`affordanceRelief`), so a
  // predicate-distinct, highly searchable third sibling can still win — while a
  // weak repetitive sibling loses to a strong claim from an emptier lane.
  broadLaneFreeSlots: 2, // first 2 in a broad lane are penalty-free
  broadLanePenaltyStep: 0.09,
  narrowLanePenaltyStep: 0.05,
  affordanceRelief: 0.9, // evidenceAffordance=1 removes up to 90% of the penalty
  socialProofPenaltyExtra: 0.10, // social proof deepens faster (thin evidence)
  // A hard redundancy backstop only for near-LITERAL duplicates (not topic).
  redundancyJaccardGate: 0.6,
  // Rebuttal-article structure: guarantee the article's counter-claims are
  // represented so the argument–counterargument shape survives selection.
  opponentTargetCount: 2, // aim for up to 2 opponent/invert claims …
  minOpponentClaims: 1, //   … but at least 1 when the frame is a rebuttal.
  // Soft overconcentration report threshold (evaluator): flag a broad lane
  // beyond this only when a strong under-represented alternative exists.
  broadLaneSoftLimit: 3,
  maxRepairIterations: 2,
  repairIntrinsicMargin: 0.10, // repair candidates must be within this of the selection floor
  evidenceBudget: {
    perClaimReferenceCap: 3, // ~2-4 strong/high-bearing references per claim
    globalReferenceCap: 27, // ~24-30 total references
  },
};

// Column provenance for every diagnostic field this selector emits.
export const DIAGNOSTIC_COLUMN_CLASSES = {
  sourceClaimId: "diagnostic_only",
  visibleClaimText: "diagnostic_only",
  selected: "diagnostic_only",
  selectionRank: "diagnostic_only",
  preRepairRank: "diagnostic_only",
  postRepairRank: "diagnostic_only",
  intrinsicScore: "production_score_input",
  articleCentrality: "production_score_input",
  verificationWorthiness: "production_score_input",
  evidenceAffordance: "production_score_input",
  primaryDocumentAffordance: "production_score_input",
  studyOrDocumentHint: "diagnostic_only",
  specificity: "production_score_input",
  namedAnchorStrength: "production_score_input",
  sourceExcerptQuality: "production_score_input",
  articlePositionProminence: "production_score_input",
  pillarCoverageRole: "production_portfolio_constraint",
  reasoningMoves: "production_score_input",
  hardPredicateFlag: "production_score_input",
  predicateFamily: "production_portfolio_constraint",
  claimBearingFamily: "production_portfolio_constraint",
  narrowLane: "production_portfolio_constraint",
  broadLane: "production_portfolio_constraint",
  broadEvidenceLane: "production_portfolio_constraint",
  narrowEvidenceLane: "production_portfolio_constraint",
  selectionScoreBeforeLanePenalty: "production_score_input",
  laneDiversityPenalty: "production_portfolio_constraint",
  selectionScoreAfterLanePenalty: "production_portfolio_constraint",
  wouldHaveSelectedButForLanePenalty: "production_portfolio_constraint",
  selectedBecause: "diagnostic_only",
  omittedBecause: "diagnostic_only",
  opponentClaimFlag: "production_portfolio_constraint",
  rhetoricalQuestionFlag: "production_repair_signal",
  socialProofFlag: "production_portfolio_constraint",
  backgroundFlag: "production_score_input",
  topicSummaryFlag: "production_repair_signal",
  similaritySuppressionReason: "production_portfolio_constraint",
  coverageRepairReason: "production_repair_signal",
  evalFailureAddressed: "production_repair_signal",
  finalSelectionReason: "diagnostic_only",
};

const byMeritDesc = (a, b) =>
  b.features.intrinsicScore - a.features.intrinsicScore ||
  String(a.claim.claimId).localeCompare(String(b.claim.claimId));

// pillarId → count of selected claims in that pillar (for safe-victim checks).
const pillarUseOf = (selected) => {
  const m = new Map();
  for (const s of selected) {
    const p = s.claim.phase2PillarId;
    if (p) m.set(p, (m.get(p) || 0) + 1);
  }
  return m;
};

function composeRationale(entry, phase2Context) {
  const f = entry.features;
  const parts = [];
  if (f.dims.articleCentrality >= 1.0) parts.push("direct thesis claim");
  else if (f.dims.articleCentrality >= 0.85) parts.push("major pillar claim — thesis-bearing");
  else if (f.dims.articleCentrality >= 0.70) parts.push("important support claim");
  parts.push(`reasoning: ${f.reasoningMoves.slice(0, 3).join(", ")}`);
  if (f.hardPredicateFlag) parts.push("hard falsifiable predicate");
  if (f.dims.verificationWorthiness >= 0.85) parts.push("verification outcome would materially move article credibility");
  const pillar = (phase2Context.pillars || []).find((p) => p.pillarId === entry.claim.phase2PillarId);
  if (pillar) parts.push(`covers pillar ${entry.claim.phase2PillarId}${pillar.pillarText ? ` (“${pillar.pillarText.slice(0, 60)}”)` : ""}`);
  parts.push(`family ${f.claimBearingFamily}`);
  if (entry.coverageRepairReason) parts.push(entry.coverageRepairReason);
  return parts.join("; ");
}

/**
 * selectTm4EvaluationClaims(claims, phase2Context, options)
 *
 * @param claims        TM4 readiness entries (Phase 1 + reconciliation + Phase 2 merged)
 * @param phase2Context { thesis, pillars: [{pillarId, pillarText}], clusters: [{clusterId, anchors, clusterScore}] }
 * @param options       overrides of TM4_SELECTION_DEFAULTS; options.goldHighPriority
 *                      ([{goldText, priority}]) is test-harness-only input.
 * @returns { selectedEvaluationClaims, nonSelectedClaims, selectionSummary, selectionDiagnostics }
 */
export function selectTm4EvaluationClaims(claims = [], phase2Context = {}, options = {}) {
  const opts = { ...TM4_SELECTION_DEFAULTS, ...options };
  const rawClaimCount = claims.length;

  // ── Stage 1: canonical duplicate removal ONLY ─────────────────────────────
  const duplicateSuppressed = [];
  const pool = claims.filter((c) => {
    const r = c.reconciliation || {};
    if (r.groupId && r.canonicalOccurrenceId && r.canonicalOccurrenceId !== c.claimId) {
      duplicateSuppressed.push({ claimId: c.claimId, reason: `duplicate of ${r.canonicalOccurrenceId} (group ${r.groupId})` });
      return false;
    }
    return true;
  });

  // ── Stages 2+3: order-independent intrinsic scoring + classification ─────
  // Rebuttal-frame is an article-level fact (thesis + opponent-claim count),
  // computed once from the fixed context and pool — order-independent.
  const rebuttalFrame = detectRebuttalFrame(phase2Context, pool);
  const ctx = { ...phase2Context, rebuttalFrame };
  const candidates = pool.map((claim) => ({ claim, features: computeClaimFeatures(claim, ctx) }));
  const byId = new Map(candidates.map((e) => [e.claim.claimId, e]));

  // Order-independence self-check: recompute on the reversed pool; any score
  // drift is a scoring bug and surfaces as order_dependence_suspected.
  const orderDependenceDiff = [];
  for (const claim of [...pool].reverse()) {
    const again = computeClaimFeatures(claim, ctx).intrinsicScore;
    const first = byId.get(claim.claimId).features.intrinsicScore;
    if (Math.abs(again - first) > 1e-12) {
      orderDependenceDiff.push({ claimId: claim.claimId, forward: first, reverse: again });
    }
  }

  // Rhetorical-question guard: a bare question carries no falsifiable
  // proposition, so it is INELIGIBLE as a final selected claim (it would need
  // a declarative rewrite Phase 1 did not provide). Kept in byId/diagnostics.
  const eligibleCandidates = [];
  for (const e of candidates) {
    if (e.features.rhetoricalQuestionFlag) {
      e.similaritySuppressionReason =
        "rhetorical question — no falsifiable proposition; ineligible unless rewritten declaratively";
      continue;
    }
    eligibleCandidates.push(e);
  }

  const ranked = [...eligibleCandidates].sort(byMeritDesc);
  ranked.forEach((e, i) => { e.meritRank = i + 1; });

  const suppression = new Map(duplicateSuppressed.map((d) => [d.claimId, d.reason]));

  // Hard admission gates ONLY: the invert cap and a near-LITERAL duplicate
  // backstop. There are deliberately NO lane caps here — lane diversity is a
  // SOFT score penalty (below), never a hard block on predicate-distinct
  // siblings.
  const makeAdmitter = (selected) => ({
    check(e) {
      const invertCount = selected.filter((s) => s.claim.scoreTransformHint === "invert").length;
      if (e.claim.scoreTransformHint === "invert" && invertCount >= opts.maxInvertClaims) {
        return { ok: false, reason: `invert cap (${opts.maxInvertClaims}) reached` };
      }
      for (const s of selected) {
        const sim = jaccard(e.claim.visibleClaimText, s.claim.visibleClaimText);
        if (sim >= opts.redundancyJaccardGate) {
          return { ok: false, reason: `near-literal duplicate of selected ${s.claim.claimId} (sim ${sim.toFixed(2)})` };
        }
      }
      return { ok: true };
    },
    recount() {}, // lane counts are recomputed on demand by laneDiversityPenalty
  });

  // Soft lane-diversity penalty (portfolio scoring, applied to a candidate GIVEN
  // the current selected set). Predicate-distinct siblings are never blocked;
  // after a broad lane is full its next sibling is penalized, and a second claim
  // in the same narrow lane costs extra. Strong evidenceAffordance buys the
  // penalty down so a highly searchable, predicate-distinct third sibling can
  // still win — while a weak repetitive sibling loses to a strong claim from an
  // emptier lane. Opponent claims are exempt (their slot is a requirement).
  const laneDiversityPenalty = (e, sel) => {
    if (e.features.opponentClaimFlag) return 0;
    let broadN = 0, narrowN = 0;
    for (const s of sel) {
      if (s.features.broadLane === e.features.broadLane) broadN++;
      if (s.features.narrowLane === e.features.narrowLane) narrowN++;
    }
    let pen = 0;
    if (broadN >= opts.broadLaneFreeSlots) pen += opts.broadLanePenaltyStep * (broadN - opts.broadLaneFreeSlots + 1);
    if (narrowN >= 1) pen += opts.narrowLanePenaltyStep * narrowN;
    if (e.features.socialProofFlag && broadN >= 1) pen += opts.socialProofPenaltyExtra;
    // Strong evidence-document affordance overrides lane pressure.
    pen *= 1 - opts.affordanceRelief * (e.features.evidenceAffordance || 0);
    return Math.max(0, pen);
  };

  const selected = [];
  const admitter = makeAdmitter(selected);
  // Insert with the lane-penalty snapshot recorded at insertion time.
  const placeSelected = (e, reason) => {
    e.scoreBeforeLanePenalty = e.features.intrinsicScore;
    e.laneDiversityPenalty = laneDiversityPenalty(e, selected);
    e.scoreAfterLanePenalty = e.features.intrinsicScore - e.laneDiversityPenalty;
    if (reason) e.coverageRepairReason = reason;
    selected.push(e);
  };

  // ── Stage 4: thesis-spine coverage selection ──────────────────────────────
  // 4a. Portfolio greedy: repeatedly admit the candidate with the highest
  // lane-penalized score (intrinsic − laneDiversityPenalty at the current
  // portfolio state), recomputing penalties as the set grows.
  while (selected.length < opts.targetCount) {
    let best = null, bestAdj = -Infinity;
    for (const e of ranked) {
      if (selected.includes(e)) continue;
      if (!admitter.check(e).ok) continue;
      const adj = e.features.intrinsicScore - laneDiversityPenalty(e, selected);
      if (adj > bestAdj || (adj === bestAdj && best && String(e.claim.claimId) < String(best.claim.claimId))) {
        best = e; bestAdj = adj;
      }
    }
    if (!best) break;
    placeSelected(best);
  }

  // 4b. Pillar backfill: every major pillar gets at least one strong selected
  // claim when a worthy candidate exists — but never a weak background claim
  // forced in merely to tick the pillar box (centrality gate 0.70).
  const pillarIds = (phase2Context.pillars || []).map((p) => p.pillarId).filter(Boolean);
  const observedPillars = pillarIds.length ? pillarIds : [...new Set(pool.map((c) => c.phase2PillarId).filter(Boolean))];
  for (const pid of observedPillars) {
    if (selected.length >= opts.maxCount) break;
    if (selected.some((s) => s.claim.phase2PillarId === pid)) continue;
    const best = ranked.find(
      (e) =>
        !selected.includes(e) &&
        e.claim.phase2PillarId === pid &&
        e.features.dims.articleCentrality >= 0.70 &&
        admitter.check(e).ok
    );
    if (best) placeSelected(best, `pillar backfill: ${pid} had no selected representative`);
  }

  // 4c. Opponent requirement: a rebuttal article must keep its argument–
  // counterargument structure. Guarantee up to opponentTargetCount opponent/
  // invert claims (at least minOpponentClaims). Opponent claims rank below the
  // article's own load-bearing claims on merit, so they are backfilled here —
  // lane caps skipped (opponents are their own lane), redundancy still applies.
  // If the portfolio is already full, evict the lowest-merit low-impact claim
  // from an over-represented broad lane rather than an opponent or sole-pillar.
  const opponentSelectedCount = () => selected.filter((s) => s.features.opponentClaimFlag).length;
  if (rebuttalFrame) {
    const opponentPool = ranked.filter((e) => e.features.opponentClaimFlag && !selected.includes(e));
    for (const e of opponentPool) {
      if (opponentSelectedCount() >= opts.opponentTargetCount) break;
      if (!admitter.check(e).ok) continue;
      if (selected.length < opts.maxCount) {
        placeSelected(e, "opponent requirement: rebuttal frame needs the counter-claim it argues against");
        continue;
      }
      // Full: only swap to satisfy the HARD minimum, and only a safe victim.
      if (opponentSelectedCount() >= opts.minOpponentClaims) break;
      const broadUse = new Map();
      for (const s of selected) broadUse.set(s.features.broadLane, (broadUse.get(s.features.broadLane) || 0) + 1);
      const soloPillars = new Set(
        [...pillarUseOf(selected)].filter(([, n]) => n === 1).map(([p]) => p)
      );
      const victim = selected
        .filter(
          (s) =>
            !s.features.opponentClaimFlag &&
            s.features.dims.verificationWorthiness < 0.85 &&
            (broadUse.get(s.features.broadLane) || 0) > 1 &&
            !soloPillars.has(s.claim.phase2PillarId)
        )
        .sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
      if (!victim) break;
      victim.similaritySuppressionReason = `evicted for opponent requirement (over-represented lane "${victim.features.broadLane}")`;
      selected.splice(selected.indexOf(victim), 1);
      placeSelected(e, `opponent requirement: swapped in over lowest-impact lane-surplus claim ${victim.claim.claimId}`);
    }
  }

  // 4d. Broad-lane coverage: a representative portfolio should span the major
  // evidence lanes, not repeat the strongest one. If a high-impact lane with a
  // strong candidate has zero representatives while another lane is
  // over-concentrated (count ≥ broadLaneSoftLimit), swap the lowest-merit
  // surplus claim from the most over-represented lane for that lane's best
  // candidate. Never evicts an opponent, a sole-pillar representative, or a
  // repair/backfill add; bounded by the number of high-impact lanes.
  const HIGH_IMPACT_LANES = [
    "institutional_data_integrity",
    "study_result_or_study_suppression",
    "statistical_adverse_event_or_population_outcome",
    "mechanistic_toxicology",
    "regulatory_safety_testing",
    "legal_policy_or_liability",
    "ingredient_exposure_comparison",
  ];
  const broadCountOf = () => {
    const m = new Map();
    for (const s of selected) m.set(s.features.broadLane, (m.get(s.features.broadLane) || 0) + 1);
    return m;
  };
  for (let pass = 0; pass < HIGH_IMPACT_LANES.length; pass++) {
    const counts = broadCountOf();
    const uncovered = HIGH_IMPACT_LANES.filter((l) => !(counts.get(l) > 0));
    let progressed = false;
    for (const lane of uncovered) {
      const cand = ranked.find(
        (e) =>
          !selected.includes(e) &&
          e.features.broadLane === lane &&
          e.features.dims.articleCentrality >= 0.85 &&
          e.features.hardPredicateFlag &&
          admitter.check(e).ok
      );
      if (!cand) continue;
      const soloPillars = new Set([...pillarUseOf(selected)].filter(([, n]) => n === 1).map(([p]) => p));
      // Most over-represented lane (must exceed the soft limit) yields a victim.
      const overLane = [...counts.entries()]
        .filter(([l, n]) => n >= opts.broadLaneSoftLimit && l !== lane)
        .sort((a, b) => b[1] - a[1])[0];
      if (!overLane) continue;
      const victim = selected
        .filter(
          (s) =>
            s.features.broadLane === overLane[0] &&
            !s.features.opponentClaimFlag &&
            !s.coverageRepairReason &&
            !soloPillars.has(s.claim.phase2PillarId)
        )
        .sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
      if (!victim) continue;
      victim.similaritySuppressionReason = `evicted for broad-lane coverage (lane "${overLane[0]}" over-concentrated; "${lane}" unrepresented)`;
      selected.splice(selected.indexOf(victim), 1);
      placeSelected(cand, `broad-lane coverage: "${lane}" had no representative`);
      progressed = true;
    }
    if (!progressed) break;
  }

  // ── Stage 5: near-literal duplicate prune (safety net; NOT topic suppression)
  // Only collapses near-identical text — predicate-distinct siblings survive.
  const pruned = [];
  outer: for (let i = 0; i < selected.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = selected[i], b = selected[j];
      if (pruned.includes(b)) continue;
      const sim = jaccard(a.claim.visibleClaimText, b.claim.visibleClaimText);
      if (sim >= opts.redundancyJaccardGate) {
        a.similaritySuppressionReason = `portfolio prune: near-literal duplicate of ${b.claim.claimId} (sim ${sim.toFixed(2)})`;
        pruned.push(a);
        continue outer;
      }
    }
  }
  for (const p of pruned) selected.splice(selected.indexOf(p), 1);

  // Backfill to minCount if pruning left us short (redundancy + invert still
  // enforced; lane penalty applied via placeSelected snapshot).
  if (selected.length < opts.minCount) {
    for (const e of ranked) {
      if (selected.length >= opts.minCount) break;
      if (selected.includes(e)) continue;
      if (!admitter.check(e).ok) continue;
      placeSelected(e, "minCount backfill");
    }
  }

  const preRepairIds = selected.map((e) => e.claim.claimId);
  [...selected].sort(byMeritDesc).forEach((e, i) => { e.preRepairRank = i + 1; });

  // ── Stage 6: evaluator check / repair loop (≤ maxRepairIterations) ────────
  const gold = (options.goldHighPriority || []).filter((g) => g && g.goldText);
  let selectedIds = new Set(preRepairIds);
  const repairLog = [];
  const repairAddedIds = new Set();
  let evaluation = null;
  for (let iter = 1; iter <= opts.maxRepairIterations; iter++) {
    evaluation = evaluateSelection({
      candidates: eligibleCandidates, selectedIds, phase2Context, options: opts, gold, orderDependenceDiff, rebuttalFrame,
    });
    if (evaluation.pass) break;
    const { repairs, selectedIds: repairedIds } = planRepairs({
      failures: evaluation.failures,
      candidates: eligibleCandidates,
      selectedIds,
      options: { ...opts, repairAddedIds: [...repairAddedIds] },
    });
    if (!repairs.length) break; // nothing actionable — acknowledged below
    for (const r of repairs) {
      repairLog.push({ iteration: iter, ...r });
      if (r.addId) {
        repairAddedIds.add(r.addId);
        const e = byId.get(r.addId);
        e.coverageRepairReason = `repair(${r.failureType}): ${r.reason}`;
        e.evalFailureAddressed = r.failureType;
      }
      if (r.removeId) {
        const e = byId.get(r.removeId);
        if (e) e.similaritySuppressionReason = e.similaritySuppressionReason || `evicted by repair(${r.failureType}): ${r.reason}`;
      }
    }
    selectedIds = repairedIds;
  }
  // Final evaluation after the last repair application.
  evaluation = evaluateSelection({
    candidates: eligibleCandidates, selectedIds, phase2Context, options: opts, gold, orderDependenceDiff, rebuttalFrame,
  });

  // ── Stage 7: output contract (persist on pass or explicit acknowledgment) ─
  const finalSelected = [...selectedIds].map((id) => byId.get(id)).filter(Boolean).sort(byMeritDesc);
  finalSelected.forEach((e, i) => { e.postRepairRank = i + 1; });

  // Would-have-selected-but-for-lane-penalty: an omitted, admissible candidate
  // whose RAW merit clears the selection floor, but whose lane-penalized score
  // falls below it — i.e. lane diversity, not weakness, kept it out.
  const selectionFloor = finalSelected.length
    ? Math.min(...finalSelected.map((e) => e.scoreAfterLanePenalty ?? e.features.intrinsicScore))
    : 0;
  for (const e of eligibleCandidates) {
    if (selectedIds.has(e.claim.claimId)) continue;
    const pen = laneDiversityPenalty(e, finalSelected);
    e.finalLanePenalty = pen;
    e.wouldHaveSelectedButForLanePenalty =
      admitter.check(e).ok &&
      e.features.intrinsicScore >= selectionFloor &&
      e.features.intrinsicScore - pen < selectionFloor;
  }

  const pillarUse = new Map();
  for (const e of finalSelected) {
    const p = e.claim.phase2PillarId;
    if (p) pillarUse.set(p, (pillarUse.get(p) || 0) + 1);
  }
  const pillarRole = (e) => {
    const p = e.claim.phase2PillarId;
    if (!p) return "no_pillar";
    return (pillarUse.get(p) || 0) === 1 ? "sole_pillar_representative" : "pillar_shared";
  };

  const selectedEvaluationClaims = finalSelected.map((e, i) => {
    const c = e.claim;
    const groupMembers = claims.filter(
      (o) => o.reconciliation?.groupId && o.reconciliation.groupId === c.reconciliation?.groupId
    );
    return {
      ...c,
      selectionRank: i + 1,
      selectionScore: Number(e.features.intrinsicScore.toFixed(4)),
      selectionBreakdown: {
        ...e.features.dims,
        intrinsicScore: Number(e.features.intrinsicScore.toFixed(4)),
        reasoningMoves: e.features.reasoningMoves,
        predicateFamily: e.features.predicateFamily,
        claimBearingFamily: e.features.claimBearingFamily,
        narrowLane: e.features.narrowLane,
        broadLane: e.features.broadLane,
        broadEvidenceLane: e.features.broadLane,
        narrowEvidenceLane: e.features.narrowLane,
        evidenceAffordance: Number((e.features.evidenceAffordance ?? 0).toFixed(3)),
        primaryDocumentAffordance: e.features.primaryDocumentAffordance || false,
        studyOrDocumentHint: e.features.studyOrDocumentHint || "",
        selectionScoreBeforeLanePenalty: Number((e.scoreBeforeLanePenalty ?? e.features.intrinsicScore).toFixed(4)),
        laneDiversityPenalty: Number((e.laneDiversityPenalty ?? 0).toFixed(4)),
        selectionScoreAfterLanePenalty: Number((e.scoreAfterLanePenalty ?? e.features.intrinsicScore).toFixed(4)),
        opponentClaimFlag: e.features.opponentClaimFlag,
        hardPredicateFlag: e.features.hardPredicateFlag,
        pillarCoverageRole: pillarRole(e),
      },
      selectionRationale: composeRationale(e, phase2Context),
      sourceRawClaimIds: groupMembers.length ? groupMembers.map((o) => o.claimId) : [c.claimId],
    };
  });

  const selectedIdSet = new Set(selectedEvaluationClaims.map((c) => c.claimId));
  const nonSelectedClaims = claims
    .filter((c) => !selectedIdSet.has(c.claimId))
    .map((c) => {
      const e = byId.get(c.claimId);
      return {
        ...c,
        suppressionReason:
          suppression.get(c.claimId) ||
          e?.similaritySuppressionReason ||
          "below selection cut (portfolio full)",
        selectionScore: e ? Number(e.features.intrinsicScore.toFixed(4)) : null,
      };
    });

  // Per-candidate diagnostics: why each claim was selected or omitted.
  const diagnosticsRows = claims.map((c) => {
    const e = byId.get(c.claimId);
    const isSel = selectedIdSet.has(c.claimId);
    const f = e?.features;
    return {
      sourceClaimId: c.claimId,
      visibleClaimText: c.visibleClaimText,
      selected: isSel ? "yes" : "no",
      selectionRank: isSel ? finalSelected.findIndex((x) => x.claim.claimId === c.claimId) + 1 : "",
      preRepairRank: e?.preRepairRank ?? "",
      postRepairRank: e?.postRepairRank ?? "",
      meritRank: e?.meritRank ?? "",
      intrinsicScore: f ? Number(f.intrinsicScore.toFixed(4)) : "",
      articleCentrality: f?.dims.articleCentrality ?? "",
      verificationWorthiness: f ? Number(f.dims.verificationWorthiness.toFixed(3)) : "",
      evidenceAffordance: f ? Number((f.evidenceAffordance ?? 0).toFixed(3)) : "",
      primaryDocumentAffordance: f ? (f.primaryDocumentAffordance ? "yes" : "") : "",
      studyOrDocumentHint: f?.studyOrDocumentHint || "",
      specificity: f ? Number(f.dims.specificity.toFixed(3)) : "",
      namedAnchorStrength: f ? Number(f.dims.namedAnchorStrength.toFixed(3)) : "",
      sourceExcerptQuality: f?.dims.sourceExcerptQuality ?? "",
      articlePositionProminence: f?.dims.articlePositionProminence ?? "",
      pillarCoverageRole: e && isSel ? pillarRole(e) : "",
      reasoningMoves: f ? f.reasoningMoves.join("|") : "",
      hardPredicateFlag: f ? (f.hardPredicateFlag ? "yes" : "no") : "",
      predicateFamily: f?.predicateFamily ?? "",
      claimBearingFamily: f?.claimBearingFamily ?? "",
      narrowLane: f?.narrowLane ?? "",
      broadLane: f?.broadLane ?? "",
      broadEvidenceLane: f?.broadLane ?? "",
      narrowEvidenceLane: f?.narrowLane ?? "",
      selectionScoreBeforeLanePenalty: f ? Number(f.intrinsicScore.toFixed(4)) : "",
      laneDiversityPenalty: isSel
        ? Number((e?.laneDiversityPenalty ?? 0).toFixed(4))
        : e ? Number((e.finalLanePenalty ?? 0).toFixed(4)) : "",
      selectionScoreAfterLanePenalty: isSel
        ? Number((e?.scoreAfterLanePenalty ?? f.intrinsicScore).toFixed(4))
        : e ? Number((f.intrinsicScore - (e.finalLanePenalty ?? 0)).toFixed(4)) : "",
      wouldHaveSelectedButForLanePenalty: !isSel && e?.wouldHaveSelectedButForLanePenalty ? "yes" : "",
      opponentClaimFlag: f?.opponentClaimFlag ? "yes" : "",
      rhetoricalQuestionFlag: f?.rhetoricalQuestionFlag ? "yes" : "",
      socialProofFlag: f?.socialProofFlag ? "yes" : "",
      backgroundFlag: f?.backgroundFlag ? "yes" : "",
      topicSummaryFlag: f?.topicSummaryFlag ? "yes" : "",
      similaritySuppressionReason: (!isSel && e?.similaritySuppressionReason) || "",
      coverageRepairReason: (isSel && e?.coverageRepairReason) || "",
      evalFailureAddressed: (isSel && e?.evalFailureAddressed) || "",
      selectedBecause: isSel
        ? (e?.coverageRepairReason
            ? e.coverageRepairReason
            : (f?.evidenceAffordance >= 0.5
                ? `merit rank ${e?.meritRank} + strong evidence affordance (${f.evidenceAffordance.toFixed(2)})`
                : `merit rank ${e?.meritRank} (adjusted ${(e?.scoreAfterLanePenalty ?? f?.intrinsicScore ?? 0).toFixed(3)})`))
        : "",
      omittedBecause: isSel
        ? ""
        : suppression.get(c.claimId)
          || e?.similaritySuppressionReason
          || (e?.wouldHaveSelectedButForLanePenalty
              ? `lane-diversity penalty (${f?.broadLane} already represented; penalty ${(e.finalLanePenalty ?? 0).toFixed(3)})`
              : "below selection cut"),
      finalSelectionReason: isSel
        ? e?.coverageRepairReason || `merit rank ${e?.meritRank} (intrinsic ${f?.intrinsicScore.toFixed(3)})`
        : suppression.get(c.claimId) || e?.similaritySuppressionReason || "below selection cut (portfolio full)",
    };
  });

  const allPillarIds = new Set(observedPillars);
  const coveredPillars = new Set(selectedEvaluationClaims.map((c) => c.phase2PillarId).filter((p) => allPillarIds.has(p)));
  const clusterIds = new Set(claims.map((c) => c.phase2ClusterId).filter(Boolean));
  const coveredClusters = new Set(selectedEvaluationClaims.map((c) => c.phase2ClusterId).filter(Boolean));
  const invertSelected = selectedEvaluationClaims.filter((c) => c.scoreTransformHint === "invert").length;

  // Portfolio-balance diagnostics: lane distribution + opponent coverage.
  const laneTally = (key) => {
    const m = {};
    for (const e of finalSelected) {
      const k = e.features[key];
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  };
  const broadLaneCounts = laneTally("broadLane");
  const narrowLaneCounts = laneTally("narrowLane");
  const opponentSelected = finalSelected.filter((e) => e.features.opponentClaimFlag).length;
  const rhetoricalExcluded = candidates
    .filter((e) => e.features.rhetoricalQuestionFlag)
    .map((e) => e.claim.claimId);

  // Portfolio audit aggregates (soft lane-diversity view).
  const scoreTransformCounts = {};
  for (const c of selectedEvaluationClaims) {
    const t = c.scoreTransformHint || "none";
    scoreTransformCounts[t] = (scoreTransformCounts[t] || 0) + 1;
  }
  const documentAffordanceCount = finalSelected.filter((e) => e.features.primaryDocumentAffordance).length;
  const highAffordanceOmitted = candidates
    .filter((e) => !selectedIdSet.has(e.claim.claimId) && (e.features.evidenceAffordance ?? 0) >= 0.5)
    .sort((a, b) => (b.features.evidenceAffordance ?? 0) - (a.features.evidenceAffordance ?? 0))
    .map((e) => ({
      claimId: e.claim.claimId,
      evidenceAffordance: Number((e.features.evidenceAffordance ?? 0).toFixed(3)),
      broadLane: e.features.broadLane,
      reason: e.similaritySuppressionReason ||
        (e.wouldHaveSelectedButForLanePenalty ? "lane-diversity penalty" : "below selection cut"),
      text: (e.claim.visibleClaimText || "").slice(0, 90),
    }));
  const claimsPromotedForLaneDiversity = finalSelected
    .filter((e) => /coverage|pillar backfill|opponent requirement/.test(e.coverageRepairReason || ""))
    .map((e) => ({ claimId: e.claim.claimId, broadLane: e.features.broadLane, reason: e.coverageRepairReason }));
  const claimsDemotedForLaneOverconcentration = candidates
    .filter((e) => !selectedIdSet.has(e.claim.claimId) && e.wouldHaveSelectedButForLanePenalty)
    .map((e) => ({
      claimId: e.claim.claimId,
      broadLane: e.features.broadLane,
      intrinsic: Number(e.features.intrinsicScore.toFixed(4)),
      lanePenalty: Number((e.finalLanePenalty ?? 0).toFixed(4)),
    }));

  const selectionSummary = {
    selectorVersion: 2,
    articleThesis: phase2Context.thesis || "",
    rebuttalFrame,
    selectedCount: selectedEvaluationClaims.length,
    rawClaimCount,
    pillarCoverage: `${coveredPillars.size}/${allPillarIds.size}`,
    clusterCoverage: `${coveredClusters.size}/${clusterIds.size}`,
    broadLaneCounts,
    narrowLaneCounts,
    maxBroadLaneCount: Math.max(0, ...Object.values(broadLaneCounts)),
    opponentClaimsSelected: opponentSelected,
    invertClaimsSelected: invertSelected,
    scoreTransformCounts,
    documentAffordanceCount,
    highAffordanceOmitted,
    claimsPromotedForLaneDiversity,
    claimsDemotedForLaneOverconcentration,
    rhetoricalQuestionsExcluded: rhetoricalExcluded,
    duplicateSuppression: duplicateSuppressed.length,
    evidenceBudget: { ...opts.evidenceBudget },
    orderIndependence: { pass: orderDependenceDiff.length === 0, mismatches: orderDependenceDiff.length },
    repairs: repairLog,
    evaluator: {
      status: evaluation.pass ? "pass" : "failed_acknowledged",
      failures: evaluation.failures,
      note: evaluation.pass
        ? "all structural gates passed"
        : "persisting with explicit acknowledgment — remaining failures are recorded above and in diagnostics",
    },
  };

  const selectionDiagnostics = { columnClasses: DIAGNOSTIC_COLUMN_CLASSES, rows: diagnosticsRows };

  logger.log(
    `[TM4_PHASE2B] v2 selected ${selectionSummary.selectedCount}/${rawClaimCount} — pillars ${selectionSummary.pillarCoverage}, families ${new Set(finalSelected.map((e) => e.features.claimBearingFamily)).size}, repairs ${repairLog.length}, evaluator ${selectionSummary.evaluator.status}, order-independent ${selectionSummary.orderIndependence.pass}`
  );

  return { selectedEvaluationClaims, nonSelectedClaims, selectionSummary, selectionDiagnostics };
}
