// backend/src/core/evidenceEngine.js

import logger from "../utils/logger.js";
import {
  assessSnippetBearingBatch,
  isBearingShadowEnabled,
  isSnippetBearingLlmEnabled,
  logBearingShadowEvent,
  logSnippetBearingCalibration,
  scoreCandidatesInBearingShadow,
} from "./snippetBearing.js";
import {
  allocateCandidatesAcrossClaims,
  logBearingGatingAudit,
  reserveAdditionalCandidates,
  selectCandidatesForClaim,
  selectClaimsForBearingGating,
} from "./evidenceCandidateSelector.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

function dedupe(arr, keyFn) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!s.has(k)) {
      s.add(k);
      out.push(x);
    }
  }
  return out;
}

export class EvidenceEngine {
  constructor(
    deps,
    cfg = {
      preferDomains: [],
      avoidDomains: [],
      limits: {
        queriesPerClaim: 6,
        candidates: 12,
        evidencePerDoc: 2,
        concurrency: 4,
      },
    }
  ) {
    this.deps = deps;
    this.cfg = cfg;
  }

  async generateQueries(claim, ctx, n = 6, searchMode = null) {
    const label = `[EV][queries][${claim.id}]`;
    logger.time(label);

    if (Array.isArray(claim.searchTargets) && claim.searchTargets.length > 0) {
      const directQueries = claim.searchTargets.slice(0, n).map((target) => ({
        claimId: claim.id,
        query: target.query,
        intent: target.intent || "both",
        matchedPart: target.matchedPart || "object_claim",
      }));
      logger.log(`🎯 [EV][queries][${claim.id}] Using direct search targets:`, directQueries);
      logger.timeEnd(label);
      return dedupe(
        directQueries,
        (q) => `${q.intent}|${q.matchedPart}|${String(q.query || "").toLowerCase()}`
      );
    }

    // Adjust prompt based on search mode
    let fallbackSystem, fallbackUser;

    if (searchMode?.enableBalancedSearch) {
      logger.log(`🎯 [EV][queries][${claim.id}] BALANCED SEARCH MODE ACTIVE - Targeting ${searchMode.supportQueries} support, ${searchMode.refuteQueries} refute, ${searchMode.nuanceQueries} nuance`);
      // Mode 3: Balanced search - explicitly request support/refute/nuance
      fallbackSystem = "You generate diverse search queries for fact-checking. CRITICAL: Create EQUAL numbers of queries for sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.";
      fallbackUser = `Claim: {{claimText}}\nContext: {{context}}\n\nTask: Produce EXACTLY {{n}} queries with BALANCED intent distribution:
- ${searchMode.supportQueries || 3} queries to find sources that SUPPORT the claim
- ${searchMode.refuteQueries || 3} queries to find sources that REFUTE the claim
- ${searchMode.nuanceQueries || 3} queries to find sources that provide NUANCED perspective

CRITICAL: Design queries to actively find OPPOSING viewpoints. For refute queries, search for debunking, fact-checks, counterarguments, alternative interpretations. For support queries, search for confirmatory evidence, corroboration, similar findings. For nuance queries, search for context, caveats, limitations, partial agreements.`;
    } else {
      logger.log(`🎯 [EV][queries][${claim.id}] Standard search mode`);

      // Mode 1 & 2: Standard query generation
      fallbackSystem = "You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.";
      fallbackUser = `Claim: {{claimText}}\nContext: {{context}}\n\nTask: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.`;
    }

    let system = fallbackSystem;
    let user = fallbackUser;

    // Try to load from database if promptManager is available
    if (this.deps.promptManager) {
      try {
        const systemPrompt = await this.deps.promptManager.getPrompt(
          'evidence_query_generation_system',
          { system: fallbackSystem, user: '', parameters: {} }
        );

        // Choose user prompt based on search mode
        const userPromptName = searchMode?.enableBalancedSearch
          ? 'evidence_query_generation_user_balanced'
          : 'evidence_query_generation_user';

        logger.log(`🎯 [EV][queries][${claim.id}] Loading prompt: ${userPromptName}`);

        const userPrompt = await this.deps.promptManager.getPrompt(
          userPromptName,
          { system: '', user: fallbackUser, parameters: { n: n } }
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{n\}\}/g, n);

        // For balanced mode, also replace query distribution variables
        if (searchMode?.enableBalancedSearch) {
          user = user
            .replace(/\{\{supportQueries\}\}/g, searchMode.supportQueries || 3)
            .replace(/\{\{refuteQueries\}\}/g, searchMode.refuteQueries || 3)
            .replace(/\{\{nuanceQueries\}\}/g, searchMode.nuanceQueries || 3);
        }
      } catch (err) {
        logger.warn(`⚠️ [EvidenceEngine] Error loading DB prompts, using fallback:`, err.message);
        // Use fallback - replace template variables
        user = fallbackUser
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{n\}\}/g, n);
      }
    } else {
      // No promptManager, use fallback with template replacement
      user = fallbackUser
        .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
        .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
        .replace(/\{\{n\}\}/g, n);
    }

    const schema =
      '{"queries":[{"query":"...","intent":"support|refute|nuance|background|factbox"}]}';

    const out = await this.deps.llm.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.2,
    });

    const queriesArray = out && Array.isArray(out.queries) ? out.queries : [];

    const qs = queriesArray.slice(0, n).map((q) => ({
      claimId: claim.id,
      query: q.query,
      intent: q.intent,
    }));

    logger.timeEnd(label);

    logger.log(`🟦 [DEBUG] Queries for ${claim.id}:`, qs);

    return dedupe(
      qs,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`
    );
  }

  /**
   * Generate fringe-seeking queries to find low-quality refutations
   * Used in two-pass search to map source credibility
   */
  generateFringeQueries(claim, claimType = null, n = 3) {
    logger.log(`🔍 [EV][fringe-queries][${claim.id}] Generating fringe queries for claim type: ${claimType || 'unknown'}`);

    const baseQueries = [
      { query: `${claim.text} hoax`, intent: 'refute-fringe' },
      { query: `${claim.text} false flag`, intent: 'refute-fringe' },
      { query: `${claim.text} conspiracy theory`, intent: 'refute-fringe' },
    ];

    // Claim-type specific fringe sites and keywords
    const typeSpecificQueries = {
      antisemitism: [
        { query: `site:gab.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `site:bitchute.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"antisemitism myth" ${claim.text}`, intent: 'refute-fringe' },
      ],
      vaccines: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `site:childrenshealthdefense.org ${claim.text}`, intent: 'refute-fringe' },
        { query: `"vaccine dangers coverup" ${claim.text}`, intent: 'refute-fringe' },
      ],
      climate: [
        { query: `site:wattsupwiththat.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"climate hoax" ${claim.text}`, intent: 'refute-fringe' },
      ],
      covid: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"covid hoax" ${claim.text}`, intent: 'refute-fringe' },
        { query: `"plandemic" ${claim.text}`, intent: 'refute-fringe' },
      ],
      pesticides: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"pesticide safety" ${claim.text}`, intent: 'refute-fringe' },
      ],
    };

    const specific = typeSpecificQueries[claimType] || [];
    const allQueries = [...baseQueries, ...specific];

    const fringeQueries = allQueries.slice(0, n).map(q => ({
      claimId: claim.id,
      query: q.query,
      intent: q.intent,
    }));

    logger.log(`🔍 [DEBUG] Fringe queries for ${claim.id}:`, fringeQueries);

    return dedupe(
      fringeQueries,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`
    );
  }

  /**
   * Detect claim type from text (simple keyword matching)
   */
  detectClaimType(claimText) {
    const text = claimText.toLowerCase();

    if (text.match(/antisemit|jewish|jew|israel|zion/)) return 'antisemitism';
    if (text.match(/vaccine|vax|immuniz/)) return 'vaccines';
    if (text.match(/climate|global warming|carbon|emissions/)) return 'climate';
    if (text.match(/election|vote|ballot|fraud/)) return 'election';
    if (text.match(/covid|coronavirus|pandemic/)) return 'covid';
    if (text.match(/pesticide|herbicide|glyphosate/)) return 'pesticides';

    return null;
  }

  async retrieveCandidates(claim, queries, opt) {
    const topK = opt.topKCandidates ?? 12;
    const limitQueries = queries.slice(0, opt.topKQueries ?? queries.length);

    // Optional throttle (default: unlimited concurrency)
    const maxParallel = opt.maxParallelSearches ?? Infinity;

    const label = `[EV][retrieve][${claim.id}]`;
    logger.time(label);

    // Convert list of queries → list of async tasks
    // Tag each result with the intent of the query that produced it
    const bearingShadowEnabled = isBearingShadowEnabled() || opt.enableBearingGating;
    const tasks = limitQueries.map((q) => async () => {
      const sub = [];

      // Run internal + web in parallel for this query
      await Promise.all(
        [
          opt.enableInternal
            ? (async () => {
                const internal = await this.deps.search.internal({
                  query: q.query,
                  topK,
                });
                if (internal?.length) sub.push(...internal);
              })()
            : null,

          opt.enableWeb
            ? (async () => {
                const web = await this.deps.search.web({
                  query: q.query,
                  topK,
                  prefer: opt.preferDomains,
                  avoid: opt.avoidDomains,
                });
                if (web?.length) sub.push(...web);
              })()
            : null,
        ].filter(Boolean)
      );

      // Tag every result with this query's intent so we can bucket later
      const intent = q.intent || 'background';
      return sub.map(r => ({
        ...r,
        searchIntent: intent,
        matchedPart: q.matchedPart || 'context',
        ...(bearingShadowEnabled ? {
          query: q.query,
          stanceGoal: q.stanceGoal || q.intent || "open",
          evidenceTargetType: q.evidenceTargetType || null,
          evidenceTargetId: q.evidenceTargetId || null,
        } : {}),
      }));
    });

    //
    // Execute tasks with optional concurrency limit
    //
    const chunks = [];

    if (maxParallel === Infinity) {
      // No throttle → fastest path
      const results = await Promise.all(tasks.map((t) => t()));
      for (const r of results) chunks.push(...r);
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const t = tasks[i++];
          const r = await t();
          if (r?.length) chunks.push(...r);
        }
      });
      await Promise.all(workers);
    }

    logger.timeEnd(label);

    // Deduplicate by URL — when same URL appears from multiple queries,
    // keep the highest-scoring copy and preserve its searchIntent
    const best = new Map();
    for (const c of chunks) {
      if (!c) continue;
      const id = c.id || c.url || `${c.source}:${c.title}`;
      const prev = best.get(id);
      if (!prev || (c.score ?? 0) > (prev.score ?? 0)) {
        best.set(id, c);
      }
    }

    // Group deduplicated candidates by intent, take top N per bucket
    // This guarantees stance diversity instead of whatever the global top-12 happen to be
    const topKPerIntent = opt.topKPerIntent ?? 4;
    const INTENT_LIMITS = {
      support:    topKPerIntent,
      refute:     topKPerIntent,
      nuance:     Math.ceil(topKPerIntent / 2),
      background: 2,
      factbox:    2,
    };

    const byIntent = {};
    for (const c of best.values()) {
      const intent = c.searchIntent || 'background';
      if (!byIntent[intent]) byIntent[intent] = [];
      byIntent[intent].push(c);
    }

    let finalCandidates = [];
    for (const [intent, bucket] of Object.entries(byIntent)) {
      const limit = INTENT_LIMITS[intent] ?? topKPerIntent;
      const sorted = bucket.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      finalCandidates.push(...sorted.slice(0, limit));
      logger.log(`🎯 [EV][intent-bucket][${claim.id}] ${intent}: ${Math.min(sorted.length, limit)}/${sorted.length} selected`);
    }

    // Filter out excluded URL (e.g., task URL to prevent self-referencing)
    if (opt.excludeUrl) {
      const beforeCount = finalCandidates.length;
      finalCandidates = finalCandidates.filter(c => c.url !== opt.excludeUrl);
      if (beforeCount > finalCandidates.length) {
        logger.log(
          `🚫 [Evidence] Filtered out task URL from candidates: ${opt.excludeUrl}`
        );
      }
    }

    // Phase 1 shadow instrumentation only. This is deliberately a pure map:
    // no filtering, sorting, canonical dedupe, caps, or selection changes.
    if (bearingShadowEnabled && claim.evidenceNeed) {
      finalCandidates = scoreCandidatesInBearingShadow(
        claim.evidenceNeed,
        finalCandidates,
        { minBearingToScrape: opt.minBearingToScrape },
      );
    }

    logger.log(
      `🟩 [DEBUG] Candidates for ${claim.id}: ${finalCandidates.length} total (intent-bucketed), scores: ${finalCandidates.map(c => `${c.searchIntent}:${c.score?.toFixed(2) || 'null'}`).join(', ')}`
    );

    return finalCandidates;
  }

  async extractEvidence(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;

    const fetchLabel = `[EV][fetch][${claim.id}][${shortUrl}]`;
    logger.time(fetchLabel);

    const fetchResult = await this.deps.fetcher.getText(cand, claim);
    logger.timeEnd(fetchLabel);

    if (!fetchResult) {
      logger.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return [];
    }

    // Handle both old format (string) and new format (object with cleanText + citationCount)
    let cleanText, citationCount, html;

    if (typeof fetchResult === 'object' && fetchResult.isProcessed) {
      // New format: already processed by runEvidenceEngine
      cleanText = fetchResult.cleanText;
      citationCount = fetchResult.citationCount || 0;
      html = cleanText; // Store for raw_text field
      logger.log(
        `♻️  [Evidence] Using pre-processed text (${citationCount} citations) from ${shortUrl}`
      );
    } else {
      // Old format: raw HTML/text that needs parsing
      html = typeof fetchResult === 'string' ? fetchResult : fetchResult.cleanText || '';
      cleanText = html;
      citationCount = 0;

      try {
        const cheerio = await import("cheerio");
        const $ = cheerio.load(html);

        // Extract citation count before removing elements
        const domRefs = $('a[href]').length;

        $("script, style, link, noscript").remove();
        cleanText = $.text().replace(/\s+/g, " ").trim();

        // Extract inline citations from text
        const { extractInlineRefs } = await import("../utils/extractInlineRefs.js");
        const inlineRefs = extractInlineRefs(cleanText);
        citationCount = (inlineRefs?.length || 0) + domRefs;

        logger.log(
          `📚 [Evidence] Extracted ${citationCount} citations (${inlineRefs?.length || 0} inline + ${domRefs} DOM) from ${shortUrl}`
        );
      } catch (err) {
        // If HTML parsing fails, use original text as-is
        logger.warn(`⚠️ Failed to parse HTML for ${shortUrl}, using raw text`);
      }
    }

    const maxChars = opt.maxCharsPerDoc ?? 8000;
    const maxEvidencePerDoc = opt.maxEvidencePerDoc ?? 2;

    // Use COMBINED quote extraction + quality scoring (saves 1 LLM call per source)
    // Tests may inject the same contract; production continues using the shared utility.
    const extractQuotesAndScoreQuality = this.deps.extractQuotesAndScoreQuality ||
      (await import("../utils/extractQuote.js")).extractQuotesAndScoreQuality;

    const llmLabel = `[EV][llm-evidence+quality][${claim.id}][${shortUrl}]`;
    logger.time(llmLabel);

    const result = await extractQuotesAndScoreQuality({
      claimText: claim.text,
      fullText: cleanText,
      sourceTitle: cand.title || cand.url,
      url: cand.url || "",
      domain: cand.domain || "",
      metadata: {
        author: "unknown", // Will be extracted later in runEvidenceEngine
        publisher: "unknown",
        citationCount, // Use actual extracted citations for evidence_density
      },
      maxChars,
      maxQuotes: maxEvidencePerDoc,
    });

    const items = result.quotes || [];
    const qualityScores = result.qualityScores;

    logger.timeEnd(llmLabel);

    logger.log(
      `📘 [DEBUG] LLM raw evidence for ${claim.id}/${shortUrl}:`,
      items
    );

    logger.log(
      `📙 [DEBUG] Parsed ${items.length} evidence items + quality=${qualityScores?.quality_tier || 'unknown'} for ${claim.id}/${shortUrl}`
    );

    const quality = (c) => {
      const base = c.score ?? 0; // Score is already 0-1 range from search engines
      const boost = c.domain?.match(
        /(reuters|apnews|nature|nih|who|gov|\.edu)/i
      )
        ? 0.2
        : 0;
      const q = Math.max(0, Math.min(1.2, base + boost)); // Max 1.2 (1.0 + 0.2 boost)
      logger.log(`🔢 [DEBUG] Quality calc for ${c.url?.slice(0, 50)}: score=${c.score}, base=${base.toFixed(4)}, boost=${boost}, quality=${q.toFixed(4)}`);
      return q;
    };

    let i = 0;
    const arr = [];

    for (const it of items) {
      if (!it || !it.quote) continue;
      arr.push({
        id: `${claim.id}:${cand.id}:${i++}`,
        claimId: claim.id,
        candidateId: cand.id,
        url: cand.url,
        title: cand.title,
        publishedAt: cand.publishedAt,
        quote: String(it.quote).trim(),
        summary: (it.summary || "").trim(),
        stance: it.stance || "insufficient",
        searchIntent: cand.searchIntent || 'background',
        matchedPart: cand.matchedPart || 'context',
        quality: quality(cand),
        location: it.location || undefined,
        raw_text: html,
        qualityScores,
        ...(it.bearing_score !== undefined ? {
          bearingScore: it.bearing_score,
          bearingType: it.bearing_type,
          bearingReason: it.bearing_reason,
          claimComponentAddressed: it.claim_component_addressed,
          causalStrength: it.causal_strength,
          bearingMethod: "post_scrape_llm_v1",
        } : {}),
      });
    }

    logger.log(
      `🟪 [DEBUG] Final evidence array for ${claim.id}/${shortUrl}:`,
      arr
    );

    return arr;
  }

  adjudicate(claim, evidence) {
    logger.log(
      `🟫 [DEBUG] Adjudicating ${claim.id} with evidence count:`,
      evidence.length
    );

    const now = Date.now();

    const w = (e) => {
      const rec = e.publishedAt
        ? Math.max(
            0.5,
            1 -
              (now - Date.parse(e.publishedAt)) /
                (1000 * 60 * 60 * 24 * 365 * 5)
          )
        : 0.8;
      return (e.quality ?? 0) * rec;
    };

    const buckets = { support: 0, refute: 0, nuance: 0, insufficient: 0 };

    for (const e of evidence) {
      const stance = e.stance || "insufficient";
      if (!buckets.hasOwnProperty(stance)) continue;
      buckets[stance] += w(e);
    }

    const ranked = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const finalVerdict = top[1] === 0 ? "insufficient" : top[0];

    const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 0.0001;
    const dominance = ranked[0][1] / total;
    const confidence = Math.max(
      0.15,
      Math.min(0.98, 0.4 * dominance + 0.6 * Math.min(1, total))
    );

    const sortedEv = [...evidence].sort((a, b) => w(b) - w(a));
    const picks = sortedEv.filter((e) => e.stance === finalVerdict).slice(0, 4);
    const counters = sortedEv
      .filter((e) => e.stance !== finalVerdict && e.stance !== "insufficient")
      .slice(0, 3);

    const cite = (e) => `${e.title || e.url || e.candidateId}`;

    const rationale = [
      picks
        .slice(0, 2)
        .map((e) => `“${e.quote}” — ${cite(e)}`)
        .join("; "),
      counters
        .slice(0, 1)
        .map((e) => `Counterpoint: “${e.quote}” — ${cite(e)}`)
        .join("; "),
    ]
      .filter(Boolean)
      .join(". ");

    logger.log(
      `🟧 [DEBUG] Verdict for ${claim.id}:`,
      finalVerdict,
      "confidence",
      confidence
    );

    return {
      claimId: claim.id,
      finalVerdict,
      confidence,
      rationale,
      evidenceIds: picks.map((e) => e.id),
      counters: counters.map((e) => e.id),
    };
  }
  /**
   * redTeam(claim, adjudication, evidence)
   * --------------------------------------
   * Second-pass adversarial check.
   * Challenges the initial verdict and may revise it.
   */
  async redTeam(claim, adjudication, evidence) {
    logger.log(`🟥 [REDTEAM] Starting red-team for claim ${claim.id}`);

    const system = `
      You are a second-pass adversarial reviewer.
      Your goal is to critically challenge the initial verdict on a claim.
      If there is strong contradictory evidence or uncertainty, adjust the verdict.
      Output ONLY a JSON object following the schema.
    `;

    const user = `
CLAIM:
${claim.text}

INITIAL VERDICT:
${JSON.stringify(adjudication, null, 2)}

EVIDENCE ITEMS:
${JSON.stringify(evidence.slice(0, 12), null, 2)}

TASK:
1. Challenge the logic of the verdict.
2. Look for bias, missing evidence, or misweighting.
3. If needed, revise:
   - finalVerdict (support|refute|nuance|insufficient)
   - confidence (0–1)
   - rationale (short explanation)
4. If initial verdict is solid, keep it but refine rationale.
    `;

    const schemaHint = `{
      "finalVerdict": "support|refute|nuance|insufficient",
      "confidence": 0.0,
      "rationale": "string"
    }`;

    let out = null;
    try {
      out = await this.deps.llm.generate({
        system,
        user,
        schemaHint,
        temperature: 0.3,
      });
    } catch (err) {
      logger.warn("🟥 [REDTEAM] LLM error:", err);
      return adjudication; // fallback
    }

    if (!out || !out.finalVerdict) {
      logger.warn("🟥 [REDTEAM] Invalid red-team result, keeping original.");
      return adjudication;
    }

    const revised = {
      claimId: claim.id,
      finalVerdict: out.finalVerdict || adjudication.finalVerdict,
      confidence: Math.max(
        0.1,
        Math.min(0.99, out.confidence || adjudication.confidence)
      ),
      rationale: out.rationale || adjudication.rationale,
      evidenceIds: adjudication.evidenceIds,
      counters: adjudication.counters,
    };

    logger.log(`🟥 [REDTEAM] Revised verdict for ${claim.id}:`, revised);
    return revised;
  }

  async prepareBearingGatedClaim(claim, index, contexts, opt) {
    const ctx = contexts ? contexts[claim.id] : undefined;
    const queries = await this.generateQueries(
      claim,
      ctx,
      opt.topKQueries ?? opt.queriesPerClaim ?? 6,
      opt,
    );
    let candidates = await this.retrieveCandidates(claim, queries, opt);
    const snippetBearingLlmEnabled =
      isBearingShadowEnabled() &&
      isSnippetBearingLlmEnabled() &&
      Boolean(claim.evidenceNeed);
    if (snippetBearingLlmEnabled) {
      const batch = await assessSnippetBearingBatch({
        claim,
        evidenceNeed: claim.evidenceNeed,
        candidates,
        llm: this.deps.llm,
        promptManager: this.deps.promptManager || null,
        taskContentId: opt.taskContentId || null,
        maxCandidates: opt.maxSnippetCandidatesPerClaim || 12,
      });
      candidates = batch.candidates;
    }
    return { claim, index, context: ctx, queries, candidates, snippetBearingLlmEnabled };
  }

  async runBearingGated(claims, contexts, opt) {
    const config = opt.bearingConfig;
    const results = new Array(claims.length);
    const { eligible, skipped } = selectClaimsForBearingGating(claims, config);
    const eligibleIds = new Set(eligible.map((claim) => Number(claim.id)));

    for (let index = 0; index < claims.length; index++) {
      const claim = claims[index];
      if (eligibleIds.has(Number(claim.id))) continue;
      const skippedInfo = skipped.find((item) => Number(item.claim.id) === Number(claim.id));
      results[index] = {
        claim,
        context: contexts ? contexts[claim.id] : undefined,
        meta: undefined,
        queries: [],
        candidates: [],
        evidence: [],
        adjudication: {
          claimId: claim.id,
          finalVerdict: "insufficient",
          confidence: 0.15,
          rationale: `Evidence search skipped by bearing gate: ${skippedInfo?.reason || "ineligible claim"}.`,
          evidenceIds: [],
          counters: [],
          unresolved_search_failed: true,
        },
        fringeQueries: [],
        fringeCandidates: [],
        fringeEvidence: [],
        bearingGatingSkipReason: skippedInfo?.reason || "ineligible_claim",
      };
    }

    const prepared = await Promise.all(
      claims
        .map((claim, index) => ({ claim, index }))
        .filter(({ claim }) => eligibleIds.has(Number(claim.id)))
        .map(({ claim, index }) => this.prepareBearingGatedClaim(claim, index, contexts, opt)),
    );
    const plans = prepared.map((item) => ({
      ...selectCandidatesForClaim(item.claim, item.candidates, config),
      prepared: item,
    }));
    const allocation = allocateCandidatesAcrossClaims(plans, config);

    logger.log(`[BEARING_GATING] ${JSON.stringify({
      event: "bearing_gating_global_allocation",
      taskContentId: opt.taskContentId || null,
      totalClaims: claims.length,
      eligibleClaims: eligible.length,
      skippedClaims: skipped.length,
      uniqueSelectedUrls: allocation.usedCanonicalUrls.size,
      globalLimit: allocation.globalLimit,
      remainingUniqueSlots: allocation.remainingUniqueSlots,
      configVersion: config.version,
    })}`);

    const occurrences = [];
    for (const plan of plans) {
      const selectedCandidates = allocation.selectedByClaimId.get(Number(plan.claim.id)) || [];
      const selectedKeys = new Set(selectedCandidates.map((candidate) => canonicalizeUrl(candidate.url) || candidate.url));
      plan.prepared.candidates.forEach((candidate) => {
        logBearingShadowEvent({
          taskContentId: opt.taskContentId || null,
          claim: plan.claim,
          candidate,
          actualSelected: selectedKeys.has(canonicalizeUrl(candidate.url) || candidate.url),
        });
      });
      logBearingGatingAudit({
        taskContentId: opt.taskContentId || null,
        claim: plan.claim,
        candidates: plan.mergedCandidates,
        selectedCandidates,
        decisions: plan.decisions,
      });
      for (let candidateIndex = 0; candidateIndex < selectedCandidates.length; candidateIndex++) {
        occurrences.push({ plan, candidate: selectedCandidates[candidateIndex], candidateIndex });
      }
    }

    // Fetch each canonical URL once in parallel. Any occurrence of that URL for
    // another claim is extracted only after the first fetch has populated the
    // existing reference cache in runEvidenceEngine.
    const firstByCanonical = new Map();
    const duplicateOccurrences = [];
    for (const occurrence of occurrences) {
      const key = canonicalizeUrl(occurrence.candidate.url) || occurrence.candidate.url;
      if (!firstByCanonical.has(key)) firstByCanonical.set(key, occurrence);
      else duplicateOccurrences.push({ ...occurrence, canonicalKey: key });
    }
    const evidenceByClaimId = new Map(prepared.map((item) => [Number(item.claim.id), []]));
    const extractOccurrence = async (occurrence, canonicalUrlOverride = null) => {
      const candidate = canonicalUrlOverride
        ? { ...occurrence.candidate, originalUrl: occurrence.candidate.url, url: canonicalUrlOverride }
        : occurrence.candidate;
      const evidence = await this.extractEvidence(occurrence.plan.claim, candidate, opt);
      evidenceByClaimId.get(Number(occurrence.plan.claim.id))[occurrence.candidateIndex] = evidence;
    };
    await Promise.all([...firstByCanonical.values()].map((occurrence) => extractOccurrence(occurrence)));
    await Promise.all(duplicateOccurrences.map((occurrence) => {
      const first = firstByCanonical.get(occurrence.canonicalKey);
      return extractOccurrence(occurrence, first.candidate.url);
    }));

    for (const plan of plans) {
      const { claim, index, context, queries, candidates, snippetBearingLlmEnabled } = plan.prepared;
      const selectedCandidates = allocation.selectedByClaimId.get(Number(claim.id)) || [];
      const evs = (evidenceByClaimId.get(Number(claim.id)) || []).flat();
      if (snippetBearingLlmEnabled) {
        logSnippetBearingCalibration({
          taskContentId: opt.taskContentId || null,
          claim,
          candidates,
          evidence: evs,
          selectedCanonicalUrls: selectedCandidates.map((candidate) => candidate.url),
        });
      }
      let adjudication = this.adjudicate(claim, evs);
      if (evs.length === 0) {
        adjudication = {
          ...adjudication,
          finalVerdict: "insufficient",
          unresolved_search_failed: true,
          rationale: "No matching evidence found within bearing/source caps.",
        };
      }
      if (opt.enableRedTeam) adjudication = await this.redTeam(claim, adjudication, evs);
      results[index] = {
        claim,
        context,
        meta: undefined,
        queries,
        candidates,
        selectedCandidates,
        evidence: evs,
        adjudication,
        fringeQueries: [],
        fringeCandidates: [],
        fringeEvidence: [],
      };
    }

    // Preserve the existing optional fringe pass only while global unique URL
    // budget remains. Process in claim order for deterministic allocation.
    if (opt.enableFringeSearch && allocation.remainingUniqueSlots > 0) {
      for (const plan of plans) {
        if (allocation.remainingUniqueSlots <= 0) break;
        const row = results[plan.prepared.index];
        if (row.adjudication.finalVerdict !== "support" || row.adjudication.confidence <= 0.7) continue;
        const fringeQueries = this.generateFringeQueries(
          plan.claim,
          this.detectClaimType(plan.claim.text),
          opt.topKFringeQueries ?? 3,
        );
        let fringeCandidates = await this.retrieveCandidates(plan.claim, fringeQueries, {
          ...opt,
          enableWeb: true,
          enableInternal: false,
          topKCandidates: opt.topKFringeCandidates ?? 3,
          preferDomains: [],
          avoidDomains: [],
        });
        if (plan.prepared.snippetBearingLlmEnabled) {
          const batch = await assessSnippetBearingBatch({
            claim: plan.claim,
            evidenceNeed: plan.claim.evidenceNeed,
            candidates: fringeCandidates,
            llm: this.deps.llm,
            promptManager: this.deps.promptManager || null,
            taskContentId: opt.taskContentId || null,
            maxCandidates: opt.maxSnippetCandidatesPerClaim || 12,
          });
          fringeCandidates = batch.candidates;
        }
        const fringePlan = selectCandidatesForClaim(plan.claim, fringeCandidates, config, {
          perClaimLimit: Math.min(1, opt.maxFringeEvidenceCandidates ?? 1),
        });
        const selectedFringe = reserveAdditionalCandidates(
          fringePlan.selectedCandidates,
          allocation,
          Math.min(1, opt.maxFringeEvidenceCandidates ?? 1),
        );
        const fringeEvidence = (
          await Promise.all(selectedFringe.map((candidate) => this.extractEvidence(plan.claim, candidate, opt)))
        ).flat();
        fringeEvidence.forEach((item) => {
          item.isFringe = true;
          item.fringeReason = "Found via bounded fringe/steelman query under bearing gate";
        });
        row.fringeQueries = fringeQueries;
        row.fringeCandidates = fringeCandidates;
        row.fringeEvidence = fringeEvidence;
      }
    }

    logger.log("🟩 [DEBUG] Final bearing-gated results before persist:", results);
    return results;
  }

  async run(claims, contexts, opt) {
    if (opt.enableBearingGating) {
      return this.runBearingGated(claims, contexts, opt);
    }

    const maxParallel = this.cfg.maxParallelClaims ?? 3;
    const results = new Array(claims.length);

    // Create async task for each claim
    const tasks = claims.map((claim, index) => async () => {
      const ctx = contexts ? contexts[claim.id] : undefined;

      logger.log(
        `\n🔵 [DEBUG] Starting claim ${claim.id}: "${claim.text.slice(
          0,
          50
        )}..."`
      );

      const claimLabel = `[EV][claim:${claim.id}]`;
      logger.time(`${claimLabel} total`);

      const queries = await this.generateQueries(
        claim,
        ctx,
        opt.topKQueries ?? opt.queriesPerClaim ?? 6,
        opt // Pass full options for balanced search mode detection
      );

      let candidates = await this.retrieveCandidates(claim, queries, opt);

      const snippetBearingLlmEnabled =
        isBearingShadowEnabled() &&
        isSnippetBearingLlmEnabled() &&
        Boolean(claim.evidenceNeed);
      if (snippetBearingLlmEnabled) {
        const batch = await assessSnippetBearingBatch({
          claim,
          evidenceNeed: claim.evidenceNeed,
          candidates,
          llm: this.deps.llm,
          promptManager: this.deps.promptManager || null,
          taskContentId: opt.taskContentId || null,
          maxCandidates: opt.maxSnippetCandidatesPerClaim || 12,
        });
        // Phase 3 remains a same-length, same-order map. No gating or sorting.
        candidates = batch.candidates;
      }

      let shadowSelectedCount = 0;
      if (isBearingShadowEnabled() && claim.evidenceNeed) {
        // Observe the exact legacy selection operation without replacing it.
        // The real fetch expression below remains unchanged.
        shadowSelectedCount = candidates.slice(0, opt.maxEvidenceCandidates).length;
        candidates.forEach((candidate, candidateIndex) => {
          logBearingShadowEvent({
            taskContentId: opt.taskContentId || null,
            claim,
            candidate,
            actualSelected: candidateIndex < shadowSelectedCount,
          });
        });
      }

      // Process all candidates in parallel (parallel is faster than sequential early exit)
      const evs = (
        await Promise.all(
          candidates
            .slice(0, opt.maxEvidenceCandidates)
            .map((c) => this.extractEvidence(claim, c, opt))
        )
      ).flat();

      logger.log(
        `🟨 [DEBUG] Evidence items returned for ${claim.id}:`,
        evs.length
      );

      if (snippetBearingLlmEnabled) {
        logSnippetBearingCalibration({
          taskContentId: opt.taskContentId || null,
          claim,
          candidates,
          evidence: evs,
          selectedCandidateCount: shadowSelectedCount,
        });
      }

      let adj = this.adjudicate(claim, evs);
      if (evs.length === 0) {
        adj = {
          ...adj,
          finalVerdict: "insufficient",
          unresolved_search_failed: true,
          rationale: "No matching evidence found within search/source caps.",
        };
      }
      if (opt.enableRedTeam) {
        adj = await this.redTeam(claim, adj, evs);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PASS 2: FRINGE SOURCE DISCOVERY (if enabled)
      // ═══════════════════════════════════════════════════════════════════
      let fringeEvidence = [];
      let fringeQueries = [];
      let fringeCandidates = [];

      if (opt.enableFringeSearch) {
        logger.log(`🔍 [EV][fringe][${claim.id}] Starting fringe source discovery...`);

        // Detect claim type for targeted fringe searches
        const claimType = this.detectClaimType(claim.text);
        logger.log(`🔍 [EV][fringe][${claim.id}] Detected claim type: ${claimType || 'unknown'}`);

        // Generate fringe-seeking queries
        fringeQueries = this.generateFringeQueries(
          claim,
          claimType,
          opt.topKFringeQueries ?? 3
        );

        // Only search for fringe sources if primary verdict is strong support
        // (this is where we expect to find low-quality refutations)
        if (adj.finalVerdict === 'support' && adj.confidence > 0.7) {
          logger.log(`🔍 [EV][fringe][${claim.id}] Primary verdict is strong support - searching for fringe refutations...`);

          fringeCandidates = await this.retrieveCandidates(
            claim,
            fringeQueries,
            {
              ...opt,
              enableWeb: true,
              enableInternal: false,
              topKCandidates: opt.topKFringeCandidates ?? 3,
              preferDomains: [], // Don't filter - we WANT fringe sources
              avoidDomains: [],  // Don't filter
            }
          );

          // Extract evidence from fringe sources (fewer candidates)
          fringeEvidence = (
            await Promise.all(
              fringeCandidates
                .slice(0, opt.maxFringeEvidenceCandidates ?? 2)
                .map((c) => this.extractEvidence(claim, c, opt))
            )
          ).flat();

          logger.log(
            `🔍 [EV][fringe][${claim.id}] Found ${fringeEvidence.length} fringe evidence items`
          );

          // Tag fringe evidence for credibility analysis
          fringeEvidence.forEach(ev => {
            ev.isFringe = true;
            ev.fringeReason = 'Found via fringe-seeking queries';
          });
        } else {
          logger.log(`🔍 [EV][fringe][${claim.id}] Skipping fringe search (verdict not strong support or low confidence)`);
        }
      }

      const row = {
        claim,
        context: ctx,
        meta: undefined,
        queries,
        candidates,
        evidence: evs,
        adjudication: adj,
        // Add fringe data
        fringeQueries,
        fringeCandidates,
        fringeEvidence,
      };

      results[index] = row;

      logger.timeEnd(`${claimLabel} total`);
    });

    // Execute tasks with concurrency limit
    if (maxParallel === Infinity || maxParallel >= tasks.length) {
      // No throttle → process all claims in parallel
      await Promise.all(tasks.map((t) => t()));
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const task = tasks[i++];
          await task();
        }
      });
      await Promise.all(workers);
    }

    logger.log("🟩 [DEBUG] Final results before persist:", results);

    return results;
  }
}
