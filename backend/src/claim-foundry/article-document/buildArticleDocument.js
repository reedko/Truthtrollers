import { Cf1InputError } from "../errors.js";
import { hashArticleInput } from "../canonicalJson.js";
import { ARTICLE_ATOM_TYPES, ARTICLE_DOCUMENT_LIMITS, ARTICLE_DOCUMENT_SCHEMA,
  ARTICLE_SOURCE_KINDS, articleAtomId } from "./contract.js";
import { buildSourceUnits } from "./sourceUnits.js";
import { buildArticleLinks } from "./links.js";
import { buildCitationSidecars } from "./citationSidecars.js";
import { assertStructureProfile, validateSourceFamily } from "./structureProfile.js";

const ADAPTER_ID = /^[a-z][a-z0-9._-]{2,95}$/;
const ADAPTER_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function canonicalAtomText(value) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n")
    .replace(/\u00ad/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return structuredClone(metadata);
}

export function buildArticleDocument({ sourceKind, sourceFamily, adapterIdentity, structureProfile,
  draftAtoms, metadata = {}, diagnostics = {}, sourceDescriptor = {} }) {
  if (!ARTICLE_SOURCE_KINDS.includes(sourceKind)) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_SOURCE_KIND", "Unsupported ArticleDocument source kind");
  }
  if (!Array.isArray(draftAtoms) || !draftAtoms.length) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_EMPTY", "ArticleDocument requires readable atoms");
  }
  const family = validateSourceFamily(sourceFamily);
  if (!ADAPTER_ID.test(adapterIdentity?.adapterId ?? "")
    || !ADAPTER_VERSION.test(adapterIdentity?.adapterVersion ?? "")) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_ADAPTER", "ArticleDocument adapter identity is invalid");
  }
  const profile = assertStructureProfile(structureProfile, family);
  if (draftAtoms.length > ARTICLE_DOCUMENT_LIMITS.atoms) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_TOO_MANY_ATOMS", "ArticleDocument atom limit exceeded");
  }

  const atoms = [];
  let canonicalText = "";
  const normalizedDrafts = [];
  for (const draft of draftAtoms) {
    const text = canonicalAtomText(draft?.text);
    if (!text) continue;
    if (text.length > ARTICLE_DOCUMENT_LIMITS.atomTextChars) {
      throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_ATOM_TOO_LARGE", "ArticleDocument atom is too large");
    }
    if (canonicalText) canonicalText += "\n\n";
    const start = canonicalText.length;
    canonicalText += text;
    const type = ARTICLE_ATOM_TYPES.includes(draft.type) ? draft.type : "unknown";
    normalizedDrafts.push({ ...draft, text });
    atoms.push({ atomId: articleAtomId(atoms.length), order: atoms.length, type, text,
      sourceOffsets: { start, end: canonicalText.length },
      layoutSignals: structuredClone(draft.layoutSignals ?? {}),
      linkIds: [], citationMarkerIds: [], referenceIds: [],
      diagnosticFlags: [...new Set(draft.diagnosticFlags ?? [])] });
  }
  if (!atoms.length || canonicalText.length > ARTICLE_DOCUMENT_LIMITS.canonicalTextChars) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_TEXT_SIZE", "Canonical article text is empty or too large");
  }

  const normalizedMetadata = normalizeMetadata(metadata);
  const title = String(normalizedMetadata.title || "").trim();
  if (!title) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_TITLE", "ArticleDocument metadata requires a title");
  }
  const sourceUnits = buildSourceUnits(atoms, { locale: normalizedMetadata.language });
  if (sourceUnits.length > ARTICLE_DOCUMENT_LIMITS.sourceUnits) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_TOO_MANY_UNITS", "ArticleDocument source-unit limit exceeded");
  }
  const candidateLinkCount = normalizedDrafts.reduce((count, draft) => count + (draft.links?.length ?? 0), 0);
  if (candidateLinkCount > ARTICLE_DOCUMENT_LIMITS.links) {
    throw new Cf1InputError("CF1_ARTICLE_DOCUMENT_TOO_MANY_LINKS", "ArticleDocument link limit exceeded");
  }
  const links = buildArticleLinks(normalizedDrafts, atoms, sourceUnits, ARTICLE_DOCUMENT_LIMITS.links);
  for (const link of links) atoms.find((atom) => atom.atomId === link.atomId)?.linkIds.push(link.linkId);
  for (const unit of sourceUnits) Object.assign(unit,
    { linkIds: [], citationMarkerIds: [], articleReferenceIds: [] });
  for (const link of links) {
    const unit = sourceUnits.find((item) => item.unitId === link.unitId);
    if (unit) unit.linkIds.push(link.linkId);
  }
  const { citationMarkers, references } = buildCitationSidecars(normalizedDrafts, atoms,
    sourceUnits, links, ARTICLE_DOCUMENT_LIMITS);
  const citationCoverage = { markerCount: citationMarkers.length, referenceCount: references.length,
    resolvedMarkerCount: citationMarkers.filter((item) => item.resolvedReferenceId).length,
    unresolvedMarkerCount: citationMarkers.filter((item) => !item.resolvedReferenceId).length,
    referenceLinkCount: references.reduce((count, item) => count + item.linkIds.length, 0) };
  return { schemaVersion: ARTICLE_DOCUMENT_SCHEMA, sourceKind, sourceFamily: family,
    adapterIdentity: structuredClone(adapterIdentity),
    structureProfile: { profileId: profile.profileId, version: profile.version,
      profileHash: profile.profileHash }, canonicalText, atoms,
    sourceUnits, links, citationMarkers, references, metadata: normalizedMetadata,
    diagnostics: { ...structuredClone(diagnostics ?? {}), citationCoverage },
    sourceDescriptor: structuredClone(sourceDescriptor ?? {}),
    contentHash: hashArticleInput({ title, text: canonicalText }) };
}
