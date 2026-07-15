import { ARTICLE_ATOM_TYPES, ARTICLE_DOCUMENT_SCHEMA, ARTICLE_SOURCE_KINDS,
  ARTICLE_UNIT_TYPES, articleAtomId, articleLinkId, articleUnitId,
  articleReferenceId, citationMarkerId } from "./contract.js";
import { validateSourceFamily } from "./structureProfile.js";

const issue = (code, path, message) => ({ code, path, message });

function validRange(range, length) {
  return Number.isInteger(range?.start) && Number.isInteger(range?.end)
    && range.start >= 0 && range.end > range.start && range.end <= length;
}

export function verifyArticleDocument(document) {
  const issues = [];
  const text = document?.canonicalText ?? "";
  if (document?.schemaVersion !== ARTICLE_DOCUMENT_SCHEMA) issues.push(issue("CF1_ARTICLE_DOCUMENT_SCHEMA", "/schemaVersion", "Unsupported ArticleDocument schema"));
  if (!ARTICLE_SOURCE_KINDS.includes(document?.sourceKind)) issues.push(issue("CF1_ARTICLE_DOCUMENT_SOURCE_KIND", "/sourceKind", "Invalid source kind"));
  try { validateSourceFamily(document?.sourceFamily); }
  catch { issues.push(issue("CF1_ARTICLE_DOCUMENT_SOURCE_FAMILY", "/sourceFamily", "Invalid source family")); }
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(document?.adapterIdentity?.adapterId ?? "")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(document?.adapterIdentity?.adapterVersion ?? "")) {
    issues.push(issue("CF1_ARTICLE_DOCUMENT_ADAPTER", "/adapterIdentity", "Invalid adapter identity"));
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(document?.structureProfile?.profileId ?? "")
    || !Number.isInteger(document?.structureProfile?.version) || document.structureProfile.version < 1
    || !/^[a-f0-9]{64}$/.test(document?.structureProfile?.profileHash ?? "")) {
    issues.push(issue("CF1_ARTICLE_DOCUMENT_PROFILE", "/structureProfile", "Invalid StructureProfile identity"));
  }
  if (!text) issues.push(issue("CF1_ARTICLE_DOCUMENT_EMPTY", "/canonicalText", "Canonical text is empty"));

  const atomIds = new Set();
  const canonicalCoverage = new Uint8Array(text.length);
  let previousAtomEnd = 0;
  for (const [index, atom] of (document?.atoms ?? []).entries()) {
    const path = `/atoms/${index}`;
    if (atom.atomId !== articleAtomId(index) || atomIds.has(atom.atomId)) issues.push(issue("CF1_ARTICLE_ATOM_ID", `${path}/atomId`, "Atom IDs must be unique and ordered"));
    atomIds.add(atom.atomId);
    if (atom.order !== index) issues.push(issue("CF1_ARTICLE_ATOM_ORDER", `${path}/order`, "Atom order is invalid"));
    if (!ARTICLE_ATOM_TYPES.includes(atom.type)) issues.push(issue("CF1_ARTICLE_ATOM_TYPE", `${path}/type`, "Atom type is invalid"));
    if (!validRange(atom.sourceOffsets, text.length) || text.slice(atom.sourceOffsets?.start, atom.sourceOffsets?.end) !== atom.text) {
      issues.push(issue("CF1_ARTICLE_ATOM_OFFSETS", `${path}/sourceOffsets`, "Atom text does not match canonical offsets"));
    }
    if (validRange(atom.sourceOffsets, text.length) && atom.sourceOffsets.start < previousAtomEnd) {
      issues.push(issue("CF1_ARTICLE_ATOM_OVERLAP", `${path}/sourceOffsets`, "Atoms overlap or are out of order"));
    }
    if (validRange(atom.sourceOffsets, text.length)) {
      canonicalCoverage.fill(1, atom.sourceOffsets.start, atom.sourceOffsets.end);
      previousAtomEnd = atom.sourceOffsets.end;
    }
  }
  for (let offset = 0; offset < text.length; offset += 1) {
    if (!/\s/.test(text[offset]) && !canonicalCoverage[offset]) {
      issues.push(issue("CF1_ARTICLE_ATOM_COVERAGE", "/canonicalText", "Atoms do not cover canonical text"));
      break;
    }
  }

  const unitIds = new Set();
  const previousUnitEnd = new Map();
  let previousGlobalUnitEnd = 0;
  for (const [index, unit] of (document?.sourceUnits ?? []).entries()) {
    const path = `/sourceUnits/${index}`;
    if (unit.unitId !== articleUnitId(index) || unitIds.has(unit.unitId)) issues.push(issue("CF1_ARTICLE_UNIT_ID", `${path}/unitId`, "Unit IDs must be unique and ordered"));
    unitIds.add(unit.unitId);
    if (!atomIds.has(unit.atomId)) issues.push(issue("CF1_ARTICLE_UNIT_ATOM", `${path}/atomId`, "Unit atom does not exist"));
    if (unit.order !== index || !ARTICLE_UNIT_TYPES.includes(unit.type)) issues.push(issue("CF1_ARTICLE_UNIT_ORDER_TYPE", path, "Unit order or type is invalid"));
    if (!validRange(unit.sourceOffsets, text.length) || text.slice(unit.sourceOffsets?.start, unit.sourceOffsets?.end) !== unit.text) {
      issues.push(issue("CF1_ARTICLE_UNIT_OFFSETS", `${path}/sourceOffsets`, "Unit text does not match canonical offsets"));
    }
    if (validRange(unit.sourceOffsets, text.length) && unit.sourceOffsets.start < previousGlobalUnitEnd) {
      issues.push(issue("CF1_ARTICLE_UNIT_GLOBAL_ORDER", `${path}/sourceOffsets`, "Units overlap or are out of document order"));
    }
    const atom = (document.atoms ?? []).find((candidate) => candidate.atomId === unit.atomId);
    if (atom && validRange(unit.sourceOffsets, text.length)
      && (unit.sourceOffsets.start < atom.sourceOffsets.start || unit.sourceOffsets.end > atom.sourceOffsets.end
        || unit.sourceOffsets.start < (previousUnitEnd.get(unit.atomId) ?? atom.sourceOffsets.start))) {
      issues.push(issue("CF1_ARTICLE_UNIT_RANGE", `${path}/sourceOffsets`, "Unit is outside its atom or overlaps"));
    }
    if (validRange(unit.sourceOffsets, text.length)) {
      previousGlobalUnitEnd = unit.sourceOffsets.end;
      previousUnitEnd.set(unit.atomId, unit.sourceOffsets.end);
    }
  }

  const linkIds = new Set();
  for (const [index, link] of (document?.links ?? []).entries()) {
    const path = `/links/${index}`;
    if (link.linkId !== articleLinkId(index) || linkIds.has(link.linkId)) issues.push(issue("CF1_ARTICLE_LINK_ID", `${path}/linkId`, "Link IDs must be unique and ordered"));
    linkIds.add(link.linkId);
    if (!atomIds.has(link.atomId) || (link.unitId && !unitIds.has(link.unitId))) issues.push(issue("CF1_ARTICLE_LINK_SOURCE", path, "Link source does not exist"));
    try { if (!["http:", "https:"].includes(new URL(link.url).protocol)) throw new Error(); }
    catch { issues.push(issue("CF1_ARTICLE_LINK_URL", `${path}/url`, "Link URL must be absolute HTTP(S)")); }
    if (link.normalizedUrl !== link.url || typeof link.originalHref !== "string") {
      issues.push(issue("CF1_ARTICLE_LINK_IDENTITY", path, "Link must preserve original and normalized URL identity"));
    }
    if (link.startOffset !== null && (!Number.isInteger(link.startOffset)
      || !Number.isInteger(link.endOffset) || link.startOffset < 0 || link.endOffset < link.startOffset)) {
      issues.push(issue("CF1_ARTICLE_LINK_OFFSETS", path, "Link offsets are invalid"));
    }
  }

  const referenceIds = new Set();
  for (const [index, reference] of (document?.references ?? []).entries()) {
    const path = `/references/${index}`;
    if (reference.referenceId !== articleReferenceId(index) || referenceIds.has(reference.referenceId)) {
      issues.push(issue("CF1_ARTICLE_REFERENCE_ID", `${path}/referenceId`, "Reference IDs must be unique and ordered"));
    }
    referenceIds.add(reference.referenceId);
    if (!atomIds.has(reference.atomId) || (reference.sourceUnitId && !unitIds.has(reference.sourceUnitId))) {
      issues.push(issue("CF1_ARTICLE_REFERENCE_SOURCE", path, "Reference source does not exist"));
    }
    for (const linkId of reference.linkIds ?? []) if (!linkIds.has(linkId)) {
      issues.push(issue("CF1_ARTICLE_REFERENCE_LINK", `${path}/linkIds`, "Reference link does not exist"));
    }
  }

  const markerIds = new Set();
  for (const [index, marker] of (document?.citationMarkers ?? []).entries()) {
    const path = `/citationMarkers/${index}`;
    if (marker.markerId !== citationMarkerId(index) || markerIds.has(marker.markerId)) {
      issues.push(issue("CF1_ARTICLE_CITATION_ID", `${path}/markerId`, "Citation marker IDs must be unique and ordered"));
    }
    markerIds.add(marker.markerId);
    if (!atomIds.has(marker.atomId) || (marker.sourceUnitId && !unitIds.has(marker.sourceUnitId))) {
      issues.push(issue("CF1_ARTICLE_CITATION_SOURCE", path, "Citation marker source does not exist"));
    }
    if (marker.resolvedReferenceId && !referenceIds.has(marker.resolvedReferenceId)) {
      issues.push(issue("CF1_ARTICLE_CITATION_REFERENCE", path, "Resolved reference does not exist"));
    }
  }

  for (const [index, atom] of (document?.atoms ?? []).entries()) {
    for (const linkId of atom.linkIds ?? []) {
      const link = (document.links ?? []).find((candidate) => candidate.linkId === linkId);
      if (!link || link.atomId !== atom.atomId) {
        issues.push(issue("CF1_ARTICLE_ATOM_LINK", `/atoms/${index}/linkIds`, "Atom link reference is invalid"));
      }
    }
    for (const markerId of atom.citationMarkerIds ?? []) if (!markerIds.has(markerId)) {
      issues.push(issue("CF1_ARTICLE_ATOM_CITATION", `/atoms/${index}/citationMarkerIds`, "Atom citation reference is invalid"));
    }
    for (const referenceId of atom.referenceIds ?? []) if (!referenceIds.has(referenceId)) {
      issues.push(issue("CF1_ARTICLE_ATOM_REFERENCE", `/atoms/${index}/referenceIds`, "Atom reference is invalid"));
    }
    const units = (document.sourceUnits ?? []).filter((unit) => unit.atomId === atom.atomId);
    const covered = new Uint8Array(atom.text.length);
    for (const unit of units) covered.fill(1, unit.sourceOffsets.start - atom.sourceOffsets.start,
      unit.sourceOffsets.end - atom.sourceOffsets.start);
    for (let offset = 0; offset < atom.text.length; offset += 1) {
      if (!/\s/.test(atom.text[offset]) && !covered[offset]) {
        issues.push(issue("CF1_ARTICLE_UNIT_COVERAGE", `/atoms/${index}`, "Source units do not cover atom text"));
        break;
      }
    }
  }
  for (const [index, unit] of (document?.sourceUnits ?? []).entries()) {
    for (const linkId of unit.linkIds ?? []) if (!linkIds.has(linkId)) {
      issues.push(issue("CF1_ARTICLE_UNIT_LINK", `/sourceUnits/${index}/linkIds`, "Unit link is invalid"));
    }
    for (const markerId of unit.citationMarkerIds ?? []) if (!markerIds.has(markerId)) {
      issues.push(issue("CF1_ARTICLE_UNIT_CITATION", `/sourceUnits/${index}/citationMarkerIds`, "Unit citation is invalid"));
    }
    for (const referenceId of unit.articleReferenceIds ?? []) if (!referenceIds.has(referenceId)) {
      issues.push(issue("CF1_ARTICLE_UNIT_REFERENCE", `/sourceUnits/${index}/articleReferenceIds`, "Unit reference is invalid"));
    }
  }
  return { valid: issues.length === 0, issues };
}
