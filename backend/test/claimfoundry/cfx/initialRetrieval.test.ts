import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dedupeCfxCandidates,
  normalizeCfxProviderCandidate,
} from "../../../src/claimfoundry/cfx/retrieval/candidates.js";
import {
  executeCfxRetrieval,
  retrievalRequests,
} from "../../../src/claimfoundry/cfx/retrieval/executeRetrieval.js";
import {
  buildCfxQueryPlanningRequest,
  loadCfxQueryPlanningPrompt,
  mergeCfxQueryPlan,
  pubmedApplicability,
} from "../../../src/claimfoundry/cfx/retrieval/queryPlanning.js";
import {
  validateCfxQueryStrategy,
} from "../../../src/claimfoundry/cfx/retrieval/legacyQueryStrategyAdapter.js";
import {
  compileLiteralPubmedQuery,
} from "../../../src/claimfoundry/cfx/retrieval/pubmedQueryCompiler.js";
import {
  buildCfxInitialRetrievalReportHtml,
} from "../../../src/claimfoundry/cfx/retrieval/report.js";
import {
  CFX_QUERY_PLANNING_JSON_SCHEMA,
} from "../../../src/claimfoundry/cfx/retrieval/schema.js";
import type {
  CfxEvidenceCandidate,
  CfxEvidenceInput,
} from "../../../src/claimfoundry/cfx/retrieval/types.js";

function evidenceInput(index: number): CfxEvidenceInput {
  const propositionId = `P${String(index).padStart(2, "0")}`;
  return {
    propositionId,
    substantiveAssertion:
      `${propositionId} Infants receiving vaccines had higher hospitalization rates.`,
    assertionSource: index === 5
      ? "William Thompson's account"
      : "Statistical data presented in the article",
    articleStance: "adopts",
    groundingUnitIds: ["U0090"],
    groundingText:
      "[U0090]\nAn analysis of U.S. data (1990-2010) concerned infants, vaccines, and hospitalization rates.",
    literalIdentifiers: {
      people: index === 5 ? ["William Thompson"] : [],
      organizations: index === 5 ? ["CDC"] : [],
      laws: [],
      studyTitles: [],
      journals: [],
      years: [],
      dateRanges: ["1990-2010"],
      doi: [],
      pmid: [],
      urls: [],
      citationNumbers: [],
      acronyms: index === 5 ? ["CDC"] : [],
    },
    lookupHints: {
      populations: ["infants"],
      exposures: ["receiving vaccines"],
      outcomes: ["hospitalization rates"],
      interventions: ["vaccines"],
      geography: ["U.S."],
      documentTypes: ["analysis"],
      topics: [],
    },
    deterministicQueries: {
      literalQuery:
        `"${propositionId} Infants receiving vaccines had higher hospitalization rates."`,
      sourceQualifiedQuery: null,
      studyLookupQueries: index === 5
        ? ["William Thompson CDC vaccine hospitalization study"]
        : [
            "\"1990-2010\" infants vaccines hospitalization rates",
          ],
    },
  };
}

function modelOutput() {
  return {
    plans: Array.from({ length: 12 }, (_, index) => {
      const propositionId = `P${String(index + 1).padStart(2, "0")}`;
      return {
        propositionId,
        queries: [{
          queryId: "Q2",
          query: `${propositionId} infants vaccines hospitalization relationship`,
          provider: "pubmed",
          rationale: "Searches the literal predicate and entities.",
        }, {
          queryId: "Q4",
          query: `${propositionId} infants vaccination hospitalization cohort study`,
          provider: "pubmed",
          rationale: "Searches independent biomedical evidence.",
        }, {
          queryId: "Q5",
          query: index % 2 === 0
            ? `${propositionId} infants vaccines hospitalization replication reanalysis`
            : `${propositionId} infants vaccines hospitalization methodological limitations`,
          provider: "pubmed",
          rationale: "Searches material qualifications.",
        }],
      };
    }),
  };
}

test("governed planning prompt and strict schema retain the intended surface", async () => {
  const prompt = await loadCfxQueryPlanningPrompt();
  assert.equal(prompt.promptId, "cfx-initial-query-planning-v1");
  assert.ok(prompt.prompt.includes(
    "The canonical substantive assertions are immutable.",
  ));
  assert.equal(
    CFX_QUERY_PLANNING_JSON_SCHEMA.name,
    "cfx_initial_query_planning_v1",
  );
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const request = buildCfxQueryPlanningRequest({ inputs, prompt });
  assert.equal(request.model, "gpt-4o-mini");
  assert.equal(request.temperature, 0.1);
  assert.equal(request.retryCount, 0);
  assert.equal(request.store, false);
  assert.equal(request.maxOutputTokens, 8_000);
  assert.equal(request.timeoutMs, 180_000);
  assert.equal(request.user.match(/immutableSubstantiveAssertion/g)?.length, 12);
  assert.ok(request.user.includes("Return exactly Q2, Q4, and Q5 for every propositionId."));
});

test("PubMed applicability is literal and records why it fired", () => {
  const applicable = pubmedApplicability(evidenceInput(7));
  assert.equal(applicable.applies, true);
  assert.ok(applicable.reasons.includes(
    "literal_population_exposure_or_intervention_outcome",
  ));
  const nonBiomedical = evidenceInput(7);
  nonBiomedical.lookupHints = {
    populations: [],
    exposures: [],
    outcomes: [],
    interventions: [],
    geography: [],
    documentTypes: ["law"],
    topics: ["liability"],
  };
  nonBiomedical.substantiveAssertion = "A law changed liability.";
  assert.deepEqual(pubmedApplicability(nonBiomedical), {
    applies: false,
    reasons: [],
  });
});

test("PubMed compiler uses anchored literal biomedical components and no evidentiary fluff", () => {
  const input = evidenceInput(7);
  input.substantiveAssertion =
    "The rise in chronic illnesses among children correlates with the increase in the childhood vaccination schedule.";
  input.groundingText = [
    "[U0085]",
    "Baby Boomers described rising chronic illness among U.S. children.",
    "[U0090]",
    "An analysis of U.S. data (1990-2010) showed that infants who received the most vaccines had the worst hospitalization and death rates.",
  ].join("\n");
  input.literalIdentifiers.dateRanges = ["1990-2010"];
  input.lookupHints = {
    populations: ["children", "baby boomer", "infants"],
    exposures: ["received the most vaccines"],
    outcomes: ["chronic illnesses", "hospitalization", "death rates"],
    interventions: ["childhood vaccination schedule", "vaccines"],
    geography: ["U.S."],
    documentTypes: ["analysis"],
    topics: ["chronic illnesses"],
  };
  const q2 = compileLiteralPubmedQuery({
    evidenceInput: input,
    queryId: "Q2",
  });
  const q4 = compileLiteralPubmedQuery({
    evidenceInput: input,
    queryId: "Q4",
  });
  assert.equal(
    q2?.query,
    'infants[Title/Abstract] AND vaccines[Title/Abstract] AND hospitalization[Title/Abstract] AND "1990-2010"[Title/Abstract]',
  );
  assert.equal(
    q4?.query,
    'infants[Title/Abstract] AND vaccines[Title/Abstract] AND (hospitalization[Title/Abstract] OR "death rates"[Title/Abstract])',
  );
  assert.equal(/high-quality|credible studies|research on|evidence on/iu.test(
    `${q2?.query} ${q4?.query}`,
  ), false);
});

test("PubMed compiler rejects article clauses and requires the literal biomedical subject", () => {
  const input = evidenceInput(8);
  input.substantiveAssertion =
    "Aluminum in vaccines is safe and occurs in levels lower than dietary exposure.";
  input.groundingText = [
    "[U0236]",
    "We are exposed to more aluminum by eating a tomato than from getting vaccines!",
    "[U0241]",
    "Folks SHOULD be nervous about aluminum being used in vaccines.",
  ].join("\n");
  input.literalIdentifiers.dateRanges = [];
  input.lookupHints = {
    populations: [],
    exposures: [
      "exposed to more aluminum by eating a tomato than from getting vaccines",
    ],
    outcomes: [],
    interventions: ["aluminum", "vaccines"],
    geography: [],
    documentTypes: [],
    topics: [],
  };
  const compiled = compileLiteralPubmedQuery({
    evidenceInput: input,
    queryId: "Q4",
  });
  assert.equal(
    compiled?.query,
    'aluminum[Title/Abstract] AND vaccines[Title/Abstract] AND ("dietary exposure"[Title/Abstract] OR safe[Title/Abstract])',
  );
  assert.equal(compiled?.query.includes("eating a tomato"), false);
});

test("Q5 policy requires a claim-specific counterevidence or qualification transformation", () => {
  const input = evidenceInput(7);
  const counter = validateCfxQueryStrategy({
    queryId:"Q5",
    query:"infants vaccines hospitalization replication reanalysis",
    evidenceInput:input,
  });
  assert.equal(counter.valid, true);
  const qualification = validateCfxQueryStrategy({
    queryId:"Q5",
    query:"infants vaccines hospitalization methodological limitations",
    evidenceInput:input,
  });
  assert.equal(qualification.valid, true);
  const trivial = validateCfxQueryStrategy({
    queryId:"Q5",
    query:`${input.substantiveAssertion} false`,evidenceInput:input,
  });
  assert.equal(trivial.valid, false);
  assert.ok(trivial.reasons.includes("Q5_TRIVIAL_VERDICT_INVERSION"));
});

test("PubMed Q5 keeps counterevidence purpose distinct through every fallback", () => {
  const input = evidenceInput(7);
  const q4 = compileLiteralPubmedQuery({
    evidenceInput:input,queryId:"Q4",
  })!;
  const q5 = compileLiteralPubmedQuery({
    evidenceInput:input,queryId:"Q5",
  })!;
  assert.notEqual(q5.query, q4.query);
  assert.match(q5.query, /replication\[Title\/Abstract\]/u);
  assert.ok(q5.fallbacks.filter((row) => row.query).every(
    (row) => /replication\[Title\/Abstract\]/u.test(row.query!),
  ));
});

test("hybrid plan freezes Q1/Q3, suppresses generic sources, and caps PubMed at two lanes", () => {
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const before = structuredClone(inputs);
  const plan = mergeCfxQueryPlan({
    inputs,
    sourceEvidenceInputHash: "source-hash",
    modelOutput: modelOutput(),
  });
  assert.deepEqual(inputs, before, "canonical CFX evidence input is immutable");
  assert.equal(plan.propositions.length, 12);
  for (const proposition of plan.propositions) {
    assert.deepEqual(
      proposition.queries.map((query) => query.queryId),
      ["Q1", "Q2", "Q3", "Q4", "Q5"],
    );
    assert.ok(
      proposition.queries.filter((query) => query.provider === "pubmed")
        .length <= 2,
    );
    assert.equal(
      proposition.queries.find((query) => query.queryId === "Q1")?.origin,
      "deterministic",
    );
  }
  const genericQ3 = plan.propositions[0]!.queries.find(
    (query) => query.queryId === "Q3",
  )!;
  assert.equal(genericQ3.query, null);
  assert.equal(genericQ3.missingReason, "NO_USEFUL_LITERAL_SOURCE_IDENTITY");
  assert.equal(
    genericQ3.rationale.includes("Statistical data presented"),
    false,
  );
  const namedQ3 = plan.propositions[4]!.queries.find(
    (query) => query.queryId === "Q3",
  )!;
  assert.equal(
    namedQ3.query,
    "William Thompson CDC vaccine hospitalization study",
  );
  const pubmed = plan.propositions[0]!.queries.find(
    (query) => query.provider === "pubmed",
  )!;
  assert.equal(pubmed.compiledFromLiteralComponents, true);
  assert.ok(pubmed.modelProposedQuery);
  assert.equal(pubmed.query?.includes("[Title/Abstract]"), true);
});

test("frozen F03 PubMed baseline retains successful queries and reviewed PMIDs", async () => {
  const baseline = JSON.parse(await readFile(
    new URL(
      "./fixtures/f03PubmedRetrievalBaseline.json",
      import.meta.url,
    ),
    "utf8",
  )) as {
    sourceArtifactAggregateSha256: string;
    protectedSuccessfulQueries: Array<{
      query: string;
      goodPmidIds: string[];
    }>;
    protectedWebCandidates: Array<{
      query: string;
      url: string;
    }>;
    zeroResultQueries: unknown[];
    reviewedCandidates: Array<{ classification: string }>;
  };
  assert.equal(
    baseline.sourceArtifactAggregateSha256,
    "0b48e1d9db76eaa3ec7b6dd393b4335e0c8b1bc2a2812975317c72f533c6b03d",
  );
  assert.deepEqual(
    baseline.protectedSuccessfulQueries.map((row) => row.query),
    [
      "High-quality evidence on the relationship between vaccination and chronic diseases",
      "Research on the effects of thimerosal in childhood vaccines",
    ],
  );
  assert.equal(
    baseline.protectedSuccessfulQueries.flatMap(
      (row) => row.goodPmidIds,
    ).length,
    5,
  );
  assert.deepEqual(
    baseline.protectedWebCandidates.map(({ query, url }) => ({ query, url })),
    [{
      query: "The CDC manipulated data linking the MMR vaccine to autism",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6768751",
    }],
  );
  assert.equal(baseline.zeroResultQueries.length, 7);
  assert.equal(
    baseline.reviewedCandidates.filter(
      (row) => row.classification === "good",
    ).length,
    5,
  );
  assert.equal(
    baseline.reviewedCandidates.filter(
      (row) => row.classification === "not_good",
    ).length,
    10,
  );
});

test("duplicate compiled PubMed text preserves the independent-evidence lane", () => {
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const input = inputs[8]!;
  input.substantiveAssertion =
    "Thimerosal is not harmful and has been removed from childhood vaccines.";
  input.literalIdentifiers.dateRanges = [];
  input.lookupHints = {
    populations: [],
    exposures: [],
    outcomes: ["autism"],
    interventions: ["thimerosal", "childhood vaccines", "mercury"],
    geography: [],
    documentTypes: [],
    topics: [],
  };
  const output = modelOutput();
  const p09Output = output.plans.find(
    (plan) => plan.propositionId === "P09",
  )!;
  const p09Q5 = p09Output.queries.find((query) => query.queryId === "Q5")!;
  p09Q5.provider = "web";
  p09Q5.query = "thimerosal autism methodological limitations";
  const plan = mergeCfxQueryPlan({
    inputs,
    sourceEvidenceInputHash: "source-hash",
    modelOutput: output,
  });
  const p09 = plan.propositions.find(
    (proposition) => proposition.propositionId === "P09",
  )!;
  const q2 = p09.queries.find(
    (query) => query.queryId === "Q2",
  )!;
  const q4 = p09.queries.find(
    (query) => query.queryId === "Q4",
  )!;
  assert.equal(q2.query, null);
  assert.equal(q2.missingReason, "DUPLICATE_QUERY_TEXT");
  assert.equal(
    q4.query,
    "thimerosal[Title/Abstract] AND autism[Title/Abstract]",
  );
  assert.equal(q4.provider, "pubmed");
});

test("retrieval is bounded, preserves sibling success, and retains raw-response hooks", async () => {
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const plan = mergeCfxQueryPlan({
    inputs,
    sourceEvidenceInputHash: "source-hash",
    modelOutput: modelOutput(),
  });
  const requests = retrievalRequests(plan);
  assert.equal(
    requests.length,
    49,
    "counterevidence and qualification lanes remain distinct from independent evidence",
  );
  assert.ok(requests.every((request) => request.topK === 5));
  const before: string[] = [];
  const after: string[] = [];
  const result = await executeCfxRetrieval({
    plan,
    concurrency: 4,
    transport: {
      async search(request) {
        if (request.requestId === "REQ-P01-Q2") {
          throw new Error("provider unavailable");
        }
        return {
          provider: request.provider,
          providerRequestId: `provider-${request.requestId}`,
          rawResponse: {
            request: request.requestId,
            exactProviderEvidence: true,
          },
          candidates: Array.from({ length: 7 }, (_, index) => ({
            provider: request.provider,
            id: `${request.requestId}-${index}`,
            title: `Candidate ${request.requestId} ${index}`,
            url: `https://example.test/${request.requestId}/${index}`,
            snippet: "Literal provider result.",
          })),
        };
      },
    },
    async beforeRequest(request) {
      before.push(request.requestId);
    },
    async afterResponse(response) {
      after.push(response.request.requestId);
      assert.ok(response.response);
    },
  });
  assert.equal(result.requestCount, 49);
  assert.equal(result.providerFailureCount, 1);
  assert.equal(before.length, 49);
  assert.equal(after.length, 49);
  assert.equal(
    result.outcomes.find(
      (outcome) => outcome.request.requestId === "REQ-P01-Q2",
    )?.status,
    "provider_error",
  );
  assert.ok(result.outcomes.some(
    (outcome) => outcome.status === "completed"
      && outcome.candidates.length === 5,
  ));
});

test("zero-result PubMed execution records and uses the deterministic fallback ladder", async () => {
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const plan = mergeCfxQueryPlan({
    inputs,
    sourceEvidenceInputHash: "source-hash",
    modelOutput: modelOutput(),
  });
  for (const proposition of plan.propositions) {
    for (const query of proposition.queries) {
      if (
        proposition.propositionId !== "P01"
        || query.queryId !== "Q4"
      ) {
        query.query = null;
        query.provider = null;
      }
    }
  }
  const row = plan.propositions[0]!.queries.find(
    (query) => query.queryId === "Q4",
  )!;
  assert.equal(row.provider, "pubmed");
  assert.ok(row.pubmedFallbacks.some((fallback) => fallback.query));
  const calls: string[] = [];
  const result = await executeCfxRetrieval({
    plan,
    concurrency: 1,
    transport: {
      async search(request) {
        calls.push(request.requestId);
        return {
          provider: "pubmed",
          providerRequestId: request.requestId,
          rawResponse: { requestId: request.requestId },
          candidates: calls.length === 1
            ? []
            : [{
                pmid: "12345678",
                title: "Literal biomedical result",
                url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
              }],
        };
      },
    },
  });
  assert.equal(result.requestCount, 1);
  assert.equal(result.providerRequestCount, 2);
  assert.deepEqual(calls, ["REQ-P01-Q4", "REQ-P01-Q4-FB3"]);
  assert.deepEqual(
    result.outcomes[0]!.attempts.map((attempt) => attempt.resultCount),
    [0, 1],
  );
  assert.equal(result.outcomes[0]!.candidates.length, 1);
});

test("candidate normalization and dedupe preserve all discovery paths", () => {
  const request = {
    requestId: "REQ-P05-Q2",
    propositionId: "P05",
    queryId: "Q2" as const,
    query: "CDC MMR autism",
    provider: "web" as const,
    topK: 5 as const,
    pubmedFallbacks: [],
  };
  const first = normalizeCfxProviderCandidate({
    raw: {
      provider: "tavily",
      id: "t-1",
      title: "A Study of MMR Vaccination and Autism",
      url: "https://example.test/study?utm_source=x",
      snippet: "First route",
      academicMetadata: {
        doi: "10.1234/EXAMPLE.1",
        authors: "A Person, B Person",
      },
      publishedAt: "2014",
    },
    request,
    rank: 1,
    rawArtifactPath: "raw-provider-responses/REQ-P05-Q2.json",
  });
  const secondRequest = {
    ...request,
    requestId: "REQ-P05-Q4",
    queryId: "Q4" as const,
    query: "MMR autism cohort study",
  };
  const second = normalizeCfxProviderCandidate({
    raw: {
      provider: "pubmed",
      id: "pubmed:123",
      title: "A Study of MMR Vaccination and Autism",
      url: "https://example.test/study",
      snippet: "Second, more informative discovery route",
      academicMetadata: {
        doi: "10.1234/example.1",
        pmid: "12345678",
      },
      publishedAt: "2014",
    },
    request: secondRequest,
    rank: 2,
    rawArtifactPath: "raw-provider-responses/REQ-P05-Q4.json",
  });
  const result = dedupeCfxCandidates([first, second]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.candidates[0]!.doi, "10.1234/example.1");
  assert.equal(result.candidates[0]!.discoveryPaths.length, 2);
  assert.deepEqual(
    result.candidates[0]!.discoveryPaths.map((path) => path.queryId).sort(),
    ["Q2", "Q4"],
  );
  assert.equal(result.audit[0]!.mergedCandidateIds.length, 2);
});

test("discovery paths never carry an evidence-stance or bearing-relation signal", () => {
  const request = {
    requestId:"REQ-P07-Q5",propositionId:"P07",queryId:"Q5" as const,
    query:"infants vaccines hospitalization replication reanalysis",
    provider:"web" as const,topK:5 as const,pubmedFallbacks:[],
  };
  const candidate = normalizeCfxProviderCandidate({
    raw:{provider:"tavily",title:"A result",url:"https://example.test/result"},
    request,rank:1,rawArtifactPath:"raw.json",
  });
  assert.equal(candidate.discoveryPaths[0]!.queryId, "Q5");
  assert.equal("queryIntent" in candidate.discoveryPaths[0]!, false);
  assert.equal("stance" in candidate, false);
  assert.equal("bearingRelation" in candidate, false);
  assert.equal("stance" in candidate.discoveryPaths[0]!, false);
});

test("review report exposes queries and candidates without automatic bearing or scores", () => {
  const inputs = Array.from({ length: 12 }, (_, index) =>
    evidenceInput(index + 1));
  const plan = mergeCfxQueryPlan({
    inputs,
    sourceEvidenceInputHash: "source-hash",
    modelOutput: modelOutput(),
  });
  const candidate: CfxEvidenceCandidate = {
    candidateId: "CAND-1",
    propositionId: "P01",
    queryId: "Q1",
    provider: "tavily",
    providerRecordId: "one",
    title: "<script>Candidate</script>",
    authors: ["A Person"],
    publication: "Journal",
    publicationDate: "2014",
    doi: null,
    pmid: null,
    url: "https://example.test",
    canonicalUrl: "https://example.test/",
    resolvedUrl: "https://example.test/",
    abstractOrSnippet: "A retrieved snippet.",
    sourceType: "web_search",
    retrievalScore: 0.9,
    retrievalRank: 1,
    rawArtifactPath: "raw.json",
    discoveryPaths: [{
      propositionId: "P01",
      queryId: "Q1",
      query: "query",
      provider: "tavily",
      retrievalRank: 1,
      requestId: "REQ-P01-Q1",
    }],
  };
  const html = buildCfxInitialRetrievalReportHtml({
    runId: "run",
    generatedAt: "2026-07-31T00:00:00.000Z",
    evidenceInputs: inputs,
    queryPlan: plan,
    outcomes: [],
    dedupedCandidates: [candidate],
    dedupeAudit: [],
    accounting: {
      modelRequestCount: 1,
      retrievalRequestCount: 0,
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      modelLatencyMs: 1,
      retrievalLatencyMs: 0,
      estimatedCostUsd: null,
    },
  });
  assert.ok(html.includes("&lt;script&gt;Candidate&lt;/script&gt;"));
  assert.ok(html.includes("No bearing, stance adjudication"));
  assert.equal(html.includes("bearingScore"), false);
  assert.equal(html.includes("sourceQualityScore"), false);
});
