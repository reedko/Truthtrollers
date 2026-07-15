import { ARTICLE_UNIT_TYPES, articleUnitId } from "./contract.js";

const WHOLE_ATOM_UNITS = Object.freeze({
  heading: "heading", quotation: "quotation", list_item: "list_item",
  table: "table_row", table_row: "table_row", caption: "caption",
  speaker_turn: "speaker_turn", timestamp: "other", social_post: "social_post",
  social_reply: "social_reply", thread_separator: "other",
  code_or_preformatted: "other", separator: "other", unknown: "other",
});

function trimRange(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
}

function sentenceRanges(text, locale) {
  if (!text || text.length < 2 || typeof Intl?.Segmenter !== "function") {
    return [{ start: 0, end: text.length }];
  }
  const segmentationText = text.replace(/\n/g, " ");
  let segments;
  try {
    segments = new Intl.Segmenter(locale || undefined, { granularity: "sentence" }).segment(segmentationText);
  } catch {
    segments = new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(segmentationText);
  }
  const ranges = [];
  for (const segment of segments) {
    const range = trimRange(text, segment.index, segment.index + segment.segment.length);
    if (range.end > range.start) ranges.push(range);
  }
  return ranges.length ? ranges : [{ start: 0, end: text.length }];
}

function rangesForAtom(atom, locale) {
  const fixedType = WHOLE_ATOM_UNITS[atom.type];
  if (fixedType) return [{ start: 0, end: atom.text.length, type: fixedType }];
  if (atom.type !== "paragraph") {
    return [{ start: 0, end: atom.text.length, type: "other" }];
  }
  return sentenceRanges(atom.text, locale).map((range) => ({ ...range, type: "sentence" }));
}

export function buildSourceUnits(atoms, { locale } = {}) {
  const units = [];
  for (const atom of atoms) {
    for (const range of rangesForAtom(atom, locale)) {
      const start = atom.sourceOffsets.start + range.start;
      const end = atom.sourceOffsets.start + range.end;
      const type = ARTICLE_UNIT_TYPES.includes(range.type) ? range.type : "other";
      units.push({ unitId: articleUnitId(units.length), atomId: atom.atomId,
        order: units.length, type, text: atom.text.slice(range.start, range.end),
        sourceOffsets: { start, end } });
    }
  }
  return units;
}
