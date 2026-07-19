// Compact packet assembly for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step: compact packet assembly).
//
// Deterministic, no model call. Builds packets only for selected 1A candidates.
// The independent attribution-surface census is observation-only and is never
// included in a Call 1B payload.
// Each packet carries the claim's grounding plus a STRUCTURAL context window
// (attribution lead-in, containing quote/speaker block, bounded local response
// window, section heading). Context is selected structurally, never via
// relatedPillarLabels — pillar assignment can be wrong and an article's response
// is usually structurally adjacent, not pillar-linked. The full article is never
// resent; every window is capped by a hard character ceiling.
import { classifyGroundingSpan } from "./candidateGroundingSpan.js";
import { semanticOverlap, semanticWords } from "./semanticGrounding.js";
import { detectSplitSourceCandidates } from "./splitSourceCandidates.js";
import { addSplitArticleVoiceCandidate } from "./splitArticleVoiceCandidate.js";

const candidateId = (index) => `CAND${String(index + 1).padStart(2, "0")}`;
const QUOTE_LIKE = new Set(["quotation", "speaker_turn", "social_post", "social_reply"]);
const ATTRIBUTION_CUE = /\b(?:said|says|told|asked|argued|claimed|claims|wrote|writes|stated|states|denied|denies|asserted|asserts|noted|notes|observed|observes|explained|explains|warned|warns|testified|insisted|insists|contends?|maintained|maintains|announced|reported|reports|found|revealed|reveals|showed|shows|concluded|concludes|demonstrated|demonstrates|classified|classifies|according to)\b/i;
// Response cues: negation, refutation/challenge verbs, evidence-denial, or a question.
const RESPONSE_CUE = /\b(?:not|no|never|false|myth|debunk\w*|misleading|however|but|contrary|refut\w*|disput\w*|wrong|incorrect|unsupported|baseless|fact[- ]?check\w*|actually|in reality)\b|\bno (?:credible|good|solid|reliable) evidence\b|\?/i;

const DEFAULTS = Object.freeze({
  leadInLookback: 6, leadInChars: 300,
  responseMaxUnits: 6, responseChars: 600, blockChars: 600,
  // Distant-response lexical scan (feeds articleDeployment only; never contentStance).
  // Off by default — enabled per validation stage via packetOptions.
  attachDistantResponse: false, distantResponseChars: 400,
  distantExcludeRadius: 6, distantMinOverlap: 2,
  includeArticleVoiceCandidates: false,
  alternateOccurrenceMinOverlap: 4, alternateOccurrenceMinRatio: 0.8,
  alternateOccurrenceMaximum: 2,
});

const authorsOf = (article) => (article?.authors ?? [])
  .map((a) => (typeof a === "string" ? a : a?.name)).map((v) => String(v ?? "").trim()).filter(Boolean);

const cap = (text, chars) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > chars ? `${value.slice(0, chars).trimEnd()}…` : value;
};

const record = (unit, chars) => unit ? { unitId: unit.unitId, text: cap(unit.text, chars) } : null;
const uniqueRecords = (records) => {
  const seen = new Set();
  return records.filter((item) => item?.unitId && !seen.has(item.unitId) && seen.add(item.unitId));
};
const cappedRecords = (units, chars) => {
  const out = []; let remaining = chars;
  for (const unit of units) {
    if (!unit || remaining <= 0) break;
    const item = record(unit, remaining);
    out.push(item);
    remaining -= item.text.length;
  }
  return out;
};

function context(sourceUnits, structuralBlocks) {
  const byId = new Map(sourceUnits.map((u) => [u.unitId, u]));
  const byOrder = new Map(sourceUnits.map((u) => [u.order, u]));
  const blockOf = new Map();
  const blockByOrder = new Map();
  for (const block of structuralBlocks ?? []) {
    blockByOrder.set(block.order, block);
    for (const id of block.sourceUnitIds ?? []) blockOf.set(id, block);
  }
  return { byId, byOrder, blockOf, blockByOrder };
}

function attributionLeadIns(firstUnit, ctx, opts) {
  const firstBlock = ctx.blockOf.get(firstUnit.unitId);
  const found = [];
  for (let order = firstUnit.order - 1; order >= firstUnit.order - opts.leadInLookback; order -= 1) {
    const unit = ctx.byOrder.get(order);
    if (!unit) continue;
    if (unit.type === "heading") break;
    if (firstBlock && ctx.blockOf.get(unit.unitId)?.blockId !== firstBlock.blockId) break;
    if (ATTRIBUTION_CUE.test(unit.text)) found.push(unit);
    if (found.length >= 3) break;
  }
  return cappedRecords(found.reverse(), opts.leadInChars);
}

function quoteOrSpeakerBlock(firstUnit, ctx, opts) {
  const block = ctx.blockOf.get(firstUnit.unitId);
  if (!block || !QUOTE_LIKE.has(firstUnit.type)) return [];
  // Center on the claim's unit rather than dumping a long lumped block.
  const ids = block.sourceUnitIds ?? [];
  const pivot = ids.indexOf(firstUnit.unitId);
  return cappedRecords(ids.slice(Math.max(0, pivot - 1), pivot + 3)
    .map((id) => ctx.byId.get(id)).filter(Boolean), opts.blockChars);
}

function listLeadIn(firstUnit, ctx, opts) {
  const block = ctx.blockOf.get(firstUnit.unitId);
  if (!block || block.structuralType !== "list") return [];
  const previous = ctx.blockByOrder.get(block.order - 1);
  if (!previous) return [];
  const units = (previous.sourceUnitIds ?? []).map((id) => ctx.byId.get(id)).filter(Boolean)
    .filter((unit) => unit.type !== "other").slice(-3);
  return cappedRecords(units, opts.blockChars);
}

function localResponseWindow(lastUnit, ctx, opts) {
  const startBlock = ctx.blockOf.get(lastUnit.unitId);
  const parts = [];
  let chars = 0;
  for (let order = lastUnit.order + 1;
    order <= lastUnit.order + 40 && parts.length < opts.responseMaxUnits; order += 1) {
    const unit = ctx.byOrder.get(order);
    if (!unit) break;
    if (unit.type === "heading" || unit.type === "speaker_turn") break; // heading / speaker change
    const block = ctx.blockOf.get(unit.unitId);
    if (block && startBlock && block.blockId !== startBlock.blockId && block.heading) break; // titled block boundary
    const item = record(unit, Math.max(1, opts.responseChars - chars));
    parts.push(item);
    chars += item.text.length;
    if (chars >= opts.responseChars) break;
  }
  return parts;
}

function sectionHeading(firstUnit, ctx) {
  const block = ctx.blockOf.get(firstUnit.unitId);
  if (block?.heading) return block.heading;
  for (let order = firstUnit.order - 1; order >= 0 && order >= firstUnit.order - 60; order -= 1) {
    const unit = ctx.byOrder.get(order);
    if (unit?.type === "heading") return unit.text;
  }
  return "";
}

function mergeSourceCandidates(...groups) {
  const candidates = []; const seen = new Set();
  for (const candidate of groups.flat()) {
    const key = String(candidate?.nameHint ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...candidate,
      sourceCandidateId: `SRC${String(candidates.length + 1).padStart(2, "0")}` });
  }
  return { sourceCandidateStatus: candidates.length ? "candidates_found" : "no_candidates_detected",
    sourceCandidates: candidates };
}

function alternateAttributedOccurrences(claim, sourceUnits, ctx, opts) {
  const currentIds = new Set(claim.sourceUnitIds ?? []);
  const claimWordCount = semanticWords(claim.claimText).size || 1;
  const matches = [];
  for (const unit of sourceUnits) {
    if (!unit || currentIds.has(unit.unitId)) continue;
    const overlap = semanticOverlap(claim.claimText, unit.text);
    const unitWordCount = semanticWords(unit.text).size || 1;
    const ratio = overlap / Math.min(claimWordCount, unitWordCount);
    if (overlap < opts.alternateOccurrenceMinOverlap || ratio < opts.alternateOccurrenceMinRatio) continue;
    const occurrenceUnits = [record(unit, opts.blockChars)];
    const attributionContextUnits = cappedRecords(uniqueRecords([
      ...listLeadIn(unit, ctx, opts),
      ...attributionLeadIns(unit, ctx, opts),
      ...quoteOrSpeakerBlock(unit, ctx, opts),
    ]).filter((item) => item?.unitId !== unit.unitId), opts.blockChars);
    const diagnostic = detectSplitSourceCandidates({ claimUnits: occurrenceUnits,
      attributionContextUnits });
    if (diagnostic.sourceCandidateStatus !== "candidates_found") continue;
    matches.push({ unit, overlap, ratio, occurrenceUnits, attributionContextUnits,
      candidates: diagnostic.sourceCandidates.map((candidate) => ({ ...candidate,
        candidateKind: "alternate_occurrence_external", contextRegion: "alternate_occurrence",
        trigger: `alternate_occurrence_${candidate.trigger}`,
        unitIds: [...new Set([...candidate.unitIds, unit.unitId])],
        basis: "Explicit source detected at a strongly matching occurrence of the same proposition" })) });
  }
  matches.sort((a, b) => b.ratio - a.ratio || b.overlap - a.overlap || a.unit.order - b.unit.order);
  const kept = matches.slice(0, opts.alternateOccurrenceMaximum);
  return {
    candidates: kept.flatMap((match) => match.candidates),
    units: uniqueRecords(kept.flatMap((match) => [
      ...match.occurrenceUnits, ...match.attributionContextUnits,
    ])),
  };
}

// Whole-document lexical scan for the article's response to a claim that sits OUTSIDE
// the claim's local response window. Defeats the adjacency assumption: an article's
// rebuttal to an opponent claim often sits in a later section, far from the claim, so
// the structurally-local window never sees it.
// Scores document units that (a) are not the claim's own units, (b) sit beyond the
// local neighbourhood (distantExcludeRadius), (c) carry a response/negation cue, and
// (d) share the claim's own content terms. Best overlap wins, regardless of distance.
// Feeds articleDeployment ONLY — never contentStance, never source-identity opposition.
function distantResponse(claim, ctx, sourceUnits, opts) {
  const claimIds = new Set(claim.sourceUnitIds ?? []);
  const claimOrders = [...claimIds].map((id) => ctx.byId.get(id)?.order).filter((o) => o != null);
  if (!claimOrders.length) return null;
  const near = (order) => claimOrders.some((co) => Math.abs(order - co) <= opts.distantExcludeRadius);
  let best = null;
  for (const unit of sourceUnits) {
    if (!unit || claimIds.has(unit.unitId) || near(unit.order)) continue;
    if (!RESPONSE_CUE.test(unit.text ?? "")) continue;
    const overlap = semanticOverlap(claim.claimText, unit.text);
    if (overlap < opts.distantMinOverlap) continue;
    if (!best || overlap > best.overlap || (overlap === best.overlap && unit.order < best.order)) {
      best = { unitId: unit.unitId, order: unit.order, overlap };
    }
  }
  if (!best) return null;
  return { unitIds: [best.unitId], overlap: best.overlap,
    distance: Math.min(...claimOrders.map((co) => Math.abs(best.order - co))),
    text: cap(ctx.byId.get(best.unitId)?.text, opts.distantResponseChars) };
}

function windowFor(claim, ctx, opts, sourceUnits, articleAuthors) {
  const sourceUnitIds = claim.sourceUnitIds ?? [];
  const units = sourceUnitIds.map((id) => ctx.byId.get(id)).filter(Boolean)
    .sort((a, b) => a.order - b.order);
  if (!units.length) return null;
  const first = units[0];
  const last = units.at(-1);
  const block = ctx.blockOf.get(first.unitId);
  const claimUnits = cappedRecords(units, opts.blockChars);
  const explicitAttribution = (claim.attributionContextUnitIds ?? [])
    .map((id) => record(ctx.byId.get(id), opts.blockChars)).filter(Boolean);
  const attributionContextUnits = cappedRecords(uniqueRecords([
    ...explicitAttribution,
    ...listLeadIn(first, ctx, opts),
    ...attributionLeadIns(first, ctx, opts),
    ...quoteOrSpeakerBlock(first, ctx, opts),
  ]).filter((item) => !sourceUnitIds.includes(item.unitId)), opts.blockChars);
  const structuralSignals = { blockType: block?.structuralType ?? null,
    unitTypes: [...new Set(units.map((u) => u.type))] };
  const localResponseUnits = localResponseWindow(last, ctx, opts);
  const directDiagnostic = detectSplitSourceCandidates({ claimUnits, attributionContextUnits,
    localResponseUnits });
  const alternate = alternateAttributedOccurrences(claim, sourceUnits, ctx, opts);
  let sourceDiagnostic = mergeSourceCandidates(directDiagnostic.sourceCandidates,
    alternate.candidates);
  if (opts.includeArticleVoiceCandidates) {
    sourceDiagnostic = addSplitArticleVoiceCandidate({ sourceDiagnostic, claimUnits,
      attributionContextUnits, structuralSignals, articleAuthors });
  }
  return {
    claimUnits,
    attributionContextUnits,
    ...sourceDiagnostic,
    alternateOccurrenceUnits: alternate.units,
    localResponseUnits,
    sectionHeading: sectionHeading(first, ctx),
    structuralSignals,
  };
}

export function assembleCall1bPackets({ inventory1a, sourceUnits = [],
  structuralBlocks = [], article, options = {} } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const ctx = context(sourceUnits, structuralBlocks);
  const claims = inventory1a?.candidateClaims ?? [];
  const articleAuthors = authorsOf(article);

  const candidatePackets = claims.map((claim, index) => {
    const window = windowFor(claim, ctx, opts, sourceUnits, articleAuthors);
    const groundingSpan = claim.groundingSpan
      ?? classifyGroundingSpan(claim.sourceUnitIds).groundingSpan;
    const packet = { id: candidateId(index), origin: "candidate", claimText: claim.claimText,
      sourceUnitIds: claim.sourceUnitIds ?? [],
      attributionContextUnitIds: claim.attributionContextUnitIds ?? [], groundingSpan, ...window };
    // Optional distant-response attachment (off by default → packets byte-identical to
    // the pre-change assembly, so it can be validated as an isolated later stage).
    if (opts.attachDistantResponse) {
      packet.possibleResponse = distantResponse(claim, ctx, sourceUnits, opts);
    }
    return packet;
  });

  return {
    orientation: {
      theme: inventory1a?.theme, thesis: inventory1a?.thesis,
      pillars: inventory1a?.pillars, thesisHinge: inventory1a?.thesisHinge,
    },
    articleAuthors,
    packets: candidatePackets,
  };
}
