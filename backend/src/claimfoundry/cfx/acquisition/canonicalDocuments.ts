import { sha256 } from "../artifacts/immutableArtifacts.js";
import {
  normalizeDoi,
  normalizePmid,
  normalizeUrl,
} from "../../shared/evidenceSearch/identityNormalization.js";
import type {
  CfxCandidateDiscoveryPath,
  CfxEvidenceCandidate,
  CfxQueryIntent,
} from "../retrieval/types.js";

export const CFX_DOCUMENT_IDENTITY_KINDS = [
  "pmid",
  "doi",
  "canonical_url",
  "resolved_url",
] as const;

export type CfxDocumentIdentityKind =
  typeof CFX_DOCUMENT_IDENTITY_KINDS[number];

export type CfxDocumentIdentity = {
  kind: CfxDocumentIdentityKind;
  value: string;
  hash: string;
  matchHash: string;
};

export type CfxDocumentDiscoveryAssignment = {
  propositionId: string;
  targetClaimId: number;
  candidateId: string;
  queryId: string;
  queryIntent: CfxQueryIntent;
  query: string;
  provider: string;
  rank: number | null;
  requestId: string;
  assignmentHash: string;
};

export type CfxCanonicalDocument = {
  documentKey: string;
  canonicalIdentity: CfxDocumentIdentity;
  identities: CfxDocumentIdentity[];
  pmid: string | null;
  doi: string | null;
  canonicalUrl: string | null;
  normalizedResolvedUrl: string | null;
  representative: CfxEvidenceCandidate;
  candidateIds: string[];
  discoveryAssignments: CfxDocumentDiscoveryAssignment[];
};

export type CfxCandidateWithTarget = {
  candidate: CfxEvidenceCandidate;
  targetClaimId: number;
};

function identity(kind: CfxDocumentIdentityKind, value: string | null):
  CfxDocumentIdentity | null {
  if (!value) return null;
  const normalized = kind === "pmid"
    ? normalizePmid(value)
    : kind === "doi"
      ? normalizeDoi(value)
      : normalizeUrl(value);
  if (!normalized) return null;
  const material = `${kind}:${normalized}`;
  const matchMaterial = kind === "canonical_url" || kind === "resolved_url"
    ? `url:${normalized}`
    : material;
  return {
    kind,
    value: normalized,
    hash: sha256(material),
    matchHash: sha256(matchMaterial),
  };
}

export function exactDocumentIdentities(
  candidate: CfxEvidenceCandidate,
): CfxDocumentIdentity[] {
  const resolvedUrl = candidate.resolvedUrl ?? candidate.url;
  const values = [
    identity("pmid", candidate.pmid),
    identity("doi", candidate.doi),
    identity("canonical_url", candidate.canonicalUrl),
    identity("resolved_url", resolvedUrl),
  ].filter((value): value is CfxDocumentIdentity => Boolean(value));
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.hash)) return false;
    seen.add(value.hash);
    return true;
  });
}

function identityMatchKeys(value: CfxDocumentIdentity): string[] {
  return [value.matchHash];
}

function assignment(
  path: CfxCandidateDiscoveryPath,
  candidateId: string,
  targetClaimId: number,
): CfxDocumentDiscoveryAssignment {
  const value = {
    propositionId: path.propositionId,
    targetClaimId,
    candidateId,
    queryId: path.queryId,
    queryIntent: path.queryIntent,
    query: path.query,
    provider: path.provider,
    rank: Number.isSafeInteger(path.retrievalRank)
      ? path.retrievalRank
      : null,
    requestId: path.requestId,
  };
  return {
    ...value,
    assignmentHash: sha256(JSON.stringify(value)),
  };
}

function information(candidate: CfxEvidenceCandidate): number {
  return candidate.title.length
    + (candidate.abstractOrSnippet?.length ?? 0)
    + candidate.authors.length * 50
    + (candidate.pmid ? 250 : 0)
    + (candidate.doi ? 200 : 0)
    - candidate.retrievalRank;
}

/**
 * Group candidates only through exact identifiers. The host does not compare
 * titles or semantics. Transitive exact aliases are unioned, then the group's
 * canonical identity is selected in the governed PMID -> DOI -> canonical URL
 * -> normalized resolved URL order.
 */
export function aggregateCfxCanonicalDocuments(
  rows: CfxCandidateWithTarget[],
): CfxCanonicalDocument[] {
  const groups: Array<{
    rows: CfxCandidateWithTarget[];
    identities: Map<string, CfxDocumentIdentity>;
  } | null> = [];
  const identityToGroup = new Map<string, number>();

  for (const row of rows) {
    const identities = exactDocumentIdentities(row.candidate);
    if (!identities.length) continue;
    const matches = [...new Set(identities.flatMap((value) =>
      identityMatchKeys(value).map((key) => identityToGroup.get(key))).filter(
      (value): value is number => value !== undefined,
    ))];
    let groupIndex = matches[0];
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groups.push({ rows: [], identities: new Map() });
    }
    const group = groups[groupIndex]!;
    group.rows.push(row);
    for (const value of identities) group.identities.set(value.hash, value);
    for (const extraIndex of matches.slice(1)) {
      const extra = groups[extraIndex];
      if (!extra || extra === group) continue;
      group.rows.push(...extra.rows);
      for (const value of extra.identities.values()) {
        group.identities.set(value.hash, value);
      }
      groups[extraIndex] = null;
    }
    for (const value of group.identities.values()) {
      for (const key of identityMatchKeys(value)) {
        identityToGroup.set(key, groupIndex);
      }
    }
  }

  const priority = new Map(
    CFX_DOCUMENT_IDENTITY_KINDS.map((kind, index) => [kind, index]),
  );
  return groups.filter(
    (group): group is NonNullable<typeof group> => Boolean(group),
  ).map((group) => {
    const identities = [...group.identities.values()].sort((left, right) =>
      (priority.get(left.kind) ?? 99) - (priority.get(right.kind) ?? 99)
      || left.value.localeCompare(right.value));
    const canonicalIdentity = identities[0]!;
    const representative = group.rows.reduce((current, row) =>
      information(row.candidate) > information(current)
        ? row.candidate
        : current, group.rows[0]!.candidate);
    const byKind = (kind: CfxDocumentIdentityKind) =>
      identities.find((value) => value.kind === kind)?.value ?? null;
    const discoveryAssignments = group.rows.flatMap(({ candidate, targetClaimId }) =>
      candidate.discoveryPaths.map((path) =>
        assignment(path, candidate.candidateId, targetClaimId)));
    return {
      documentKey: `DOC-${canonicalIdentity.matchHash.slice(0, 20)}`,
      canonicalIdentity,
      identities,
      pmid: byKind("pmid"),
      doi: byKind("doi"),
      canonicalUrl: byKind("canonical_url"),
      normalizedResolvedUrl: byKind("resolved_url"),
      representative,
      candidateIds: [...new Set(group.rows.map(({ candidate }) =>
        candidate.candidateId))],
      discoveryAssignments,
    };
  }).sort((left, right) => left.documentKey.localeCompare(right.documentKey));
}
