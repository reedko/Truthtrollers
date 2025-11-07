// ESM
import express from "express";

const router = express.Router();
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;

// Small helper to call OpenAI and demand JSON back
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
    // surface LLM error text if any
    const msg = json?.error?.message || `OpenAI HTTP ${resp.status}`;
    throw new Error(msg);
  }

  let content = json?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    // last-ditch: return empty shape
    return {};
  }
}

// POST /api/claims/suggest-queries
// body: { text: string, claims: string[] }
router.post("/suggest-queries", async (req, res) => {
  try {
    const { text, claims } = req.body || {};
    if (!text || !Array.isArray(claims) || !claims.length) {
      return res.status(400).json({ error: "Missing text or claims[]" });
    }

    const system =
      "You are a research assistant. For each short claim, propose 3–5 web search queries and a list of preferred domains and disallowed domains. Output strict JSON.";
    const user =
      "Return JSON as { items: [{ claim, queries: string[], prefer_domains: string[], avoid_domains: string[] }] } " +
      "for these claims in the given text:\n\n" +
      JSON.stringify({ text: String(text).slice(0, 8000), claims }, null, 2);

    const out = await openaiJSON({ system, user });
    const safeItems = Array.isArray(out?.items) ? out.items : [];

    return res.json({ success: true, items: safeItems });
  } catch (err) {
    console.error("suggest-queries error:", err);
    return res.status(500).json({ success: false, error: "LLM failed" });
  }
});

export default router;
