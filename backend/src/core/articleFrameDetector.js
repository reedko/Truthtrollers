// backend/src/core/articleFrameDetector.js
// Provisional article frame detection (pre-chunking pass)
// Extracts high-level thesis, stance, pillars, and opening questions without persisting

import logger from "../utils/logger.js";

/**
 * Extracts structured frame from article metadata and text
 * Returns provisional thesis, stance, likely pillars, and key questions
 * This pass is NOT persisted — it serves as a context frame for later chunk-level passes
 */
export async function detectArticleFrame({
  llm,
  text,
  title = null,
  byline = null,
  date = null,
  headings = null,
}) {
  if (!llm) {
    logger.warn("[articleFrameDetector] No LLM provided, skipping frame detection");
    return null;
  }

  if (!text || !text.trim()) {
    logger.warn("[articleFrameDetector] Empty text, skipping frame detection");
    return null;
  }

  try {
    // Extract text samples
    const firstChars = Math.min(4000, text.length);
    const lastChars = Math.min(2000, text.length);
    const firstSample = text.substring(0, firstChars);
    const lastSample = lastChars > 0 ? text.substring(Math.max(0, text.length - lastChars)) : "";

    // Build metadata section
    let metadataSection = "";
    if (title) {
      metadataSection += `ARTICLE TITLE: ${title}\n`;
    }
    if (byline || date) {
      metadataSection += "BYLINE/DATE: ";
      if (byline) metadataSection += byline;
      if (byline && date) metadataSection += " | ";
      if (date) metadataSection += date;
      metadataSection += "\n";
    }
    if (headings && Array.isArray(headings) && headings.length > 0) {
      metadataSection += `ARTICLE STRUCTURE (headings):\n${headings.slice(0, 10).map((h) => `  - ${h}`).join("\n")}\n`;
    }

    // Construct the LLM prompt
    const systemPrompt = `You are an expert at identifying the high-level framing of articles.
Your task is to generate a provisional thesis frame from an article.
This frame is PRELIMINARY and may be expanded, narrowed, or contradicted by detailed chunk analysis later.
Focus on clarity and specificity rather than hedge language.`;

    const userPrompt = `${metadataSection}

ARTICLE BEGINNING (first ~4000 chars):
${firstSample}

${lastSample ? `ARTICLE ENDING (last ~2000 chars):\n${lastSample}\n` : ""}

Analyze this article and return a JSON object with:

{
  "provisionalThesis": "One-sentence statement of what the article is primarily arguing or exploring",
  "provisionalStance": "endorses" | "rejects" | "mixed" | "unclear" (overall article stance toward the thesis),
  "likelyPillars": ["core claim 1", "core claim 2", ...] (3-5 main supporting claims or arguments),
  "likelyOpposingClaims": ["counter 1", "counter 2", ...] (1-3 contrary arguments the article acknowledges or refutes),
  "namedAnchors": [
    {"type": "person|organization|concept|location|event", "name": "..."},
    ...
  ] (Key named entities that anchor the frame, max 5),
  "openQuestions": ["What is...?", "How does...?", ...] (2-4 questions the article opens without fully resolving),
  "seedConfidence": 0.0-1.0 (Your confidence that this frame is accurate based on metadata + opening/closing, 0.3 min for "read cautiously", 0.8+ for "pretty clear")
}

Remember: This frame is provisional. It helps guide later chunk analysis but does NOT filter chunks.`;

    const schemaHint = JSON.stringify({
      provisionalThesis: "string",
      provisionalStance: "string",
      likelyPillars: ["string"],
      likelyOpposingClaims: ["string"],
      namedAnchors: [{ type: "string", name: "string" }],
      openQuestions: ["string"],
      seedConfidence: "number",
    });

    logger.log("[articleFrameDetector] Calling LLM for frame detection...");

    const frameData = await llm.generate({
      system: systemPrompt,
      user: userPrompt,
      schemaHint,
      temperature: 0.3,
      timeout: 20000,
    });

    // Validate response structure
    if (!frameData || typeof frameData !== "object") {
      logger.warn("[articleFrameDetector] Invalid response from LLM (not an object)");
      return null;
    }

    // Normalize and validate
    const frame = {
      provisionalThesis: String(frameData.provisionalThesis || "").trim(),
      provisionalStance: String(frameData.provisionalStance || "unclear").trim().toLowerCase(),
      likelyPillars: Array.isArray(frameData.likelyPillars)
        ? frameData.likelyPillars.filter((p) => p).map((p) => String(p).trim()).slice(0, 10)
        : [],
      likelyOpposingClaims: Array.isArray(frameData.likelyOpposingClaims)
        ? frameData.likelyOpposingClaims.filter((c) => c).map((c) => String(c).trim()).slice(0, 5)
        : [],
      namedAnchors: Array.isArray(frameData.namedAnchors)
        ? frameData.namedAnchors
            .filter((a) => a && a.name)
            .map((a) => ({
              type: String(a.type || "").trim().toLowerCase() || "unknown",
              name: String(a.name).trim(),
            }))
            .slice(0, 5)
        : [],
      openQuestions: Array.isArray(frameData.openQuestions)
        ? frameData.openQuestions.filter((q) => q).map((q) => String(q).trim()).slice(0, 5)
        : [],
      seedConfidence: Math.min(1, Math.max(0.0, Number(frameData.seedConfidence) || 0.5)),
    };

    // Validate stance
    const validStances = ["endorses", "rejects", "mixed", "unclear"];
    if (!validStances.includes(frame.provisionalStance)) {
      frame.provisionalStance = "unclear";
    }

    // Require at least a thesis
    if (!frame.provisionalThesis) {
      logger.warn("[articleFrameDetector] LLM response missing provisionalThesis");
      return null;
    }

    logger.log(
      `✅ [articleFrameDetector] Frame detected (confidence: ${frame.seedConfidence.toFixed(2)})`
    );
    logger.log(`   Thesis: "${frame.provisionalThesis.substring(0, 100)}..."`);
    logger.log(`   Stance: ${frame.provisionalStance}`);
    logger.log(`   Pillars: ${frame.likelyPillars.length}`);
    logger.log(`   Opposing claims: ${frame.likelyOpposingClaims.length}`);
    logger.log(`   Named anchors: ${frame.namedAnchors.length}`);
    logger.log(`   Open questions: ${frame.openQuestions.length}`);

    return frame;
  } catch (error) {
    logger.error("[articleFrameDetector] Failed to detect frame:", error.message);
    return null;
  }
}

/**
 * Log the frame using the ARTICLE_FRAME_SEEDED format
 */
export function logArticleFrameSeeded(frame) {
  if (!frame) return;

  const frameLog = {
    provisionalThesis: frame.provisionalThesis,
    provisionalStance: frame.provisionalStance,
    likelyPillars: frame.likelyPillars,
    likelyOpposingClaims: frame.likelyOpposingClaims,
    namedAnchors: frame.namedAnchors,
    openQuestions: frame.openQuestions,
    seedConfidence: frame.seedConfidence,
  };

  logger.log(`🎬 ARTICLE_FRAME_SEEDED: ${JSON.stringify(frameLog)}`);
}
