// backend/src/core/tm4SelectionEvaluator.js
//
// TM4 Phase 2b — selection evaluator + repair planner.
//
// Runs AFTER a candidate portfolio has been assembled and BEFORE persistence.
// Returns STRUCTURED failures (never a bare PASS/FAIL) and deterministic
// repair actions. Pure functions: no logging, no mutation of inputs — the
// selector orchestrates apply/re-evaluate loops (max 2 iterations) and records
// every repair in the selection diagnostics.
//
// Gold rows are OPTIONAL test-harness input (gold_eval_only); production runs
// evaluate without them and every other gate still works.

import { HIGH_IMPACT_MOVES, jaccard } from "./tm4SelectorFeatures.js";

export const FAILURE_TYPES = [
  "missing_claim_bearing_family",
  "lost_hard_predicate",
  "gold_high_priority_missing",
  "topic_summary_selected",
  "overselected_social_proof",
  "cluster_overcollapse",
  "weak_falsifiability_selected",
  "pillar_undercoverage",
  "order_dependence_suspected",
  // portfolio-balance gates
  "missing_opponent_coverage",
  "broad_lane_overconcentration",
  "narrow_lane_overconcentration",
  "rhetorical_question_selected",
];

const SOCIAL_THESIS_RE = /\b(movement|protest|supporters|rally|awareness|uptake|adoption|popularity|turnout)\b/i;

const isStrongFamilyCarrier = (e) =>
  HIGH_IMPACT_MOVES.has(e.features.primaryMove) &&
  e.features.hardPredicateFlag &&
  e.features.dims.articleCentrality >= 0.85;

/**
 * evaluateSelection({ candidates, selectedIds, phase2Context, options, gold, orderDependenceDiff })
 *
 * @param candidates entries [{ claim, features }] — the post-dedup pool
 * @param selectedIds Set of claimIds currently in the portfolio
 * @param gold optional [{ goldText, priority }] high-priority gold rows
 * @param orderDependenceDiff optional array of {claimId, forward, reverse} score mismatches
 * @returns { pass, failures: [{ type, detail, candidateClaimId?, selectedClaimId? }] }
 */
export function evaluateSelection({
  candidates = [],
  selectedIds = new Set(),
  phase2Context = {},
  options = {},
  gold = [],
  orderDependenceDiff = [],
  rebuttalFrame = false,
}) {
  const failures = [];
  const selected = candidates.filter((e) => selectedIds.has(e.claim.claimId));
  const unselected = candidates.filter((e) => !selectedIds.has(e.claim.claimId));
  const minSelectedIntrinsic = selected.length
    ? Math.min(...selected.map((e) => e.features.intrinsicScore))
    : 0;
  const repairFloor = minSelectedIntrinsic - (options.repairIntrinsicMargin ?? 0.10);

  // ── order_dependence_suspected (self-check computed by the selector) ──────
  if (orderDependenceDiff.length) {
    failures.push({
      type: "order_dependence_suspected",
      detail: { mismatches: orderDependenceDiff.slice(0, 5), count: orderDependenceDiff.length },
    });
  }

  // ── pillar_undercoverage ──────────────────────────────────────────────────
  const pillarIds = (phase2Context.pillars || []).map((p) => p.pillarId).filter(Boolean);
  const observedPillars = pillarIds.length
    ? pillarIds
    : [...new Set(candidates.map((e) => e.claim.phase2PillarId).filter(Boolean))];
  const selectedPillars = new Set(selected.map((e) => e.claim.phase2PillarId).filter(Boolean));
  for (const pid of observedPillars) {
    if (selectedPillars.has(pid)) continue;
    const best = unselected
      .filter(
        (e) =>
          e.claim.phase2PillarId === pid &&
          e.features.dims.articleCentrality >= 0.70 &&
          e.features.intrinsicScore >= repairFloor
      )
      .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
    if (best) {
      failures.push({
        type: "pillar_undercoverage",
        detail: { pillarId: pid, bestCandidate: best.claim.claimId, intrinsic: best.features.intrinsicScore },
        candidateClaimId: best.claim.claimId,
      });
    }
  }

  // ── missing_claim_bearing_family / cluster_overcollapse ──────────────────
  // A family is "must-cover" when its best carrier is a strong high-impact
  // hard-predicate claim near the selection floor AND losing it actually
  // thins the thesis spine: its whole EVIDENCE LANE is unrepresented, or its
  // pillar is unrepresented. Coverage is judged at the broad-lane / pillar
  // level (matching the portfolio balance model) — a claim whose evidence lane
  // and pillar are already covered is just below the cut, not a structural
  // failure, even if its exact fine-grained predicate family is unique.
  const selectedBroadLanes = new Set(selected.map((e) => e.features.broadLane));
  const selectedFamilies = new Set(selected.map((e) => e.features.claimBearingFamily));
  const selectedClusters = new Set(selected.map((e) => e.claim.phase2ClusterId).filter(Boolean));
  // Lane saturation: the family/predicate gates must not demand a claim from a
  // broad lane that is already well represented (at/over the soft limit) —
  // otherwise soft lane-diversity de-concentration re-surfaces as an unfixable
  // "missing family" failure.
  const softLimit = options.broadLaneSoftLimit ?? 3;
  const selBroad = new Map();
  for (const e of selected) {
    selBroad.set(e.features.broadLane, (selBroad.get(e.features.broadLane) || 0) + 1);
  }
  const laneSaturated = (e) => (selBroad.get(e.features.broadLane) || 0) >= softLimit;
  // Once a broad lane already holds its penalty-free allotment, the selector's
  // soft lane-diversity pressure intentionally prefers a DIFFERENT lane. The
  // same-entity predicate gate must respect that: don't demand a further
  // sibling from an already-diverse-enough lane.
  const freeSlots = options.broadLaneFreeSlots ?? 2;
  const laneAtDiversityCap = (e) => (selBroad.get(e.features.broadLane) || 0) >= freeSlots;
  const seenFamilies = new Set();
  for (const e of unselected.sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)) {
    const fam = e.features.claimBearingFamily;
    if (seenFamilies.has(fam) || selectedFamilies.has(fam)) continue;
    seenFamilies.add(fam);
    if (!isStrongFamilyCarrier(e)) continue;
    if (e.features.intrinsicScore < repairFloor) continue;
    if (laneSaturated(e)) continue; // balance caps forbid it — not a failure
    const spineRelevant =
      !selectedBroadLanes.has(e.features.broadLane) ||
      (e.claim.phase2PillarId && !selectedPillars.has(e.claim.phase2PillarId));
    if (!spineRelevant) continue;
    const sharesCluster = e.claim.phase2ClusterId && selectedClusters.has(e.claim.phase2ClusterId);
    failures.push({
      type: sharesCluster ? "cluster_overcollapse" : "missing_claim_bearing_family",
      detail: {
        family: fam,
        predicateFamily: e.features.predicateFamily,
        bestCandidate: e.claim.claimId,
        intrinsic: e.features.intrinsicScore,
        cluster: e.claim.phase2ClusterId || null,
      },
      candidateClaimId: e.claim.claimId,
    });
  }

  // ── lost_hard_predicate ───────────────────────────────────────────────────
  // Entity already represented in the portfolio, but a distinct allegation
  // verb-class about that entity (carried only by an unselected strong
  // candidate) is not — the specific hard predicate got lost.
  const reportedCandidates = new Set(failures.map((f) => f.candidateClaimId).filter(Boolean));
  const selectedVerbByEntity = new Map();
  for (const e of selected) {
    const key = e.features.primaryEntity;
    if (!selectedVerbByEntity.has(key)) selectedVerbByEntity.set(key, new Set());
    for (const v of e.features.verbClasses) selectedVerbByEntity.get(key).add(v);
  }
  for (const e of unselected) {
    if (reportedCandidates.has(e.claim.claimId)) continue;
    if (!isStrongFamilyCarrier(e)) continue;
    if (e.features.intrinsicScore < repairFloor) continue;
    // Respect soft lane diversity: don't force a same-entity predicate sibling
    // into a lane that already holds its penalty-free allotment.
    if (laneAtDiversityCap(e)) continue;
    const entityVerbs = selectedVerbByEntity.get(e.features.primaryEntity);
    if (!entityVerbs) continue; // entity absent entirely → family gate above owns it
    const lost = e.features.verbClasses.filter((v) => !entityVerbs.has(v));
    if (lost.length && lost.length === e.features.verbClasses.length) {
      failures.push({
        type: "lost_hard_predicate",
        detail: { entity: e.features.primaryEntity, lostVerbClasses: lost, bestCandidate: e.claim.claimId },
        candidateClaimId: e.claim.claimId,
      });
      reportedCandidates.add(e.claim.claimId);
    }
  }

  // ── topic_summary_selected ────────────────────────────────────────────────
  // Opponent claims are exempt: a public-health slogan the article rebuts is
  // meant to be a slogan; it carries argument structure, not a topic summary
  // of the article's own thesis.
  for (const s of selected) {
    if (s.features.opponentClaimFlag) continue;
    if (!s.features.topicSummaryFlag) continue;
    const alt = unselected
      .filter(
        (e) =>
          e.claim.phase2PillarId === s.claim.phase2PillarId &&
          e.features.hardPredicateFlag &&
          !e.features.topicSummaryFlag &&
          e.features.intrinsicScore >= s.features.intrinsicScore - 0.05
      )
      .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
    if (alt) {
      failures.push({
        type: "topic_summary_selected",
        detail: { selected: s.claim.claimId, replacement: alt.claim.claimId },
        selectedClaimId: s.claim.claimId,
        candidateClaimId: alt.claim.claimId,
      });
    }
  }

  // ── overselected_social_proof ─────────────────────────────────────────────
  const socialSelected = selected.filter((e) => e.features.socialProofFlag);
  const thesisIsSocial = SOCIAL_THESIS_RE.test(phase2Context.thesis || "");
  const maxSocial = options.maxSocialProofClaims ?? 1;
  if (!thesisIsSocial && socialSelected.length > maxSocial) {
    const weakest = socialSelected.sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
    failures.push({
      type: "overselected_social_proof",
      detail: { count: socialSelected.length, max: maxSocial, weakest: weakest.claim.claimId },
      selectedClaimId: weakest.claim.claimId,
    });
  }

  // ── weak_falsifiability_selected ──────────────────────────────────────────
  for (const s of selected) {
    if (s.features.opponentClaimFlag) continue; // opponent slogans are exempt
    if (s.features.hardPredicateFlag || s.features.dims.verificationWorthiness >= 0.5) continue;
    const alt = unselected
      .filter((e) => e.features.hardPredicateFlag && e.features.intrinsicScore > s.features.intrinsicScore)
      .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
    if (alt) {
      failures.push({
        type: "weak_falsifiability_selected",
        detail: { selected: s.claim.claimId, replacement: alt.claim.claimId },
        selectedClaimId: s.claim.claimId,
        candidateClaimId: alt.claim.claimId,
      });
    }
  }

  // ── rhetorical_question_selected ──────────────────────────────────────────
  // A bare question is never a valid final claim. (The selector already makes
  // these ineligible, so this is a defense-in-depth gate; no repair candidate
  // is offered — the fix is removal.)
  for (const s of selected) {
    if (s.features.rhetoricalQuestionFlag) {
      failures.push({
        type: "rhetorical_question_selected",
        detail: { selected: s.claim.claimId, note: "rhetorical question carries no falsifiable proposition" },
        selectedClaimId: s.claim.claimId,
      });
    }
  }

  // ── missing_opponent_coverage ─────────────────────────────────────────────
  // A rebuttal article must keep at least minOpponentClaims of the counter-
  // claims it argues against, so the argument–counterargument structure
  // survives. Offer the best unselected opponent claim as the repair add.
  if (rebuttalFrame) {
    const opponentSelected = selected.filter((e) => e.features.opponentClaimFlag).length;
    const need = options.minOpponentClaims ?? 1;
    if (opponentSelected < need) {
      const best = unselected
        .filter((e) => e.features.opponentClaimFlag)
        .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
      failures.push({
        type: "missing_opponent_coverage",
        detail: { opponentSelected, need, bestCandidate: best?.claim.claimId },
        candidateClaimId: best?.claim.claimId,
      });
    }
  }

  // ── broad_lane_overconcentration / narrow_lane_overconcentration ──────────
  // The portfolio should spread across evidence lanes. Over-cap concentration
  // is a failure only when a demotable surplus claim AND at least one
  // uncovered/under-covered alternative lane both exist (otherwise the article
  // really is overwhelmingly about that lane — no repair is warranted).
  const laneCount = (key) => {
    const m = new Map();
    for (const e of selected) m.set(e.features[key], (m.get(e.features[key]) || 0) + 1);
    return m;
  };
  const broadCounts = laneCount("broadLane");
  const narrowCounts = laneCount("narrowLane");
  const distinctBroadAvailable = new Set(candidates.map((e) => e.features.broadLane)).size;
  const laneFailure = (key, counts, cap, type) => {
    for (const [lane, n] of counts) {
      if (n <= cap) continue;
      const surplus = selected
        .filter((e) => e.features[key] === lane && !e.features.opponentClaimFlag)
        .sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
      // A distinct lane worth swapping toward must exist among unselected.
      const alt = unselected
        .filter((e) => (counts.get(e.features[key]) || 0) === 0 && e.features.hardPredicateFlag)
        .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
      if (surplus && alt) {
        failures.push({
          type,
          detail: { lane, count: n, cap, demote: surplus.claim.claimId, promote: alt.claim.claimId, distinctBroadAvailable },
          selectedClaimId: surplus.claim.claimId,
          candidateClaimId: alt.claim.claimId,
        });
      }
    }
  };
  // Soft-limit safety net: only fires when a lane is over the soft limit AND a
  // strong claim from a completely uncovered lane is available to swap toward.
  laneFailure("broadLane", broadCounts, options.broadLaneSoftLimit ?? 3, "broad_lane_overconcentration");
  laneFailure("narrowLane", narrowCounts, (options.broadLaneSoftLimit ?? 3) - 1, "narrow_lane_overconcentration");

  // ── gold_high_priority_missing (test harness only) ────────────────────────
  for (const g of gold) {
    const best = selected
      .map((e) => ({ e, sim: jaccard(g.goldText, e.claim.visibleClaimText) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (best && best.sim >= 0.3) continue;
    const rawBest = unselected
      .map((e) => ({ e, sim: jaccard(g.goldText, e.claim.visibleClaimText) }))
      .sort((a, b) => b.sim - a.sim)[0];
    failures.push({
      type: "gold_high_priority_missing",
      detail: { gold: g.goldText.slice(0, 120), priority: g.priority, bestSelectedSim: best?.sim ?? 0 },
      candidateClaimId: rawBest && rawBest.sim >= 0.3 ? rawBest.e.claim.claimId : undefined,
    });
  }

  return { pass: failures.length === 0, failures };
}

/**
 * planRepairs({ failures, candidates, selectedIds, options })
 *
 * Deterministic repair plan for one iteration. maxCount is intentional slack:
 * prefer ADDING (10→11–12) over zero-sum swaps between two central claims.
 * Swap victims must be low-impact (worthiness < 0.5), never repair-added, and
 * never the sole selected representative of their pillar.
 *
 * @returns [{ action: "add"|"swap"|"remove", failureType, addId?, removeId?, reason }]
 */
export function planRepairs({ failures = [], candidates = [], selectedIds = new Set(), options = {} }) {
  const maxCount = options.maxCount ?? 12;
  const byId = new Map(candidates.map((e) => [e.claim.claimId, e]));
  const working = new Set(selectedIds);
  const repairAdded = new Set(options.repairAddedIds || []);
  const repairs = [];

  const pillarCount = () => {
    const m = new Map();
    for (const id of working) {
      const p = byId.get(id)?.claim.phase2PillarId;
      if (p) m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  };

  const pickVictim = () => {
    const counts = pillarCount();
    const familyCounts = new Map();
    for (const id of working) {
      const fam = byId.get(id)?.features.claimBearingFamily;
      if (fam) familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
    }
    const evictable = [...working]
      .map((id) => byId.get(id))
      .filter(
        (e) =>
          e &&
          !repairAdded.has(e.claim.claimId) &&
          (!e.claim.phase2PillarId || (counts.get(e.claim.phase2PillarId) || 0) > 1)
      );
    // Tier 1: low-impact claims (verification outcome barely moves the article).
    const lowImpact = evictable
      .filter((e) => e.features.dims.verificationWorthiness < 0.5)
      .sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
    if (lowImpact) return lowImpact;
    // Tier 2: the weaker second carrier of an already-covered family — a
    // distinct uncovered predicate family beats a duplicate-family sibling.
    return evictable
      .filter((e) => (familyCounts.get(e.features.claimBearingFamily) || 0) > 1)
      .sort((a, b) => a.features.intrinsicScore - b.features.intrinsicScore)[0];
  };

  const admit = (addId, failureType, reason) => {
    if (!addId || working.has(addId) || !byId.has(addId)) return;
    if (working.size < maxCount) {
      working.add(addId);
      repairs.push({ action: "add", failureType, addId, reason });
      return;
    }
    const victim = pickVictim();
    if (!victim) return; // acknowledged failure — nothing safe to evict
    working.delete(victim.claim.claimId);
    working.add(addId);
    repairs.push({
      action: "swap",
      failureType,
      addId,
      removeId: victim.claim.claimId,
      reason: `${reason}; evicted lowest-impact claim ${victim.claim.claimId}`,
    });
  };

  const ORDER = [
    "rhetorical_question_selected",
    "gold_high_priority_missing",
    "missing_opponent_coverage",
    "missing_claim_bearing_family",
    "cluster_overcollapse",
    "lost_hard_predicate",
    "pillar_undercoverage",
    "topic_summary_selected",
    "weak_falsifiability_selected",
    "overselected_social_proof",
    "broad_lane_overconcentration",
    "narrow_lane_overconcentration",
  ];
  const sorted = failures
    .filter((f) => f.type !== "order_dependence_suspected") // no portfolio repair can fix scoring
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

  for (const f of sorted) {
    switch (f.type) {
      case "rhetorical_question_selected":
        if (f.selectedClaimId && working.has(f.selectedClaimId)) {
          working.delete(f.selectedClaimId);
          repairs.push({
            action: "remove",
            failureType: f.type,
            removeId: f.selectedClaimId,
            reason: "removed rhetorical question (no falsifiable proposition)",
          });
        }
        break;
      case "missing_opponent_coverage":
      case "gold_high_priority_missing":
      case "missing_claim_bearing_family":
      case "cluster_overcollapse":
      case "lost_hard_predicate":
      case "pillar_undercoverage":
        admit(f.candidateClaimId, f.type, `cover ${JSON.stringify(f.detail.family ?? f.detail.pillarId ?? f.detail.entity ?? (f.type === "missing_opponent_coverage" ? "opponent claim" : "gold"))}`);
        break;
      case "broad_lane_overconcentration":
      case "narrow_lane_overconcentration": {
        // Swap the lowest-merit surplus lane claim for a distinct uncovered
        // lane — but never demote a sole-pillar representative.
        const counts = pillarCount();
        const victimPillar = f.selectedClaimId ? byId.get(f.selectedClaimId)?.claim.phase2PillarId : null;
        const soleRep = victimPillar && (counts.get(victimPillar) || 0) === 1;
        if (f.selectedClaimId && f.candidateClaimId && working.has(f.selectedClaimId) && !working.has(f.candidateClaimId) && !soleRep) {
          working.delete(f.selectedClaimId);
          working.add(f.candidateClaimId);
          repairs.push({
            action: "swap",
            failureType: f.type,
            addId: f.candidateClaimId,
            removeId: f.selectedClaimId,
            reason: `de-concentrate lane "${f.detail.lane}" (${f.detail.count}>${f.detail.cap}) — swap surplus for uncovered lane`,
          });
        }
        break;
      }
      case "topic_summary_selected":
      case "weak_falsifiability_selected":
        if (f.selectedClaimId && f.candidateClaimId && working.has(f.selectedClaimId) && !working.has(f.candidateClaimId)) {
          working.delete(f.selectedClaimId);
          working.add(f.candidateClaimId);
          repairs.push({
            action: "swap",
            failureType: f.type,
            addId: f.candidateClaimId,
            removeId: f.selectedClaimId,
            reason: `replace ${f.type === "topic_summary_selected" ? "topic summary" : "weakly falsifiable claim"} with concrete claim`,
          });
        }
        break;
      case "overselected_social_proof":
        if (f.selectedClaimId && working.has(f.selectedClaimId)) {
          const next = candidates
            .filter(
              (e) =>
                !working.has(e.claim.claimId) &&
                !e.features.socialProofFlag &&
                e.features.hardPredicateFlag
            )
            .sort((a, b) => b.features.intrinsicScore - a.features.intrinsicScore)[0];
          working.delete(f.selectedClaimId);
          if (next) working.add(next.claim.claimId);
          repairs.push({
            action: next ? "swap" : "remove",
            failureType: f.type,
            addId: next?.claim.claimId,
            removeId: f.selectedClaimId,
            reason: "demote excess social-proof claim",
          });
        }
        break;
      default:
        break;
    }
  }

  return { repairs, selectedIds: working };
}
