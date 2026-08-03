import { buildEvidenceNeedV1, normalizeBearingText } from "../../../core/evidenceNeed.js";
import { scoreSnippetBearingDeterministic } from "../../../core/snippetBearing.js";
import type { CfxEvidenceInput } from "./types.js";

export type CfxCanonicalCandidate = {
  documentKey: string;
  canonicalIdentity?: { kind?: string; value?: string } | null;
  identities?: Array<{ kind?: string; value?: string }>;
  pmid?: string | null;
  doi?: string | null;
  canonicalUrl?: string | null;
  normalizedResolvedUrl?: string | null;
  representative: {
    candidateId: string;
    title?: string;
    abstractOrSnippet?: string | null;
    retrievalRank?: number;
    retrievalScore?: number;
    pmid?: string | null;
    doi?: string | null;
    canonicalUrl?: string | null;
    url?: string | null;
  };
  discoveryAssignments: Array<{
    propositionId: string;
    queryId: string;
    queryIntent: string;
    rank: number;
    candidateId?: string;
  }>;
};

export type SnippetPreBearingResult = {
  documentKey: string;
  propositionId: string;
  snippetPreBearingLikelihood: number;
  confidence: number;
  components: Record<string, unknown> & { exactIdentity: number };
  diagnostic: string;
};

const text = (value: unknown): string => String(value ?? "").normalize("NFKC")
  .replace(/\s+/gu, " ").trim();

const literalValues = (input: CfxEvidenceInput): string[] => [
  ...input.literalIdentifiers.people,
  ...input.literalIdentifiers.organizations,
  ...input.literalIdentifiers.laws,
  ...input.literalIdentifiers.studyTitles,
  ...input.literalIdentifiers.journals,
  ...input.literalIdentifiers.years,
  ...input.literalIdentifiers.dateRanges,
  ...input.literalIdentifiers.doi,
  ...input.literalIdentifiers.pmid,
  ...input.literalIdentifiers.urls,
  ...input.literalIdentifiers.acronyms,
].map(text).filter(Boolean);

function exactIdentityScore(input: CfxEvidenceInput, document: CfxCanonicalCandidate): number {
  const literal = new Set(literalValues(input).map(normalizeBearingText));
  if (!literal.size) return 0;
  const candidateValues = [
    document.pmid,
    document.doi,
    document.canonicalUrl,
    document.normalizedResolvedUrl,
    document.canonicalIdentity?.value,
    document.representative.pmid,
    document.representative.doi,
    document.representative.canonicalUrl,
    document.representative.url,
    ...(document.identities ?? []).map((identity) => identity.value),
  ].map(normalizeBearingText).filter(Boolean);
  if (candidateValues.some((value) => literal.has(value))) return 1;

  const visible = normalizeBearingText([
    document.representative.title,
    document.representative.abstractOrSnippet,
  ].join(" "));
  const namedLiterals = literalValues(input)
    .map(normalizeBearingText)
    .filter((value) => value.length >= 3 && !/^\d{4}$/u.test(value));
  if (namedLiterals.some((value) => visible.includes(value))) return 0.7;
  return 0;
}

export function scoreCfxSnippetPreBearing(
  input: CfxEvidenceInput,
  document: CfxCanonicalCandidate,
): SnippetPreBearingResult {
  const need = buildEvidenceNeedV1({
    text: input.substantiveAssertion,
    speakerEntity: input.assertionSource,
  });
  need.mustIncludeTerms = [...new Set([
    ...(need.mustIncludeTerms ?? []),
    ...literalValues(input),
  ])].slice(0, 24);
  const scored = scoreSnippetBearingDeterministic(need, {
    title: document.representative.title ?? "",
    bearingText: document.representative.abstractOrSnippet ?? "",
    snippet: document.representative.abstractOrSnippet ?? "",
    url: document.canonicalUrl ?? document.representative.canonicalUrl
      ?? document.representative.url ?? "",
  });
  const exactIdentity = exactIdentityScore(input, document);
  const likelihood = Math.max(0, Math.min(1, Number(scored.score) + exactIdentity * 0.25));
  return {
    documentKey: document.documentKey,
    propositionId: input.propositionId,
    snippetPreBearingLikelihood: Number(likelihood.toFixed(4)),
    confidence: Number((Number("confidence" in scored ? scored.confidence : 0) || 0).toFixed(4)),
    components: { ...scored.components, exactIdentity },
    diagnostic: `${scored.reason} exactIdentity=${exactIdentity}`,
  };
}

function assignmentFor(document: CfxCanonicalCandidate, propositionId: string) {
  return document.discoveryAssignments
    .filter((row) => row.propositionId === propositionId)
    .sort((left, right) => left.queryId.localeCompare(right.queryId)
      || Number(left.rank) - Number(right.rank)
      || String(left.candidateId ?? "").localeCompare(String(right.candidateId ?? "")))[0];
}

/** Exact former Workspace selection ordering, projected onto canonical documents. */
export function selectCfxFormerSearchRankBaseline(
  input: CfxEvidenceInput,
  documents: CfxCanonicalCandidate[],
  maximum = 5,
): CfxCanonicalCandidate[] {
  return documents.filter((document) => assignmentFor(document, input.propositionId))
    .sort((left, right) => {
      const leftPath = assignmentFor(left, input.propositionId)!;
      const rightPath = assignmentFor(right, input.propositionId)!;
      return leftPath.queryId.localeCompare(rightPath.queryId)
        || Number(leftPath.rank) - Number(rightPath.rank)
        || left.representative.candidateId.localeCompare(right.representative.candidateId);
    }).slice(0, maximum);
}

const LANE_ORDER = [
  "canonical",
  "entity_predicate",
  "source_identity",
  "independent_evidence",
  "counterevidence",
  "qualification",
];

/**
 * Deterministic target-relative selection. Lane identity controls diversity,
 * never stance; the likelihood score controls order within the available pool.
 */
export function selectCfxSnippetPreBearing(
  input: CfxEvidenceInput,
  documents: CfxCanonicalCandidate[],
  maximum = 5,
): Array<CfxCanonicalCandidate & { preBearing: SnippetPreBearingResult }> {
  const eligible = documents.filter((document) => assignmentFor(document, input.propositionId))
    .map((document) => ({ ...document, preBearing: scoreCfxSnippetPreBearing(input, document) }));
  const byScore = (left: typeof eligible[number], right: typeof eligible[number]) =>
    Number(right.preBearing.components.exactIdentity) - Number(left.preBearing.components.exactIdentity)
    || right.preBearing.snippetPreBearingLikelihood - left.preBearing.snippetPreBearingLikelihood
    || right.preBearing.confidence - left.preBearing.confidence
    || Number(Boolean(right.representative.title || right.representative.abstractOrSnippet))
      - Number(Boolean(left.representative.title || left.representative.abstractOrSnippet))
    || Number(right.representative.retrievalScore || 0) - Number(left.representative.retrievalScore || 0)
    || Number(left.representative.retrievalRank || Number.MAX_SAFE_INTEGER)
      - Number(right.representative.retrievalRank || Number.MAX_SAFE_INTEGER)
    || Number(assignmentFor(left, input.propositionId)!.rank)
      - Number(assignmentFor(right, input.propositionId)!.rank)
    || left.documentKey.localeCompare(right.documentKey);
  eligible.sort(byScore);

  const selected: typeof eligible = [];
  const used = new Set<string>();
  for (const lane of LANE_ORDER) {
    if (selected.length >= maximum) break;
    const row = eligible.find((document) => !used.has(document.documentKey)
      && document.discoveryAssignments.some((assignment) =>
        assignment.propositionId === input.propositionId
        && assignment.queryIntent === lane));
    if (row) {
      selected.push(row);
      used.add(row.documentKey);
    }
  }
  for (const row of eligible) {
    if (selected.length >= maximum) break;
    if (!used.has(row.documentKey)) selected.push(row);
  }
  return selected;
}
