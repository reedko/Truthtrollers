// backend/core/claims.js

import PromptManager from "./promptManager.js";
import {
  LOCAL_CLAIM_EXTRACTION_PROMPT,
  DOCUMENT_SYNTHESIS_PROMPT,
  normalizeLocalClaimRecord,
  dedupeLocalClaimRecords,
  compactRecordsForSynthesis,
  applyDocumentSynthesis,
} from "./localClaimExtraction.js";

function normalizeClaimKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stringArray(value, limit = 12) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit)
    : [];
}

function fillPromptTemplate(template, values = {}) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

export function normalizeSearchAssertions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const assertion = String(entry.assertion || entry.text || entry.claim || "").trim();
    const query = String(entry.query || entry.searchQuery || entry.search_query || "").trim();
    if (!assertion && !query) return null;
    return {
      id: String(entry.id || entry.assertionId || entry.assertion_id || `search-assertion-${index + 1}`),
      assertion,
      query,
      derivedFromClaimText: String(
        entry.derivedFromClaimText || entry.derived_from_claim_text || "",
      ).trim(),
      searchIntent: String(entry.searchIntent || entry.search_intent || "both").trim().toLowerCase(),
      priority: String(entry.priority || "medium").trim().toLowerCase(),
      mustIncludeTerms: stringArray(entry.mustIncludeTerms || entry.must_include_terms),
      optionalTerms: stringArray(entry.optionalTerms || entry.optional_terms),
      entityFocus: stringArray(entry.entityFocus || entry.entity_focus),
      dateFocus: stringArray(entry.dateFocus || entry.date_focus),
      reasonForSearch: String(entry.reasonForSearch || entry.reason_for_search || entry.reason || "")
        .trim()
        .slice(0, 500),
    };
  }).filter(Boolean);
}

function assertionsForClaim(searchAssertions, claim) {
  const claimKeys = new Set([
    claim?.id,
    claim?.text,
  ].map(normalizeClaimKey).filter(Boolean));
  return searchAssertions.filter((assertion) => {
    const derivedKey = normalizeClaimKey(assertion.derivedFromClaimText);
    const assertionKey = normalizeClaimKey(assertion.assertion);
    return (derivedKey && claimKeys.has(derivedKey)) || (assertionKey && claimKeys.has(assertionKey));
  });
}

export class ClaimExtractor {
  constructor(llm, query = null) {
    this.llm = llm; // expects { generate({ system, user, schemaHint, temperature }) }
    this.query = query; // database query function for fetching prompts
    this.promptManager = query ? new PromptManager(query) : null;
    this.structuredPromptCache = new Map();
  }

  async loadStructuredPrompt(name, fallback) {
    if (!this.promptManager) return fallback;
    if (!this.structuredPromptCache.has(name)) {
      this.structuredPromptCache.set(name, this.promptManager.getPrompt(name, fallback));
    }
    return this.structuredPromptCache.get(name);
  }

  async analyzeLocalCaseChunk({ chunk, tokenLength, chunkIndex = 0 }) {
    const prompt = await this.loadStructuredPrompt(
      "claim_local_extraction",
      LOCAL_CLAIM_EXTRACTION_PROMPT,
    );
    const maxClaims = Number(prompt?.parameters?.max_claims || prompt?.parameters?.maxClaims) || 12;
    const minClaims = tokenLength > 5000 ? 6 : 5;
    const user = fillPromptTemplate(prompt.user || LOCAL_CLAIM_EXTRACTION_PROMPT.user, {
      minClaims,
      maxClaims,
      chunk,
    });
    const out = await this.llm.generate({
      system: prompt.system || LOCAL_CLAIM_EXTRACTION_PROMPT.system,
      user,
      schemaHint: "",
      temperature: 0.1,
      maxRetries: 1,
      timeout: 60000,
    });
    const rawRecords = Array.isArray(out?.localClaims) ? out.localClaims
      : Array.isArray(out?.claims) ? out.claims
      : [];
    const localClaims = rawRecords
      .slice(0, maxClaims)
      .map((record, recordIndex) => normalizeLocalClaimRecord(record, {
        chunk,
        chunkIndex,
        recordIndex,
      }))
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

  async synthesizeCaseClaims(records = []) {
    const deduped = dedupeLocalClaimRecords(records);
    if (!deduped.length) return applyDocumentSynthesis([], {});
    const prompt = await this.loadStructuredPrompt(
      "claim_document_synthesis",
      DOCUMENT_SYNTHESIS_PROMPT,
    );
    const user = fillPromptTemplate(prompt.user || DOCUMENT_SYNTHESIS_PROMPT.user, {
      claimsJson: JSON.stringify(compactRecordsForSynthesis(deduped)),
    });
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
      console.warn(`[ClaimExtractor] Structured document synthesis failed; preserving local metadata: ${error.message}`);
    }
    return applyDocumentSynthesis(deduped, out);
  }

  /**
   * Load claim extraction prompts from database with fallback to legacy prompt names.
   *
   * New preferred family:
   *   - claim_extraction_stack_system
   *   - claim_extraction_stack_with_topics
   *   - claim_extraction_stack_no_topics
   *
   * Legacy fallback:
   *   - claim_extraction_{edge|ranked|comprehensive}_*
   *   - claim_extraction_edge_for_source_*
   */
  async loadClaimExtractionPrompts(
    extractionMode,
    includeTopicsAndTestimonials,
    minClaims,
    maxClaims,
    contentRole = 'case'
  ) {
    if (!this.promptManager) {
      throw new Error('[ClaimExtractor] PromptManager is required - all prompts must be loaded from database');
    }

    const mode = ['edge', 'ranked', 'comprehensive'].includes(extractionMode)
      ? extractionMode
      : 'ranked';
    const role = contentRole === 'source' ? 'source' : 'case';
    const topicSuffix = includeTopicsAndTestimonials ? '_with_topics' : '_no_topics';

    const replaceTokens = (text) =>
      String(text || '')
        .replace(/\{\{minClaims\}\}/g, minClaims)
        .replace(/\{\{maxClaims\}\}/g, maxClaims)
        .replace(/\{\{extractionMode\}\}/g, mode)
        .replace(/\{\{contentRole\}\}/g, role);

    const loadFirstAvailable = async (candidateNames, label) => {
      let lastErr = null;
      for (const name of candidateNames) {
        try {
          const prompt = await this.promptManager.getPrompt(name);
          return { prompt, name };
        } catch (err) {
          lastErr = err;
        }
      }
      throw new Error(
        `[ClaimExtractor] Could not load ${label} prompt. Tried: ${candidateNames.join(', ')}. Last error: ${lastErr?.message || 'unknown'}`
      );
    };

    const preferredSystemNames = [
      'claim_extraction_stack_system',
    ];

    const preferredUserNames = [
      `claim_extraction_stack${topicSuffix}`,
    ];

    const legacySystemNames = [
      role === 'source' && mode === 'edge'
        ? 'claim_extraction_edge_for_source_system'
        : null,
      mode === 'edge'
        ? 'claim_extraction_edge_system'
        : 'claim_extraction_ranked_system',
    ].filter(Boolean);

    const legacyUserNames = [
      role === 'source' && mode === 'edge'
        ? `claim_extraction_edge_for_source${topicSuffix}`
        : null,
      role === 'source' && mode !== 'edge'
        ? `claim_extraction_${mode}_for_source${topicSuffix}`
        : null,
      mode === 'edge'
        ? `claim_extraction_edge${topicSuffix}`
        : `claim_extraction_${mode}${topicSuffix}`,
      mode === 'comprehensive'
        ? `claim_extraction_comprehensive${topicSuffix}`
        : null,
    ].filter(Boolean);

    try {
      const systemPrompt =
        await loadFirstAvailable(
          preferredSystemNames.concat(legacySystemNames),
          `${role} system`
        );
      const userPrompt =
        await loadFirstAvailable(
          preferredUserNames.concat(legacyUserNames),
          `${role} user`
        );

      const systemText = replaceTokens(systemPrompt.prompt.system);
      const userText = replaceTokens(userPrompt.prompt.user);

      console.log(
        `✅ [ClaimExtractor] Loaded ${mode} ${role} prompts: ${systemPrompt.name} + ${userPrompt.name}`
      );

      return {
        system: systemText,
        user: userText,
        parameters: {
          ...systemPrompt.prompt.parameters,
          ...userPrompt.prompt.parameters,
          minClaims,
          maxClaims,
          min_claims: minClaims,
          max_claims: maxClaims,
          extractionMode: mode,
          contentRole: role,
        },
      };
    } catch (err) {
      console.error(`❌ [ClaimExtractor] Error loading prompts from database:`, err.message);
      throw err;
    }
  }

  /**
   * Score and filter claims by importance
   * Returns only high-value claims worth verifying
   */
  async filterAndRankClaims(claims, maxClaims = 5, threshold = 0.6) {
    if (!claims || claims.length === 0) return [];
    if (claims.length <= maxClaims) return claims; // No need to filter

    console.log(`[ClaimFilter] Scoring ${claims.length} claims to find top ${maxClaims}...`);

    const scoredClaims = [];

    // Score claims in batches to avoid rate limits
    for (const claim of claims) {
      try {
        const system = "You are a claim quality evaluator. Return only valid JSON.";

        const user = `
Evaluate this claim for verification worthiness:

CLAIM: "${claim}"

Rate 0.0-1.0 on each dimension:

1. SPECIFICITY: Is this specific and falsifiable? (NOT vague like "there was a study")
   - 1.0 = Concrete, verifiable assertion with specifics (numbers, dates, names)
   - 0.5 = Somewhat specific but missing key details
   - 0.0 = Vague, generic, or subjective opinion

2. CONTROVERSY: Would reasonable people dispute this? Is it worth checking?
   - 1.0 = Genuinely controversial or surprising claim
   - 0.5 = Somewhat debatable
   - 0.0 = Obviously true/false or trivial

3. MATERIALITY: Is this central to the article's main argument?
   - 1.0 = Core thesis or key supporting claim
   - 0.5 = Supporting detail
   - 0.0 = Background context or filler

Return JSON: {"specificity": X, "controversy": Y, "materiality": Z, "reasoning": "brief explanation"}
`.trim();

        const schemaHint = '{"specificity":0.0,"controversy":0.0,"materiality":0.0,"reasoning":""}';

        const scores = await this.llm.generate({
          system,
          user,
          schemaHint,
          temperature: 0.1,
        });

        const avgScore = (
          (scores.specificity || 0) +
          (scores.controversy || 0) +
          (scores.materiality || 0)
        ) / 3;

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
        // If scoring fails, give it a neutral score
        scoredClaims.push({
          claim,
          scores: { specificity: 0.5, controversy: 0.5, materiality: 0.5, average: 0.5 },
          reasoning: "Scoring failed",
        });
      }
    }

    // Sort by average score descending
    scoredClaims.sort((a, b) => b.scores.average - a.scores.average);

    // Filter by threshold and cap at maxClaims
    const filtered = scoredClaims
      .filter(sc => sc.scores.average >= threshold)
      .slice(0, maxClaims);

    console.log(`[ClaimFilter] Kept ${filtered.length} high-value claims (threshold: ${threshold})`);
    filtered.forEach((sc, i) => {
      console.log(`  ${i + 1}. [${sc.scores.average.toFixed(2)}] ${sc.claim.substring(0, 80)}...`);
    });

    return filtered.map(sc => sc.claim);
  }

  async analyzeChunk({
    chunk,
    tokenLength,
    includeTopicsAndTestimonials = false,
    incomingTestimonials,
    extractionMode = 'ranked', // 'ranked' = top quality only, 'comprehensive' = extract all for user ranking
    taskClaimsContext = null,   // array of task claim strings for context-aware reference extraction
    existingAssertions = [],
    unresolvedTargetContexts = [],
    contentRole = 'case',
    chunkIndex = 0,
  }) {
    if (contentRole !== "source") {
      return this.analyzeLocalCaseChunk({ chunk, tokenLength, chunkIndex });
    }

    // Load prompts first to get max_claims from database
    const promptPreview = await this.loadClaimExtractionPrompts(
      extractionMode,
      includeTopicsAndTestimonials,
      5, // temporary minClaims for loading
      12, // temporary maxClaims for loading
      contentRole
    );

    // Get max_claims from database (default to 12 if not set)
    const dbMaxClaims =
      promptPreview.parameters?.max_claims ||
      promptPreview.parameters?.maxClaims ||
      12;

    // Set minClaims based on article length (same logic as before)
    let minClaims;
    if (tokenLength > 9000) {
      minClaims = 8;
    } else if (tokenLength > 5000) {
      minClaims = 6;
    } else {
      minClaims = 5;
    }

    // maxClaims comes from database
    const maxClaims = dbMaxClaims;

    const testimonialsText =
      includeTopicsAndTestimonials &&
      incomingTestimonials &&
      incomingTestimonials.length > 0
        ? `Below is a list of testimonials detected elsewhere. Deduplicate or improve them if they also appear in this text.\n\nExtracted testimonials:\n${JSON.stringify(
            incomingTestimonials
          )}\n`
        : "";

    // ========================================
    // LOAD PROMPTS (from DB or fallback to hardcoded)
    // ========================================
    const prompts = await this.loadClaimExtractionPrompts(
      extractionMode,
      includeTopicsAndTestimonials,
      minClaims,
      maxClaims,
      contentRole
    );

    const system = prompts.system;
    const tasks = prompts.user;

    // When extracting from a reference, use task claims as GUIDANCE for prioritization,
    // not as a filter. Still extract ALL worthy factual claims from the reference.
    const buildTaskClaimsText = () =>
      taskClaimsContext.map((c, i) => `  ${i + 1}. "${c}"`).join('\n');

    const fallbackTaskClaimsInstruction = `
⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:
{{taskClaims}}

⚠️ DO NOT extract the above SOURCE claims themselves.

EXTRACTION INSTRUCTIONS:
1) Extract factual claims from the TEXT BELOW following the standard criteria (materiality, verifiability, specificity).

2) PRIORITIZE claims that:
   - Directly support, contradict, refute, or respond to the SOURCE claims above
   - Provide counter-arguments, rebuttals, or alternative perspectives
   - Include expert opinions or commentary about those specific topics
   → These responsive statements should be ranked HIGHER than general background claims

3) STILL EXTRACT general factual claims even if they don't directly address SOURCE claims:
   - Extract background claims with concrete data (numbers, percentages, dates)
   - Extract relevant factual context about the topic
   - These general claims are LOWER PRIORITY but should still be included if they meet quality criteria

4) Extract responsive statements EVEN IF they are argumentative or evaluative rather than purely factual.

→ Extract ALL worthy claims, but RANK responsive claims higher than general background.
→ ONLY extract NEW statements from the TEXT below, NOT the SOURCE claims listed above.

`;

    let taskClaimsInstruction = "";
    if (unresolvedTargetContexts && unresolvedTargetContexts.length > 0) {
      const fallbackUnresolvedInstruction = `
The evidence engine already preserved the assertions listed under ALREADY CAPTURED.

UNRESOLVED EVALUATION TARGETS:
{{unresolvedTargets}}

ALREADY CAPTURED — DO NOT RE-EXTRACT OR PARAPHRASE:
{{existingAssertions}}

Extract ONLY additional, distinct assertions from the source text that directly
address one of the unresolved targets. Do not extract general background,
topic-adjacent facts, or assertions relevant only to other case claims. Return
no claims if the text contains no additional target-bearing assertion.`;
      let template = fallbackUnresolvedInstruction;
      try {
        const prompt = await this.promptManager.getPrompt(
          'claim_extraction_unresolved_targets_instruction',
          { system: '', user: fallbackUnresolvedInstruction, parameters: {} }
        );
        template = prompt.user || prompt.system || fallbackUnresolvedInstruction;
      } catch {
        template = fallbackUnresolvedInstruction;
      }
      const targetText = unresolvedTargetContexts.map((target, index) =>
        `${index + 1}. [claim ${target.taskClaimId}, target ${target.evaluationTargetId}, ${target.evaluationTargetType || 'unknown'}] ${target.targetText || ''}`
      ).join('\n');
      const capturedText = (existingAssertions || []).slice(0, 20).map((assertion, index) =>
        `${index + 1}. ${String(assertion).slice(0, 500)}`
      ).join('\n') || '(none)';
      taskClaimsInstruction = template
        .replace(/\{\{unresolvedTargets\}\}/g, targetText)
        .replace(/\{\{existingAssertions\}\}/g, capturedText);
    } else if (taskClaimsContext && taskClaimsContext.length > 0) {
      let template = fallbackTaskClaimsInstruction;
      try {
        const contextPrompt = await this.promptManager.getPrompt(
          'claim_extraction_source_context_instruction',
          { system: '', user: fallbackTaskClaimsInstruction, parameters: {} }
        );
        template = contextPrompt.user || contextPrompt.system || fallbackTaskClaimsInstruction;
      } catch {
        template = fallbackTaskClaimsInstruction;
      }
      taskClaimsInstruction = template.replace(/\{\{taskClaims\}\}/g, buildTaskClaimsText());
    }

    if (taskClaimsInstruction) {
      const contextCount = unresolvedTargetContexts?.length || taskClaimsContext?.length || 0;
      console.log(`🎯 [ClaimExtractor] Context-aware instruction built (${contextCount} targets/claims):`);
      console.log(taskClaimsInstruction);
      console.log(`📄 [ClaimExtractor] Processing ${chunk.length} chars of text with context-aware extraction`);
      // Show a snippet to confirm the paragraph is in there
      if (chunk.includes('Ablin') || chunk.includes('nihilistic musings')) {
        console.log(`✅ [ClaimExtractor] Text contains "Ablin" or "nihilistic musings" - target paragraph is present`);
      }
    }

    const user = `
You are a fact-checking assistant.

${taskClaimsInstruction}
${tasks}

${testimonialsText}

TEXT:
${chunk}
`.trim();

    const schemaHint = "";

    const out = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2,
    });

    const rawReasoningStack = out.reasoningStack || {
      thesis: out.thesis || "",
      pillars: Array.isArray(out.pillars) ? out.pillars : [],
      evidenceClaims: Array.isArray(out.evidenceClaims) ? out.evidenceClaims : [],
      backgroundClaims: Array.isArray(out.backgroundClaims) ? out.backgroundClaims : [],
    };
    const searchAssertions = normalizeSearchAssertions(
      rawReasoningStack.searchAssertions || out.searchAssertions,
    );
    const reasoningStack = {
      ...rawReasoningStack,
      pillars: Array.isArray(rawReasoningStack.pillars) ? rawReasoningStack.pillars : [],
      evidenceClaims: Array.isArray(rawReasoningStack.evidenceClaims) ? rawReasoningStack.evidenceClaims : [],
      backgroundClaims: Array.isArray(rawReasoningStack.backgroundClaims) ? rawReasoningStack.backgroundClaims : [],
      fallibilityCriticalClaims: Array.isArray(rawReasoningStack.fallibilityCriticalClaims)
        ? rawReasoningStack.fallibilityCriticalClaims
        : [],
      searchAssertions,
    };

    const flattenClaimEntries = (entries, fallbackRole = null) => {
      const flattened = [];
      if (!Array.isArray(entries)) return flattened;

      for (const entry of entries) {
        if (!entry) continue;
        if (typeof entry === 'string') {
          flattened.push({ text: entry, role: fallbackRole });
          continue;
        }

        const text = entry.text || entry.claim || entry.statement || "";
        if (!text || !String(text).trim()) continue;

        flattened.push({
          id: entry.id || entry.claimId || entry.claim_id || null,
          text: String(text).trim(),
          role: entry.role || fallbackRole,
          parentId: entry.parentId || entry.parent_id || null,
          centrality: entry.centrality ?? null,
          verifiability: entry.verifiability ?? null,
          priority: entry.priority ?? null,
          searchText: entry.searchText || entry.search_text || "",
          claimKind: entry.claimKind || entry.claim_kind || null,
          evidenceType: entry.evidenceType || entry.evidence_type || null,
          articleStance: entry.articleStance || entry.article_stance || null,
          namedEntities: stringArray(entry.namedEntities || entry.named_entities),
          dates: stringArray(entry.dates || entry.dateFocus || entry.date_focus),
          studiesOrDocuments: stringArray(entry.studiesOrDocuments || entry.studies_or_documents),
          sourceCitedInArticle: String(entry.sourceCitedInArticle || entry.source_cited_in_article || "").trim(),
          isFallibilityCritical: Boolean(entry.isFallibilityCritical || entry.is_fallibility_critical),
          whyCritical: String(entry.whyCritical || entry.why_critical || "").trim().slice(0, 500),
        });
      }

      return flattened;
    };

    const structuredClaims = [];
    const claimsFromOut = flattenClaimEntries(out.claims, null);
    const thesisClaims = reasoningStack.thesis
      ? [{ id: 'thesis', text: reasoningStack.thesis, role: 'thesis', parentId: null, centrality: null, verifiability: null }]
      : [];
    const pillarClaims = flattenClaimEntries(
      reasoningStack.pillars.flatMap((pillar, index) => {
        const pillarId = pillar?.id || `P${index + 1}`;
        const pillarSummary = pillar?.summary || pillar?.label || pillar?.text || "";
        const pillarHeader = pillarSummary
          ? [{ id: pillarId, text: pillarSummary, role: 'pillar', parentId: 'thesis', centrality: pillar?.centrality ?? null, verifiability: pillar?.verifiability ?? null }]
          : [];
        const nestedClaims = flattenClaimEntries(pillar?.claims || [], 'pillar_support').map((entry) => ({
          ...entry,
          parentId: entry.parentId || pillarId,
        }));
        return [...pillarHeader, ...nestedClaims];
      })
    );
    const evidenceClaims = flattenClaimEntries(reasoningStack.evidenceClaims, 'evidence');
    const fallibilityCriticalClaims = flattenClaimEntries(
      reasoningStack.fallibilityCriticalClaims,
      'evidence',
    ).map((entry) => ({ ...entry, isFallibilityCritical: true }));
    const backgroundClaims = flattenClaimEntries(reasoningStack.backgroundClaims, 'background');
    const allowedRoles = new Set(['thesis', 'pillar', 'pillar_support', 'evidence', 'background']);
    const normalizeRole = (claim) => {
      if (!claim || typeof claim !== 'object') return claim;
      if (!claim.role || allowedRoles.has(claim.role)) return claim;
      return { ...claim, role: 'evidence' };
    };

    structuredClaims.push(
      ...thesisClaims,
      ...pillarClaims,
      ...evidenceClaims,
      ...fallibilityCriticalClaims,
      ...backgroundClaims,
      ...claimsFromOut
    );

    // Post-process: dedupe & clamp
    const rawClaims = structuredClaims;

    if (taskClaimsContext && taskClaimsContext.length > 0) {
      console.log(`🔍 [ClaimExtractor] LLM extracted ${rawClaims.length} claims (context-aware mode):`);
      rawClaims.forEach((claim, i) => {
        const preview = String(claim.text || "").substring(0, 100);
        console.log(`   ${i + 1}. [${claim.role || 'claim'}] "${preview}${preview.length > 100 ? '...' : ''}"`);
      });
    }
    const seen = new Set();
    const deduped = [];
    const dedupedByText = new Map();

    for (const c of rawClaims) {
      const norm = String(c?.text || "")
        .trim()
        .replace(/\s+/g, " ");
      const key = norm.toLowerCase();
      if (norm && !seen.has(key)) {
        seen.add(key);
        dedupedByText.set(key, deduped.length);
        deduped.push(normalizeRole({
          ...c,
          text: norm,
          searchAssertions: assertionsForClaim(searchAssertions, { ...c, text: norm }),
        }));
      } else if (norm && dedupedByText.has(key)) {
        const index = dedupedByText.get(key);
        const existing = deduped[index];
        deduped[index] = {
          ...c,
          ...existing,
          isFallibilityCritical: Boolean(existing.isFallibilityCritical || c.isFallibilityCritical),
          whyCritical: existing.whyCritical || c.whyCritical || "",
          claimKind: existing.claimKind || c.claimKind || null,
          evidenceType: existing.evidenceType || c.evidenceType || null,
          namedEntities: [...new Set([...(existing.namedEntities || []), ...(c.namedEntities || [])])].slice(0, 12),
          dates: [...new Set([...(existing.dates || []), ...(c.dates || [])])].slice(0, 12),
          searchAssertions: assertionsForClaim(searchAssertions, { ...existing, text: norm }),
        };
      }
    }

    const finalClaims = deduped.slice(0, maxClaims);

    const finalTestimonials =
      Array.isArray(out.testimonials) && includeTopicsAndTestimonials
        ? out.testimonials.slice(0, 20)
        : [];

    return {
      generalTopic: includeTopicsAndTestimonials ? out.generalTopic || "" : "",
      specificTopics:
        includeTopicsAndTestimonials && Array.isArray(out.specificTopics)
          ? out.specificTopics.slice(0, 5)
          : [],
      reasoningStack,
      claims: finalClaims.map((claim) => claim.text),
      claimsDetailed: finalClaims,
      testimonials: finalTestimonials,
    };
  }

  async analyzeContent({
    chunks,
    existingTestimonials = [],
    maxConcurrency = 3,
    extractionMode = 'ranked', // 'ranked' or 'comprehensive'
    taskClaimsContext = null,   // array of task claim strings — when set, also extract responsive/argumentative statements
    existingAssertions = [],
    unresolvedTargetContexts = [],
    contentRole = 'case',
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

      const res = await this.analyzeChunk({
        chunk: chunk.text,
        tokenLength: chunk.tokenLength,
        includeTopicsAndTestimonials: isFirst,
        incomingTestimonials: testimonials,
        extractionMode, // Pass through the mode
        taskClaimsContext, // Pass through task claims for context-aware extraction
        existingAssertions,
        unresolvedTargetContexts,
        contentRole,
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

    if (contentRole !== "source") {
      const synthesis = await this.synthesizeCaseClaims(allDetailedClaims);
      const roleRank = { thesis: 0, pillar: 1, evidence: 2, opposing_claim: 2, unclear: 2, background: 3 };
      const orderedClaims = synthesis.claims
        .slice()
        .sort((a, b) =>
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

  /**
   * Survey a single chunk to extract metadata-rich candidates without running evidence.
   * Returns a survey packet with pillar hints, evaluation candidates, and source candidates.
   *
   * @param {Object} params
   * @param {string} params.chunkText - The chunk text to survey
   * @param {string} params.articleTitle - Title of the article
   * @param {string} params.provisionalFrame - The provisional frame from document analysis
   * @param {number} params.chunkIndex - Index of this chunk (0-based)
   * @param {number} params.chunkCount - Total number of chunks
   * @param {string} params.chunkPosition - Position: lead|early_body|middle_body|late_body|conclusion
   * @returns {Promise<Object>} Survey packet with candidates marked candidateOnly=true
   */
  async surveyChunk({
    chunkText,
    articleTitle = "",
    provisionalFrame = "",
    chunkIndex = 0,
    chunkCount = 1,
    chunkPosition = "middle_body",
  }) {
    console.log(`[CHUNK_SURVEY_STARTED] Surveying chunk ${chunkIndex + 1}/${chunkCount} (${chunkPosition})`);

    const system = `You are a fact-checking assistant analyzing article chunks to extract claim candidates.

Your role is to identify and categorize potential claims, pillars, and background facts WITHOUT running evidence searches.

For each chunk, return:
1. chunkMiniTheme: A brief metadata label (not a claim)
2. relationshipToProvisionalFrame: How this chunk relates to the article's main argument
3. pillarHints: Potential major supporting claims (metadata only, not evaluation)
4. evaluationCandidateClaims: Factual claims worth verifying (0-6)
5. sourceBackgroundCandidates: Background facts useful as source context (0-2)
6. localRepetitionSignals: Repeated themes detected within the chunk

CRITICAL RULES:
- Return ONLY candidates. Do NOT persist these.
- Mark all records with candidateOnly=true.
- mini-theme and pillarHints are metadata, NOT claims.
- Do NOT call evidence engine or run searches.
- Separate evaluation candidates from background/source candidates into different arrays.
- evaluationCandidateClaims: 0-6 items, each a potential focal claim to verify
- sourceBackgroundCandidates: 0-2 items, useful only as reference background
- If a theme repeats, mark it in localRepetitionSignals, not as duplicates.
- Confidence is 0-1.0; importance is 0-1.0.

Return strict JSON only.`;

    const user = `Article: "${articleTitle}"
Provisional Frame (document-level thesis candidate): "${provisionalFrame}"

Chunk #${chunkIndex + 1}/${chunkCount} | Position: ${chunkPosition}

Analyze this chunk for claim candidates:

${chunkText}

Return:
{
  "chunkIndex": ${chunkIndex},
  "chunkPosition": "${chunkPosition}",
  "chunkMiniTheme": "brief metadata label of what this chunk discusses",
  "relationshipToProvisionalFrame": "supports_seed|narrows_seed|expands_seed|contradicts_seed|introduces_new_pillar|mostly_background|unclear",
  "pillarHints": [
    {
      "pillarText": "potential major supporting claim (not a verification candidate)",
      "confidence": 0.0,
      "supportingExcerpt": "exact excerpt from chunk"
    }
  ],
  "evaluationCandidateClaims": [
    {
      "claimText": "factual assertion to verify",
      "roleHint": "thesis|pillar|evidence|opposing_claim|fallibility_critical|source_anchor|unclear",
      "importanceInChunk": 0.0,
      "importanceToArticleGuess": 0.0,
      "noveltyHint": "new|rephrased_repetition|elaboration|duplicate_possible",
      "rhetoricalFunction": "states main argument|supports thesis|provides evidence|counters objection|etc",
      "localSourceExcerpt": "exact phrase or sentence from chunk",
      "namedActors": ["person", "organization"],
      "namedStudiesOrDocuments": ["study name", "report"],
      "namedLawsOrPolicies": ["law", "policy"],
      "namedDatasets": ["dataset name"],
      "claimType": {
        "attribution": false,
        "misconduct": false,
        "causation": false,
        "statistical": false,
        "legal_or_regulatory": false
      },
      "candidateOnly": true
    }
  ],
  "sourceBackgroundCandidates": [
    {
      "claimText": "factual background useful for source context",
      "reasonUsefulAsSource": "provides data | establishes context | defines term | etc",
      "sourceUsefulness": "high|medium|low",
      "localSourceExcerpt": "exact phrase from chunk",
      "namedActors": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedDatasets": [],
      "claimType": { "background": true },
      "candidateOnly": true
    }
  ],
  "localRepetitionSignals": [
    {
      "phraseOrIdea": "repeated theme",
      "appearsToRepeatEarlierArticleTheme": false,
      "notes": "seen earlier in chunk"
    }
  ]
}`;

    try {
      const out = await this.llm.generate({
        system,
        user,
        schemaHint: "",
        temperature: 0.1,
        maxRetries: 1,
        timeout: 60000,
      });

      // Normalize and validate response
      const surveyPacket = {
        chunkIndex: Number(out.chunkIndex ?? chunkIndex),
        chunkPosition: String(out.chunkPosition || chunkPosition),
        chunkMiniTheme: String(out.chunkMiniTheme || "").trim(),
        relationshipToProvisionalFrame: String(out.relationshipToProvisionalFrame || "unclear").trim(),
        pillarHints: Array.isArray(out.pillarHints) ? out.pillarHints.slice(0, 5).map(hint => ({
          pillarText: String(hint.pillarText || "").trim(),
          confidence: Number(hint.confidence ?? 0.5),
          supportingExcerpt: String(hint.supportingExcerpt || "").trim(),
        })).filter(h => h.pillarText) : [],
        evaluationCandidateClaims: Array.isArray(out.evaluationCandidateClaims)
          ? out.evaluationCandidateClaims.slice(0, 6).map(claim => ({
              claimText: String(claim.claimText || "").trim(),
              roleHint: String(claim.roleHint || "unclear").trim(),
              importanceInChunk: Number(claim.importanceInChunk ?? 0.5),
              importanceToArticleGuess: Number(claim.importanceToArticleGuess ?? 0.3),
              noveltyHint: String(claim.noveltyHint || "unclear").trim(),
              rhetoricalFunction: String(claim.rhetoricalFunction || "").trim(),
              localSourceExcerpt: String(claim.localSourceExcerpt || "").trim(),
              namedActors: Array.isArray(claim.namedActors) ? claim.namedActors.slice(0, 10) : [],
              namedStudiesOrDocuments: Array.isArray(claim.namedStudiesOrDocuments) ? claim.namedStudiesOrDocuments.slice(0, 5) : [],
              namedLawsOrPolicies: Array.isArray(claim.namedLawsOrPolicies) ? claim.namedLawsOrPolicies.slice(0, 5) : [],
              namedDatasets: Array.isArray(claim.namedDatasets) ? claim.namedDatasets.slice(0, 5) : [],
              claimType: typeof claim.claimType === 'object' ? claim.claimType : {},
              candidateOnly: true,
            })).filter(c => c.claimText)
          : [],
        sourceBackgroundCandidates: Array.isArray(out.sourceBackgroundCandidates)
          ? out.sourceBackgroundCandidates.slice(0, 2).map(bg => ({
              claimText: String(bg.claimText || "").trim(),
              reasonUsefulAsSource: String(bg.reasonUsefulAsSource || "").trim(),
              sourceUsefulness: String(bg.sourceUsefulness || "medium").trim(),
              localSourceExcerpt: String(bg.localSourceExcerpt || "").trim(),
              namedActors: Array.isArray(bg.namedActors) ? bg.namedActors.slice(0, 5) : [],
              namedStudiesOrDocuments: Array.isArray(bg.namedStudiesOrDocuments) ? bg.namedStudiesOrDocuments.slice(0, 5) : [],
              namedLawsOrPolicies: Array.isArray(bg.namedLawsOrPolicies) ? bg.namedLawsOrPolicies.slice(0, 3) : [],
              namedDatasets: Array.isArray(bg.namedDatasets) ? bg.namedDatasets.slice(0, 3) : [],
              claimType: typeof bg.claimType === 'object' ? bg.claimType : { background: true },
              candidateOnly: true,
            })).filter(b => b.claimText)
          : [],
        localRepetitionSignals: Array.isArray(out.localRepetitionSignals)
          ? out.localRepetitionSignals.slice(0, 10).map(signal => ({
              phraseOrIdea: String(signal.phraseOrIdea || "").trim(),
              appearsToRepeatEarlierArticleTheme: Boolean(signal.appearsToRepeatEarlierArticleTheme),
              notes: String(signal.notes || "").trim(),
            })).filter(s => s.phraseOrIdea)
          : [],
      };

      console.log(`[CHUNK_SURVEY_COMPLETED] Chunk ${chunkIndex + 1}: ${surveyPacket.evaluationCandidateClaims.length} evaluation candidates, ${surveyPacket.sourceBackgroundCandidates.length} background candidates`);

      return surveyPacket;
    } catch (error) {
      console.error(`[CHUNK_SURVEY] Error surveying chunk ${chunkIndex + 1}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Survey content across multiple chunks in parallel with bounded concurrency.
   * Returns survey packets without persistence or evidence searches.
   *
   * @param {Object} params
   * @param {Array} params.chunks - Array of { text, tokenLength }
   * @param {string} params.articleTitle - Article title
   * @param {string} params.provisionalFrame - Document-level provisional frame
   * @param {number} params.maxConcurrency - Max parallel chunk surveys (default: 3)
   * @returns {Promise<Array>} Array of survey packets indexed by chunk
   */
  async surveyContent({
    chunks = [],
    articleTitle = "",
    provisionalFrame = "",
    maxConcurrency = 3,
  }) {
    if (!chunks || chunks.length === 0) {
      console.log("[surveyContent] No chunks to survey, returning empty array");
      return [];
    }

    console.log(`[surveyContent] Starting survey of ${chunks.length} chunk(s) with max concurrency ${maxConcurrency}`);

    const surveyPackets = new Array(chunks.length);
    let nextIndex = 0;

    // Determine chunk positions based on chunk count
    const determineChunkPosition = (index, total) => {
      if (total === 1) return "lead";
      if (index === 0) return "lead";
      if (index < Math.ceil(total / 3)) return "early_body";
      if (index < Math.ceil(2 * total / 3)) return "middle_body";
      if (index < total - 1) return "late_body";
      return "conclusion";
    };

    const runNext = async () => {
      const i = nextIndex++;
      if (i >= chunks.length) return;

      const chunk = chunks[i];
      const chunkPosition = determineChunkPosition(i, chunks.length);

      try {
        const surveyPacket = await this.surveyChunk({
          chunkText: chunk.text,
          articleTitle,
          provisionalFrame,
          chunkIndex: i,
          chunkCount: chunks.length,
          chunkPosition,
        });

        surveyPackets[i] = surveyPacket;
      } catch (error) {
        console.error(`[surveyContent] Failed to survey chunk ${i + 1}: ${error.message}`);
        // Return a minimal error packet
        surveyPackets[i] = {
          chunkIndex: i,
          chunkPosition: determineChunkPosition(i, chunks.length),
          chunkMiniTheme: "(survey failed)",
          relationshipToProvisionalFrame: "unclear",
          pillarHints: [],
          evaluationCandidateClaims: [],
          sourceBackgroundCandidates: [],
          localRepetitionSignals: [],
          surveyError: error.message,
        };
      }

      return runNext();
    };

    // Create worker pool with bounded concurrency
    const workers = [];
    const concurrency = Math.min(maxConcurrency, chunks.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(runNext());
    }

    await Promise.all(workers);

    console.log(`[surveyContent] Completed surveys for ${chunks.length} chunks`);
    return surveyPackets;
  }
}
