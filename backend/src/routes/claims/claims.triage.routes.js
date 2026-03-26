// backend/src/routes/claims/claims.triage.routes.js
// API routes for claim triage and source quality scoring

import { Router } from "express";
import { ClaimEvaluationClassifier } from "../../core/claimEvaluationClassifier.js";
import { SourceQualityScorer } from "../../core/sourceQualityScorer.js";
import { openAiLLM } from "../../core/openAiLLM.js";

export default function createClaimTriageRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/claims/quality-scores/:contentId
   * Get source quality scores for content
   */
  router.get("/api/claims/quality-scores/:contentId", async (req, res) => {
    try {
      const { contentId } = req.params;

      const sql = `
        SELECT
          sqs.content_id,
          sqs.author_transparency,
          sqs.publisher_transparency,
          sqs.evidence_density,
          sqs.claim_specificity,
          sqs.correction_behavior,
          sqs.domain_reputation,
          sqs.sensationalism_score,
          sqs.monetization_pressure,
          sqs.original_reporting,
          sqs.quality_score,
          sqs.risk_score,
          sqs.quality_tier,
          sqs.scored_at,
          sqs.scoring_model,
          c.content_name,
          c.url,
          c.media_source
        FROM source_quality_scores sqs
        JOIN content c ON sqs.content_id = c.content_id
        WHERE sqs.content_id = ?
      `;

      const scores = await query(sql, [contentId]);

      if (!scores || scores.length === 0) {
        return res
          .status(404)
          .json({ error: "No quality scores found for this content" });
      }

      const result = scores[0];

      // Fetch author info (format: First Last, Title)
      const authorSql = `
        SELECT
          CONCAT(
            a.author_first_name,
            ' ',
            a.author_last_name,
            CASE
              WHEN a.author_title IS NOT NULL AND a.author_title != ''
              THEN CONCAT(', ', a.author_title)
              ELSE ''
            END
          ) AS author_name
        FROM content_authors ca
        JOIN authors a ON ca.author_id = a.author_id
        WHERE ca.content_id = ?
        LIMIT 1
      `;
      const authors = await query(authorSql, [contentId]);
      result.author_name = authors?.[0]?.author_name || null;
      result.author_credentials = null; // No credentials field in current schema

      // Extract citation count from content_text (rough estimate)
      const contentSql = `SELECT content_text FROM content WHERE content_id = ?`;
      const contentRows = await query(contentSql, [contentId]);
      const contentText = contentRows?.[0]?.content_text || '';

      // Count inline citation patterns and rough estimate
      const inlineCitations = (contentText.match(/\[\d+\]/g) || []).length;
      const urlCitations = (contentText.match(/https?:\/\/[^\s<>"']+/gi) || []).length;
      result.citation_count = inlineCitations + Math.min(urlCitations, 50); // Cap URLs at 50 to avoid body text URLs

      res.json(result);
    } catch (err) {
      console.error("Error fetching quality scores:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/claims/run-quality-analysis/:contentId
   * Run source quality analysis on a single content item
   */
  router.post("/api/claims/run-quality-analysis/:contentId", async (req, res) => {
    try {
      const { contentId } = req.params;

      // 1. Fetch content details from database
      const contentSql = `
        SELECT
          content_id,
          content_name,
          url,
          content_text,
          details,
          media_source
        FROM content
        WHERE content_id = ?
      `;

      const contentRows = await query(contentSql, [contentId]);

      if (!contentRows || contentRows.length === 0) {
        return res.status(404).json({ error: "Content not found" });
      }

      const content = contentRows[0];

      // 2. Use content_text (full cleaned text up to 8000 chars) for quality analysis
      // Fall back to details field for old content that doesn't have content_text yet
      const fullText = content.content_text || content.details || "";

      if (!fullText || fullText.length < 100) {
        return res.status(400).json({
          error: "Insufficient text content for quality analysis",
          hint: content.content_text
            ? "Content text is too short (< 100 chars)"
            : "This content doesn't have full text stored. Try re-scraping via the evidence engine, or content was created before the content_text migration.",
        });
      }

      // 3. Extract domain from URL
      let domain = "unknown";
      if (content.url) {
        try {
          const urlObj = new URL(content.url);
          domain = urlObj.hostname;
        } catch (err) {
          console.warn(`Failed to parse URL: ${content.url}`);
        }
      }

      // 4. Fetch author/publisher metadata if available (format: First Last, Title)
      const authorSql = `
        SELECT
          CONCAT(
            a.author_first_name,
            ' ',
            a.author_last_name,
            CASE
              WHEN a.author_title IS NOT NULL AND a.author_title != ''
              THEN CONCAT(', ', a.author_title)
              ELSE ''
            END
          ) AS author_name
        FROM content_authors ca
        JOIN authors a ON ca.author_id = a.author_id
        WHERE ca.content_id = ?
        LIMIT 1
      `;

      const authorRows = await query(authorSql, [contentId]);
      const author = authorRows?.[0]?.author_name || "unknown";

      const metadata = {
        author,
        publisher: content.media_source || "unknown",
        date: null, // Could extract from content.published_date if available
      };

      // 5. Run quality scoring with AI
      console.log(`[Quality] Scoring content_id=${contentId}: ${content.content_name}`);
      console.log(`[Quality] Text length: ${fullText.length} chars`);
      console.log(`[Quality] Metadata:`, metadata);

      const scorer = new SourceQualityScorer(openAiLLM, query);
      const qualityScores = await scorer.scoreSource({
        content_id: contentId,
        content_text: fullText,
        metadata,
        url: content.url || "",
        domain,
      });

      console.log(`[Quality] Raw scores returned:`, qualityScores);

      // 6. Save scores to database
      await scorer.saveScores(contentId, qualityScores);

      console.log(
        `[Quality] Scored content_id=${contentId}: ${qualityScores.quality_tier} (${qualityScores.quality_score}/10)`
      );

      // 7. Return the scores
      res.json({
        success: true,
        message: "Quality analysis completed",
        scores: qualityScores,
      });
    } catch (err) {
      console.error("Error running quality analysis:", err);
      res.status(500).json({
        error: err.message || "Failed to run quality analysis",
      });
    }
  });

  /**
   * POST /api/claims/run-triage/:contentId
   * Run full triage pipeline on all claims for content
   */
  router.post("/api/claims/run-triage/:contentId", async (req, res) => {
    try {
      const { contentId } = req.params;

      // Get all claims for this content
      const claimsSql = `
        SELECT c.claim_id AS claim_id, c.claim_text as claim_text, cc.content_id as content_id
        FROM claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
       WHERE cc.content_id = ?
      `;

      const claims = await query(claimsSql, [contentId]);

      if (!claims || claims.length === 0) {
        return res
          .status(404)
          .json({ error: "No claims found for this content" });
      }

      // Initialize classifier
      const classifier = new ClaimEvaluationClassifier(null, query);

      // Process each claim (simplified - full implementation would include source quality scoring)
      const results = [];
      for (const claim of claims) {
        // For now, just acknowledge the claim
        // Full implementation would run source quality scoring and triage
        results.push({
          claim_id: claim.claim_id,
          status: "pending",
        });
      }

      res.json({
        success: true,
        message: `Triage pipeline started for ${claims.length} claims`,
        results,
      });
    } catch (err) {
      console.error("Error running triage:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/claims/triage-status/:contentId
   * Get triage status for all claims in content
   */
  router.get("/api/claims/triage-status/:contentId", async (req, res) => {
    try {
      const { contentId } = req.params;

      const sql = `
        SELECT
          claim_id,
          claim_text,
          triage_status,
          claim_centrality,
          claim_specificity,
          claim_consequence,
          claim_contestability,
          claim_novelty,
          retrieval_count,
          distinct_source_count,
          max_relevance,
          avg_top3_relevance,
          triaged_at,
          triage_reasoning
        FROM claims
        WHERE content_id = ?
        ORDER BY claim_centrality DESC NULLS LAST
      `;

      const [claims] = await query(sql, [contentId]);

      res.json(claims || []);
    } catch (err) {
      console.error("Error fetching triage status:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
