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

  async generateQueries(claim, ctx, n = 6) {
    const label = `[EV][queries][${claim.id}]`;
    logger.time(label);

    const system =
      "You generate diverse, high-precision search queries for fact-checking.";
    const user = `Claim: ${claim.text}\nContext: ${JSON.stringify(
      ctx ?? {}
    )}\nTask: Produce ${n} queries across intents.`;

    const schema =
      '{"queries":[{"query":"...","intent":"support|refute|background|factbox"}]}';

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

    const finalCandidates = Array.from(best.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);

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

    const html = await this.deps.fetcher.getText(cand, claim);
    logger.timeEnd(fetchLabel);

    if (!html) {
      logger.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return [];
    }

    // Extract clean text from HTML for LLM processing
    let cleanText = html;
    try {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);
      $("script, style, link, noscript").remove();
      cleanText = $.text().replace(/\s+/g, " ").trim();
    } catch (err) {
      // If HTML parsing fails, use original text as-is
      logger.warn(`⚠️ Failed to parse HTML for ${shortUrl}, using raw text`);
    }

    const maxChars = opt.maxCharsPerDoc ?? 8000;
    const maxEvidencePerDoc = opt.maxEvidencePerDoc ?? 2;

    // Use shared quote extraction utility
    const { extractQuotesFromText } = await import("../utils/extractQuote.js");

    const llmLabel = `[EV][llm-evidence][${claim.id}][${shortUrl}]`;
    logger.time(llmLabel);

    const items = await extractQuotesFromText({
      claimText: claim.text,
      fullText: cleanText,
      sourceTitle: cand.title || cand.url,
      maxChars,
      maxQuotes: maxEvidencePerDoc,
    });

    logger.timeEnd(llmLabel);

    logger.log(
      `📘 [DEBUG] LLM raw evidence for ${claim.id}/${shortUrl}:`,
      items
    );

    logger.log(
      `📙 [DEBUG] Parsed ${items.length} evidence items for ${claim.id}/${shortUrl}`
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
        opt.topKQueries ?? 3
      );

      const candidates = await this.retrieveCandidates(claim, queries, opt);

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

      const row = {
        claim,
        context: ctx,
        meta: undefined,
        queries,
        candidates,
        evidence: evs,
        adjudication: adj,
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
