// backend/src/core/engine.js

// Note: All imports from "./types" / "./ports" were *type-only* in TS,
// so they are removed in JS. The engine just operates on plain objects.

// tiny utils
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
  /**
   * @param {Object} deps - { llm, search, fetcher, storage }
   * @param {Object} cfg
   */
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
    console.time(label);
    const system =
      "You generate diverse, high-precision search queries for fact-checking.";
    const user = `Claim: ${claim.text}\nContext: ${JSON.stringify(
      ctx ?? {}
    )}\nTask: Produce ${n} queries across intents (support, refute, background, factbox).`;
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
    console.timeEnd(label);

    return dedupe(
      qs,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`
    );
  }

  async retrieveCandidates(claim, queries, opt) {
    const topK = opt.topKCandidates ?? 12;
    const chunks = [];

    const limitQueries = queries.slice(0, opt.topKQueries ?? queries.length);
    const label = `[EV][retrieve][${claim.id}]`;
    console.time(label);

    for (const q of limitQueries) {
      if (opt.enableInternal) {
        const internal = await this.deps.search.internal({
          query: q.query,
          topK,
        });
        chunks.push(...(internal || []));
      }

      if (opt.enableWeb) {
        const web = await this.deps.search.web({
          query: q.query,
          topK,
          prefer: opt.preferDomains,
          avoid: opt.avoidDomains,
        });
        chunks.push(...(web || []));
      }
    }
    console.timeEnd(label);
    const best = new Map();
    for (const c of chunks) {
      if (!c) continue;
      const id = c.id || c.url || `${c.source}:${c.title}`;
      const prev = best.get(id);
      if (!prev || (c.score ?? 0) > (prev.score ?? 0)) {
        best.set(id, c);
      }
    }

    return Array.from(best.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);
  }

  async extractEvidence(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;

    const fetchLabel = `[EV][fetch][${claim.id}][${shortUrl}]`;
    console.time(fetchLabel);

    const text = await this.deps.fetcher.getText(cand);
    console.timeEnd(fetchLabel);
    if (!text) return [];
    const maxChars = opt.maxCharsPerDoc ?? 8000; // was 20000
    const system =
      "You extract verbatim quotes that directly bear on a claim; classify stance and avoid speculation.";
    const user = `Claim: ${claim.text}\nSource: ${
      cand.title || cand.url
    }\nText (truncated):\n${text.slice(0, maxChars)}\nTask: Select up to ${
      opt.maxEvidencePerDoc ?? 1 // was 2
    } short quotes (<= 40 words) with stance and 1-line summary.`;

    const schema =
      '{"items":[{"quote":"...","stance":"support|refute|nuance|insufficient","summary":"...","location":{"page":null,"section":"..."}}]}';

    // 2) LLM evidence
    const llmLabel = `[EV][llm-evidence][${claim.id}][${shortUrl}]`;
    console.time(llmLabel);
    const out = await this.deps.llm.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.1,
    });
    console.timeEnd(llmLabel);
    const items = out && Array.isArray(out.items) ? out.items : [];

    const quality = (c) => {
      const base = (c.score ?? 0) / 100;
      const boost = c.domain?.match(
        /(reuters|apnews|nature|nih|who|gov|\.edu)/i
      )
        ? 0.2
        : 0;
      return Math.max(0, Math.min(1, base + boost));
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
      });
    }
    return arr;
  }

  adjudicate(claim, evidence) {
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

    const buckets = {
      support: 0,
      refute: 0,
      nuance: 0,
      insufficient: 0,
    };

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

    return {
      claimId: claim.id,
      finalVerdict,
      confidence,
      rationale,
      evidenceIds: picks.map((e) => e.id),
      counters: counters.map((e) => e.id),
    };
  }

  async redTeam(claim, adj, evidence) {
    const system =
      "You critically audit conclusions. Identify weak assumptions and missing evidence.";
    const user = `Claim: ${claim.text}\nVerdict: ${
      adj.finalVerdict
    } (${adj.confidence.toFixed(2)})\nEvidence:\n${JSON.stringify(
      evidence
    ).slice(
      0,
      8000
    )}\nTask: <=120 words blindspots + delta_confidence (-0.2..0).`;
    const schema = '{"blindspots":["..."],"delta_confidence":0}';

    try {
      const out = await this.deps.llm.generate({
        system,
        user,
        schemaHint: schema,
        temperature: 0.1,
      });

      const delta =
        typeof out.delta_confidence === "number" ? out.delta_confidence : 0;

      const newConfidence = Math.max(0, Math.min(1, adj.confidence + delta));

      const blindspots =
        Array.isArray(out.blindspots) && out.blindspots.length
          ? `\nBlindspots: ${out.blindspots.join("; ")}`
          : "";

      return {
        ...adj,
        confidence: newConfidence,
        rationale: adj.rationale + blindspots,
      };
    } catch {
      return adj;
    }
  }

  // End-to-end
  async run(claims, contexts, opt) {
    const results = [];

    for (const claim of claims) {
      const ctx = contexts ? contexts[claim.id] : undefined;
      const claimLabel = `[EV][claim:${claim.id}]`;

      console.time(`${claimLabel} total`);

      const queries = await this.generateQueries(
        claim,
        ctx,
        opt.topKQueries ?? 3 // was 6
      );

      const candidates = await this.retrieveCandidates(claim, queries, opt);

      const evs = (
        await Promise.all(
          candidates
            .slice(0, opt.maxEvidenceCandidates)
            .map((c) => this.extractEvidence(claim, c, opt))
        )
      ).flat();

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

      results.push(row);

      console.timeEnd(`${claimLabel} total`);
    }

    try {
      await this.deps.storage.persistResults(results);
    } catch {
      // ignore storage errors for now
    }

    return results;
  }
}
