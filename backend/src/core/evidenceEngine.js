// backend/src/core/evidenceEngine.js

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
    console.time(label);

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

    console.timeEnd(label);

    console.log(`🟦 [DEBUG] Queries for ${claim.id}:`, qs);

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

    const finalCandidates = Array.from(best.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);

    console.log(`🟩 [DEBUG] Candidates for ${claim.id}:`, finalCandidates);

    return finalCandidates;
  }

  async extractEvidence(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;

    const fetchLabel = `[EV][fetch][${claim.id}][${shortUrl}]`;
    console.time(fetchLabel);

    const text = await this.deps.fetcher.getText(cand);
    console.timeEnd(fetchLabel);

    if (!text) {
      console.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return [];
    }

    const maxChars = opt.maxCharsPerDoc ?? 8000;

    const system =
      "You extract verbatim quotes that directly bear on a claim; classify stance.";

    const user = `Claim: ${claim.text}\nSource: ${
      cand.title || cand.url
    }\nText:\n${text.slice(0, maxChars)}`;

    const schema =
      '{"items":[{"quote":"...","stance":"support|refute|nuance|insufficient","summary":"...","location":{"page":null,"section":"..."}}]}';

    const llmLabel = `[EV][llm-evidence][${claim.id}][${shortUrl}]`;
    console.time(llmLabel);

    const out = await this.deps.llm.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.1,
    });

    console.timeEnd(llmLabel);

    console.log(
      `📘 [DEBUG] LLM raw evidence for ${claim.id}/${shortUrl}:`,
      out
    );

    const items = out && Array.isArray(out.items) ? out.items : [];

    console.log(
      `📙 [DEBUG] Parsed ${items.length} evidence items for ${claim.id}/${shortUrl}`
    );

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

    console.log(
      `🟪 [DEBUG] Final evidence array for ${claim.id}/${shortUrl}:`,
      arr
    );

    return arr;
  }

  adjudicate(claim, evidence) {
    console.log(
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

    console.log(
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

  async run(claims, contexts, opt) {
    const results = [];

    for (const claim of claims) {
      const ctx = contexts ? contexts[claim.id] : undefined;

      console.log(
        `\n🔵 [DEBUG] Starting claim ${claim.id}: "${claim.text.slice(
          0,
          50
        )}..."`
      );

      const claimLabel = `[EV][claim:${claim.id}]`;
      console.time(`${claimLabel} total`);

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

      console.log(
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

      results.push(row);

      console.timeEnd(`${claimLabel} total`);
    }

    console.log("🟩 [DEBUG] Final results before persist:", results);

    try {
      await this.deps.storage.persistResults(results);
    } catch (err) {
      console.log("🟥 [DEBUG] Persist error:", err);
    }

    return results;
  }
}
