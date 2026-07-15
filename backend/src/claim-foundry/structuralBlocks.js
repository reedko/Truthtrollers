import { CF1_LIMITS, CF1_STRUCTURAL_TYPES } from "./contract.js";
import { Cf1Error } from "./errors.js";

const DEFAULTS = Object.freeze({ targetMinChars: 1_000, targetMaxChars: 8_000, hardMaxChars: 30_000 });
const LIST_LINE = /^\s*(?:[-*+] |\d+[.)] )/;

function classify(text) {
  const trimmed = text.trim();
  const lines = trimmed.split("\n").filter((line) => line.trim());
  if (lines.length && lines.every((line) => LIST_LINE.test(line))) return "list";
  if (/^(?:[>“"]|‘)/.test(trimmed)) return "quotation";
  if (lines.length === 1 && trimmed.length <= 160 && !/[.!?]$/.test(trimmed)) return "heading_section";
  return "paragraph_group";
}

function sourceUnits(text) {
  const units = [];
  const separator = /\n[ \t]*\n+/g;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index;
    if (text.slice(start, end).trim()) units.push({ start, end, type: classify(text.slice(start, end)) });
    start = match.index + match[0].length;
  }
  if (text.slice(start).trim()) units.push({ start, end: text.length, type: classify(text.slice(start)) });
  return units;
}

function splitUnit(unit, text, hardMaxChars) {
  const pieces = [];
  let start = unit.start;
  while (unit.end - start > hardMaxChars) {
    const limit = start + hardMaxChars;
    const windowStart = start + Math.floor(hardMaxChars * 0.75);
    const window = text.slice(windowStart, limit);
    const relativeBreak = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const end = relativeBreak >= 0 ? windowStart + relativeBreak + 1 : limit;
    pieces.push({ start, end, type: unit.type });
    start = end;
  }
  if (text.slice(start, unit.end).trim()) pieces.push({ start, end: unit.end, type: unit.type });
  return pieces;
}

function validateOptions(options) {
  const values = { ...DEFAULTS, ...options };
  const valid = Number.isInteger(values.targetMinChars) && Number.isInteger(values.targetMaxChars)
    && Number.isInteger(values.hardMaxChars) && values.targetMinChars > 0
    && values.targetMinChars <= values.targetMaxChars && values.targetMaxChars <= values.hardMaxChars
    && values.hardMaxChars <= CF1_LIMITS.articleTextChars;
  if (!valid) throw new Cf1Error("CF1_INVALID_BLOCK_OPTIONS", "Invalid structural block size options", { status: 400 });
  return values;
}

export function proposeStructuralBlocks(article, options = {}) {
  if (!article?.text) throw new Cf1Error("CF1_INVALID_ARTICLE", "Normalized article text is required", { status: 400 });
  const limits = validateOptions(options);
  const units = sourceUnits(article.text).flatMap((unit) => splitUnit(unit, article.text, limits.hardMaxChars));
  const groups = [];

  for (const unit of units) {
    const current = groups.at(-1);
    const combinedLength = current ? unit.end - current.start : 0;
    const compatible = current?.type === unit.type && combinedLength <= limits.targetMaxChars;
    if (compatible) current.end = unit.end;
    else groups.push({ ...unit });
  }
  if (groups.length > 999) {
    throw new Cf1Error("CF1_INPUT_TOO_LARGE", "Article requires more than 999 structural blocks", { status: 413 });
  }

  return groups.map((group, index) => ({
    blockId: `B${String(index + 1).padStart(3, "0")}`,
    order: index,
    heading: group.type === "heading_section" ? article.text.slice(group.start, group.end).trim() : "",
    text: article.text.slice(group.start, group.end),
    structuralType: group.type,
    sourceOffsets: { start: group.start, end: group.end },
  }));
}

export function verifyBlockCoverage(article, blocks, { hardMaxChars = DEFAULTS.hardMaxChars } = {}) {
  const issues = [];
  const covered = new Uint8Array(article?.text?.length ?? 0);
  let previousEnd = 0;
  const ids = new Set();

  for (const [index, block] of (blocks ?? []).entries()) {
    const path = `/semanticBlocks/${index}`;
    const { start, end } = block.sourceOffsets ?? {};
    if (block.blockId !== `B${String(index + 1).padStart(3, "0")}` || ids.has(block.blockId)) issues.push({ code: "CF1_BLOCK_ID_ORDER", path, message: "Block IDs must be unique and sequential" });
    ids.add(block.blockId);
    if (block.order !== index) issues.push({ code: "CF1_BLOCK_ORDER", path, message: "Block order must match array order" });
    if (!CF1_STRUCTURAL_TYPES.includes(block.structuralType)) issues.push({ code: "CF1_BLOCK_TYPE", path, message: "Unsupported structural type" });
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < previousEnd || end <= start || end > covered.length) {
      issues.push({ code: "CF1_BLOCK_RANGE", path, message: "Block range is invalid, overlapping, or unordered" });
      continue;
    }
    if (end - start > hardMaxChars) issues.push({ code: "CF1_BLOCK_TOO_LARGE", path, message: "Block exceeds the hard character limit" });
    if (article.text.slice(start, end) !== block.text) issues.push({ code: "CF1_BLOCK_TEXT_MISMATCH", path, message: "Block text does not match article offsets" });
    covered.fill(1, start, end);
    previousEnd = end;
  }

  for (let index = 0; index < covered.length; index += 1) {
    if (!covered[index] && !/\s/.test(article.text[index])) {
      issues.push({ code: "CF1_BLOCK_COVERAGE_GAP", path: `/article/text/${index}`, message: "Non-whitespace article text is not covered" });
      break;
    }
  }
  return { valid: issues.length === 0, issues };
}
