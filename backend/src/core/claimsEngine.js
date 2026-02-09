// backend/core/claims.js

import PromptManager from "./promptManager.js";

export class ClaimExtractor {
  constructor(llm, query = null) {
    this.llm = llm; // expects { generate({ system, user, schemaHint, temperature }) }
    this.query = query; // database query function for fetching prompts
    this.promptManager = query ? new PromptManager(query) : null;
  }

  /**
   * Load claim extraction prompts from database with fallback to hardcoded versions
   */
  async loadClaimExtractionPrompts(extractionMode, includeTopicsAndTestimonials, minClaims, maxClaims) {
    // Determine prompt name based on mode and options
    const modePrefix = extractionMode === 'ranked' ? 'claim_extraction_ranked' : 'claim_extraction_comprehensive';
    const topicSuffix = includeTopicsAndTestimonials ? '_with_topics' : '_no_topics';
    const promptName = `${modePrefix}${topicSuffix}`;

    //FALLBACK PROMPTS (in case DB fetch fails)
    const fallbackSystem = "You are a precise claim extraction assistant. You must return strictly valid JSON.";

    const fallbackRankedWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract ONLY the ${minClaims}-${maxClaims} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top ${maxClaims} claims that meet these criteria. Quality over quantity.

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    const fallbackRankedNoTopics = `TASKS
1) Extract ONLY the ${minClaims}-${maxClaims} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top ${maxClaims} claims that meet these criteria. Quality over quantity.

2) Do NOT invent topics or testimonials in this mode.`;

    const fallbackComprehensiveWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract DISTINCT factual claims from the text.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").
   - Deduplicate against the main text if overlapping.`;

    const fallbackComprehensiveNoTopics = `TASKS
1) Extract DISTINCT factual claims from the text ONLY.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

2) Do NOT invent topics or testimonials in this mode.`;

    // Map to fallback user prompts
    const fallbackMap = {
      'claim_extraction_ranked_with_topics': fallbackRankedWithTopics,
      'claim_extraction_ranked_no_topics': fallbackRankedNoTopics,
      'claim_extraction_comprehensive_with_topics': fallbackComprehensiveWithTopics,
      'claim_extraction_comprehensive_no_topics': fallbackComprehensiveNoTopics,
    };

    const fallback = {
      system: fallbackSystem,
      user: fallbackMap[promptName] || fallbackRankedNoTopics,
      parameters: { minClaims, maxClaims },
    };

    // Try to load from database if promptManager is available
    if (this.promptManager) {
      try {
        // Load system prompt
        const systemPrompt = await this.promptManager.getPrompt(
          'claim_extraction_ranked_system',
          { system: fallbackSystem, user: '', parameters: {} }
        );

        // Load user prompt
        const userPrompt = await this.promptManager.getPrompt(promptName, fallback);

        // Replace template variables in user prompt
        let userText = userPrompt.user
          .replace(/\{\{minClaims\}\}/g, minClaims)
          .replace(/\{\{maxClaims\}\}/g, maxClaims);

        return {
          system: systemPrompt.system,
          user: userText,
          parameters: { ...userPrompt.parameters, minClaims, maxClaims },
        };
      } catch (err) {
        console.warn(`⚠️ [ClaimExtractor] Error loading DB prompts, using fallback:`, err.message);
        return fallback;
      }
    }

    // No promptManager, use fallback
    return fallback;
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
  }) {
    // Claim extraction bounds based on mode
    let minClaims, maxClaims;

    if (extractionMode === 'ranked') {
      // RANKED MODE: Extract fewer, higher-quality claims only
      minClaims = 3;
      maxClaims = 12; // Increased to capture more notable quotes/evidence
      // Don't scale with token length - keep it tight
    } else {
      // COMPREHENSIVE MODE: Extract all claims for user ranking
      minClaims = 5;
      maxClaims = 12;

      if (tokenLength > 2500 && tokenLength <= 5000) {
        minClaims = 8;
        maxClaims = 16;
      } else if (tokenLength > 5000 && tokenLength <= 9000) {
        minClaims = 12;
        maxClaims = 24;
      } else if (tokenLength > 9000) {
        minClaims = 16;
        maxClaims = 30;
      }
    }

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
      maxClaims
    );

    const system = prompts.system;
    const tasks = prompts.user;

    // Keep the old hardcoded prompts below for reference (not used if DB load succeeds)
    // ========================================
    // RANKED MODE: Extract only high-value claims (FALLBACK - not used if DB works)
    // ========================================
    const rankedTasks_UNUSED = includeTopicsAndTestimonials
      ? `
TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract ONLY the ${minClaims}-${maxClaims} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top ${maxClaims} claims that meet these criteria. Quality over quantity.

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").
`
      : `
TASKS
1) Extract ONLY the ${minClaims}-${maxClaims} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top ${maxClaims} claims that meet these criteria. Quality over quantity.

2) Do NOT invent topics or testimonials in this mode.
`;

    // ========================================
    // COMPREHENSIVE MODE: Extract all claims for user ranking
    // ========================================
    const comprehensiveTasks = includeTopicsAndTestimonials
      ? `
TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract DISTINCT factual claims from the text.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").
   - Deduplicate against the main text if overlapping.
`
      : `
TASKS
1) Extract DISTINCT factual claims from the text ONLY.
   - Return AT LEAST ${minClaims} and AT MOST ${maxClaims} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

2) Do NOT invent topics or testimonials in this mode.
`;

    // tasks is already set from DB prompts above
    // const tasks = extractionMode === 'ranked' ? rankedTasks : comprehensiveTasks;

    const outputShape = `
OUTPUT (STRICT JSON):
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...],
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
      '{"generalTopic":"","specificTopics":[],"claims":[],"testimonials":[{"text":"","name":"","imageUrl":""}]}';

    const out = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2,
    });

    // Post-process: dedupe & clamp
    const rawClaims = Array.isArray(out.claims) ? out.claims : [];

    if (taskClaimsContext && taskClaimsContext.length > 0) {
      console.log(`🔍 [ClaimExtractor] LLM extracted ${rawClaims.length} claims (context-aware mode):`);
      rawClaims.forEach((claim, i) => {
        console.log(`   ${i + 1}. "${claim.substring(0, 100)}${claim.length > 100 ? '...' : ''}"`);
      });
    }
    const seen = new Set();
    const deduped = [];

    for (const c of rawClaims) {
      const norm = String(c || "")
        .trim()
        .replace(/\s+/g, " ");
      if (norm && !seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        deduped.push(norm);
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
      claims: finalClaims,
      testimonials: finalTestimonials,
    };
  }

  async analyzeContent({
    chunks,
    existingTestimonials = [],
    maxConcurrency = 3,
    extractionMode = 'ranked', // 'ranked' or 'comprehensive'
    taskClaimsContext = null,   // array of task claim strings — when set, also extract responsive/argumentative statements
  }) {
    if (!chunks || chunks.length === 0) {
      return {
        generalTopic: "",
        specificTopics: [],
        claims: [],
        testimonials: [],
      };
    }

    const allClaims = [];
    let generalTopic = "";
    let specificTopics = [];
    let testimonials = [...existingTestimonials];

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
      });

      if (isFirst) {
        generalTopic = res.generalTopic;
        specificTopics = res.specificTopics;
        testimonials = res.testimonials;
      }

      allClaims.push(...res.claims);
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
      testimonials,
    };
  }
}
