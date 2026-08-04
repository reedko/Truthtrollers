import type { CfxEvidenceAccessLevel } from "../evidenceBearing/types.js";
import type { CfxDocumentIdentityKind } from "../acquisition/canonicalDocuments.js";

export type CfxPhase3DocumentCandidate = {
  documentId: string;
  selectedTextVersionId?: number;
  title?: string | null;
  canonicalIdentityKind: CfxDocumentIdentityKind;
  canonicalIdentityValue?: string | null;
  sourceUrl?: string | null;
  accessLevel: CfxEvidenceAccessLevel;
  textLength: number;
  selectedTextVersionHash: string | null;
  propositionIds: string[];
  queryIds: string[];
  providers: string[];
  publishers: string[];
  documentRoles: Array<"primary" | "official" | "independent" | "other">;
};

export type CfxPhase3RankedDocument = CfxPhase3DocumentCandidate & {
  eligible: boolean;
  eligibilityReason: string;
  score: number;
  rank: number | null;
  tier: "tier_1" | "tier_2" | "excluded";
  selectionReasons: string[];
};

const accessScore: Partial<Record<CfxEvidenceAccessLevel, number>> = {
  full_text: 400,
  substantial_excerpt: 330,
  abstract: 260,
};
const identityScore: Record<CfxDocumentIdentityKind, number> = {
  pmid: 100, doi: 90, canonical_url: 50, resolved_url: 30,
};

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function baseScore(document: CfxPhase3DocumentCandidate): number {
  const roleScore = document.documentRoles.includes("primary") ? 45
    : document.documentRoles.includes("official") ? 40
      : document.documentRoles.includes("independent") ? 35 : 0;
  return (accessScore[document.accessLevel] ?? 0)
    + identityScore[document.canonicalIdentityKind]
    + roleScore
    + Math.min(unique(document.queryIds).length, 5) * 8
    + Math.min(unique(document.propositionIds).length, 12) * 12
    + Math.min(unique(document.providers).length, 4) * 6;
}

/** Deterministic discovery prioritization only; it never assigns evidence stance. */
export function prioritizeCfxPhase3Documents(input: {
  documents: CfxPhase3DocumentCandidate[];
  tier1Target?: number;
  tier1Maximum?: number;
}): CfxPhase3RankedDocument[] {
  const target = Math.min(input.tier1Maximum ?? 18, Math.max(1, input.tier1Target ?? 15));
  const excluded: CfxPhase3RankedDocument[] = [];
  const eligible = input.documents.flatMap((document) => {
    const hasUsableText = Boolean(accessScore[document.accessLevel])
      && document.textLength > 0 && Boolean(document.selectedTextVersionHash);
    if (!hasUsableText) {
      excluded.push({
        ...document, eligible: false,
        eligibilityReason: document.accessLevel === "snippet"
          ? "snippet is provisional and excluded from the initial semantic run"
          : "no eligible selected full text, substantial excerpt, or abstract",
        score: 0, rank: null, tier: "excluded", selectionReasons: [],
      });
      return [];
    }
    return [{ document, score: baseScore(document) }];
  });
  const selected: CfxPhase3RankedDocument[] = [];
  const remaining = [...eligible];
  const coveredTargets = new Set<string>();
  const coveredProviders = new Set<string>();
  const coveredPublishers = new Set<string>();
  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const diversity = (row: typeof left) =>
        unique(row.document.propositionIds).filter((value) => !coveredTargets.has(value)).length * 20
        + unique(row.document.providers).filter((value) => !coveredProviders.has(value)).length * 10
        + unique(row.document.publishers).filter((value) => !coveredPublishers.has(value)).length * 8;
      return (right.score + diversity(right)) - (left.score + diversity(left))
        || left.document.documentId.localeCompare(right.document.documentId);
    });
    const next = remaining.shift()!;
    const reasons = [
      `${next.document.accessLevel} selected text`,
      `${next.document.canonicalIdentityKind} exact identity`,
      `${unique(next.document.propositionIds).length} proposition assignment(s)`,
      `${unique(next.document.queryIds).length} discovery query assignment(s)`,
    ];
    selected.push({
      ...next.document, eligible: true, eligibilityReason: "eligible selected text",
      score: next.score, rank: selected.length + 1,
      tier: selected.length < target ? "tier_1" : "tier_2",
      selectionReasons: reasons,
    });
    unique(next.document.propositionIds).forEach((value) => coveredTargets.add(value));
    unique(next.document.providers).forEach((value) => coveredProviders.add(value));
    unique(next.document.publishers).forEach((value) => coveredPublishers.add(value));
  }
  return [...selected, ...excluded.sort((a, b) => a.documentId.localeCompare(b.documentId))];
}
