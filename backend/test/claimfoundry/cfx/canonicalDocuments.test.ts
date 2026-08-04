import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCfxCanonicalDocuments,
  exactDocumentIdentities,
} from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";
import type {
  CfxEvidenceCandidate,
} from "../../../src/claimfoundry/cfx/retrieval/types.js";

function candidate(input: {
  candidateId: string;
  propositionId: string;
  queryId: "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
  pmid?: string | null;
  doi?: string | null;
  canonicalUrl?: string | null;
  resolvedUrl?: string | null;
  rank?: number;
}): CfxEvidenceCandidate {
  const rank = input.rank ?? 1;
  return {
    candidateId: input.candidateId,
    propositionId: input.propositionId,
    queryId: input.queryId,
    provider: "test",
    providerRecordId: null,
    title: `Document ${input.candidateId}`,
    authors: [],
    publication: null,
    publicationDate: null,
    doi: input.doi ?? null,
    pmid: input.pmid ?? null,
    url: input.resolvedUrl ?? input.canonicalUrl ?? null,
    canonicalUrl: input.canonicalUrl ?? null,
    resolvedUrl: input.resolvedUrl ?? null,
    abstractOrSnippet: null,
    sourceType: null,
    retrievalScore: 1,
    retrievalRank: rank,
    rawArtifactPath: `raw/${input.candidateId}.json`,
    discoveryPaths: [{
      propositionId: input.propositionId,
      queryId: input.queryId,
      query: `${input.queryId} query`,
      provider: "test",
      retrievalRank: rank,
      requestId: `REQ-${input.candidateId}`,
    }],
  };
}

test("canonical documents use PMID, DOI, canonical URL, then resolved URL", () => {
  const pmid = candidate({
    candidateId: "C1", propositionId: "P01", queryId: "Q1",
    pmid: "PMID: 12345", doi: "10.1000/ABC",
    canonicalUrl: "https://journal.test/paper",
  });
  assert.deepEqual(exactDocumentIdentities(pmid).map(({ kind }) => kind), [
    "pmid", "doi", "canonical_url", "resolved_url",
  ]);
  const documents = aggregateCfxCanonicalDocuments([
    { candidate: pmid, targetClaimId: 101 },
  ]);
  assert.equal(documents[0]!.canonicalIdentity.kind, "pmid");
  assert.equal(documents[0]!.canonicalIdentity.value, "12345");
});

test("exact aliases aggregate across propositions and preserve every discovery assignment", () => {
  const rows = [
    { targetClaimId: 101, candidate: candidate({
      candidateId: "C1", propositionId: "P01", queryId: "Q1",
      doi: "10.1000/same",
      canonicalUrl: "https://journal.test/article",
    }) },
    { targetClaimId: 102, candidate: candidate({
      candidateId: "C2", propositionId: "P02", queryId: "Q4",
      doi: "https://doi.org/10.1000/SAME",
      resolvedUrl: "https://mirror.test/article",
    }) },
    { targetClaimId: 102, candidate: candidate({
      candidateId: "C3", propositionId: "P02", queryId: "Q5",
      canonicalUrl: "https://journal.test/article",
    }) },
  ];
  const documents = aggregateCfxCanonicalDocuments(rows);
  assert.equal(documents.length, 1);
  assert.equal(documents[0]!.canonicalIdentity.kind, "doi");
  assert.equal(documents[0]!.discoveryAssignments.length, 3);
  assert.deepEqual(
    documents[0]!.discoveryAssignments.map(({ candidateId }) => candidateId).sort(),
    ["C1", "C2", "C3"],
  );
  assert.deepEqual(
    [...new Set(documents[0]!.discoveryAssignments.map(({ targetClaimId }) => targetClaimId))],
    [101, 102],
  );
});

test("similar titles never merge without an exact shared identity", () => {
  const documents = aggregateCfxCanonicalDocuments([
    { targetClaimId: 1, candidate: candidate({
      candidateId: "C1", propositionId: "P01", queryId: "Q1",
      resolvedUrl: "https://a.test/paper",
    }) },
    { targetClaimId: 2, candidate: candidate({
      candidateId: "C2", propositionId: "P02", queryId: "Q5",
      resolvedUrl: "https://b.test/paper",
    }) },
  ]);
  assert.equal(documents.length, 2);
});

test("a canonical URL and the same normalized resolved URL are one exact document", () => {
  const documents = aggregateCfxCanonicalDocuments([
    { targetClaimId:1,candidate:candidate({
      candidateId:"C1",propositionId:"P01",queryId:"Q1",canonicalUrl:"https://Example.test:443/paper?b=2&a=1#top",
    }) },
    { targetClaimId:2,candidate:candidate({
      candidateId:"C2",propositionId:"P02",queryId:"Q4",resolvedUrl:"https://example.test/paper?a=1&b=2",
    }) },
  ]);
  assert.equal(documents.length, 1);
  assert.equal(documents[0]!.canonicalIdentity.kind, "canonical_url");
  assert.equal(documents[0]!.discoveryAssignments.length, 2);
});
