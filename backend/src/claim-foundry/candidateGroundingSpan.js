// Deterministic grounding-span detector for the CF1 Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step: grounding-span check).
//
// A well-formed candidate claim is grounded in ONE tightly clustered passage.
// When a claim's sourceUnitIds are welded from passages far apart in the
// document, that is the "fusion" failure the split arm is built to catch (e.g.
// the F03 "public health messaging" claim welded from U0021 and U0182). This
// module tags each claim groundingSpan: clustered | distant so the host can
// flag likely fusions BEFORE Call 1B, without a model call.
//
// The core signal is the ordinal distance between cited units. Unit IDs are
// assigned in strict document order (articleUnitId: U0001, U0002, ...), so the
// integer encoded in the ID is the unit's position — the span is computable
// from the sourceUnitIds alone, which is what lets this run against a saved
// inventory (Test order step 1) as well as live inside the pipeline.

// Two cited units belong to the same passage when their positions are within
// NEAR_GAP of each other — this merges adjacent sentences of one paragraph or
// quote block (which receive consecutive unit orders) into a single passage.
export const NEAR_GAP = 8;
// The largest jump between neighboring cited units classifies the claim:
//   maxGap >= DISTANT_GAP        -> distant   (a clear cross-document weld)
//   BORDERLINE_GAP <= maxGap <20 -> borderline (wider than one passage, but not
//                                    clearly a weld — a legitimate same-topic
//                                    claim substantiated across a longer passage
//                                    would look like this)
//   maxGap < BORDERLINE_GAP      -> clustered
// borderline is a first-guess boundary: it must stay a DISTINCT, visible tag
// (never silently folded into clustered or distant) so Call 1B receives it and
// makes its own needsSplit call, and so real borderline claims can be logged
// during stage 2-4 calibration and the cutoff revisited against labeled data.
export const BORDERLINE_GAP = 15;
export const DISTANT_GAP = 20;

// Parse the ordinal position out of an articleUnitId (U0007 -> 7). Returns null
// for anything that is not a positional unit id so callers can ignore it.
export function unitOrdinal(unitId) {
  const match = /^U(\d{1,6})$/.exec(String(unitId ?? "").trim());
  return match ? Number.parseInt(match[1], 10) : null;
}

// Group sorted, de-duplicated ordinals into passages: a new passage starts
// whenever the gap from the previous cited unit exceeds NEAR_GAP.
function groupPassages(ordinals, nearGap) {
  const passages = [];
  for (const ordinal of ordinals) {
    const current = passages.at(-1);
    if (current && ordinal - current.end <= nearGap) current.end = ordinal;
    else passages.push({ start: ordinal, end: ordinal });
  }
  return passages;
}

// Classify one claim's grounding into clustered | borderline | distant. Options
// let host selection or tests override the thresholds; passageCount/maxGap/
// unitSpan are returned for policy use and calibration logging.
export function classifyGroundingSpan(sourceUnitIds, {
  nearGap = NEAR_GAP, borderlineGap = BORDERLINE_GAP, distantGap = DISTANT_GAP } = {}) {
  const ordinals = [...new Set((sourceUnitIds ?? [])
    .map(unitOrdinal).filter((value) => value != null))].sort((a, b) => a - b);

  if (ordinals.length <= 1) {
    return { groundingSpan: "clustered", unitSpan: 0, maxGap: 0,
      passageCount: ordinals.length, passages: ordinals.map((o) => ({ start: o, end: o })) };
  }

  const passages = groupPassages(ordinals, nearGap);
  const unitSpan = ordinals.at(-1) - ordinals[0];
  let maxGap = 0;
  for (let i = 1; i < ordinals.length; i += 1) {
    maxGap = Math.max(maxGap, ordinals[i] - ordinals[i - 1]);
  }
  const groundingSpan = maxGap >= distantGap ? "distant"
    : maxGap >= borderlineGap ? "borderline" : "clustered";
  return { groundingSpan, unitSpan, maxGap, passageCount: passages.length, passages };
}

// distant and borderline are both "flagged" for Call 1B: 1B receives the flag
// and makes its own needsSplit / split-by-assertionSource decision per packet.
export const isFlaggedGroundingSpan = (groundingSpan) =>
  groundingSpan === "distant" || groundingSpan === "borderline";

// Tag every candidate claim in an inventory in place-safe fashion, returning a
// new array of { ...claim, groundingSpan } plus the raw span metrics under a
// non-schema sidecar key the host consumes (never sent to a model).
export function tagCandidateGroundingSpans(candidateClaims = [], options) {
  return candidateClaims.map((claim) => {
    const span = classifyGroundingSpan(claim?.sourceUnitIds, options);
    return { ...claim, groundingSpan: span.groundingSpan, _groundingSpanMetrics: span };
  });
}
