// Independent attribution-surface census for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step: independent attribution surface).
//
// This is the RECALL fix, not just the posture fix. It is built directly from the
// article's structural units and is NOT derived from or dependent on Call 1A's
// candidate list, so it can surface assertion-bearing passages 1A missed entirely.
// Each collected passage becomes a census packet carrying raw grounding (not yet a
// claimText); Call 1B decides whether it holds a distinct material proposition and,
// if so, mints it. Recall is the priority here — precision comes later from 1B,
// host duplicate detection, and selection. Every census item must later resolve to
// exactly one outcome (became a final candidate, or logged as a recall-miss).

const censusId = (index) => `CEN${String(index + 1).padStart(3, "0")}`;

// Structural unit types that ARE an attribution surface on their own.
const STRUCTURAL_KIND = Object.freeze({
  quotation: "block_quotation",
  speaker_turn: "speaker_turn",
  social_post: "embedded_post",
  social_reply: "embedded_post",
});

// Lexical cues for prose units (sentence/paragraph) that carry an attributed
// assertion — someone other than the article's own bare voice supplies the claim.
const ATTRIBUTION_CUE = /\b(?:said|says|told|argued|claimed|claims|wrote|writes|stated|states|denied|denies|added|asserted|asserts|noted|notes|explained|explains|warned|warns|testified|insisted|insists|contends?|contended|maintains?|maintained|according to)\b/i;

// Cues the article signals it will challenge, examine, or rebut a passage.
const CHALLENGE_CUE = /\b(?:so-called|purports? to|falsely|debunk\w*|\bmyth\b|disput\w+|contrary to|in fact|no evidence|misleading|denies that|refut\w+)\b/i;

// A named source is a multi-word proper name anywhere, a titled name, or a
// single capitalized surname bound directly to an attribution verb
// ("<Surname> said") or an "according to <Name>" lead-in.
const ATTRIBUTION_VERB = "said|says|told|argued|claimed|wrote|stated|noted|explained|warned|testified|insisted|maintains?|maintained|contends?|contended";
const NAMED_SOURCE = new RegExp(
  `[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+`
  + `|(?:Dr|Mr|Ms|Mrs|Prof)\\.\\s+[A-Z][a-z]+`
  + `|\\b[A-Z][a-z]{2,}\\b\\s+(?:${ATTRIBUTION_VERB})\\b`
  + `|according to\\s+(?:the\\s+)?[A-Z][a-z]{2,}`);
const hasNamedSource = (text) => NAMED_SOURCE.test(text);

// Classify one unit into a census kind, or null if it is not an attribution
// surface. Structural type wins; otherwise prose cues. Returns the primary kind
// plus every matched signal so downstream policy can inspect the evidence.
function classifyUnit(unit) {
  const signals = [];
  const structural = STRUCTURAL_KIND[unit.type];
  if (structural) signals.push(structural);
  const prose = unit.type === "sentence" || unit.type === "paragraph";
  if (prose && ATTRIBUTION_CUE.test(unit.text)) signals.push("attributed_statement");
  if (hasNamedSource(unit.text) && (structural || signals.includes("attributed_statement"))) {
    signals.push("named_source");
  }
  if (prose && /\?\s*$/.test(unit.text)) signals.push("qa_passage");
  if (CHALLENGE_CUE.test(unit.text)) signals.push("challenge_signal");
  if (!signals.length) return null;
  return { kind: signals[0], signals };
}

export function collectAttributionSurface({ sourceUnits = [], maxItems = 60 } = {}) {
  const items = [];
  for (const unit of sourceUnits) {
    const classified = classifyUnit(unit);
    if (!classified) continue;
    items.push({
      censusId: censusId(items.length),
      kind: classified.kind,
      signals: classified.signals,
      sourceUnitIds: [unit.unitId],
      unitOrder: unit.order,
      unitType: unit.type,
      text: unit.text,
    });
    if (items.length >= maxItems) break;
  }
  return items;
}
