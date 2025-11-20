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
 * Steps:
 * 1) Chunk the content.
 * 2) Use ClaimsEngine (ClaimExtractor) to get topics/claims/testimonials.
 * 3) Optionally use EvidenceEngine to map claims to evidence/verdicts.
 *
 * @param {Object} params
 * @param {string} params.content
 * @param {Array}  [params.testimonials]
 * @param {boolean} [params.includeEvidence] - whether to run evidence mapping
 * @param {Object} [params.deps] - optional overrides for deps (llm, search, fetcher, storage)
 * @param {Object} [params.cfg] - optional config for EvidenceEngine
 * @param {number} [params.maxCharsPerChunk]
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
    };
  }

  console.time("[AI] total");
  console.time("[AI] claim-extraction");
  // 🔑 llm MUST be provided by caller
  const llm = deps.llm;
  if (!llm) {
    throw new Error(
      "analyzeContentPipeline: deps.llm is required but was not provided"
    );
  }
  const search = deps.search;
  const fetcher = deps.fetcher;
  const storage = deps.storage;

  const chunks = chunkContentIntoPieces(content, maxCharsPerChunk);

  // 1) CLAIM EXTRACTION (works for tasks and references)
  const extractor = new ClaimExtractor(llm);
  const extraction = await extractor.analyzeContent({
    chunks,
    existingTestimonials: testimonials || [],
    maxConcurrency: 3,
  });
  // extraction = { generalTopic, specificTopics, claims, testimonials }
  console.timeEnd("[AI] claim-extraction");

  // 2) NO evidence mode → just return claims
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
    };
  }

  // 3) EVIDENCE MODE (tasks ONLY, when includeEvidence=true and deps exist)
  console.time("[AI] evidence-phase");
  const evidenceEngine = new EvidenceEngine(
    { llm, search, fetcher, storage },
    cfg
  );

  const claimObjects = extraction.claims.map((text, idx) => ({
    id: `c${idx + 1}`,
    text,
  }));

  const mappingResults = await evidenceEngine.run(claimObjects, null, {
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
  });

  console.timeEnd("[AI] evidence-phase");
  console.timeEnd("[AI] total");
  // Per-claim picks (for future UI, suggested claim links)
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

  // Flatten into Lit_references-style objects (for recursion)
  const byUrl = new Map();
  for (const row of mappingResults) {
    for (const c of row.candidates || []) {
      if (!c?.url) continue;
      const existing = byUrl.get(c.url);
      if (!existing) {
        byUrl.set(c.url, {
          url: c.url,
          content_name: c.title || c.url,
          origin: "claim",
          claims: [row.claim.text],
        });
      } else {
        const s = new Set([...(existing.claims || []), row.claim.text]);
        existing.claims = [...s];
      }
    }
  }
  const evidenceRefs = Array.from(byUrl.values());

  return {
    ...extraction,
    claimSourcePicks,
    evidenceRefs,
  };
}

/**
 * Backwards-compat wrapper so anything still importing analyzeInChunks keeps working.
 * You can keep this or delete once all imports are moved to analyzeContentPipeline.
 */
export async function analyzeInChunks(content, testimonials) {
  return analyzeContentPipeline({
    content,
    testimonials,
    includeEvidence: false,
  });
}
