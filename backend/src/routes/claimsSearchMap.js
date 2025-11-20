// ESM
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();
const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

// TODO: swap this with Tavily/SerpAPI/etc. (current stub returns no results)
async function searchWebSimple(_query) {
  // Return an array of: [{ url, title, snippet }]
  return [];
}

function filterByDomainPrefs(results, prefer = [], avoid = []) {
  const score = (u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (avoid.some((d) => host.endsWith(d))) return -10;
      if (prefer.some((d) => host.endsWith(d))) return 5;
      return 0;
    } catch {
      return 0;
    }
  };
  return results
    .map((r) => ({ ...r, _s: score(r.url) }))
    .sort((a, b) => b._s - a._s);
}

async function openaiJSON({
  system,
  user,
  model = "gpt-4o-mini",
  temperature = 0.2,
}) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || `OpenAI HTTP ${resp.status}`;
    throw new Error(msg);
  }

  let content = json?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// POST /api/claims/search-map
// body: { items: [{ claim, queries: string[], prefer_domains: string[], avoid_domains: string[] }] }
router.post("/search-map", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Missing items[]" });
    }

    const perClaimResults = [];

    for (const item of items) {
      const {
        claim,
        queries = [],
        prefer_domains = [],
        avoid_domains = [],
      } = item || {};

      // 1) Gather web candidates across queries
      let candidates = [];
      for (const q of queries.slice(0, 4)) {
        const r = await searchWebSimple(q);
        if (Array.isArray(r) && r.length) candidates.push(...r);
      }

      // 2) De-dupe by URL
      const seen = new Set();
      const dedup = [];
      for (const c of candidates) {
        if (c?.url && !seen.has(c.url)) {
          seen.add(c.url);
          dedup.push(c);
        }
      }

      // 3) Re-rank by domain prefs (still fine even if empty)
      const ranked = filterByDomainPrefs(dedup, prefer_domains, avoid_domains)
        .slice(0, 10)
        .map(({ _s, ...rest }) => rest);

      // 4) Ask LLM to pick 1–3 best and label stance
      const system =
        "You map web results to the claim. Choose up to 3 that best SUPPORT or REFUTE the claim. " +
        "Label each as supports/refutes/background and explain briefly.";
      const user =
        "Claim:\n" +
        (claim || "") +
        "\n\nCandidates (JSON):\n" +
        JSON.stringify(ranked, null, 2) +
        "\n\nReturn JSON: { claim, sources:[{url,title,stance,why}] }";

      const picked = await openaiJSON({ system, user });

      // Ensure stable shape
      const safe = {
        claim: picked?.claim ?? claim ?? "",
        sources: Array.isArray(picked?.sources) ? picked.sources : [],
      };

      perClaimResults.push(safe);
    }

    return res.json({ success: true, results: perClaimResults });
  } catch (err) {
    console.error("search-map error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Search mapping failed" });
  }
});

export default router;
