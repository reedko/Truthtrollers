/**
 * EXISTING CLAIM EXTRACTION & CHUNKING CODE
 *
 * Consolidated from:
 * - processTaskClaims.js (main orchestrator)
 * - claimsEngine.js (ClaimExtractor class)
 * - localClaimExtraction.js (prompts & helpers)
 *
 * TOTAL LINES: ~950 (key functions for chunking + claim picking)
 *
 * This file extracts the core logic for:
 * 1. Chunking content into 6000-char pieces
 * 2. Extracting claims from each chunk (LLM)
 * 3. Deduplicating & synthesizing across chunks
 * 4. Filtering by quality/bearing
 * 5. Persisting final claims
 */

// ============================================================================
// SECTION 1: CHUNKING (processTaskClaims.js:12-26)
// ============================================================================

export function chunkContentForClaimExtraction(text, maxCharsPerChunk = 6000) {
  const content = String(text || "");
  const chunkSize = Math.max(1, Number(maxCharsPerChunk) || 6000);
  const chunks = [];

  for (let start = 0; start < content.length; start += chunkSize) {
    const chunkText = content.slice(start, start + chunkSize);
    chunks.push({
      text: chunkText,
      tokenLength: Math.round(chunkText.length / 4),
    });
  }

  return chunks;
}

// ============================================================================
// SECTION 2: LOCAL CLAIM EXTRACTION PROMPTS (localClaimExtraction.js:1-200+)
// ============================================================================

const LOCAL_ROLES = new Set([
  "thesis",
  "pillar",
  "evidence",
  "background",
  "opposing_claim",
  "unclear",
]);

const ARTICLE_STANCES = new Set(["endorses", "rejects", "neutral", "unclear"]);

export const LOCAL_CLAIM_EXTRACTION_PROMPT = {
  system: `Extract locally verifiable claims from one article chunk.

Return strict JSON only. Use only the supplied chunk; do not use outside knowledge.
Keep each claim tied to the nearby language that gives it meaning. Do not construct a
document-wide argument hierarchy here.

For each claim return:
- claimText: a complete factual assertion
- localSourceExcerpt: one to three short exact sentences from this chunk that contain the claim
- localRoleSuggestion: thesis | pillar | evidence | background | opposing_claim | unclear
- articleStance: endorses | rejects | neutral | unclear
- namedActors: people or organizations
- namedStudiesOrDocuments: specifically named works, datasets, laws, protocols, or reports
- allegedAction: the alleged act for misconduct/attribution claims
- claimType: booleans for attribution, misconduct, causation, disputed_study, statistical, legal_or_regulatory, background
- thesisCandidate: true only if this chunk expresses a likely article thesis
- pillarCandidate: true only if the claim appears to carry a major part of the article's argument`,
  user: `Extract {{minClaims}} to {{maxClaims}} locally grounded claims.
Return fewer when there aren't that many worthy claims.`,
  parameters: { max_claims: 12 },
};

export const DOCUMENT_SYNTHESIS_PROMPT = {
  system: `Consolidate and organize local claim fragments into one article-level argument map.

CONSOLIDATION IS CRITICAL: The input includes many near-duplicate fragments. Group these
duplicates and return a SINGLE canonical representative for each group. Return claimAssignments
ONLY for canonical claims — omit duplicates entirely from the result.

Identify canonical claims as: claims with distinct substantive content, claims marked as
thesis/pillar/evidence (not generic fragments), and for duplicates, the earliest or most
complete instance.

Return strict JSON only. Do not fact-check and do not use outside knowledge.`,
  user: `STRUCTURED LOCAL CLAIMS:
{{claimsJson}}

TASK: Identify all groups of near-duplicate claims. For each group, select ONE canonical
representative. Return ONLY claimAssignments for canonical claims — omit all duplicates.`,
  parameters: {},
};

// ============================================================================
// SECTION 3: CLAIM NORMALIZATION & DEDUPLICATION (localClaimExtraction.js)
// ============================================================================

export function normalizeLocalClaimRecord(record, context = {}) {
  if (!record || typeof record !== "object") return null;

  const {
    claimText = "",
    localSourceExcerpt = "",
    localRoleSuggestion = "unclear",
    articleStance = "unclear",
    namedActors = [],
    namedStudiesOrDocuments = [],
    allegedAction = "",
    claimType = {},
    thesisCandidate = false,
    pillarCandidate = false,
    confidence = 0,
  } = record;

  const text = String(claimText || "").trim();
  if (!text) return null;

  return {
    claimText: text,
    localSourceExcerpt: String(localSourceExcerpt || "").trim(),
    localRoleSuggestion: String(localRoleSuggestion || "").toLowerCase(),
    articleStance: String(articleStance || "").toLowerCase(),
    namedActors: Array.isArray(namedActors) ? namedActors : [],
    namedStudiesOrDocuments: Array.isArray(namedStudiesOrDocuments)
      ? namedStudiesOrDocuments
      : [],
    allegedAction: String(allegedAction || "").trim(),
    claimType: claimType || {},
    thesisCandidate: Boolean(thesisCandidate),
    pillarCandidate: Boolean(pillarCandidate),
    confidence: Number(confidence) || 0,
    sourceChunkIndex: context.chunkIndex ?? 0,
  };
}

export function dedupeLocalClaimRecords(records = []) {
  if (!Array.isArray(records)) return [];

  const seen = new Set();
  const deduped = [];

  for (const record of records) {
    if (!record || !record.claimText) continue;

    const key = String(record.claimText)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(record);
    }
  }

  return deduped;
}

export function compactRecordsForSynthesis(records = []) {
  return records.map((r) => ({
    claimText: r.claimText,
    localSourceExcerpt: r.localSourceExcerpt,
    localRoleSuggestion: r.localRoleSuggestion,
    articleStance: r.articleStance,
    namedActors: r.namedActors,
    namedStudiesOrDocuments: r.namedStudiesOrDocuments,
    thesisCandidate: r.thesisCandidate,
    pillarCandidate: r.pillarCandidate,
    sourceChunkIndex: r.sourceChunkIndex,
  }));
}

export function applyDocumentSynthesis(deduped, synthesisOut = {}) {
  // Apply synthesis results to deduped claims
  const claimAssignments = Array.isArray(synthesisOut.claimAssignments)
    ? synthesisOut.claimAssignments
    : [];

  const assignmentMap = new Map();
  for (const assignment of claimAssignments) {
    if (assignment.claimText) {
      const key = String(assignment.claimText)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      assignmentMap.set(key, assignment);
    }
  }

  const finalClaims = deduped.map((record) => {
    const key = String(record.claimText)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const assignment = assignmentMap.get(key) || {};

    return {
      claimText: record.claimText,
      finalRole: assignment.finalRole || record.localRoleSuggestion || "unclear",
      articleStance: assignment.articleStance || record.articleStance || "unclear",
      localSourceExcerpt: record.localSourceExcerpt,
      namedActors: record.namedActors,
      namedStudiesOrDocuments: record.namedStudiesOrDocuments,
      thesisLoadScore: assignment.thesisLoadScore ?? null,
      sourceChunkIndex: record.sourceChunkIndex,
    };
  });

  return {
    claims: finalClaims,
    globalThesis: synthesisOut.globalThesis || "",
    globalPillars: Array.isArray(synthesisOut.globalPillars)
      ? synthesisOut.globalPillars
      : [],
    claimRelationships: synthesisOut.claimRelationships || {},
  };
}

// ============================================================================
// SECTION 4: CLAIM EXTRACTOR CLASS (claimsEngine.js:66-825)
// ============================================================================

export class ClaimExtractor {
  constructor(llm, promptManager = null) {
    this.llm = llm; // { generate({ system, user, schemaHint, temperature }) }
    this.promptManager = promptManager; // PromptManager for loading prompts from DB
    this.structuredPromptCache = new Map();
  }

  async loadStructuredPrompt(name, fallback) {
    if (!this.promptManager) return fallback;
    if (!this.structuredPromptCache.has(name)) {
      this.structuredPromptCache.set(
        name,
        this.promptManager.getPrompt(name, fallback)
      );
    }
    return this.structuredPromptCache.get(name);
  }

  // ========================================================================
  // LOCAL CASE CHUNK ANALYSIS (analyzeLocalCaseChunk)
  // ========================================================================
  async analyzeLocalCaseChunk({ chunk, tokenLength, chunkIndex = 0 }) {
    const prompt = await this.loadStructuredPrompt(
      "claim_local_extraction",
      LOCAL_CLAIM_EXTRACTION_PROMPT
    );

    const maxClaims =
      Number(prompt?.parameters?.max_claims || prompt?.parameters?.maxClaims) ||
      12;
    const minClaims = tokenLength > 5000 ? 6 : 5;

    const user = String(prompt.user || LOCAL_CLAIM_EXTRACTION_PROMPT.user)
      .replace(/\{\{minClaims\}\}/g, minClaims)
      .replace(/\{\{maxClaims\}\}/g, maxClaims)
      .replace(/\{\{chunk\}\}/g, chunk);

    const out = await this.llm.generate({
      system: prompt.system || LOCAL_CLAIM_EXTRACTION_PROMPT.system,
      user,
      schemaHint: "",
      temperature: 0.1,
      maxRetries: 1,
      timeout: 60000,
    });

    const rawRecords = Array.isArray(out?.localClaims)
      ? out.localClaims
      : Array.isArray(out?.claims)
      ? out.claims
      : [];

    const localClaims = rawRecords
      .slice(0, maxClaims)
      .map((record, recordIndex) =>
        normalizeLocalClaimRecord(record, {
          chunk,
          chunkIndex,
          recordIndex,
        })
      )
      .filter(Boolean);

    return {
      generalTopic: "",
      specificTopics: [],
      reasoningStack: null,
      claims: localClaims.map((claim) => claim.claimText),
      claimsDetailed: localClaims,
      testimonials: [],
    };
  }

  // ========================================================================
  // CLAIM SYNTHESIS ACROSS CHUNKS (synthesizeCaseClaims)
  // ========================================================================
  async synthesizeCaseClaims(records = []) {
    const deduped = dedupeLocalClaimRecords(records);
    if (!deduped.length) return applyDocumentSynthesis([], {});

    const prompt = await this.loadStructuredPrompt(
      "claim_document_synthesis",
      DOCUMENT_SYNTHESIS_PROMPT
    );

    const user = String(prompt.user || DOCUMENT_SYNTHESIS_PROMPT.user).replace(
      /\{\{claimsJson\}\}/g,
      JSON.stringify(compactRecordsForSynthesis(deduped))
    );

    let out = {};
    try {
      out = await this.llm.generate({
        system: prompt.system || DOCUMENT_SYNTHESIS_PROMPT.system,
        user,
        schemaHint: "",
        temperature: 0,
        maxRetries: 1,
        timeout: 60000,
      });
    } catch (error) {
      console.warn(
        `[ClaimExtractor] Synthesis failed; preserving local metadata: ${error.message}`
      );
    }

    return applyDocumentSynthesis(deduped, out);
  }

  // ========================================================================
  // CLAIM QUALITY FILTERING (filterAndRankClaims)
  // ========================================================================
  async filterAndRankClaims(claims, maxClaims = 5, threshold = 0.6) {
    if (!claims || claims.length === 0) return [];
    if (claims.length <= maxClaims) return claims;

    console.log(
      `[ClaimFilter] Scoring ${claims.length} claims to find top ${maxClaims}...`
    );

    const scoredClaims = [];

    for (const claim of claims) {
      try {
        const system =
          "You are a claim quality evaluator. Return only valid JSON.";

        const user = `
Evaluate this claim for verification worthiness:

CLAIM: "${claim}"

Rate 0.0-1.0 on each dimension:

1. SPECIFICITY: Is this specific and falsifiable?
   - 1.0 = Concrete, verifiable assertion with specifics (numbers, dates, names)
   - 0.5 = Somewhat specific but missing key details
   - 0.0 = Vague, generic, or subjective opinion

2. CONTROVERSY: Would reasonable people dispute this?
   - 1.0 = Genuinely controversial or surprising claim
   - 0.5 = Somewhat debatable
   - 0.0 = Obviously true/false or trivial

3. MATERIALITY: Is this central to the article's main argument?
   - 1.0 = Core thesis or key supporting claim
   - 0.5 = Supporting detail
   - 0.0 = Background context or filler

Return JSON: {"specificity": X, "controversy": Y, "materiality": Z, "reasoning": "brief explanation"}
`.trim();

        const schemaHint =
          '{"specificity":0.0,"controversy":0.0,"materiality":0.0,"reasoning":""}';

        const scores = await this.llm.generate({
          system,
          user,
          schemaHint,
          temperature: 0.1,
        });

        const avgScore =
          ((scores.specificity || 0) +
            (scores.controversy || 0) +
            (scores.materiality || 0)) /
          3;

        scoredClaims.push({
          claim,
          scores: {
            specificity: scores.specificity || 0,
            controversy: scores.controversy || 0,
            materiality: scores.materiality || 0,
            average: avgScore,
          },
          reasoning: scores.reasoning || "",
        });

        console.log(`[ClaimFilter] "${claim.substring(0, 60)}..." → ${avgScore.toFixed(2)}`);
      } catch (err) {
        console.warn(`[ClaimFilter] Failed to score claim: ${err.message}`);
        scoredClaims.push({
          claim,
          scores: {
            specificity: 0.5,
            controversy: 0.5,
            materiality: 0.5,
            average: 0.5,
          },
          reasoning: "Scoring failed",
        });
      }
    }

    // Sort by average score descending
    scoredClaims.sort((a, b) => b.scores.average - a.scores.average);

    // Filter by threshold and cap at maxClaims
    const filtered = scoredClaims
      .filter((sc) => sc.scores.average >= threshold)
      .slice(0, maxClaims);

    console.log(
      `[ClaimFilter] Kept ${filtered.length} high-value claims (threshold: ${threshold})`
    );

    return filtered.map((sc) => sc.claim);
  }

  // ========================================================================
  // FULL CONTENT ANALYSIS (analyzeContent)
  // ========================================================================
  async analyzeContent({
    chunks,
    existingTestimonials = [],
    maxConcurrency = 3,
    extractionMode = "ranked",
    taskClaimsContext = null,
    existingAssertions = [],
    unresolvedTargetContexts = [],
    contentRole = "case",
  }) {
    if (!chunks || chunks.length === 0) {
      return {
        generalTopic: "",
        specificTopics: [],
        claims: [],
        claimsDetailed: [],
        reasoningStack: null,
        testimonials: [],
      };
    }

    const allClaims = [];
    const allDetailedClaims = [];
    let generalTopic = "";
    let specificTopics = [];
    let testimonials = [...existingTestimonials];
    let reasoningStack = null;

    let index = 0;

    const runNext = async () => {
      const i = index++;
      if (i >= chunks.length) return;

      const isFirst = i === 0;
      const chunk = chunks[i];

      const res = await this.analyzeLocalCaseChunk({
        chunk: chunk.text,
        tokenLength: chunk.tokenLength,
        chunkIndex: i,
      });

      if (isFirst) {
        generalTopic = res.generalTopic;
        specificTopics = res.specificTopics;
        testimonials = res.testimonials;
        reasoningStack = res.reasoningStack;
      }

      allClaims.push(...res.claims);
      if (Array.isArray(res.claimsDetailed)) {
        allDetailedClaims.push(...res.claimsDetailed);
      }

      return runNext();
    };

    const workers = [];
    const concurrency = Math.min(maxConcurrency, chunks.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(runNext());
    }

    await Promise.all(workers);

    // Final dedupe across chunks
    const seen = new Set();
    const finalClaims = [];
    for (const c of allClaims) {
      const norm = c.trim().replace(/\s+/g, " ");
      if (norm && !seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        finalClaims.push(norm);
      }
    }

    // Synthesize (for case content only)
    if (contentRole !== "source") {
      const synthesis = await this.synthesizeCaseClaims(allDetailedClaims);
      const roleRank = {
        thesis: 0,
        pillar: 1,
        evidence: 2,
        opposing_claim: 2,
        unclear: 2,
        background: 3,
      };

      const orderedClaims = synthesis.claims
        .slice()
        .sort(
          (a, b) =>
            (roleRank[a.finalRole] ?? 2) - (roleRank[b.finalRole] ?? 2) ||
            Number(b.thesisLoadScore || 0) - Number(a.thesisLoadScore || 0) ||
            Number(a.sourceChunkIndex || 0) - Number(b.sourceChunkIndex || 0)
        );

      return {
        generalTopic,
        specificTopics,
        claims: orderedClaims.map((claim) => claim.claimText),
        claimsDetailed: orderedClaims,
        reasoningStack: {
          thesis: synthesis.globalThesis,
          pillars: synthesis.globalPillars,
          claimRelationships: synthesis.claimRelationships,
        },
        documentSynthesis: synthesis,
        testimonials,
      };
    }

    return {
      generalTopic,
      specificTopics,
      claims: finalClaims,
      claimsDetailed: allDetailedClaims,
      reasoningStack,
      testimonials,
    };
  }
}

// ============================================================================
// SECTION 5: MAIN ORCHESTRATOR (processTaskClaims)
// ============================================================================

export async function processTaskClaims({
  query,
  taskContentId,
  text,
  claimType = "task",
  taskClaimsContext = null,
  existingAssertions = [],
  unresolvedTargetContexts = [],
  clearOldLinks = false,
  extractionMode = null,
  llm,
}) {
  // 1. Chunk content
  const chunks = chunkContentForClaimExtraction(text);
  console.log(
    `📦 Sending ${chunks.length} claim-extraction chunk(s) (max 6000 chars each)`
  );

  // 2. Extract claims from all chunks (in parallel where possible)
  const extractor = new ClaimExtractor(llm, null);
  const contentRole = claimType === "reference" ? "source" : "case";

  const extraction = await extractor.analyzeContent({
    chunks,
    existingTestimonials: [],
    maxConcurrency: 3,
    extractionMode: extractionMode || "ranked",
    taskClaimsContext,
    existingAssertions,
    unresolvedTargetContexts,
    contentRole,
  });

  let claims = extraction.claimsDetailed || extraction.claims || [];
  console.log(`🟩 Extracted ${claims.length} claims`);

  if (claims.length === 0) {
    console.warn(
      `⚠️ [processTaskClaims] No claims extracted! The article text may be:`
    );
    console.warn(`   - Too technical/scientific for claim extraction`);
    console.warn(`   - Missing verifiable factual claims`);
    console.warn(`   - Not properly text-extracted`);
    return [];
  }

  // 3. Filter claims if in comprehensive mode
  if (extractionMode === "comprehensive") {
    console.log(`🟦 [ClaimFiltering] Scoring and filtering claims...`);
    const claimTexts = claims.map((claim) =>
      typeof claim === "string" ? claim : claim?.text || ""
    );
    const filteredTexts = await extractor.filterAndRankClaims(
      claimTexts,
      10, // maxClaims
      0.4 // threshold
    );

    const claimLookup = new Map();
    for (const claim of claims) {
      const key = String(claim?.text || claim || "")
        .trim()
        .toLowerCase();
      if (key && !claimLookup.has(key)) {
        claimLookup.set(key, claim);
      }
    }

    claims = filteredTexts
      .map((text) => claimLookup.get(String(text).trim().toLowerCase()))
      .filter(Boolean);

    console.log(`🟦 [ClaimFiltering] Filtered to ${claims.length} claims`);
  } else {
    console.log(`🟦 [ClaimFiltering] Skipping separate filter (already filtered)`);
  }

  // 4. Return normalized claims
  const normalizedClaims = claims.map((claim) => {
    if (typeof claim === "string") {
      return { text: claim };
    }
    return {
      ...claim,
      id: claim.id || claim.localClaimId || null,
      namedEntities: claim.namedEntities || claim.namedActors || [],
      studiesOrDocuments: claim.studiesOrDocuments || claim.namedStudiesOrDocuments || [],
    };
  });

  return normalizedClaims;
}

// ============================================================================
// END OF CONSOLIDATED CODE
// ============================================================================
