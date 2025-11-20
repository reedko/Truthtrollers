// routes/claimsMapOneShot.js
import express from "express";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

const router = express.Router();

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID || undefined;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEY_V2;

// knobs
const QUERIES_PER_CLAIM = Number(process.env.QUERIES_PER_CLAIM || 4);
const SEARCH_RESULTS_PER_CLAIM = Number(
  process.env.SEARCH_RESULTS_PER_CLAIM || 8
);
const PICKS_PER_CLAIM = Number(process.env.PICKS_PER_CLAIM || 3);
const MAX_CONCURRENCY = Number(process.env.CLAIM_CONCURRENCY || 4);
const MAX_TOKENS = Number(process.env.MAP_ONESHOT_MAX_TOKENS || 384);
const REFINE_QUERIES_WITH_LLM =
  String(process.env.REFINE_QUERIES_WITH_LLM || "true") === "true";
const PICK_WITH_LLM = String(process.env.PICK_WITH_LLM || "true") === "true";
const STRICT_DOMAIN_FILTER =
  String(process.env.STRICT_DOMAIN_FILTER || "false") === "true";

const AGENT = new https.Agent({ keepAlive: true });

const PREFER = [
  "apnews.com",
  "reuters.com",
  "bbc.com",
  "wikipedia.org",
  "fullfact.org",
  "snopes.com",
  "factcheck.org",
  "politifact.com",
];

// ---------- utils ----------
async function runPool(items, worker, concurrency) {
  const res = new Array(items.length);
  let idx = 0;
  async function loop() {
    while (idx < items.length) {
      const my = idx++;
      try {
        res[my] = await worker(items[my], my);
      } catch (e) {
        res[my] = { error: String(e?.message || e) };
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => loop()
  );
  await Promise.all(workers);
  return res;
}

function dedupeRefs(refs) {
  const by = new Map();
  for (const r of refs || []) {
    if (!r?.url) continue;
    const ex = by.get(r.url);
    if (!ex) {
      by.set(r.url, {
        url: r.url,
        content_name: r.content_name || r.title || r.url,
        origin: "claim",
        claims: r.claims?.length ? [...new Set(r.claims)] : [],
      });
    } else {
      if (!ex.content_name && (r.content_name || r.title))
        ex.content_name = r.content_name || r.title;
      const s = new Set([...(ex.claims || []), ...(r.claims || [])]);
      ex.claims = [...s];
    }
  }
  return [...by.values()];
}

function localQueriesForClaim(c) {
  const claim = String(c || "").trim();
  const base = [
    claim,
    `${claim} fact check`,
    `${claim} site:wikipedia.org`,
    `${claim} site:reuters.com`,
    `${claim} site:apnews.com`,
  ];
  return [...new Set(base)].slice(0, QUERIES_PER_CLAIM);
}

// ---------- external ----------
async function openaiJSON({ messages, model = OPENAI_MODEL, temperature = 0 }) {
  if (!OPENAI_API_KEY) {
    const e = new Error("NO_API_KEY");
    e.httpStatus = 401;
    throw e;
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
  if (OPENAI_PROJECT_ID) headers["OpenAI-Project"] = OPENAI_PROJECT_ID;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    agent: AGENT,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  const text = await resp.text();
  let outer;
  try {
    outer = text ? JSON.parse(text) : {};
  } catch {
    outer = { raw: text?.slice(0, 200) };
  }
  if (!resp.ok) {
    const msg = outer?.error?.message || `HTTP ${resp.status}`;
    const e = new Error(msg);
    e.httpStatus = resp.status;
    throw e;
  }
  const content = outer?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function tavilySearch(query, { includeDomains, excludeDomains }) {
  if (!TAVILY_API_KEY) {
    console.warn("[map-claims] ⚠️ Missing TAVILY_API_KEY; returning empty");
    return { results: [] };
  }
  const body = {
    api_key: TAVILY_API_KEY,
    query,
    search_depth: "basic",
    max_results: SEARCH_RESULTS_PER_CLAIM,
    include_answer: false,
    include_raw_content: false,
    include_domains:
      STRICT_DOMAIN_FILTER &&
      Array.isArray(includeDomains) &&
      includeDomains.length
        ? includeDomains
        : undefined,
    exclude_domains:
      Array.isArray(excludeDomains) && excludeDomains.length
        ? excludeDomains
        : undefined,
  };

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    agent: AGENT,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.warn(
      "[map-claims] Tavily error:",
      resp.status,
      text?.slice(0, 160)
    );
    return { results: [] };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  const arr = Array.isArray(json?.results) ? json.results : [];
  return arr.slice(0, SEARCH_RESULTS_PER_CLAIM).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.content || r.snippet || "",
    score: r.score,
  }));
}

// ---------- prompts ----------
function buildQueriesPrompt(indexedClaims) {
  // indexedClaims: [{i, claim}]
  const system = "Return strict JSON only.";
  const user =
    `For each item, propose up to ${QUERIES_PER_CLAIM} concise web search queries.` +
    ' Return EXACTLY: {"items":[{"i":0,"queries":["q1","q2","q3","q4"]}]}.' +
    " Keep `i` unchanged for alignment.\n" +
    "Items:\n" +
    JSON.stringify({ items: indexedClaims });
  return { system, user };
}

function buildPickerPrompt({ claim, candidates, picks = PICKS_PER_CLAIM }) {
  const system = "Return strict JSON only.";
  const user =
    `Pick up to ${picks} links from CANDIDATES that best assess the CLAIM. ` +
    'Prefer high-credibility/primary sources. Label stance: "support" | "refute" | "neutral" and add a short "why". ' +
    'Return EXACTLY: {"pick":[{"url":"...","title":"...","stance":"support|refute|neutral","why":"..."}]} ' +
    "CLAIM:\n" +
    JSON.stringify(claim) +
    "\n" +
    "CANDIDATES:\n" +
    JSON.stringify(candidates);
  return { system, user };
}

// ---------- route ----------
/**
 * POST /api/claims/map-claims
 * body: {
 *   claims: string[] | { text:string, queries?:string[] }[],
 *   prefer_domains?: string[],
 *   avoid_domains?: string[],
 *   return_queries?: boolean
 * }
 */
router.post("/map-claims", async (req, res) => {
  const started = Date.now();

  // refine counters (for visibility)
  let refineTried = 0;
  let refineApplied = 0;
  let refineMissed = 0;

  try {
    const {
      claims: rawClaims,
      prefer_domains = PREFER,
      avoid_domains = [],
      return_queries = true,
    } = req.body || {};

    // normalize claims → [{i, text, queries?}]
    const base = (Array.isArray(rawClaims) ? rawClaims : [])
      .map((c, i) => {
        if (typeof c === "string") return { i, text: c.trim(), queries: [] };
        const text = String(c?.text || "").trim();
        const queries = Array.isArray(c?.queries)
          ? c.queries.filter(Boolean)
          : [];
        return { i, text, queries };
      })
      .filter((c) => c.text);

    if (!base.length) {
      return res
        .status(400)
        .json({ success: false, error: "Missing claims[]" });
    }

    // --- 1) Ensure queries per claim (LLM refine, aligned by index), else local
    const needsQueries = base
      .map((c) => (!c.queries?.length ? { i: c.i, claim: c.text } : null))
      .filter(Boolean);

    if (REFINE_QUERIES_WITH_LLM && needsQueries.length) {
      refineTried = needsQueries.length;

      const { system, user } = buildQueriesPrompt(needsQueries);
      try {
        console.log(
          `[map-claims] refine → sending ${needsQueries.length} items`
        );
        const out = await openaiJSON({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });

        const arr = Array.isArray(out?.items) ? out.items : [];
        console.log(`[map-claims] refine ← got ${arr.length} items from LLM`);

        if (!arr.length) {
          console.warn(
            "[map-claims] refine: LLM returned empty items; using local queries"
          );
        }

        // merge by i; accept "queries" or "q"
        for (const it of arr) {
          const idx = Number(it?.i);
          const entry = base.find((b) => b.i === idx);
          if (!entry) {
            refineMissed++;
            continue;
          }

          const rawQs = Array.isArray(it?.queries)
            ? it.queries
            : Array.isArray(it?.q)
            ? it.q
            : [];
          const qs = (rawQs || [])
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean);

          if (qs.length) {
            entry.queries = [...new Set(qs)].slice(0, QUERIES_PER_CLAIM);
            refineApplied++;
          } else {
            entry.queries = localQueriesForClaim(entry.text);
            refineMissed++;
          }
        }
      } catch (e) {
        console.warn(
          "[map-claims] refine error; using local for all missing:",
          e?.message || e
        );
        for (const m of needsQueries) {
          const entry = base.find((b) => b.i === m.i);
          if (entry && (!entry.queries || !entry.queries.length)) {
            entry.queries = localQueriesForClaim(entry.text);
          }
        }
      }
    }

    // any still missing → local
    for (const c of base) {
      if (!c.queries || !c.queries.length)
        c.queries = localQueriesForClaim(c.text);
      else c.queries = c.queries.slice(0, QUERIES_PER_CLAIM);
    }

    // --- 2) SEARCH (Tavily) per claim, in parallel
    const searchResults = await runPool(
      base,
      async (cl) => {
        const perQuery = await Promise.all(
          cl.queries.map((q) =>
            tavilySearch(q, {
              includeDomains: prefer_domains,
              excludeDomains: avoid_domains,
            })
          )
        );
        // flatten + dedupe by URL
        const seen = new Set();
        const merged = [];
        for (const arr of perQuery) {
          for (const r of arr || []) {
            if (!r?.url || seen.has(r.url)) continue;
            seen.add(r.url);
            merged.push(r);
          }
        }
        return merged.slice(0, SEARCH_RESULTS_PER_CLAIM);
      },
      MAX_CONCURRENCY
    );

    const totalCandidates = searchResults.reduce(
      (n, arr) => n + (arr?.length || 0),
      0
    );
    console.log(`[map-claims] candidates total=${totalCandidates}`);
    if (!totalCandidates) {
      console.log("[map-claims] ex claim:", base[0]?.text);
      console.log("[map-claims] ex queries:", base[0]?.queries);
    }

    // --- 3) PICK (LLM) with heuristic fallback
    const picks = await runPool(
      base,
      async (cl, idx) => {
        const candidates = (searchResults[idx] || []).map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
        }));
        console.log(
          `[map-claims] picker: claim="${cl.text.slice(0, 80)}..." candidates=${
            candidates.length
          }`
        );
        if (!candidates.length) return { pick: [] };

        if (!PICK_WITH_LLM) {
          return {
            pick: candidates.slice(0, PICKS_PER_CLAIM).map((c) => ({
              url: c.url,
              title: c.title,
              stance: "neutral",
              why: "High-ranked search result.",
            })),
          };
        }

        try {
          const { system, user } = buildPickerPrompt({
            claim: cl.text,
            candidates,
            picks: PICKS_PER_CLAIM,
          });
          const out = await openaiJSON({
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });
          const pick = Array.isArray(out?.pick) ? out.pick : [];
          if (pick.length) return { pick };
          // fall through to heuristic if empty
        } catch (e) {
          console.warn(
            "[map-claims] picker LLM failed, using heuristic:",
            e?.message || e
          );
        }

        // heuristic fallback
        return {
          pick: candidates.slice(0, PICKS_PER_CLAIM).map((c) => ({
            url: c.url,
            title: c.title,
            stance: "neutral",
            why: "High-ranked search result.",
          })),
        };
      },
      MAX_CONCURRENCY
    );

    // --- 4) Build response
    const items = base.map((cl, idx) => ({
      i: cl.i,
      claim: cl.text,
      queries: return_queries ? cl.queries : undefined,
      picks: Array.isArray(picks[idx]?.pick) ? picks[idx].pick : [],
    }));

    const flatRefs = [];
    for (const it of items) {
      for (const p of it.picks || []) {
        if (!p?.url) continue;
        flatRefs.push({
          url: p.url,
          content_name: p.title || p.url,
          origin: "claim",
          claims: [it.claim],
        });
      }
    }
    const references = dedupeRefs(flatRefs);

    return res.json({
      success: true,
      items, // [{ i, claim, queries?, picks[] }]
      references, // Lit_references[]
      took_ms: Date.now() - started,
      meta: {
        model: OPENAI_MODEL,
        queries_per_claim: QUERIES_PER_CLAIM,
        search_results_per_claim: SEARCH_RESULTS_PER_CLAIM,
        picks_per_claim: PICKS_PER_CLAIM,
        concurrency: MAX_CONCURRENCY,
        refined_queries_with_llm: REFINE_QUERIES_WITH_LLM,
        pick_with_llm: PICK_WITH_LLM,
        refine_tried: refineTried,
        refine_applied: refineApplied,
        refine_missed: refineMissed,
      },
    });
  } catch (err) {
    console.error("[claims/map-claims] error:", err?.message || err);
    return res.status(200).json({
      success: false,
      error: String(err?.message || err),
      took_ms: Date.now() - started,
    });
  }
});

export default router;
