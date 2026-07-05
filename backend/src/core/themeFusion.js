// backend/src/core/themeFusion.js
// Theme fusion: consolidate chunk mini-themes into a final frame

import { openAiLLM } from "./openAiLLM.js";
import PromptManager from "./promptManager.js";
import logger from "../utils/logger.js";

/**
 * Validate final frame output against expected schema
 * @param {object} output - The LLM output to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateFinalFrame(output) {
  if (!output || typeof output !== "object") {
    logger.warn("[ThemeFusion] Output is not an object");
    return false;
  }

  // Check required fields
  if (typeof output.finalThesis !== "string" || !output.finalThesis.trim()) {
    logger.warn("[ThemeFusion] finalThesis is missing or invalid");
    return false;
  }

  if (!["endorses", "rejects", "mixed", "unclear"].includes(output.finalStance)) {
    logger.warn("[ThemeFusion] finalStance is not valid:", output.finalStance);
    return false;
  }

  if (!["none", "narrowed", "expanded", "replaced", "mixed", "unclear"].includes(output.themeShiftFromSeed)) {
    logger.warn("[ThemeFusion] themeShiftFromSeed is not valid:", output.themeShiftFromSeed);
    return false;
  }

  // Validate finalPillars
  if (!Array.isArray(output.finalPillars)) {
    logger.warn("[ThemeFusion] finalPillars is not an array");
    return false;
  }

  for (const pillar of output.finalPillars) {
    if (typeof pillar.pillarText !== "string" || !pillar.pillarText.trim()) {
      logger.warn("[ThemeFusion] pillar missing pillarText");
      return false;
    }
    if (!Array.isArray(pillar.supportingChunkIndexes)) {
      logger.warn("[ThemeFusion] pillar supportingChunkIndexes is not an array");
      return false;
    }
    if (!Array.isArray(pillar.representativeCandidateIds)) {
      logger.warn("[ThemeFusion] pillar representativeCandidateIds is not an array");
      return false;
    }
    const coverage = Number(pillar.coverageStrength);
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
      logger.warn("[ThemeFusion] pillar coverageStrength is not a valid 0-1 number");
      return false;
    }
  }

  // Validate dominantNamedAnchors (array, can be empty)
  if (!Array.isArray(output.dominantNamedAnchors)) {
    logger.warn("[ThemeFusion] dominantNamedAnchors is not an array");
    return false;
  }

  // Validate repeatedPersuasionPatterns
  if (!Array.isArray(output.repeatedPersuasionPatterns)) {
    logger.warn("[ThemeFusion] repeatedPersuasionPatterns is not an array");
    return false;
  }

  for (const pattern of output.repeatedPersuasionPatterns) {
    if (typeof pattern.repeatedIdea !== "string" || !pattern.repeatedIdea.trim()) {
      logger.warn("[ThemeFusion] pattern missing repeatedIdea");
      return false;
    }
    if (!Array.isArray(pattern.variantCandidateIds)) {
      logger.warn("[ThemeFusion] pattern variantCandidateIds is not an array");
      return false;
    }
    if (typeof pattern.notes !== "string") {
      logger.warn("[ThemeFusion] pattern notes is not a string");
      return false;
    }
  }

  // Validate coverageGaps (array, can be empty)
  if (!Array.isArray(output.coverageGaps)) {
    logger.warn("[ThemeFusion] coverageGaps is not an array");
    return false;
  }

  return true;
}

/**
 * Fuse chunk mini-themes into a final frame using LLM orchestration
 *
 * @param {object} params - Parameters object
 * @param {string} params.provisionalFrame - Provisional article frame from Prompt 4
 * @param {array} params.chunkMiniThemes - Mini-themes extracted from each chunk (Prompt 5)
 * @param {array} params.relationshipToProvisionalFrame - How each chunk relates to provisional frame
 * @param {array} params.pillarHints - Pillar hints from chunks
 * @param {array} params.evaluationCandidateSummaries - Compact summaries of evaluation candidates
 * @param {array} params.sourceBackgroundCandidateSummaries - Compact summaries of source/background candidates
 * @param {array} params.namedAnchors - Named anchors across chunks
 * @param {array} params.repeatedPersuasionSignals - Repeated persuasion patterns in local evidence
 * @param {object} params.promptManager - PromptManager instance for loading DB prompts
 * @param {number} params.timeout - Optional LLM timeout in ms (default 45000)
 *
 * @returns {Promise<object>} - Final frame object with finalThesis, finalStance, themeShiftFromSeed, finalPillars, dominantNamedAnchors, repeatedPersuasionPatterns, coverageGaps
 */
export async function fuseSurveyThemesIntoFrame({
  provisionalFrame,
  chunkMiniThemes,
  relationshipToProvisionalFrame,
  pillarHints,
  evaluationCandidateSummaries,
  sourceBackgroundCandidateSummaries,
  namedAnchors,
  repeatedPersuasionSignals,
  promptManager = null,
  timeout = 45000,
} = {}) {
  try {
    logger.log("[ThemeFusion] Starting theme fusion with chunk count:", chunkMiniThemes?.length || 0);

    // Load prompt from database if promptManager is provided, else use fallback
    let systemPrompt = "";
    let userPromptTemplate = "";

    if (promptManager) {
      try {
        const prompt = await promptManager.getPrompt("theme_fusion", null);
        if (prompt) {
          systemPrompt = prompt.system || "";
          userPromptTemplate = prompt.user || "";
          logger.log("[ThemeFusion] Loaded theme_fusion prompt from database");
        }
      } catch (err) {
        logger.warn("[ThemeFusion] Failed to load theme_fusion prompt from DB:", err.message);
      }
    }

    // Use fallback prompts if not loaded from DB
    if (!systemPrompt) {
      systemPrompt = `You are a theme fusion expert. Given a provisional article frame and mini-themes extracted from multiple chunks of evidence, fuse these into a final frame.

The provisional frame may be wrong. Mini-themes vote on the final frame. Your task is to:
1. Consolidate overlapping themes and identify dominant pillars
2. Detect shifts in the frame (narrowed, expanded, replaced, etc.)
3. Map relationships between chunks and their representative evidence
4. Identify persistent persuasion patterns and coverage gaps
5. Determine the final stance and thesis

Return strict JSON only. Do not modify claims or run evidence.`;
    }

    if (!userPromptTemplate) {
      userPromptTemplate = `PROVISIONAL ARTICLE FRAME:
{{provisionalFrame}}

CHUNK MINI-THEMES ({{chunkCount}} chunks):
{{chunkMiniThemesJson}}

RELATIONSHIP TO PROVISIONAL FRAME:
{{relationshipToProvisionalFrameJson}}

PILLAR HINTS FROM CHUNKS:
{{pillarHintsJson}}

EVALUATION CANDIDATE SUMMARIES:
{{evaluationCandidateSummariesJson}}

SOURCE/BACKGROUND CANDIDATE SUMMARIES:
{{sourceBackgroundCandidateSummariesJson}}

NAMED ANCHORS ACROSS CHUNKS:
{{namedAnchorsJson}}

REPEATED PERSUASION SIGNALS:
{{repeatedPersuasionSignalsJson}}

Fuse these into a final frame. Return:
{
  "finalThesis": "string",
  "finalStance": "endorses|rejects|mixed|unclear",
  "themeShiftFromSeed": "none|narrowed|expanded|replaced|mixed|unclear",
  "finalPillars": [
    {
      "pillarText": "string",
      "supportingChunkIndexes": [0, 1, 3],
      "representativeCandidateIds": ["c0", "c3"],
      "coverageStrength": 0.0
    }
  ],
  "dominantNamedAnchors": ["anchor1", "anchor2"],
  "repeatedPersuasionPatterns": [
    {
      "repeatedIdea": "string",
      "variantCandidateIds": ["c1", "c5"],
      "notes": "string"
    }
  ],
  "coverageGaps": ["gap description 1", "gap description 2"]
}`;
    }

    // Prepare user prompt by filling template variables
    const userPrompt = userPromptTemplate
      .replace(/\{\{provisionalFrame\}\}/g, provisionalFrame || "Not provided")
      .replace(/\{\{chunkCount\}\}/g, String(chunkMiniThemes?.length || 0))
      .replace(/\{\{chunkMiniThemesJson\}\}/g, JSON.stringify(chunkMiniThemes || [], null, 2))
      .replace(/\{\{relationshipToProvisionalFrameJson\}\}/g, JSON.stringify(relationshipToProvisionalFrame || [], null, 2))
      .replace(/\{\{pillarHintsJson\}\}/g, JSON.stringify(pillarHints || [], null, 2))
      .replace(/\{\{evaluationCandidateSummariesJson\}\}/g, JSON.stringify(evaluationCandidateSummaries || [], null, 2))
      .replace(/\{\{sourceBackgroundCandidateSummariesJson\}\}/g, JSON.stringify(sourceBackgroundCandidateSummaries || [], null, 2))
      .replace(/\{\{namedAnchorsJson\}\}/g, JSON.stringify(namedAnchors || [], null, 2))
      .replace(/\{\{repeatedPersuasionSignalsJson\}\}/g, JSON.stringify(repeatedPersuasionSignals || [], null, 2));

    // Define schema hint
    const schemaHint = `{
  "finalThesis": "string",
  "finalStance": "endorses|rejects|mixed|unclear",
  "themeShiftFromSeed": "none|narrowed|expanded|replaced|mixed|unclear",
  "finalPillars": [{"pillarText": "string", "supportingChunkIndexes": [0], "representativeCandidateIds": ["c0"], "coverageStrength": 0.85}],
  "dominantNamedAnchors": ["anchor"],
  "repeatedPersuasionPatterns": [{"repeatedIdea": "string", "variantCandidateIds": ["c1"], "notes": "string"}],
  "coverageGaps": ["gap description"]
}`;

    logger.log("[ThemeFusion] Calling LLM to fuse themes...");

    // Call LLM with single request
    const finalFrame = await openAiLLM.generate({
      system: systemPrompt,
      user: userPrompt,
      schemaHint,
      temperature: 0.2,
      maxRetries: 2,
      timeout,
    });

    logger.log("[ThemeFusion] LLM response received");

    // Validate output against schema
    if (!validateFinalFrame(finalFrame)) {
      throw new Error("LLM output failed schema validation");
    }

    logger.log("[ThemeFusion] Schema validation passed");

    // Extract metadata for logging
    const pillarCount = finalFrame.finalPillars?.length || 0;
    const themeShift = finalFrame.themeShiftFromSeed || "unknown";
    const coverageGapCount = finalFrame.coverageGaps?.length || 0;
    const anchorCount = finalFrame.dominantNamedAnchors?.length || 0;
    const patternCount = finalFrame.repeatedPersuasionPatterns?.length || 0;

    // Log THEME_FUSION_COMPLETED with details
    logger.log(
      `THEME_FUSION_COMPLETED | pillars=${pillarCount} | themeShift=${themeShift} | gaps=${coverageGapCount} | anchors=${anchorCount} | patterns=${patternCount}`
    );

    return finalFrame;
  } catch (error) {
    logger.error("[ThemeFusion] Theme fusion failed:", error.message);
    throw error;
  }
}

export default { fuseSurveyThemesIntoFrame };
