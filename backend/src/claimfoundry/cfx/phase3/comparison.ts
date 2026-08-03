import type { CfxMergedEvidenceAssertion } from "../evidenceBearing/documentExtraction.js";
import type { CfxEvidenceBearingExtraction } from "../evidenceBearing/types.js";

/** Pure offline comparison; the one-target primitive remains an optional repair path. */
export function compareCfxDocumentAndTargetedBearing(input: {
  documentAssertions: CfxMergedEvidenceAssertion[];
  targetedRows: CfxEvidenceBearingExtraction[];
}) {
  const documentPairs = input.documentAssertions.flatMap((assertion) =>
    assertion.targetLinks.map((link) => `${link.propositionId}\0${link.bearingRelation}\0${assertion.exactExcerpt}`));
  const targetedPairs = input.targetedRows.flatMap((row) => row.assertions.map((assertion) =>
    `${row.propositionId}\0${assertion.bearingRelation}\0${assertion.exactExcerpt}`));
  const documentSet = new Set(documentPairs);
  const targetedSet = new Set(targetedPairs);
  return {
    documentAssertionCount: input.documentAssertions.length,
    documentPairCount: documentSet.size,
    targetedPairCount: targetedSet.size,
    sharedPairCount: [...documentSet].filter((value) => targetedSet.has(value)).length,
    documentOnlyPairs: [...documentSet].filter((value) => !targetedSet.has(value)).sort(),
    targetedOnlyPairs: [...targetedSet].filter((value) => !documentSet.has(value)).sort(),
  };
}
