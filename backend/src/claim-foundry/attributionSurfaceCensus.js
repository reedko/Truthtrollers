// Deterministic, observation-only census of passages that may contain attributed,
// quoted, opponent, or documentary claims. Every structural block is scanned; the
// census never reads Call 1A output, creates claims, or participates in execution
// success/failure. A separate diagnostic compares these packets with Call 1A.

const censusId = (index) => `CEN${String(index + 1).padStart(3, "0")}`;

const STRUCTURAL_KIND = Object.freeze({
  quotation: "block_quotation",
  speaker_turn: "speaker_turn",
  social_post: "embedded_post",
  social_reply: "embedded_post",
});

const ATTRIBUTION_CUE = /\b(?:said|says|told|argued|claimed|claims|wrote|writes|stated|states|denied|denies|added|asserted|asserts|noted|notes|explained|explains|warned|warns|testified|insisted|insists|contends?|contended|maintains?|maintained|announced|reported|reports|found|concluded|according to)\b/i;
const CHALLENGE_CUE = /\b(?:so-called|purports? to|falsely|debunk\w*|\bmyth\b|disput\w+|contrary to|in fact|no evidence|misleading|denies that|refut\w+|unsupported|baseless)\b/i;
const DOCUMENT_CUE = /\b(?:study|studies|report|analysis|data|survey|review|paper|records?|documents?|law|act|statute|regulation|package insert|advertisement|\bad\b)\b/i;
const COMPARISON_CUE = /\b(?:more|less|fewer|higher|lower|increase[ds]?|decrease[ds]?|rise|fell|compared|correlat\w*|link\w*|associated|twice|half|percent|percentage|rate|risk|odds)\b|\d/i;
const INSTITUTION_CUE = /\b(?:department|agency|authority|authorities|government|university|company|manufacturer|committee|administration|center|centre|institute|association|council|board|office|bureau)\b/i;
const ATTRIBUTION_VERB = "said|says|told|argued|claimed|wrote|stated|noted|explained|warned|testified|insisted|maintains?|maintained|contends?|contended";
const NAMED_SOURCE = new RegExp(
  `[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+`
  + `|(?:Dr|Mr|Ms|Mrs|Prof)\\.\\s+[A-Z][a-z]+`
  + `|\\b[A-Z][a-z]{2,}\\b\\s+(?:${ATTRIBUTION_VERB})\\b`
  + `|according to\\s+(?:the\\s+)?[A-Z][a-z]{2,}`);

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const hasNamedSource = (text) => NAMED_SOURCE.test(text);

function sentenceFragments(text) {
  const clean = normalize(text);
  if (!clean) return [];
  try {
    const segments = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(clean)]
      .map(({ segment }) => normalize(segment)).filter(Boolean);
    return segments.length ? segments : [clean];
  } catch {
    return clean.split(/(?<=[.!?])\s+(?=[“\"'‘’A-Z0-9•])/).map(normalize).filter(Boolean);
  }
}

function contextFor(unit, block, blockIndex, unitsById, blocks) {
  const ids = block?.sourceUnitIds ?? [unit.unitId];
  const position = ids.indexOf(unit.unitId);
  const localIds = position >= 0 ? ids.slice(Math.max(0, position - 1), position + 2) : [unit.unitId];
  // List assertions commonly inherit their source from the immediately preceding
  // prose block (for example, "Among the statements made:"). Preserve that lead-in.
  const previous = blockIndex > 0 ? blocks[blockIndex - 1] : null;
  const inheritedIds = unit.type === "list_item"
    ? (previous?.sourceUnitIds ?? []).slice(-2) : [];
  const contextUnitIds = [...new Set([...inheritedIds, ...localIds])];
  const contextText = contextUnitIds.map((id) => unitsById.get(id)?.text).filter(Boolean)
    .map(normalize).join("\n");
  return { contextUnitIds, contextText, heading: block?.heading ?? "" };
}

function classifyFragment({ fragment, unit, block }) {
  const signals = [];
  const structural = STRUCTURAL_KIND[unit.type];
  if (structural) signals.push(structural);
  if (unit.type === "list_item" || block?.structuralType === "list") signals.push("list_assertion");
  if (ATTRIBUTION_CUE.test(fragment)) signals.push("attributed_statement");
  if (hasNamedSource(fragment) && (structural || signals.includes("attributed_statement"))) {
    signals.push("named_source");
  }
  if (/\?\s*[”\"']?$/.test(fragment)) signals.push("qa_passage");
  if (CHALLENGE_CUE.test(fragment)) signals.push("challenge_signal");
  if (DOCUMENT_CUE.test(fragment)) signals.push("document_or_study_statement");
  if (COMPARISON_CUE.test(fragment)) signals.push("numeric_or_comparative_statement");
  if (INSTITUTION_CUE.test(fragment)
    && (structural || signals.includes("list_assertion") || signals.includes("attributed_statement"))) {
    signals.push("institutional_assertion");
  }
  const unique = [...new Set(signals)];
  if (!unique.length) return null;
  const substantive = fragment.replace(/[“”\"'‘’•—–-]/g, " ").match(/[A-Za-z0-9]+/g)?.length >= 5;
  const recoveryEligible = Boolean(substantive && !unique.includes("qa_passage")
    && unique.some((signal) => signal !== "named_source"));
  return { kind: unique.find((signal) => signal !== "named_source") ?? unique[0],
    signals: unique, recoveryEligible };
}

export function collectAttributionSurface({ sourceUnits = [], structuralBlocks = [],
  maxItems = Number.POSITIVE_INFINITY } = {}) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const blockByUnit = new Map();
  const blocks = structuralBlocks.length ? structuralBlocks : sourceUnits.map((unit, index) => ({
    blockId: `UNIT-${unit.unitId}`, order: index, heading: "",
    structuralType: unit.type, sourceUnitIds: [unit.unitId],
  }));
  blocks.forEach((block, blockIndex) => {
    for (const id of block.sourceUnitIds ?? []) blockByUnit.set(id, { block, blockIndex });
  });

  const items = [];
  for (const unit of sourceUnits) {
    const located = blockByUnit.get(unit.unitId) ?? {};
    const block = located.block;
    for (const [fragmentIndex, fragment] of sentenceFragments(unit.text).entries()) {
      const classified = classifyFragment({ fragment, unit, block });
      if (!classified) continue;
      const local = contextFor(unit, block, located.blockIndex ?? 0, unitsById, blocks);
      items.push({
        censusId: censusId(items.length),
        semanticChunkId: block?.blockId ?? `UNIT-${unit.unitId}`,
        semanticChunkOrder: block?.order ?? unit.order,
        kind: classified.kind,
        signals: classified.signals,
        recoveryEligible: classified.recoveryEligible,
        sourceUnitIds: [unit.unitId],
        contextUnitIds: local.contextUnitIds,
        heading: local.heading,
        unitOrder: unit.order,
        unitType: unit.type,
        fragmentIndex,
        text: fragment,
        contextText: local.contextText,
      });
      if (items.length >= maxItems) return items;
    }
  }
  return items;
}
