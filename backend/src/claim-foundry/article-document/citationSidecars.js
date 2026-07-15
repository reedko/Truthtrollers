import { articleReferenceId, citationMarkerId } from "./contract.js";

function unitForRange(atom, units, startOffset, endOffset) {
  const start = atom.sourceOffsets.start + Math.max(0, startOffset ?? 0);
  const end = atom.sourceOffsets.start + Math.max(startOffset ?? 0, endOffset ?? startOffset ?? 0);
  const candidates = units.filter((unit) => unit.atomId === atom.atomId);
  return candidates.find((unit) => unit.sourceOffsets.start <= start && unit.sourceOffsets.end >= end)
    ?? candidates.find((unit) => unit.sourceOffsets.start < end && unit.sourceOffsets.end > start)
    ?? candidates[0] ?? null;
}

const normalizedKey = (value) => decodeURIComponent(String(value ?? "").replace(/^#/, ""))
  .trim().toLowerCase();

export function buildCitationSidecars(drafts, atoms, units, links, limits) {
  const references = [];
  const referenceByKey = new Map();
  for (const [index, draft] of drafts.entries()) {
    if (!draft.referenceCandidate || references.length >= limits.references) continue;
    const atom = atoms[index];
    const candidate = draft.referenceCandidate;
    const unit = unitForRange(atom, units, 0, atom.text.length);
    const reference = { referenceId: articleReferenceId(references.length),
      label: candidate.label || null, text: atom.text, atomId: atom.atomId,
      sourceUnitId: unit?.unitId ?? null,
      linkIds: links.filter((link) => link.atomId === atom.atomId
        && link.classification !== "non_retrieval").map((link) => link.linkId),
      markerIds: [], elementKeys: [...new Set(candidate.elementKeys ?? [])],
      backlinkTargets: [...new Set(candidate.backlinkTargets ?? [])],
      diagnosticFlags: [...new Set(candidate.diagnosticFlags ?? [])] };
    references.push(reference);
    for (const key of reference.elementKeys) if (normalizedKey(key)) {
      referenceByKey.set(normalizedKey(key), reference);
    }
    atom.referenceIds.push(reference.referenceId);
    if (unit) unit.articleReferenceIds.push(reference.referenceId);
  }

  const citationMarkers = [];
  for (const [index, draft] of drafts.entries()) {
    const atom = atoms[index];
    for (const candidate of draft.citationMarkers ?? []) {
      if (citationMarkers.length >= limits.citationMarkers) break;
      const unit = unitForRange(atom, units, candidate.startOffset, candidate.endOffset);
      const reference = candidate.targetFragment
        ? referenceByKey.get(normalizedKey(candidate.targetFragment)) : null;
      const flags = [...new Set([...(candidate.diagnosticFlags ?? []),
        ...(candidate.targetFragment && !reference ? ["unresolved_fragment"] : [])])];
      const marker = { markerId: citationMarkerId(citationMarkers.length),
        displayText: candidate.displayText, kind: candidate.kind,
        atomId: atom.atomId, sourceUnitId: unit?.unitId ?? null,
        startOffset: candidate.startOffset, endOffset: candidate.endOffset,
        targetFragment: candidate.targetFragment ?? null,
        resolvedReferenceId: reference?.referenceId ?? null, diagnosticFlags: flags };
      citationMarkers.push(marker);
      atom.citationMarkerIds.push(marker.markerId);
      if (unit) unit.citationMarkerIds.push(marker.markerId);
      if (reference) reference.markerIds.push(marker.markerId);
    }
  }
  return { citationMarkers, references };
}
