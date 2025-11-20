// backend/src/routes/mapClaims.js

// IMPORTANT:
// You must import the JS file directly, with extension!
import { EvidenceEngine } from "../core/evidenceEngine.js";

// DevDeps was a TS-only construct — in JS we must import the real adapters.
// You’ll replace these with correct JS adapter imports.
import { DevDeps } from "../core/devDeps.js";

export function registerMapClaimsRoute(app) {
  const engine = new EvidenceEngine(DevDeps, {
    preferDomains: ["reuters.com", "apnews.com", "example.edu"],
    avoidDomains: ["clickbait"],
    limits: {
      queriesPerClaim: 3,
      candidates: 8,
      evidencePerDoc: 2,
      concurrency: 4,
    },
  });

  app.post("/api/claims/map-claims", async (req, res) => {
    const { claims, contexts = {}, options = {} } = req.body || {};

    try {
      const out = await engine.run(claims || [], contexts, {
        enableInternal: true,
        enableWeb: true,
        ...options,
      });

      res.json(out);
    } catch (err) {
      console.error("map-claims error", err);
      res.status(500).json({
        error: "map-claims failed",
        details: err?.message || String(err),
      });
    }
  });
}
