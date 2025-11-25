// backend/core/aiPipeline.js

import { ClaimExtractor } from "./claimsEngine.js";
import { EvidenceEngine } from "./evidenceEngine.js";

/**
 * Simple character-based chunking with approximate token estimate.
 */
function chunkContentIntoPieces(content, maxCharsPerChunk = 6000) {
  const approxTokensPerChar = 1 / 4;
  const chunks = [];

  let start = 0;
  while (start < content.length) {
    const end = Math.min(start + maxCharsPerChunk, content.length);
    const slice = content.slice(start, end);

    chunks.push({
      text: slice,
      tokenLength: Math.round(slice.length * approxTokensPerChar),
    });

    start = end;
  }

  return chunks;
}

/**
 * High-level AI pipeline for a single content item.
 *
 * NOTE:
 *  - This file must remain PURE logic: no DB calls, no query(),
 *    no inserts — only returns data.
 *
 *  - /routes/analyzeContent.js performs actual DB insertion.
 */
export async function analyzeContentPipeline({
  content,
  testimonials = [],
  includeEvidence = false,
  deps = {},
  cfg = {},
  maxCharsPerChunk = 6000,
}) {
  if (!content || !content.trim()) {
    return {
      generalTopic: "",
      specificTopics: [],
      claims: [],
      testimonials: [],
      claimSourcePicks: [],
      evidenceRefs: [],
      referenceClaimLinks: [],
    };
  }

  console.time("[AI] total");
  console.time("[AI] claim-extraction");

  const llm = deps.llm;
  if (!llm) {
    throw new Error("analyzeContentPipeline: deps.llm is required.");
  }

  const search = deps.search;
  const fetcher = deps.fetcher;
  const storage = deps.storage;

  const chunks = chunkContentIntoPieces(content, maxCharsPerChunk);

  // 1) CLAIM EXTRACTION
  const extractor = new ClaimExtractor(llm);
  const extraction = await extractor.analyzeContent({
    chunks,
    existingTestimonials: testimonials || [],
    maxConcurrency: 3,
  });

  console.timeEnd("[AI] claim-extraction");

  // 2) NO EVIDENCE MODE
  if (
    !includeEvidence ||
    !search ||
    !fetcher ||
    !storage ||
    !Array.isArray(extraction.claims) ||
    extraction.claims.length === 0
  ) {
    return {
      ...extraction,
      claimSourcePicks: [],
      evidenceRefs: [],
      referenceClaimLinks: [], // <-- NEW: explicit always returned
    };
  }

  // 3) EVIDENCE MODE
  console.time("[AI] evidence-phase");

  const evidenceEngine = new EvidenceEngine(
    { llm, search, fetcher, storage },
    cfg
  );

  const claimObjects = extraction.claims.map((text, idx) => ({
    id: `c${idx + 1}`,
    text,
  }));

  // --------------------------
  // PARALLEL EVIDENCE EXECUTION
  // --------------------------
  const maxParallelClaims = cfg.maxParallelClaims || 5;

  async function withTimeout(promise, ms, label) {
    const controller = new AbortController();
    const id = setTimeout(() => {
      controller.abort();
    }, ms);

    try {
      const result = await promise;
      clearTimeout(id);
      return result;
    } catch (err) {
      if (controller.signal.aborted) {
        console.warn(`⏳ [timeout] ${label} exceeded ${ms}ms`);
        return { __tt_timeout: true };
      }
      throw err;
    }
  }
  async function runEvidenceForClaim(claimObj, claimIndex) {
    const label = `claim-${claimIndex}`;
    const TIMEOUT_MS = cfg.evidenceTimeoutMs || 20000; // 20s default
    console.log("DEBUG >>> runEvidenceForClaim START", claimObj.id);

    const result = await withTimeout(
      evidenceEngine.run([claimObj], null, {
        enableInternal: true,
        enableWeb: true,
        topKQueries: cfg?.limits?.queriesPerClaim ?? 6,
        topKCandidates: cfg?.limits?.candidates ?? 12,
        maxEvidencePerDoc: cfg?.limits?.evidencePerDoc ?? 2,
        preferDomains: cfg?.preferDomains || [],
        avoidDomains: cfg?.avoidDomains || [],
        maxCharsPerDoc: cfg?.maxCharsPerDoc ?? 8000,
        enableRedTeam: cfg?.enableRedTeam ?? false,
        maxEvidenceCandidates: cfg?.maxEvidenceCandidates ?? 2,
      }),
      TIMEOUT_MS,
      label
    );

    if (!result || result.__tt_timeout) {
      console.warn(`❌ [evidence] claim ${label} timed out`);
      return []; // return empty, but DO NOT BLOCK pool
    }

    return result;
  }

  // ------------------------------
  // SAFE PARALLEL WORKER POOL
  // with EXTREME LOGGING
  // ------------------------------
  async function runParallelWithLimit(items, worker, limit) {
    console.log(
      `\n⚙️ [worker-pool] Starting evidence run for ${items.length} claims`
    );
    console.log(`⚙️ [worker-pool] Max parallel workers = ${limit}`);
    console.log("DEBUG >>> RUNNING aiPipeline.js FROM SRC <<<");
    const results = new Array(items.length);
    let nextIndex = 0;

    // high-resolution timer
    const now = () => Number(process.hrtime.bigint()) / 1e6; // ms

    async function runWorker(workerId) {
      console.log(`🧵 [worker ${workerId}] started`);

      while (true) {
        const i = nextIndex++;
        if (i >= items.length) {
          console.log(`🧵 [worker ${workerId}] finished (no more items)`);
          break;
        }

        const claimObj = items[i];
        const start = now();
        console.log(
          `🧵 [worker ${workerId}] → Claim #${i} (“${claimObj.text.slice(
            0,
            50
          )}…”) starting`
        );

        try {
          // ⛔ REMOVE nested timeout — worker already handles its own timeout
          const res = await worker(claimObj, i);

          const duration = (now() - start).toFixed(1);

          if (!res) {
            console.warn(
              `⚠️ [worker ${workerId}] Claim #${i} returned EMPTY result (duration ${duration} ms)`
            );
            results[i] = null;
            continue;
          }

          if (Array.isArray(res)) {
            results[i] = res[0] || null;
            console.log(
              `✅ [worker ${workerId}] Claim #${i} completed (array result) in ${duration} ms`
            );
          } else {
            results[i] = res;
            console.log(
              `✅ [worker ${workerId}] Claim #${i} completed (single result) in ${duration} ms`
            );
          }
        } catch (err) {
          const duration = (now() - start).toFixed(1);
          console.error(
            `❌ [worker ${workerId}] ERROR processing claim #${i} after ${duration} ms:\n`,
            err
          );
          results[i] = null;
        }
      }
    }

    // create worker pool
    const workers = [];
    for (let w = 0; w < limit; w++) {
      workers.push(runWorker(w + 1));
    }

    await Promise.all(workers);

    const ok = results.filter(Boolean).length;
    const bad = results.length - ok;

    console.log(
      `\n📊 [worker-pool] Completed all evidence tasks.\n   ✔️ ${ok} ok\n   ❌ ${bad} failed or empty\n`
    );

    return results.filter(Boolean);
  }

  console.time("[AI] evidence-phase");

  const mappingResults = await runParallelWithLimit(
    claimObjects,
    runEvidenceForClaim,
    maxParallelClaims
  );

  console.timeEnd("[AI] total");

  // PRODUCE UI FRIENDLY PICKS
  const claimSourcePicks = mappingResults.map((row) => ({
    claim: row.claim.text,
    sources: (row.candidates || [])
      .filter((c) => c?.url)
      .map((c) => ({
        url: c.url,
        title: c.title,
        stance: row.adjudication?.finalVerdict,
        why: row.adjudication?.rationale,
      })),
  }));

  // PRODUCE RECURSION-FRIENDLY REFERENCES
  const byUrl = new Map();
  for (const row of mappingResults) {
    for (const cand of row.candidates || []) {
      if (!cand?.url) continue;
      const existing = byUrl.get(cand.url);
      if (!existing) {
        byUrl.set(cand.url, {
          url: cand.url,
          content_name: cand.title || cand.url,
          origin: "claim",
          claims: [row.claim.text],
        });
      } else {
        const merged = new Set(existing.claims);
        merged.add(row.claim.text);
        existing.claims = [...merged];
      }
    }
  }

  const evidenceRefs = Array.from(byUrl.values());

  // NEW → EXPLICIT reference → claim link candidates (NO DB INSERTS HERE)
  const referenceClaimLinks = [];

  for (const row of mappingResults) {
    const claimText = row.claim.text;
    const stance = row.adjudication?.finalVerdict || "nuance";
    const rationale = row.adjudication?.rationale || null;

    for (const cand of row.candidates || []) {
      if (!cand.url) continue;

      referenceClaimLinks.push({
        claim_text: claimText,
        reference_url: cand.url,
        reference_title: cand.title || null,
        stance,
        rationale,
        score: cand.score || null,
        evidence_text: cand.snippet || null,
      });
    }
  }

  return {
    ...extraction,
    claimSourcePicks,
    evidenceRefs,
    referenceClaimLinks, // <-- NEW: returned cleanly for the route to insert
  };
}

/**
 * Legacy wrapper — unchanged
 */
export async function analyzeInChunks(content, testimonials) {
  return analyzeContentPipeline({
    content,
    testimonials,
    includeEvidence: false,
  });
}
