import { articleLinkId } from "./contract.js";

export function resolveHttpUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl || undefined);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function unitForLink(atom, units, anchorText) {
  const candidates = units.filter((unit) => unit.atomId === atom.atomId);
  if (!candidates.length) return null;
  const anchor = String(anchorText || "").trim();
  return (anchor && candidates.find((unit) => unit.text.includes(anchor))) || candidates[0];
}

function unitForCandidate(atom, units, candidate) {
  if (!Number.isInteger(candidate.startOffset)) return unitForLink(atom, units, candidate.anchorText);
  const start = atom.sourceOffsets.start + candidate.startOffset;
  const end = atom.sourceOffsets.start + (candidate.endOffset ?? candidate.startOffset);
  return units.find((unit) => unit.atomId === atom.atomId
    && unit.sourceOffsets.start <= start && unit.sourceOffsets.end >= end)
    ?? unitForLink(atom, units, candidate.anchorText);
}

export function buildArticleLinks(draftAtoms, atoms, sourceUnits, maximum) {
  const links = [];
  for (const [atomIndex, draft] of draftAtoms.entries()) {
    const atom = atoms[atomIndex];
    for (const candidate of draft.links ?? []) {
      if (!candidate?.url || links.length >= maximum) continue;
      const unit = unitForCandidate(atom, sourceUnits, candidate);
      links.push({ linkId: articleLinkId(links.length), url: candidate.url,
        normalizedUrl: candidate.url, originalHref: candidate.originalHref ?? candidate.url,
        anchorText: String(candidate.anchorText || "").trim(), atomId: atom.atomId,
        unitId: unit?.unitId ?? null,
        startOffset: Number.isInteger(candidate.startOffset) ? candidate.startOffset : null,
        endOffset: Number.isInteger(candidate.endOffset) ? candidate.endOffset : null,
        relation: candidate.relation ?? "inline_link",
        classification: candidate.classification || "unclassified",
        diagnosticFlags: [...new Set(candidate.diagnosticFlags ?? [])] });
    }
  }
  return links;
}
