// backend/src/routes/debug/sourceProviders.routes.js
// Dev/admin-only diagnostic endpoints for source provider health + testing.
// Register in server.js behind an env guard (process.env.NODE_ENV !== 'production').

import { Router } from "express";
import {
  checkAllProviders,
  lookupPublisherAllProviders,
  lookupClaimAllProviders,
  listProviders,
} from "../../../services/sourceProviders/sourceProviderRegistry.js";
import { evaluateAdmiraltyCode } from "../../../services/admiraltyEvaluator.js";
import logger from "../../utils/logger.js";

export default function createSourceProviderDebugRoutes() {
  const router = Router();

  // ── GET /api/debug/source-providers ──────────────────────────────────────
  router.get("/", (_req, res) => {
    res.json({
      endpoints: {
        "GET  /api/debug/source-providers/health":       "Health check all providers",
        "POST /api/debug/source-providers/test-publisher":"Lookup publisher across all providers",
        "POST /api/debug/source-providers/test-claim":   "Lookup claim (Google Fact Check etc.)",
        "POST /api/debug/source-providers/test-full":    "Full admiralty evaluation trace",
      },
      providers: listProviders(),
    });
  });

  // ── GET /api/debug/source-providers/health ───────────────────────────────
  router.get("/health", async (_req, res) => {
    logger.log("🔬 [debug] Running provider health checks...");
    const results = await checkAllProviders();
    const summary = {
      total: results.length,
      ok:    results.filter(r => r.ok).length,
      failing: results.filter(r => !r.ok).map(r => r.providerName),
    };
    res.json({ summary, results });
  });

  // ── POST /api/debug/source-providers/test-publisher ──────────────────────
  router.post("/test-publisher", async (req, res) => {
    const { domain, publisherName, sourceUrl } = req.body ?? {};
    if (!domain && !publisherName && !sourceUrl) {
      return res.status(400).json({ error: "Provide at least one of: domain, publisherName, sourceUrl" });
    }
    logger.log(`🔬 [debug] Publisher lookup: ${publisherName ?? domain ?? sourceUrl}`);
    const results = await lookupPublisherAllProviders({ domain, publisherName, sourceUrl });
    const matched = results.filter(r => r.matchFound);
    res.json({
      query: { domain, publisherName, sourceUrl },
      summary: { total: results.length, matched: matched.length, matchedProviders: matched.map(r => r.providerName) },
      results,
    });
  });

  // ── POST /api/debug/source-providers/test-claim ──────────────────────────
  router.post("/test-claim", async (req, res) => {
    const { claimText, sourceUrl, publisherName } = req.body ?? {};
    if (!claimText?.trim()) {
      return res.status(400).json({ error: "claimText is required" });
    }
    logger.log(`🔬 [debug] Claim lookup: "${claimText.slice(0, 80)}..."`);
    const results = await lookupClaimAllProviders({ claimText, sourceUrl, publisherName });
    const matched = results.filter(r => r.matchFound);
    res.json({
      query: { claimText, sourceUrl, publisherName },
      summary: { total: results.length, matched: matched.length, matchedProviders: matched.map(r => r.providerName) },
      results,
    });
  });

  // ── POST /api/debug/source-providers/test-full ───────────────────────────
  router.post("/test-full", async (req, res) => {
    const { sourceUrl, publisherName, domain, claimText } = req.body ?? {};
    if (!sourceUrl && !domain && !publisherName) {
      return res.status(400).json({ error: "Provide sourceUrl, domain, or publisherName" });
    }

    logger.log(`🔬 [debug] Full evaluation trace for: ${sourceUrl ?? domain ?? publisherName}`);

    const trace = { steps: [], warnings: [] };

    // 1. Source identity
    let sourceIdentity = null;
    try {
      const { resolveSourceIdentity } = await import("../../../services/sourceIdentityResolver.js");
      sourceIdentity = await resolveSourceIdentity(sourceUrl ?? `https://${domain}`, { hintName: publisherName });
      trace.steps.push({ step: "source_identity", status: "ok", result: sourceIdentity });
    } catch (err) {
      trace.steps.push({ step: "source_identity", status: "error", error: err.message });
      trace.warnings.push(`sourceIdentity failed: ${err.message}`);
    }

    // 2. Source lineage
    let sourceLineage = null;
    if (sourceUrl) {
      try {
        const { resolveSourceLineage } = await import("../../../services/sourceLineageResolver.js");
        sourceLineage = await resolveSourceLineage(sourceUrl);
        trace.steps.push({ step: "source_lineage", status: "ok", result: sourceLineage });
      } catch (err) {
        trace.steps.push({ step: "source_lineage", status: "error", error: err.message });
        trace.warnings.push(`sourceLineage failed: ${err.message}`);
      }
    }

    // 3. Publisher enrichment providers
    const providerResults = await lookupPublisherAllProviders({ domain, publisherName, sourceUrl });
    trace.steps.push({
      step: "publisher_providers",
      status: "ok",
      summary: { total: providerResults.length, matched: providerResults.filter(r => r.matchFound).length },
      results: providerResults,
    });

    // 4. Claim lookup
    let claimProviderResults = [];
    if (claimText) {
      claimProviderResults = await lookupClaimAllProviders({ claimText, sourceUrl, publisherName });
      trace.steps.push({
        step: "claim_providers",
        status: "ok",
        results: claimProviderResults,
      });
    }

    // 5. Admiralty evaluation
    const evaluation = await evaluateAdmiraltyCode({
      sourceUrl,
      publisherName,
      sourceIdentity,
      sourceLineage,
      claimText,
      factCheckMatches: claimProviderResults.filter(r => r.providerName === "google_fact_check" && r.matchFound)
                                            .flatMap(r => r.allMatches ?? [r]),
      providerResults,
    }, { debug: true, runClaimLookup: false });

    trace.steps.push({ step: "admiralty_evaluation", status: "ok", result: evaluation });

    res.json({
      query: { sourceUrl, publisherName, domain, claimText },
      admiraltyCode: evaluation.admiraltyCode,
      sourceReliabilityLetter: evaluation.sourceReliabilityLetter,
      claimCredibilityNumber: evaluation.claimCredibilityNumber,
      confidence: evaluation.confidence,
      warnings: evaluation.warnings,
      recommendedActions: evaluation.recommendedActions,
      trace,
      evaluation,
    });
  });

  return router;
}
