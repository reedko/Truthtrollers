// backend/src/routes/evidence/evidence.routes.js
import { Router } from "express";

import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";
import { persistAIResults } from "../../storage/persistAIResults.js";
import { logUserActivity } from "../../utils/logUserActivity.js";
import { getEvidenceComparisonRun } from "../../core/evidenceComparisonRegistry.js";
import {
  CLAIM_LINK_HEADERS,
  LOAD_HEADERS,
  buildClaimLinkComparisonRows,
  buildLoadComparisonRows,
  loadEvidenceComparisonDbData,
  rowsToCsv,
} from "../../core/evidenceComparisonExport.js";
import { createZipBuffer } from "../../utils/simpleZip.js";
import {
  GATING_PROJECTION_HEADERS,
  REVIEW_HEADERS,
  SUMMARY_HEADERS,
  TOKEN_SUMMARY_HEADERS,
  buildEvidenceReviewRows,
  buildEvidenceSummaryRows,
  buildGatingProjectionRows,
  buildTokenSummaryRows,
} from "../../core/evidenceReviewExport.js";

export default function createEvidenceRoutes({ query, pool }) {
  const router = Router();

  router.get("/api/dev/evidence-comparison/export", async (req, res) => {
    const enabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_EVIDENCE_EXPORT === "true";
    if (!enabled) return res.status(404).json({ error: "Developer evidence export is disabled." });

    const contentId = Number.parseInt(req.query.content_id, 10);
    if (!Number.isInteger(contentId) || contentId <= 0) {
      return res.status(400).json({ error: "A valid content_id is required." });
    }
    const format = String(req.query.format || "csv").toLowerCase();
    if (!['csv', 'zip'].includes(format)) {
      return res.status(400).json({
        error: "XLSX is not available because no workbook library is installed. Use format=csv; the response is a ZIP containing both CSV sheets.",
      });
    }

    try {
      const snapshot = getEvidenceComparisonRun(contentId);
      const dbData = await loadEvidenceComparisonDbData(query, contentId, snapshot);
      if (!dbData) return res.status(404).json({ error: `Content ${contentId} was not found.` });

      const linkRows = buildClaimLinkComparisonRows({
        caseClaims: dbData.caseClaims,
        legacyLinks: dbData.legacyLinks,
        snapshot,
        sourceMetadataByContentId: dbData.sourceMetadataByContentId,
      });
      const loadRows = buildLoadComparisonRows({
        contentId,
        caseClaims: dbData.caseClaims,
        snapshot,
        legacyStatsByClaimId: dbData.legacyStatsByClaimId,
        costRates: {
          inputPerMillion: process.env.OPENAI_INPUT_COST_PER_1M,
          outputPerMillion: process.env.OPENAI_OUTPUT_COST_PER_1M,
        },
      });
      const reviewRows = buildEvidenceReviewRows({
        caseClaims: dbData.caseClaims,
        legacyLinks: dbData.legacyLinks,
        snapshot,
        sourceMetadataByContentId: dbData.sourceMetadataByContentId,
      });
      const gatingRows = buildGatingProjectionRows({
        caseClaims: dbData.caseClaims,
        snapshot,
        loadRows,
      });
      const summaryRows = buildEvidenceSummaryRows({
        contentId,
        caseClaims: dbData.caseClaims,
        snapshot,
        reviewRows,
        gatingRows,
        loadRows,
      });
      const tokenSummaryRows = buildTokenSummaryRows({
        contentId,
        caseClaims: dbData.caseClaims,
        snapshot,
        gatingRows,
        loadRows,
      });
      const metadata = {
        content_id: contentId,
        content_title: dbData.content.content_name || "not_available",
        content_url: dbData.content.url || "not_available",
        exported_at: new Date().toISOString(),
        run_timestamp: snapshot ? new Date(snapshot.completedAtMs).toISOString() : "not_available",
        bearing_snapshot: snapshot ? "in_memory" : "not_available",
        enable_bearing_shadow: snapshot?.flags?.enableBearingShadow ?? "not_available",
        enable_snippet_bearing_llm: snapshot?.flags?.enableSnippetBearingLlm ?? "not_available",
        enable_bearing_gating: snapshot?.flags?.enableBearingGating ?? "not_available",
        enable_bearing_packet: snapshot?.flags?.enableBearingPacket ?? "not_available",
        enable_bearing_packet_live: snapshot?.flags?.enableBearingPacketLive ?? "not_available",
        token_usage: snapshot?.actualTokenUsage
          ? "api_reported_actual_total_plus_estimated_per_claim_breakdown"
          : "estimated_from_retained_character_counts",
        projection_mode: "conservative_shadow_only_not_actual_savings",
      };
      const linksCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison Export — Claim Link Comparison",
        metadata,
        headers: CLAIM_LINK_HEADERS,
        rows: linkRows,
      });
      const loadCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison Export — Load Comparison",
        metadata,
        headers: LOAD_HEADERS,
        rows: loadRows,
      });
      const reviewCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison — Human Review",
        metadata,
        headers: REVIEW_HEADERS,
        rows: reviewRows,
      });
      const summaryCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison — Compact Summary",
        metadata,
        headers: SUMMARY_HEADERS,
        rows: summaryRows,
      });
      const gatingCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison — Conservative Gating Projection",
        metadata,
        headers: GATING_PROJECTION_HEADERS,
        rows: gatingRows,
      });
      const tokenSummaryCsv = rowsToCsv({
        title: "VeriStrata Evidence Comparison — Token Summary",
        metadata,
        headers: TOKEN_SUMMARY_HEADERS,
        rows: tokenSummaryRows,
      });
      const sheet = String(req.query.sheet || "").toLowerCase();
      if (["links", "load", "review", "summary", "metrics", "gating"].includes(sheet)) {
        const sheets = {
          links: { filename: `evidence_comparison_links_${contentId}.csv`, csv: linksCsv },
          load: { filename: `evidence_comparison_load_${contentId}.csv`, csv: loadCsv },
          review: { filename: `evidence_comparison_review_${contentId}.csv`, csv: reviewCsv },
          summary: { filename: `evidence_comparison_summary_${contentId}.csv`, csv: summaryCsv },
          metrics: { filename: `evidence_comparison_token_summary_${contentId}.csv`, csv: tokenSummaryCsv },
          gating: { filename: `evidence_comparison_gating_projection_${contentId}.csv`, csv: gatingCsv },
        };
        const selected = sheets[sheet];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${selected.filename}"`);
        return res.send(`\ufeff${selected.csv}`);
      }

      const archive = createZipBuffer([
        { name: `evidence_comparison_links_${contentId}.csv`, data: `\ufeff${linksCsv}` },
        { name: `evidence_comparison_load_${contentId}.csv`, data: `\ufeff${loadCsv}` },
      ]);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="evidence_comparison_${contentId}.zip"`);
      return res.send(archive);
    } catch (error) {
      console.error("Evidence comparison export failed:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/run-evidence
   * Body:
   *   { taskContentId, claimIds, readableText }
   */
  router.post("/api/run-evidence", async (req, res) => {
    try {
      const { taskContentId, claimIds, readableText } = req.body;

      if (!taskContentId || !Array.isArray(claimIds)) {
        return res.status(400).json({
          success: false,
          error: "Missing taskContentId or claimIds",
        });
      }

      // Step 1 — AI evidence
      const engineOut = await runEvidenceEngine({
        query,
        taskContentId,
        claimIds,
        readableText,
      });

      // Step 2 — Persist AI refs + evidence
      await persistAIResults(query, {
        contentId: taskContentId,
        evidenceRefs: engineOut.aiReferences || [],
        claimIds: claimIds || [],
        claimConfidenceMap: engineOut.claimConfidenceMap || new Map(),
      });

      // Step 3 — Log user activity for engagement tracking
      await logUserActivity(query, {
        userId: req.user?.user_id || null,
        username: req.user?.username || null,
        activityType: 'evidence_run',
        contentId: taskContentId,
        metadata: {
          claimCount: claimIds.length,
          textLength: readableText?.length || 0,
          referencesFound: (engineOut.aiReferences || []).length
        }
      });

      return res.json({
        success: true,
        ...engineOut,
      });
    } catch (err) {
      console.error("❌ /api/run-evidence:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
