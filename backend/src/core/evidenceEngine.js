// backend/src/core/evidenceEngine.js

import logger from "../utils/logger.js";

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
        const userPrompt = await this.deps.promptManager.getPrompt(
          'evidence_query_generation_user',
          { system: '', user: fallbackUser, parameters: { n: 6 } }
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{claimText\}\}/g, claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{n\}\}/g, n);
      } catch (err) {
        logger.warn(`⚠️ [EvidenceEngine] Error loading DB prompts, using fallback:`, err.message);
        // Use fallback - replace template variables
        user = fallbackUser
          .replace(/\{\{claimText\}\}/g, claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{n\}\}/g, n);
      }
    } else {
      // No promptManager, use fallback with template replacement
      user = fallbackUser
        .replace(/\{\{claimText\}\}/g, claim.text)
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

      return sub;
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

    //
    // Deduplicate + rank like your original implementation
    //
    const best = new Map();
    for (const c of chunks) {
      if (!c) continue;
      const id = c.id || c.url || `${c.source}:${c.title}`;
      const prev = best.get(id);
      if (!prev || (c.score ?? 0) > (prev.score ?? 0)) {
        best.set(id, c);
      }
    }

    let finalCandidates = Array.from(best.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);

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

    logger.log(
      `🟩 [DEBUG] Candidates for ${claim.id}: ${finalCandidates.length} results, scores: ${finalCandidates.map(c => c.score?.toFixed(2) || 'null').join(', ')}`
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
    const { extractQuotesAndScoreQuality } = await import("../utils/extractQuote.js");

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
        quality: quality(cand),
        location: it.location || undefined,
        raw_text: html, // ← Save original HTML to avoid re-fetching and allow metadata extraction
        qualityScores, // ← Add quality scores from combined LLM call
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

  async run(claims, contexts, opt) {
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

      const candidates = await this.retrieveCandidates(claim, queries, opt);

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

      let adj = this.adjudicate(claim, evs);
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
