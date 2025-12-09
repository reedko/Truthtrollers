// backend/src/core/runEvidenceEngine.js
// --------------------------------------------------------------
// Purpose: Wrap EvidenceEngine.run() so the extension can request it.
//
// INPUT:
//   taskContentId    = numeric content_id of TASK
//   claimIds         = array of claim_id from processTaskClaims()
//   readableText     = original scraped text (optional but useful)
//
// OUTPUT:
//   { aiReferences, evidence, referenceClaimLinks }
//
// No DB writes occur here.
// DB writes happen in persistAIResults().
// --------------------------------------------------------------

import { openAiLLM } from "./openAiLLM.js";
import { tavilySearch } from "./tavilySearch.js";
import { bingSearch } from "./bingSearch.js";
import { EvidenceEngine } from "./evidenceEngine.js";
import { query } from "../db/pool.js";

export async function runEvidenceEngine({
  taskContentId,
  claimIds,
  readableText,
}) {
  console.log("🟣 [runEvidenceEngine] Starting evidence run…");

  if (!taskContentId) throw new Error("Missing taskContentId");
  if (!Array.isArray(claimIds) || claimIds.length === 0)
    throw new Error("No claims passed to EvidenceEngine");

  // Fetch claim text from DB
  const rows = await query(
    `SELECT claim_id, claim_text FROM claims WHERE claim_id IN (?)`,
    [claimIds]
  );

  const claims = rows.map((row) => ({
    id: row.claim_id,
    text: row.claim_text,
  }));

  const engine = new EvidenceEngine(
    {
      llm: openAiLLM,
      search: {
        internal: tavilySearch.internal ?? (() => []),
        web: async (opts) => {
          if (runOptions.searchEngine === "tavily") {
            const start = Date.now();
            const results = await tavilySearch.web(opts);
            const duration = Date.now() - start;
            console.log(
              `⏱️  [BENCHMARK] Tavily search took ${duration}ms for query: "${opts.query}"`
            );
            return results;
          }
          if (runOptions.searchEngine === "bing") {
            const start = Date.now();
            const results = await bingSearch(opts);
            const duration = Date.now() - start;
            console.log(
              `⏱️  [BENCHMARK] Bing search took ${duration}ms for query: "${opts.query}"`
            );
            return results;
          }

          // hybrid
          const startTav = Date.now();
          const startBing = Date.now();
          const [tav, bing] = await Promise.all([
            tavilySearch.web(opts).then((r) => {
              const duration = Date.now() - startTav;
              console.log(
                `⏱️  [BENCHMARK] Tavily (hybrid) took ${duration}ms for query: "${opts.query}"`
              );
              return r;
            }),
            bingSearch(opts).then((r) => {
              const duration = Date.now() - startBing;
              console.log(
                `⏱️  [BENCHMARK] Bing (hybrid) took ${duration}ms for query: "${opts.query}"`
              );
              return r;
            }),
          ]);
          return [...(tav || []), ...(bing || [])];
        },
      },
      fetcher: {
        async getText(cand) {
          try {
            if (cand.text) return cand.text;
            if (!cand.url) return null;
            const resp = await fetch(cand.url);
            return (await resp.text()).slice(0, 50000);
          } catch (err) {
            console.warn("❌ fetcher.getText:", err);
            return null;
          }
        },
      },
    },
    {
      limits: {
        queriesPerClaim: 3,
        candidates: 4,
        evidencePerDoc: 1,
      },
      maxParallelClaims: 3,
      maxCharsPerDoc: 8000,
      preferDomains: [],
      avoidDomains: [],
      enableRedTeam: false,
      maxEvidenceCandidates: 2,
      maxParallelSearches: 4,
    }
  );

  // engine.run(claims, contexts, opt)
  // contexts can be null/undefined if not needed
  const runOptions = {
    enableInternal: true,
    enableWeb: true,
    topKQueries: 6,
    searchEngine: "hybrid",
    topKCandidates: 12,
    maxEvidencePerDoc: 2,
    preferDomains: [],
    avoidDomains: [],
    maxCharsPerDoc: 8000,
    enableRedTeam: false,
    maxEvidenceCandidates: 2,
  };

  const results = await engine.run(claims, null, runOptions);

  // Transform results into persistAIResults format
  // Group evidence by URL to avoid duplicates
  const evidenceByUrl = new Map();

  for (let claimIndex = 0; claimIndex < results.length; claimIndex++) {
    const claimResult = results[claimIndex];
    const evidenceItems = claimResult.evidence || [];

    for (const ev of evidenceItems) {
      if (!ev.url) continue;

      const existing = evidenceByUrl.get(ev.url);
      if (existing) {
        // Add this claim to existing reference
        if (!existing.claims.includes(claimIndex)) {
          existing.claims.push(claimIndex);
        }
        // Keep higher quality stance/summary
        if ((ev.quality || 0) > (existing.quality || 0)) {
          existing.stance = ev.stance;
          existing.why = ev.summary || ev.quote;
          existing.quality = ev.quality;
        }
      } else {
        // New reference
        evidenceByUrl.set(ev.url, {
          url: ev.url,
          title: ev.title || "AI Reference",
          stance: ev.stance,
          why: ev.summary || ev.quote,
          quote: ev.quote,
          claims: [claimIndex],
          quality: ev.quality,
        });
      }
    }
  }

  // Convert to array (remove quality field used for comparison)
  const aiReferences = Array.from(evidenceByUrl.values()).map(
    ({ quality, ...rest }) => rest
  );

  console.log(
    `🟣 [runEvidenceEngine] Returning ${aiReferences.length} AI references`
  );

  return aiReferences;
}
