// Deterministic support for the optional census-recovery experiment. It selects a
// bounded, high-signal subset of unmatched diagnostic passages and merges only
// well-grounded, nonduplicate recovery claims. It never changes the primary 1A
// prompt, and recovery failure is handled by the runner as nonblocking.
import { semanticOverlap, semanticWords } from "./semanticGrounding.js";

const DIRECT_RECOVERY_SIGNALS = new Set([
  "list_assertion", "block_quotation", "speaker_turn", "embedded_post",
  "attributed_statement", "challenge_signal", "institutional_assertion",
]);
const SIGNAL_WEIGHT = Object.freeze({
  list_assertion: 100,
  attributed_statement: 85,
  institutional_assertion: 80,
  named_source: 75,
  block_quotation: 65,
  speaker_turn: 65,
  embedded_post: 60,
  challenge_signal: 55,
  document_or_study_statement: 25,
  numeric_or_comparative_statement: 15,
});

const packetScore = (item) => Math.max(0,
  ...(item.signals ?? []).map((signal) => SIGNAL_WEIGHT[signal] ?? 0));
const packetChars = (item) => String(item.snippet ?? "").length
  + Math.min(600, String(item.contextText ?? "").length) + 160;

export function selectSplitCensusRecoveryPackets({ diagnostic, maximumPackets = 60,
  maximumCharacters = 24_000 } = {}) {
  const candidates = (diagnostic?.items ?? []).filter((item) =>
    item.assessment === "no_obvious_call1a_match"
    && item.recoveryEligible
    && (item.signals ?? []).some((signal) => DIRECT_RECOVERY_SIGNALS.has(signal)))
    .map((item) => ({ ...item, recoveryScore: packetScore(item) }))
    .sort((a, b) => b.recoveryScore - a.recoveryScore
      || (a.semanticChunkId ?? "").localeCompare(b.semanticChunkId ?? "")
      || (a.sourceUnitIds?.[0] ?? "").localeCompare(b.sourceUnitIds?.[0] ?? "")
      || a.censusId.localeCompare(b.censusId));

  const selected = []; const selectedIds = new Set(); let characters = 0;
  const add = (item) => {
    if (!item || selectedIds.has(item.censusId) || selected.length >= maximumPackets) return;
    const size = packetChars(item);
    if (selected.length && characters + size > maximumCharacters) return;
    selected.push(item); selectedIds.add(item.censusId); characters += size;
  };

  // Explicit lists are the strongest deterministic signal and commonly contain
  // several distinct opponent assertions in one semantic block. Preserve every
  // unmatched list item before applying cross-block coverage.
  candidates.filter((item) => item.signals.includes("list_assertion")).forEach(add);
  const bestByChunk = new Map();
  for (const item of candidates) {
    if (!bestByChunk.has(item.semanticChunkId)) bestByChunk.set(item.semanticChunkId, item);
  }
  [...bestByChunk.values()].forEach(add);
  candidates.forEach(add);

  return {
    selected,
    deferred: candidates.filter((item) => !selectedIds.has(item.censusId)),
    summary: { eligibleUnmatchedPackets: candidates.length,
      selectedPackets: selected.length, deferredPackets: candidates.length - selected.length,
      selectedSemanticChunks: new Set(selected.map((item) => item.semanticChunkId)).size,
      selectedCharacters: characters, maximumPackets, maximumCharacters },
  };
}

function nearDuplicate(left, right) {
  const overlap = semanticOverlap(left, right);
  const smaller = Math.min(semanticWords(left).size, semanticWords(right).size);
  return smaller >= 4 && overlap / smaller >= 0.8;
}

export function mergeSplitCensusRecoveryClaims({ candidateClaims = [], recoveryClaims = [],
  selectedPackets = [] } = {}) {
  const packetById = new Map(selectedPackets.map((packet) => [packet.censusId, packet]));
  const merged = [...candidateClaims]; const accepted = []; const rejected = [];
  for (const [index, claim] of recoveryClaims.entries()) {
    const censusIds = [...new Set(claim.censusIds ?? [])];
    const packets = censusIds.map((id) => packetById.get(id)).filter(Boolean);
    const allowedSourceIds = new Set(packets.flatMap((packet) => packet.sourceUnitIds ?? []));
    const sourceUnitIds = [...new Set(claim.sourceUnitIds ?? [])];
    let reason = null;
    if (!packets.length || packets.length !== censusIds.length) reason = "unknown_census_id";
    else if (!sourceUnitIds.length || !sourceUnitIds.some((id) => allowedSourceIds.has(id))) {
      reason = "not_grounded_in_census_passage";
    } else if (merged.some((existing) => nearDuplicate(existing.claimText, claim.claimText))) {
      reason = "semantic_duplicate";
    }
    if (reason) { rejected.push({ index, claimText: claim.claimText, censusIds, reason }); continue; }
    const recovered = { claimText: claim.claimText, sourceUnitIds,
      materiality: claim.materiality, relatedPillarLabels: claim.relatedPillarLabels ?? [],
      scope: claim.scope, evidenceUsefulnessHint: claim.evidenceUsefulnessHint,
      _censusRecovery: { censusIds, origin: "census_recovery" } };
    merged.push(recovered); accepted.push(recovered);
  }
  return { candidateClaims: merged, accepted, rejected,
    summary: { primaryClaims: candidateClaims.length, modelRecoveryClaims: recoveryClaims.length,
      acceptedRecoveryClaims: accepted.length, rejectedRecoveryClaims: rejected.length,
      mergedClaims: merged.length } };
}

export function unavailableSplitCensusRecovery(error, packetSelection = null) {
  return { status: "unavailable", error: String(error?.message ?? error),
    packetSelection, output: { candidateClaims: [] }, merge: null, modelCall: null, usage: {} };
}
