import { CF1_STRUCTURAL_TYPES } from "../contract.js";
import { Cf1Error } from "../errors.js";
import { resolveStructureProfile } from "./defaultProfiles.js";
import { verifyArticleDocument } from "./verifyArticleDocument.js";

const DEFAULTS = Object.freeze({ targetMinChars: 600, targetMaxChars: 3_500,
  hardMaxChars: 8_000, maxBlocks: 999 });
const idFor = (index) => `B${String(index + 1).padStart(3, "0")}`;

function blockType(atomType) {
  if (atomType === "heading") return "heading_section";
  if (atomType === "quotation") return "quotation";
  if (atomType === "list_item") return "list";
  if (["table", "table_row"].includes(atomType)) return "table";
  if (atomType === "caption") return "caption";
  if (["speaker_turn", "timestamp"].includes(atomType)) return "transcript";
  if (["social_post", "social_reply", "thread_separator"].includes(atomType)) return "social_thread";
  if (atomType === "paragraph") return "paragraph_group";
  return "other";
}

function optionsFor(options) {
  const values = { ...DEFAULTS, ...options };
  const valid = ["targetMinChars", "targetMaxChars", "hardMaxChars", "maxBlocks"]
    .every((key) => Number.isInteger(values[key]) && values[key] > 0)
    && values.targetMinChars <= values.targetMaxChars
    && values.targetMaxChars <= values.hardMaxChars && values.maxBlocks <= 999;
  if (!valid) throw new Cf1Error("CF1_INVALID_SOURCE_BLOCK_OPTIONS",
    "Invalid ArticleDocument source-block options", { status: 400 });
  return values;
}

function exactProfile(document, supplied) {
  const profile = resolveStructureProfile(document.sourceFamily, supplied);
  const identity = document.structureProfile ?? {};
  if (profile.profileId !== identity.profileId || profile.version !== identity.version
    || profile.profileHash !== identity.profileHash) {
    throw new Cf1Error("CF1_SOURCE_BLOCK_PROFILE_MISMATCH",
      "Source blocks require the exact ArticleDocument StructureProfile", { status: 409 });
  }
  return profile;
}

function visualGapBoundary(previous, atom, profile) {
  const rule = profile.rules.find((candidate) => candidate.signal === "layout.vertical-gap"
    && candidate.action === "boundary.candidate");
  const samePdfPage = previous?.layoutSignals?.pdfPage
    && previous.layoutSignals.pdfPage === atom.layoutSignals?.pdfPage;
  return Boolean(rule && samePdfPage
    && Number(previous.layoutSignals.verticalGapAfter) > Number(rule.parameters?.minimum ?? 24));
}

function structuralBoundary(group, atom, previous, nextLength, limits, profile) {
  if (!group) return "document_start";
  if (nextLength > limits.hardMaxChars) return "hard_size";
  const separatorsOnly = group.atoms.every((entry) => ["separator", "thread_separator"].includes(entry.type));
  if (separatorsOnly) return null;
  if (["separator", "thread_separator"].includes(atom.type)) return "separator";
  if (atom.layoutSignals?.separatorBefore) return "separator";
  if (visualGapBoundary(previous, atom, profile)) return "large_visual_gap";
  if (atom.type === "heading") {
    const contentAtoms = group.atoms.filter((entry) => !["separator", "thread_separator"].includes(entry.type));
    if (group.type === "heading_section" && contentAtoms.every((entry) => entry.type === "heading")) return null;
    return "heading";
  }
  if (nextLength > limits.targetMaxChars && group.length >= limits.targetMinChars) return "target_size";

  const incoming = blockType(atom.type);
  if (group.type === "heading_section") return null;
  if (group.type === incoming) return null;
  if (group.type === "table" && incoming === "caption") return null;
  if (group.type === "quotation" && incoming === "paragraph_group" && atom.text.length <= 500) return null;
  if ([group.type, incoming].every((type) => ["paragraph_group", "quotation", "caption"].includes(type))
    && group.length < limits.targetMinChars) return null;
  return "structural_type_change";
}

function materialize(document, group, index) {
  const first = group.atoms[0];
  const last = group.atoms.at(-1);
  const start = first.sourceOffsets.start;
  const end = last.sourceOffsets.end;
  const atomIds = group.atoms.map((atom) => atom.atomId);
  const sourceUnits = document.sourceUnits.filter((unit) => atomIds.includes(unit.atomId));
  const linkIds = document.links.filter((link) => atomIds.includes(link.atomId)).map((link) => link.linkId);
  const structuralAtoms = group.atoms.filter((atom) => !["separator", "thread_separator"].includes(atom.type));
  const firstNonHeading = structuralAtoms.findIndex((atom) => atom.type !== "heading");
  const headingAtoms = structuralAtoms.slice(0, firstNonHeading < 0 ? structuralAtoms.length : firstNonHeading);
  return { blockId: idFor(index), order: index,
    heading: headingAtoms.map((atom) => atom.text).join("\n\n"),
    text: document.canonicalText.slice(start, end), structuralType: group.type,
    sourceOffsets: { start, end }, atomIds, sourceUnitIds: sourceUnits.map((unit) => unit.unitId),
    linkIds, boundaryReasons: [group.boundaryReason] };
}

export function buildArticleSourceBlocks(document, options = {}) {
  const documentCheck = verifyArticleDocument(document);
  if (!documentCheck.valid) throw new Cf1Error("CF1_INVALID_ARTICLE_DOCUMENT",
    "Cannot build source blocks from an invalid ArticleDocument", { status: 400,
      details: { issues: documentCheck.issues } });
  const { structureProfile, ...sizeOptions } = options;
  const profile = exactProfile(document, structureProfile);
  const limits = optionsFor(sizeOptions);
  const groups = [];

  for (const atom of document.atoms) {
    if (atom.text.length > limits.hardMaxChars) throw new Cf1Error("CF1_SOURCE_BLOCK_ATOM_TOO_LARGE",
      "An ArticleDocument atom exceeds the source-block hard limit", { status: 413,
        details: { atomId: atom.atomId } });
    const current = groups.at(-1);
    const nextLength = current ? atom.sourceOffsets.end - current.atoms[0].sourceOffsets.start : atom.text.length;
    const reason = structuralBoundary(current, atom, current?.atoms.at(-1), nextLength, limits, profile);
    if (reason) groups.push({ atoms: [atom], type: blockType(atom.type),
      boundaryReason: reason, get length() { return this.atoms.at(-1).sourceOffsets.end
        - this.atoms[0].sourceOffsets.start; } });
    else {
      current.atoms.push(atom);
      if (current.type === "other" && !["separator", "thread_separator"].includes(atom.type)) {
        current.type = blockType(atom.type);
      }
    }
  }
  if (groups.length > limits.maxBlocks) throw new Cf1Error("CF1_TOO_MANY_SOURCE_BLOCKS",
    "ArticleDocument requires too many source blocks", { status: 413 });
  return groups.map((group, index) => materialize(document, group, index));
}

export function verifyArticleSourceBlocks(document, blocks, options = {}) {
  const limits = optionsFor(options);
  const issues = [];
  const atomIds = new Set();
  const unitIds = new Set();
  const covered = new Uint8Array(document.canonicalText.length);
  let previousEnd = 0;
  for (const [index, block] of (blocks ?? []).entries()) {
    const path = `/sourceBlocks/${index}`;
    const { start, end } = block.sourceOffsets ?? {};
    if (block.blockId !== idFor(index) || block.order !== index) issues.push({ code: "CF1_SOURCE_BLOCK_ID_ORDER", path });
    if (!CF1_STRUCTURAL_TYPES.includes(block.structuralType)) issues.push({ code: "CF1_SOURCE_BLOCK_TYPE", path });
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < previousEnd || end <= start
      || end > document.canonicalText.length) { issues.push({ code: "CF1_SOURCE_BLOCK_RANGE", path }); continue; }
    if (end - start > limits.hardMaxChars) issues.push({ code: "CF1_SOURCE_BLOCK_TOO_LARGE", path });
    if (document.canonicalText.slice(start, end) !== block.text) issues.push({ code: "CF1_SOURCE_BLOCK_TEXT", path });
    covered.fill(1, start, end);
    const expectedAtoms = document.atoms.filter((atom) => atom.sourceOffsets.start >= start && atom.sourceOffsets.end <= end);
    const expectedUnits = document.sourceUnits.filter((unit) => unit.sourceOffsets.start >= start && unit.sourceOffsets.end <= end);
    const expectedLinks = document.links.filter((link) => expectedAtoms.some((atom) => atom.atomId === link.atomId));
    if (JSON.stringify(block.atomIds) !== JSON.stringify(expectedAtoms.map((atom) => atom.atomId))) issues.push({ code: "CF1_SOURCE_BLOCK_ATOMS", path });
    if (JSON.stringify(block.sourceUnitIds) !== JSON.stringify(expectedUnits.map((unit) => unit.unitId))) issues.push({ code: "CF1_SOURCE_BLOCK_UNITS", path });
    if (JSON.stringify(block.linkIds) !== JSON.stringify(expectedLinks.map((link) => link.linkId))) issues.push({ code: "CF1_SOURCE_BLOCK_LINKS", path });
    for (const id of block.atomIds ?? []) { if (atomIds.has(id)) issues.push({ code: "CF1_SOURCE_BLOCK_ATOM_DUPLICATE", path }); atomIds.add(id); }
    for (const id of block.sourceUnitIds ?? []) { if (unitIds.has(id)) issues.push({ code: "CF1_SOURCE_BLOCK_UNIT_DUPLICATE", path }); unitIds.add(id); }
    previousEnd = end;
  }
  if (atomIds.size !== document.atoms.length) issues.push({ code: "CF1_SOURCE_BLOCK_ATOM_COVERAGE", path: "/sourceBlocks" });
  if (unitIds.size !== document.sourceUnits.length) issues.push({ code: "CF1_SOURCE_BLOCK_UNIT_COVERAGE", path: "/sourceBlocks" });
  for (let offset = 0; offset < covered.length; offset += 1) {
    if (!covered[offset] && !/\s/.test(document.canonicalText[offset])) {
      issues.push({ code: "CF1_SOURCE_BLOCK_TEXT_COVERAGE", path: `/canonicalText/${offset}` });
      break;
    }
  }
  return { valid: issues.length === 0, issues };
}
