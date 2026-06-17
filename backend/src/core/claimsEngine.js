// backend/core/claims.js

import PromptManager from "./promptManager.js";

export class ClaimExtractor {
  constructor(llm, query = null) {
    this.llm = llm; // expects { generate({ system, user, schemaHint, temperature }) }
    this.query = query; // database query function for fetching prompts
    this.promptManager = query ? new PromptManager(query) : null;
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
    contentRole = 'case',
  }) {
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

    const outputShape = `
OUTPUT (STRICT JSON):
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "thesis": "<string>",
  "pillars": [
    {
      "id": "P1",
      "label": "<string>",
      "summary": "<string>",
      "centrality": 0-100,
      "claims": [
        {
          "text": "<claim>",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0-100,
          "verifiability": 0-100
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "<claim>",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "backgroundClaims": [
    {
      "text": "<claim>",
      "role": "background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "claims": [
    {
      "text": "<claim>",
      "role": "thesis|pillar|evidence|background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" }
  ]
}
`.trim();

    // When extracting from a reference, use task claims as GUIDANCE for prioritization,
    // not as a filter. Still extract ALL worthy factual claims from the reference.
    const taskClaimsInstruction = (taskClaimsContext && taskClaimsContext.length > 0)
      ? `
⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:
${taskClaimsContext.map((c, i) => `  ${i + 1}. "${c}"`).join('\n')}

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

`
      : "";

    if (taskClaimsInstruction) {
      console.log(`🎯 [ClaimExtractor] Context-aware instruction built (${taskClaimsContext.length} claims):`);
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

${includeTopicsAndTestimonials ? outputShape : ""}

${testimonialsText}

TEXT:
${chunk}
`.trim();

    const schemaHint =
      '{"generalTopic":"","specificTopics":[],"thesis":"","pillars":[{"id":"P1","label":"","summary":"","centrality":0,"claims":[{"text":"","role":"pillar_support","parentId":"P1","centrality":0,"verifiability":0}]}],"evidenceClaims":[{"text":"","role":"evidence","parentId":"P1","centrality":0,"verifiability":0}],"backgroundClaims":[{"text":"","role":"background","parentId":"","centrality":0,"verifiability":0}],"claims":[{"text":"","role":"thesis","parentId":"","centrality":0,"verifiability":0}],"testimonials":[{"text":"","name":"","imageUrl":""}]}';

    const out = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2,
    });

    const reasoningStack = out.reasoningStack || {
      thesis: out.thesis || "",
      pillars: Array.isArray(out.pillars) ? out.pillars : [],
      evidenceClaims: Array.isArray(out.evidenceClaims) ? out.evidenceClaims : [],
      backgroundClaims: Array.isArray(out.backgroundClaims) ? out.backgroundClaims : [],
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
          text: String(text).trim(),
          role: entry.role || fallbackRole,
          parentId: entry.parentId || entry.parent_id || null,
          centrality: entry.centrality ?? null,
          verifiability: entry.verifiability ?? null,
        });
      }

      return flattened;
    };

    const structuredClaims = [];
    const claimsFromOut = flattenClaimEntries(out.claims, null);
    const thesisClaims = reasoningStack.thesis
      ? [{ text: reasoningStack.thesis, role: 'thesis', parentId: null, centrality: null, verifiability: null }]
      : [];
    const pillarClaims = flattenClaimEntries(
      reasoningStack.pillars.flatMap((pillar, index) => {
        const pillarSummary = pillar?.summary || pillar?.label || pillar?.text || "";
        const pillarHeader = pillarSummary
          ? [{ text: pillarSummary, role: 'pillar', parentId: pillar?.id || `P${index + 1}`, centrality: pillar?.centrality ?? null, verifiability: pillar?.verifiability ?? null }]
          : [];
        const nestedClaims = flattenClaimEntries(pillar?.claims || [], 'pillar_support').map((entry) => ({
          ...entry,
          parentId: entry.parentId || pillar?.id || `P${index + 1}`,
        }));
        return [...pillarHeader, ...nestedClaims];
      })
    );
    const evidenceClaims = flattenClaimEntries(reasoningStack.evidenceClaims, 'evidence');
    const backgroundClaims = flattenClaimEntries(reasoningStack.backgroundClaims, 'background');

    if (claimsFromOut.length > 0) {
      structuredClaims.push(...claimsFromOut);
    } else {
      structuredClaims.push(...thesisClaims, ...pillarClaims, ...evidenceClaims, ...backgroundClaims);
    }

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

    for (const c of rawClaims) {
      const norm = String(c?.text || "")
        .trim()
        .replace(/\s+/g, " ");
      if (norm && !seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        deduped.push({ ...c, text: norm });
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
        contentRole,
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
