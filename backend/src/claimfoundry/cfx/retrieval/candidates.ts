import {
  sha256,
} from "../artifacts/immutableArtifacts.js";
import {
  normalizeDoi,
  normalizePmid,
  normalizeUrl,
} from "../../shared/evidenceSearch/identityNormalization.js";
import type {
  CfxCandidateDedupeAudit,
  CfxCandidateDiscoveryPath,
  CfxEvidenceCandidate,
  CfxRawProviderCandidate,
  CfxRetrievalRequest,
} from "./types.js";

function text(value: unknown, maximum = 4_000): string {
  return String(value ?? "").normalize("NFKC")
    .replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function nullable(value: unknown, maximum = 4_000): string | null {
  const valueText = text(value, maximum);
  return valueText || null;
}

function authorNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const names = values.flatMap((author) => {
    if (typeof author === "string") return author.split(/\s*[;,]\s*/u);
    if (author && typeof author === "object") {
      const row = author as Record<string, unknown>;
      return [row.name ?? row.display_name ?? row.fullName];
    }
    return [];
  }).map((author) => text(author, 300)).filter(Boolean);
  return [...new Set(names)];
}

function identifier(
  raw: CfxRawProviderCandidate,
  key: "doi" | "pmid",
): string | null {
  const metadata = raw.academicMetadata;
  const nested = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)[key]
    : null;
  const direct = raw[key] ?? nested;
  if (!direct) return null;
  return key === "doi"
    ? normalizeDoi(String(direct)) || null
    : normalizePmid(String(direct));
}

function retrievalScore(value: unknown, rank: number): number {
  const parsed = Number(value);
  const fallback = 1 / Math.max(1, rank);
  return Math.max(0, Math.min(1.2, Number.isFinite(parsed) ? parsed : fallback));
}

export function normalizeCfxProviderCandidate(input: {
  raw: CfxRawProviderCandidate;
  request: CfxRetrievalRequest;
  rank: number;
  rawArtifactPath: string;
}): CfxEvidenceCandidate {
  const raw = input.raw;
  const metadata = raw.academicMetadata;
  const academic = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
  const provider = text(raw.provider ?? raw._provider ?? input.request.provider, 80);
  const providerRecordId = nullable(
    raw.id ?? raw.providerRecordId ?? raw.paperId ?? raw.openAlexId
      ?? raw.pmid ?? raw.doi,
    500,
  );
  const title = text(raw.title, 1_000);
  const url = nullable(raw.url, 4_000);
  const canonicalUrl = normalizeUrl(
    String(raw.canonicalUrl ?? url ?? ""),
  );
  const resolvedUrl = normalizeUrl(
    String(raw.resolvedUrl ?? raw.finalUrl ?? raw.responseUrl ?? url ?? ""),
  );
  const authors = authorNames(raw.authors ?? academic.authors);
  const publication = nullable(
    raw.publication ?? raw.journal ?? raw.venue ?? raw.containerTitle
      ?? academic.journal ?? academic.venue ?? academic.containerTitle
      ?? academic.publisher,
    1_000,
  );
  const publicationDate = nullable(
    raw.publicationDate ?? raw.publishedAt ?? raw.date,
    100,
  );
  const doi = identifier(raw, "doi");
  const pmid = identifier(raw, "pmid");
  const abstractOrSnippet = nullable(
    raw.abstract ?? raw.abstractOrSnippet ?? raw.searchSnippet ?? raw.snippet,
    8_000,
  );
  const sourceType = nullable(
    raw.sourceType ?? raw.source ?? raw.type ?? raw.publicationTypes
      ?? academic.publicationTypes,
    300,
  );
  const discoveryPath: CfxCandidateDiscoveryPath = {
    propositionId: input.request.propositionId,
    queryId: input.request.queryId,
    queryIntent: input.request.queryIntent,
    query: input.request.query,
    provider,
    retrievalRank: input.rank,
    requestId: input.request.requestId,
  };
  const identityMaterial = [
    input.request.propositionId,
    input.request.requestId,
    String(input.rank),
    doi ?? "",
    pmid ?? "",
    canonicalUrl ?? "",
    providerRecordId ?? "",
    title,
  ].join("\u001f");
  return {
    candidateId: `CAND-${sha256(identityMaterial).slice(0, 20)}`,
    propositionId: input.request.propositionId,
    queryId: input.request.queryId,
    provider,
    providerRecordId,
    title,
    authors,
    publication,
    publicationDate,
    doi,
    pmid,
    url,
    canonicalUrl,
    resolvedUrl,
    abstractOrSnippet,
    sourceType,
    retrievalScore: retrievalScore(raw.score ?? raw.relevanceScore, input.rank),
    retrievalRank: input.rank,
    rawArtifactPath: input.rawArtifactPath,
    discoveryPaths: [discoveryPath],
  };
}

function normalizedTitle(value: string): string {
  return text(value, 2_000).toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function publicationYear(candidate: CfxEvidenceCandidate): string {
  return candidate.publicationDate?.match(/\b(?:18|19|20)\d{2}\b/u)?.[0] ?? "";
}

function candidateKeys(candidate: CfxEvidenceCandidate): string[] {
  const keys: string[] = [];
  if (candidate.doi) keys.push(`1:doi:${candidate.doi}`);
  if (candidate.pmid) keys.push(`2:pmid:${candidate.pmid}`);
  if (candidate.providerRecordId) {
    keys.push(
      `3:provider:${candidate.provider.toLocaleLowerCase()}:${candidate.providerRecordId.toLocaleLowerCase()}`,
    );
  }
  if (candidate.canonicalUrl) {
    keys.push(`4:url:${candidate.canonicalUrl}`);
  }
  const title = normalizedTitle(candidate.title);
  const year = publicationYear(candidate);
  if (title && year) keys.push(`5:title-year:${title}:${year}`);
  if (title.length >= 20) keys.push(`6:title:${title}`);
  return keys;
}

function preferred(
  left: CfxEvidenceCandidate,
  right: CfxEvidenceCandidate,
): CfxEvidenceCandidate {
  const information = (candidate: CfxEvidenceCandidate) =>
    candidate.title.length
    + (candidate.abstractOrSnippet?.length ?? 0)
    + candidate.authors.length * 50
    + (candidate.doi ? 200 : 0)
    + (candidate.pmid ? 200 : 0)
    - candidate.retrievalRank;
  return information(right) > information(left) ? right : left;
}

export function dedupeCfxCandidates(
  candidates: CfxEvidenceCandidate[],
): {
  candidates: CfxEvidenceCandidate[];
  audit: CfxCandidateDedupeAudit[];
  duplicateCount: number;
} {
  const groups: Array<{
    representative: CfxEvidenceCandidate;
    members: CfxEvidenceCandidate[];
    keys: Set<string>;
  } | null> = [];
  const keyToGroup = new Map<string, number>();
  for (const candidate of candidates) {
    const keys = candidateKeys(candidate);
    const indexes = [...new Set(keys.map((key) => keyToGroup.get(key))
      .filter((value): value is number => value !== undefined))];
    let index = indexes[0];
    if (index === undefined) {
      index = groups.length;
      groups.push({
        representative: candidate,
        members: [candidate],
        keys: new Set(keys),
      });
    } else {
      const group = groups[index]!;
      group.representative = preferred(group.representative, candidate);
      group.members.push(candidate);
      keys.forEach((key) => group.keys.add(key));
      for (const extraIndex of indexes.slice(1)) {
        const other = groups[extraIndex];
        if (!other || other === group) continue;
        group.representative = preferred(
          group.representative,
          other.representative,
        );
        group.members.push(...other.members);
        other.keys.forEach((key) => group.keys.add(key));
        groups[extraIndex] = null;
      }
    }
    for (const key of groups[index]!.keys) keyToGroup.set(key, index);
  }
  const audit: CfxCandidateDedupeAudit[] = [];
  const deduped = groups.filter(
    (group): group is NonNullable<typeof group> => Boolean(group),
  ).map((group) => {
    const representative = group.representative;
    const discoveryPaths = group.members.flatMap(
      (member) => member.discoveryPaths,
    );
    const dedupeKey = [...group.keys].sort()[0]
      ?? `unresolved:${normalizedTitle(representative.title)}`;
    const candidateId = `CAND-${sha256(
      `${representative.propositionId}\u001f${dedupeKey}`,
    ).slice(0, 20)}`;
    const merged = {
      ...representative,
      candidateId,
      discoveryPaths,
    };
    audit.push({
      candidateId,
      dedupeKey,
      mergedCandidateIds: group.members.map((member) => member.candidateId),
      discoveryPathCount: discoveryPaths.length,
    });
    return merged;
  });
  return {
    candidates: deduped,
    audit,
    duplicateCount: candidates.length - deduped.length,
  };
}
