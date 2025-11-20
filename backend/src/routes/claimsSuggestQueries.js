// routes/claimsSuggestQueries.js
import express from "express";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

const router = express.Router();

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID || undefined;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ---- performance knobs ----
const CHUNK_SIZE = Number(process.env.CLAIM_CHUNK_SIZE || 10); // claims per LLM call
const MAX_CONCURRENCY = Number(process.env.CLAIM_CONCURRENCY || 3); // parallel chunk calls
const REFINE_WITH_LLM =
  String(process.env.REFINE_WITH_LLM || "true") === "true";

// Reuse TLS connection to OpenAI
const OPENAI_AGENT = new https.Agent({ keepAlive: true });

// ---------- tiny helpers ----------
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// In-memory cache: claim string -> { claim, queries, prefer_domains, avoid_domains }
const CLAIM_CACHE = new Map();

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

function localQueriesForClaim(c) {
  const claim = String(c || "").trim();
  return [
    claim,
    `${claim} fact check`,
    `${claim} site:wikipedia.org`,
    `${claim} site:reuters.com`,
    `${claim} site:apnews.com`,
  ];
}

function makeLocalItems(claims) {
  return claims.map((claim) => ({
    claim,
    queries: localQueriesForClaim(claim),
    prefer_domains: PREFER,
    avoid_domains: [],
  }));
}

function fallbackItems(claims) {
  // same as local; separate name just to clarify logs/intent
  return makeLocalItems(claims);
}

async function openaiJSON({ system, user, model = MODEL, temperature = 0 }) {
  if (!OPENAI_API_KEY) {
    throw Object.assign(new Error("NO_API_KEY"), { httpStatus: 401 });
  }

  const started = Date.now();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
  if (OPENAI_PROJECT_ID) headers["OpenAI-Project"] = OPENAI_PROJECT_ID;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    agent: OPENAI_AGENT,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: 256,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const took = Date.now() - started;
  const bodyText = await resp.text();
  console.log(
    `[suggest-queries] ⏱️ OpenAI status=${resp.status} model=${model} took=${took}ms`
  );

  let outer;
  try {
    outer = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    outer = { raw: bodyText?.slice(0, 200) };
  }

  if (!resp.ok) {
    const msg = outer?.error?.message || `HTTP ${resp.status}`;
    const e = new Error(msg);
    e.httpStatus = resp.status;
    throw e;
  }

  const content = outer?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content); // expected { items: [...] }
  } catch {
    return {};
  }
}

// Build a super-tight prompt for a chunk of claims
function buildRefinePrompt(claims) {
  const system = "Return strict JSON only.";
  const user =
    "Refine up to 4 concise queries per claim. " +
    'Output exactly: {"items":[{"claim":"...","queries":["q1","q2","q3","q4"],"prefer_domains":["apnews.com","reuters.com","bbc.com","wikipedia.org","fullfact.org","snopes.com"],"avoid_domains":[]}]} ' +
    "for these claims: " +
    JSON.stringify({ claims });
  return { system, user };
}

// ---------- ROUTE ----------
router.post("/suggest-queries", async (req, res) => {
  const started = Date.now();
  const claimsRaw = Array.isArray(req.body?.claims) ? req.body.claims : [];
  console.log(
    `[suggest-queries] ▶️ POST /suggest-queries (${claimsRaw.length} claims) refine=${REFINE_WITH_LLM} chunk=${CHUNK_SIZE} cc=${MAX_CONCURRENCY}`
  );

  if (!claimsRaw.length) {
    return res.status(400).json({ success: false, error: "Missing claims[]" });
  }

  // normalize + dedupe
  const safeClaims = [
    ...new Set(
      claimsRaw
        .map((c) => (typeof c === "string" ? c : c?.text || ""))
        .filter(Boolean)
    ),
  ];

  // pull from cache
  const cached = [];
  const toProcess = [];
  for (const c of safeClaims) {
    const hit = CLAIM_CACHE.get(c);
    if (hit) cached.push(hit);
    else toProcess.push(c);
  }

  // start with local suggestions for "toProcess"
  let working = makeLocalItems(toProcess);

  // refine with LLM in parallel (chunked), if enabled
  if (REFINE_WITH_LLM && toProcess.length) {
    const chunks = chunk(toProcess, CHUNK_SIZE);
    let next = 0;
    const results = [];

    async function worker() {
      while (next < chunks.length) {
        const myIdx = next++;
        const claimsChunk = chunks[myIdx];

        try {
          const { system, user } = buildRefinePrompt(claimsChunk);
          const out = await openaiJSON({
            system,
            user,
            model: MODEL,
            temperature: 0,
          });
          const refined = Array.isArray(out?.items) ? out.items : [];

          // merge refined into working + cache
          for (const it of refined) {
            const claim = String(it?.claim || "").trim();
            if (!claim) continue;
            const queries =
              Array.isArray(it?.queries) && it.queries.length
                ? it.queries.slice(0, 4)
                : localQueriesForClaim(claim);

            const merged = {
              claim,
              queries,
              prefer_domains:
                Array.isArray(it?.prefer_domains) && it.prefer_domains.length
                  ? it.prefer_domains
                  : PREFER,
              avoid_domains: Array.isArray(it?.avoid_domains)
                ? it.avoid_domains
                : [],
            };

            CLAIM_CACHE.set(claim, merged);
            const idx = working.findIndex((w) => w.claim === claim);
            if (idx >= 0) working[idx] = merged;
            else working.push(merged);
          }
          results.push({ ok: true, n: refined.length });
        } catch (e) {
          // keep local for this chunk; do not fail request
          results.push({ ok: false, error: String(e?.message || e) });
          console.warn(
            `[suggest-queries] ⚠️ refine chunk failed: ${String(
              e?.message || e
            )}`
          );
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENCY, chunks.length) },
      () => worker()
    );
    await Promise.all(workers);
  } else {
    // no refine: cache local immediately
    for (const it of working) CLAIM_CACHE.set(it.claim, it);
  }

  // combine cached hits + working (preserve original safeClaims order)
  const byClaim = new Map();
  for (const it of [...cached, ...working]) byClaim.set(it.claim, it);
  const ordered = safeClaims.map((c) => byClaim.get(c)).filter(Boolean);

  const body = {
    success: true,
    items: ordered,
    took_ms: Date.now() - started,
    cache_hits: cached.length,
    refined: REFINE_WITH_LLM,
    chunk_size: CHUNK_SIZE,
    concurrency: MAX_CONCURRENCY,
  };

  console.log(
    `[suggest-queries] ✅ items=${ordered.length} cache_hits=${cached.length} total=${body.took_ms}ms`
  );
  return res.json(body);
});

export default router;
