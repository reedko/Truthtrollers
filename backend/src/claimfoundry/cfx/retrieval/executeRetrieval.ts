import {
  createEvidenceRetrievalGateway,
} from "../../../core/evidenceRetrievalGateway.js";
import {
  normalizeCfxProviderCandidate,
} from "./candidates.js";
import type {
  CfxPlannedQuery,
  CfxQueryPlan,
  CfxRetrievalOutcome,
  CfxRetrievalRequest,
  CfxRetrievalTransport,
} from "./types.js";

function requestId(
  propositionId: string,
  queryId: string,
): string {
  return `REQ-${propositionId}-${queryId}`;
}

export function retrievalRequests(
  plan: CfxQueryPlan,
): CfxRetrievalRequest[] {
  return plan.propositions.flatMap((proposition) =>
    proposition.queries.filter(
      (query): query is CfxPlannedQuery & {
        query: string;
        provider: "web" | "pubmed";
      } => Boolean(query.query && query.provider),
    ).map((query) => ({
      requestId: requestId(proposition.propositionId, query.queryId),
      propositionId: proposition.propositionId,
      queryId: query.queryId,
      query: query.query,
      provider: query.provider,
      topK: 5 as const,
      pubmedFallbacks: query.pubmedFallbacks,
    }))
  );
}

export function createCfxGatewayRetrievalTransport(input: {
  webProvider: "tavily" | "brave" | "serpapi" | "bing";
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof globalThis.fetch;
}): CfxRetrievalTransport {
  const gateway = createEvidenceRetrievalGateway({
    config: {
      mode: "single",
      retrievalStrategy: "cost_saver",
      provider: input.webProvider,
      providers: [input.webProvider],
      maxResultsPerQuery: 5,
      maxProvidersPerTarget: 1,
      providerEnabled: {
        [input.webProvider]: true,
        pubmed: true,
      },
    },
    env: input.env ?? process.env,
    fetchImpl: input.fetchImpl ?? globalThis.fetch,
  });
  return {
    async search(request) {
      const selectedProvider =
        request.provider === "pubmed" ? "pubmed" : input.webProvider;
      const response = await gateway.web({
        query: request.query,
        topK: request.topK,
        onlyProviders: [selectedProvider],
        returnDiagnostics: true,
      });
      const results = Array.isArray(response)
        ? response
        : Array.isArray(response?.results)
          ? response.results
          : [];
      return {
        provider: selectedProvider,
        providerRequestId: null,
        rawResponse: response,
        candidates: results,
      };
    },
  };
}

async function workers<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await work(items[index]!, index);
      }
    },
  ));
  return results;
}

export async function executeCfxRetrieval(input: {
  plan: CfxQueryPlan;
  transport: CfxRetrievalTransport;
  concurrency?: number;
  beforeRequest?: (request: CfxRetrievalRequest) => Promise<void>;
  afterResponse?: (input: {
    request: CfxRetrievalRequest;
    response: unknown;
    provider: string;
    providerRequestId: string | null;
    latencyMs: number;
  }) => Promise<void>;
}): Promise<{
  outcomes: CfxRetrievalOutcome[];
  requestCount: number;
  providerRequestCount: number;
  providerFailureCount: number;
}> {
  const requests = retrievalRequests(input.plan);
  const outcomes = await workers(
    requests,
    input.concurrency ?? 4,
    async (request): Promise<CfxRetrievalOutcome> => {
      const descriptors = [
        { step: 1 as const, query: request.query },
        ...(request.provider === "pubmed"
          ? request.pubmedFallbacks.filter(
              (fallback): fallback is typeof fallback & { query: string } =>
                Boolean(fallback.query),
            ).map((fallback) => ({
              step: fallback.step,
              query: fallback.query,
            }))
          : []),
      ];
      const attempts: CfxRetrievalOutcome["attempts"] = [];
      let totalLatencyMs = 0;
      for (const descriptor of descriptors) {
        const attemptRequest: CfxRetrievalRequest = {
          ...request,
          requestId: descriptor.step === 1
            ? request.requestId
            : `${request.requestId}-FB${descriptor.step}`,
          query: descriptor.query,
          pubmedFallbacks: [],
        };
        await input.beforeRequest?.(attemptRequest);
        const startedAt = Date.now();
        const rawArtifactPath =
          `raw-provider-responses/${attemptRequest.requestId}.json`;
        try {
          const response = await input.transport.search(attemptRequest);
          const latencyMs = Date.now() - startedAt;
          totalLatencyMs += latencyMs;
          const rawCandidates = response.candidates.slice(0, 5);
          attempts.push({
            requestId: attemptRequest.requestId,
            step: descriptor.step,
            query: descriptor.query,
            status: "completed",
            resultCount: rawCandidates.length,
            latencyMs,
            error: null,
          });
          await input.afterResponse?.({
            request: attemptRequest,
            response: response.rawResponse,
            provider: response.provider,
            providerRequestId: response.providerRequestId,
            latencyMs,
          });
          if (
            rawCandidates.length > 0
            || attemptRequest.provider !== "pubmed"
            || descriptor === descriptors.at(-1)
          ) {
            return {
              request: attemptRequest,
              status: "completed",
              provider: response.provider,
              providerRequestId: response.providerRequestId,
              latencyMs: totalLatencyMs,
              rawResponse: response.rawResponse,
              candidates: rawCandidates.map((raw, index) =>
                normalizeCfxProviderCandidate({
                  raw,
                  request: attemptRequest,
                  rank: index + 1,
                  rawArtifactPath,
                })
              ),
              error: null,
              attempts,
            };
          }
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          totalLatencyMs += latencyMs;
          const detail = {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          };
          attempts.push({
            requestId: attemptRequest.requestId,
            step: descriptor.step,
            query: descriptor.query,
            status: "provider_error",
            resultCount: 0,
            latencyMs,
            error: detail,
          });
          await input.afterResponse?.({
            request: attemptRequest,
            response: { providerError: detail },
            provider: attemptRequest.provider,
            providerRequestId: null,
            latencyMs,
          });
          return {
            request: attemptRequest,
            status: "provider_error",
            provider: attemptRequest.provider,
            providerRequestId: null,
            latencyMs: totalLatencyMs,
            rawResponse: { providerError: detail },
            candidates: [],
            error: detail,
            attempts,
          };
        }
      }
      throw new Error(`No retrieval attempt executed for ${request.requestId}`);
    },
  );
  return {
    outcomes,
    requestCount: outcomes.length,
    providerRequestCount: outcomes.reduce(
      (sum, outcome) => sum + outcome.attempts.length,
      0,
    ),
    providerFailureCount: outcomes.filter(
      (outcome) => outcome.status === "provider_error",
    ).length,
  };
}
