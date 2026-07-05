import assert from "node:assert/strict";
import test from "node:test";

import { createEvidenceRetrievalGateway } from "../../src/core/evidenceRetrievalGateway.js";
import { normalizeSearchGatewayConfig } from "../../src/core/searchGatewayConfig.js";

const silentLog = { log() {}, warn() {}, error() {} };

test("gateway preserves the established Tavily candidate contract and adds metadata", async () => {
  const gateway = createEvidenceRetrievalGateway({
    config: {
      mode: "single",
      provider: "tavily",
      retrievalStrategy: "cost_saver",
      providerEnabled: { tavily: true },
    },
    providers: {
      tavily: async () => [{
        id: "t-1",
        url: "https://example.org/study",
        title: "Study",
        content: "Bearing snippet",
        score: 0.75,
        published_date: "2024-01-01",
      }],
    },
    log: silentLog,
  });
  const [result] = await gateway.web({ query: "target query", topK: 10, prefer: [], avoid: [] });
  assert.equal(result.id, "t-1");
  assert.equal(result.url, "https://example.org/study");
  assert.equal(result.title, "Study");
  assert.equal(result.snippet, "Bearing snippet");
  assert.equal(result.score, 0.75);
  assert.equal(result.source, "web_search");
  assert.equal(result.provider, "tavily");
  assert.equal(result.providerRank, 1);
  assert.equal(result.providerMetadata.provider, "tavily");
});

test("best-bearing-pool searches enabled providers before returning a deduped pool", async () => {
  const calls = [];
  const gateway = createEvidenceRetrievalGateway({
    config: {
      mode: "single",
      retrievalStrategy: "best_bearing_pool",
      providers: ["tavily", "brave", "serpapi"],
      providerEnabled: { tavily: true, brave: true, serpapi: true },
    },
    providers: {
      tavily: async () => { calls.push("tavily"); return [{ url: "https://example.org/report?utm_source=t", title: "T", content: "T" }]; },
      brave: async () => { calls.push("brave"); return [{ url: "https://example.org/report", title: "B", description: "B" }]; },
      serpapi: async () => { calls.push("serpapi"); return [{ link: "https://example.net/primary", title: "S", snippet: "S" }]; },
    },
    log: silentLog,
  });
  const results = await gateway.web({ query: "William Thompson CDC manipulation", topK: 10 });
  assert.deepEqual(calls.sort(), ["brave", "serpapi", "tavily"]);
  assert.equal(results.length, 2);
  const duplicate = results.find((item) => item.canonicalUrl === "https://example.org/report");
  assert.deepEqual(duplicate.providersSeen.sort(), ["brave", "tavily"]);
  assert.deepEqual(duplicate.discoveryRoutes, ["web_search"]);
  assert.deepEqual(duplicate.snippetVariants.map((item) => item.provider).sort(), ["brave", "tavily"]);
  assert.ok(duplicate.snippetVariants.some((item) => item.snippet === "B"));
  assert.ok(duplicate.snippetVariants.some((item) => item.snippet === "T"));
});

test("fallback mode survives provider failure and uses the next provider", async () => {
  const gateway = createEvidenceRetrievalGateway({
    config: {
      mode: "fallback",
      provider: "tavily",
      fallbacks: ["brave"],
      retrievalStrategy: "cost_saver",
      providerEnabled: { tavily: true, brave: true },
    },
    providers: {
      tavily: async () => { throw new Error("down"); },
      brave: async () => [{ url: "https://example.org/fallback", title: "Fallback", description: "usable" }],
    },
    log: silentLog,
  });
  const results = await gateway.web({ query: "query" });
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, "brave");
});

test("bibliographic onlyProviders excludes general web engines", async () => {
  const calls = [];
  const providers = Object.fromEntries(
    ["tavily", "brave", "pubmed", "crossref", "openalex"].map((provider) => [
      provider,
      async () => { calls.push(provider); return []; },
    ]),
  );
  const gateway = createEvidenceRetrievalGateway({
    config: {
      retrievalStrategy: "best_bearing_pool",
      providers: ["tavily", "brave"],
      providerEnabled: { tavily: true, brave: true, pubmed: true, crossref: true, openalex: true },
    },
    providers,
    log: silentLog,
  });
  await gateway.web({
    query: "2004 MMR autism William Thompson Pediatrics",
    onlyProviders: ["pubmed", "crossref", "openalex"],
  });
  assert.deepEqual(calls.sort(), ["crossref", "openalex", "pubmed"]);
});

test("new retrieval defaults are best-bearing-pool with five assertions", () => {
  const config = normalizeSearchGatewayConfig({}, {});
  assert.equal(config.retrievalStrategy, "best_bearing_pool");
  assert.equal(config.minHighBearingClaimsPerTarget, 5);
  assert.equal(config.providerEnabled.tavily, true);
  assert.equal(config.providerEnabled.brave, false);
  assert.equal(config.providerEnabled.serpapi, false);
});

test("legacy Serper settings transparently use the SerpApi Google endpoint", async () => {
  let requestedUrl = "";
  const gateway = createEvidenceRetrievalGateway({
    config: {
      mode: "single",
      provider: "serper",
      providers: ["serper"],
      retrievalStrategy: "cost_saver",
      providerEnabled: { serper: true },
    },
    env: { SERPAPI_API_KEY: "test-key" },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        async json() {
          return { organic_results: [{ link: "https://example.org/result", title: "Result", snippet: "Bearing result" }] };
        },
      };
    },
    log: silentLog,
  });

  const [result] = await gateway.web({ query: "William Thompson CDC", topK: 7 });
  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://serpapi.com/search");
  assert.equal(url.searchParams.get("engine"), "google");
  assert.equal(url.searchParams.get("q"), "William Thompson CDC");
  assert.equal(url.searchParams.get("num"), "7");
  assert.equal(url.searchParams.get("api_key"), "test-key");
  assert.equal(result.provider, "serpapi");
  assert.equal(result.snippet, "Bearing result");
});
