// backend/src/core/devDeps.ts
// Dev-only adapters for wiring up EvidenceEngine without real OpenAI/search yet.

import { ClaimMappingResult, CandidateDoc } from "./types";
import {
  EngineDeps,
  LLMJson,
  SearchPorts,
  FetcherPort,
  StoragePort,
} from "./ports";

// ───────────────────────────────────────────────────────────────────────────────
// 1) DEV LLM — returns structured JSON based on simple heuristics
//    (so generateQueries / extractEvidence / redTeam all "work" without OpenAI)
// ───────────────────────────────────────────────────────────────────────────────

const DevLLM: LLMJson = {
  async generate<T>({
    system,
    user,
    schemaHint,
  }: {
    system: string;
    user: string;
    schemaHint: string;
    temperature?: number;
  }): Promise<T> {
    // VERY crude routing based on schemaHint / user text.
    // Enough to run smoke tests and see the pipeline shape.

    // Query generation schema
    if (schemaHint.includes(`"queries"`)) {
      const queries = [
        { query: "coffee dehydration randomized trial", intent: "refute" },
        { query: "coffee hydration meta-analysis", intent: "refute" },
        { query: "caffeine diuresis endurance athletes", intent: "nuance" },
      ];
      return { queries } as any as T;
    }

    // Evidence extraction schema
    if (schemaHint.includes(`"items"`)) {
      const items = [
        {
          quote:
            "Coffee contributes to daily fluid intake and does not cause chronic dehydration.",
          stance: "refute",
          summary: "Refutes the claim that coffee causes dehydration.",
          location: { section: "Results" },
        },
        {
          quote:
            "Caffeine has a mild acute diuretic effect in caffeine-naive individuals.",
          stance: "nuance",
          summary:
            "Introduces nuance: short-term diuresis without long-term dehydration.",
          location: { section: "Discussion" },
        },
      ];
      return { items } as any as T;
    }

    // Red-team schema
    if (schemaHint.includes(`"blindspots"`)) {
      return {
        blindspots: ["Limited sample size and specific population."],
        delta_confidence: -0.05,
      } as any as T;
    }

    // Fallback: return an empty-ish object
    return {} as T;
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// 2) DEV Search — returns a couple of fake CandidateDocs
// ───────────────────────────────────────────────────────────────────────────────

const DevSearch: SearchPorts = {
  async internal({ query, topK }) {
    const docs: CandidateDoc[] = [
      {
        id: "int1",
        title: "Hydration meta-analysis",
        url: "https://example.edu/hydration",
        domain: "example.edu",
        snippet: `Meta-analysis on hydration and common beverages: ${query}`,
        score: 95,
        source: "internal_db",
        publishedAt: "2022-01-01",
      },
    ];
    return docs.slice(0, topK);
  },

  async web({ query, topK }) {
    const docs: CandidateDoc[] = [
      {
        id: "web1",
        title: "AP News: Coffee and hydration",
        url: "https://apnews.com/coffee-hydration",
        domain: "apnews.com",
        snippet: `News explainer on coffee and hydration: ${query}`,
        score: 90,
        source: "web_search",
        publishedAt: "2023-02-01",
      },
      {
        id: "web2",
        title: "Random health blog",
        url: "https://clickbait.health/blog",
        domain: "clickbait.health",
        snippet: `Blog claiming coffee totally dehydrates you: ${query}`,
        score: 40,
        source: "web_search",
        publishedAt: "2021-06-01",
      },
    ];
    return docs.slice(0, topK);
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// 3) DEV Fetcher — returns a canned “full text” for any candidate
// ───────────────────────────────────────────────────────────────────────────────

const DevFetcher: FetcherPort = {
  async getText(candidate: CandidateDoc): Promise<string> {
    // You can branch on candidate.id/domain if you want different texts.
    return [
      "Coffee contributes to daily fluid intake and does not cause chronic dehydration.",
      "Caffeine has a mild acute diuretic effect in caffeine-naive individuals.",
      "Overall, regular coffee consumption does not appear to lead to chronic dehydration in healthy adults.",
    ].join("\n\n");
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// 4) DEV Storage — no-op cache + log results
// ───────────────────────────────────────────────────────────────────────────────

const DevStorage: StoragePort = {
  async cacheGet(_key: string): Promise<any | undefined> {
    return undefined; // no cache for now
  },
  async cacheSet(_key: string, _value: any, _ttlSec?: number): Promise<void> {
    // no-op
  },
  async persistResults(results: ClaimMappingResult[]): Promise<void> {
    // For now, just log — later this will write to SQL / Redis / etc.
    console.log("[DevStorage.persistResults] count =", results.length);
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// 5) Export EngineDeps bundle
// ───────────────────────────────────────────────────────────────────────────────

export const DevDeps: EngineDeps = {
  llm: DevLLM,
  search: DevSearch,
  fetcher: DevFetcher,
  storage: DevStorage,
};
