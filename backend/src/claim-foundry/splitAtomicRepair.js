// Deterministic detection, packet construction, and verified application for the
// optional atomic-claim repair stage. Detection may over-flag; the model may keep
// an already atomic claim. A bad/missing repair never blocks the run: the original
// claim survives with an explicit unresolved diagnostic.
import { semanticOverlap, semanticWords } from "./semanticGrounding.js";

const SECOND_PREDICATE = /\b(?:and|as well as)\s+(?:also\s+)?(?:is|are|was|were|has|have|had|may|might|can|could|will|would|did|does|do|claimed|claims|ordered|released|found|showed|stopped|banned|caused|linked|contaminate|contaminates|conceal|conceals|denied|denies|destroyed|destroys)\b/i;
const SERIAL_OBJECTS = /,\s*[^,;]{1,70},?\s+and\s+[^,;]{1,70}(?:[.!?]|$)/i;
const DISTINCT_OUTCOMES = /\b(?:hospitali[sz]ation|injur(?:y|ies)|mortality|death|risk|harm|effect|outcome|rate)s?\s+and\s+(?:hospitali[sz]ation|injur(?:y|ies)|mortality|death|risk|harm|effect|outcome|rate)s?\b/i;
const CLAUSE_JOIN = /;|,\s*(?:claiming|including|while)\b/i;
const PRESENTATION = /\b(?:attempts? to|aims? to|intends? to|presentation|guide to|describes? the article|will explore)\b/i;
const AUDIENCE_DESCRIPTION = /\b(?:parents?|readers?|audience|supporters?|opponents?|critics?)\b.*\b(?:educated|literate|intelligent|informed|ignorant|zealots?)\b/i;
const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const repairId = (index) => `1A-${String(index + 1).padStart(3, "0")}`;

function groundingCoverage(claim, sourceText) {
  const claimWords = semanticWords(claim.claimText).size;
  const overlap = semanticOverlap(claim.claimText, sourceText);
  return { overlap, claimWords, ratio: claimWords ? overlap / claimWords : 0 };
}

export function detectSplitAtomicRepairSignals({ claim, sourceUnitsById } = {}) {
  const signals = [];
  const groundingText = (claim?.sourceUnitIds ?? [])
    .map((id) => sourceUnitsById.get(id)?.text).filter(Boolean).join(" ");
  const coverage = groundingCoverage(claim, groundingText);
  const claimText = claim?.claimText ?? "";
  if (SECOND_PREDICATE.test(claimText) || SERIAL_OBJECTS.test(claimText)
    || DISTINCT_OUTCOMES.test(claimText) || CLAUSE_JOIN.test(claimText)) {
    signals.push("possible_multiple_assertions");
  }
  if (PRESENTATION.test(claim?.claimText ?? "")) signals.push("presentation_or_intent_claim");
  if (AUDIENCE_DESCRIPTION.test(claimText)) signals.push("audience_characterization");
  if (coverage.claimWords >= 4 && (coverage.overlap < 2 || coverage.ratio < 0.4)) {
    signals.push("weak_claim_to_grounding_overlap");
  }
  const groundedUnits = (claim?.sourceUnitIds ?? []).map((id) => sourceUnitsById.get(id)).filter(Boolean);
  if (groundedUnits.length && groundedUnits.every((unit) =>
    normalize(unit.text).split(/\s+/).length <= 8)) signals.push("grounded_only_in_short_label");
  if (semanticWords(claim?.claimText).size < 4) signals.push("incomplete_or_too_short");
  return { signals: [...new Set(signals)], groundingCoverage: coverage };
}

function localUnitsFor(claim, sourceUnits, structuralBlocks, radius = 3) {
  const byId = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const blockByUnit = new Map();
  for (const block of structuralBlocks ?? []) {
    for (const id of block.sourceUnitIds ?? []) blockByUnit.set(id, block);
  }
  const grounded = (claim.sourceUnitIds ?? []).map((id) => byId.get(id)).filter(Boolean)
    .sort((a, b) => a.order - b.order);
  if (!grounded.length) return [];
  const block = blockByUnit.get(grounded[0].unitId);
  const blockIds = block?.sourceUnitIds ?? sourceUnits.map((unit) => unit.unitId);
  const positions = grounded.map((unit) => blockIds.indexOf(unit.unitId)).filter((index) => index >= 0);
  const start = Math.max(0, Math.min(...positions) - radius);
  const end = Math.min(blockIds.length, Math.max(...positions) + radius + 1);
  return blockIds.slice(start, end).map((id) => byId.get(id)).filter(Boolean)
    .map((unit) => ({ unitId: unit.unitId, type: unit.type, text: normalize(unit.text).slice(0, 1800) }));
}

export function buildSplitAtomicRepairPackets({ candidateClaims = [], sourceUnits = [],
  structuralBlocks = [] } = {}) {
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const packets = [];
  for (const [index, claim] of candidateClaims.entries()) {
    const diagnostic = detectSplitAtomicRepairSignals({ claim, sourceUnitsById });
    if (!diagnostic.signals.length) continue;
    const localUnits = localUnitsFor(claim, sourceUnits, structuralBlocks);
    packets.push({ repairId: repairId(index), candidateIndex: index,
      originalClaim: claim, signals: diagnostic.signals,
      groundingCoverage: diagnostic.groundingCoverage, localUnits,
      allowedSourceUnitIds: localUnits.map((unit) => unit.unitId) });
  }
  return { packets, summary: { candidateClaims: candidateClaims.length,
    flaggedClaims: packets.length,
    bySignal: packets.flatMap((packet) => packet.signals).reduce((counts, signal) =>
      ({ ...counts, [signal]: (counts[signal] ?? 0) + 1 }), {}) } };
}

function validReplacement(judgment, packet) {
  const claimText = normalize(judgment.claimText);
  const sourceUnitIds = [...new Set(judgment.sourceUnitIds ?? [])];
  if (!claimText) return { valid: false, reason: "missing_replacement_text" };
  if (!sourceUnitIds.length || sourceUnitIds.some((id) =>
    !packet.allowedSourceUnitIds.includes(id))) return { valid: false, reason: "invalid_source_units" };
  const replacementSignals = detectSplitAtomicRepairSignals({ claim: { claimText,
    sourceUnitIds }, sourceUnitsById: new Map(packet.localUnits.map((unit) =>
    [unit.unitId, unit])) }).signals;
  if (replacementSignals.includes("possible_multiple_assertions")) {
    return { valid: false, reason: "replacement_still_compound" };
  }
  const originalCoverage = groundingCoverage({ claimText }, packet.originalClaim.claimText);
  if (originalCoverage.overlap < 2 || originalCoverage.ratio < 0.5) {
    return { valid: false, reason: "replacement_changed_proposition", originalCoverage };
  }
  const sourceText = sourceUnitIds.map((id) =>
    packet.localUnits.find((unit) => unit.unitId === id)?.text).filter(Boolean).join(" ");
  const coverage = groundingCoverage({ claimText }, sourceText);
  if (coverage.overlap < 2 || coverage.ratio < 0.3) {
    return { valid: false, reason: "replacement_not_grounded", coverage };
  }
  return { valid: true, claimText, sourceUnitIds, coverage, originalCoverage };
}

export function applySplitAtomicRepairs({ candidateClaims = [], packets = [],
  repairOutput = {} } = {}) {
  const judgments = repairOutput.candidateRepairs ?? [];
  const byId = new Map();
  for (const judgment of judgments) {
    if (!byId.has(judgment.repairId)) byId.set(judgment.repairId, []);
    byId.get(judgment.repairId).push(judgment);
  }
  const packetByIndex = new Map(packets.map((packet) => [packet.candidateIndex, packet]));
  const output = []; const diagnostics = [];
  for (const [index, original] of candidateClaims.entries()) {
    const packet = packetByIndex.get(index);
    if (!packet) { output.push(original); continue; }
    const matches = byId.get(packet.repairId) ?? [];
    if (matches.length !== 1) {
      output.push({ ...original, _atomicityRepair: { status: "unresolved",
        repairId: packet.repairId, reason: matches.length ? "duplicate_repair" : "missing_repair",
        signals: packet.signals } });
      diagnostics.push({ repairId: packet.repairId, action: "fallback_original",
        reason: matches.length ? "duplicate_repair" : "missing_repair", claimText: original.claimText });
      continue;
    }
    const judgment = matches[0];
    if (judgment.action === "keep") {
      if (packet.signals.includes("possible_multiple_assertions")) {
        output.push({ ...original, _atomicityRepair: { status: "unresolved",
          repairId: packet.repairId, reason: "keep_did_not_resolve_compound",
          signals: packet.signals } });
        diagnostics.push({ repairId: packet.repairId, action: "fallback_original",
          reason: "keep_did_not_resolve_compound", claimText: original.claimText });
        continue;
      }
      output.push({ ...original, _atomicityRepair: { status: "kept",
        repairId: packet.repairId, signals: packet.signals } });
      diagnostics.push({ repairId: packet.repairId, action: "keep", claimText: original.claimText });
      continue;
    }
    if (judgment.action === "drop_not_material" || judgment.action === "drop_not_grounded") {
      diagnostics.push({ repairId: packet.repairId, action: judgment.action,
        claimText: original.claimText });
      continue;
    }
    if (judgment.action === "replace_with_first_atomic_assertion") {
      const checked = validReplacement(judgment, packet);
      if (checked.valid) {
        const replacement = { ...original, claimText: checked.claimText,
          sourceUnitIds: checked.sourceUnitIds,
          evidenceUsefulnessHint: normalize(judgment.evidenceUsefulnessHint)
            || original.evidenceUsefulnessHint,
          _atomicityRepair: { status: "replaced", repairId: packet.repairId,
            originalClaimText: original.claimText, signals: packet.signals } };
        output.push(replacement);
        diagnostics.push({ repairId: packet.repairId, action: "replaced",
          originalClaimText: original.claimText, claimText: replacement.claimText,
          sourceUnitIds: replacement.sourceUnitIds });
      } else {
        output.push({ ...original, _atomicityRepair: { status: "unresolved",
          repairId: packet.repairId, reason: checked.reason, signals: packet.signals } });
        diagnostics.push({ repairId: packet.repairId, action: "fallback_original",
          reason: checked.reason, claimText: original.claimText });
      }
      continue;
    }
    output.push({ ...original, _atomicityRepair: { status: "unresolved",
      repairId: packet.repairId, reason: "unknown_action", signals: packet.signals } });
    diagnostics.push({ repairId: packet.repairId, action: "fallback_original",
      reason: "unknown_action", claimText: original.claimText });
  }
  return { candidateClaims: output, diagnostics,
    summary: { inputClaims: candidateClaims.length, flaggedClaims: packets.length,
      outputClaims: output.length,
      kept: diagnostics.filter((item) => item.action === "keep").length,
      replaced: diagnostics.filter((item) => item.action === "replaced").length,
      dropped: diagnostics.filter((item) => item.action.startsWith("drop_")).length,
      unresolved: diagnostics.filter((item) => item.action === "fallback_original").length } };
}

export function unavailableSplitAtomicRepair(error, packetBuild = null) {
  return { status: "unavailable", error: String(error?.message ?? error), packetBuild,
    output: { candidateRepairs: [] }, application: null, modelCall: null, usage: {} };
}
