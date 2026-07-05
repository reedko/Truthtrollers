// backend/src/core/processTaskClaims.js
// NEW FLOW: Survey → Frame → Fuse → Cluster → Reduce → Persist ONLY reducer outputs
// CRITICAL: Only selectedEvaluationClaims and selectedSourceBackgroundClaims persisted
// No raw packets, candidates, themes, or intermediate data allowed
// Guards: selectedEvaluationClaims <= 12, selectedSourceBackgroundClaims <= CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS
// No candidateOnly=true records can be persisted

import { ClaimExtractor } from "./claimsEngine.js";
import { openAiLLM } from "./openAiLLM.js";
import { persistClaims } from "../storage/persistClaims.js";
import { classifyAttributionClaim } from "../utils/normalizeEvidenceClaim.js";
import logger from "../utils/logger.js";
import { detectArticleFrame, logArticleFrameSeeded } from "./articleFrameDetector.js";
import { fuseSurveyThemesIntoFrame } from "./themeFusion.js";
import PromptManager from "./promptManager.js";
import {
  clusterCandidates,
  reduceEvaluationClaims,
  reduceBackgroundClaims,
  CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS,
  CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS,
} from "./claimReduction.js";
import { runTargetedRepairPass } from "./claimRepairPass.js";

export function chunkContentForClaimExtraction(text, maxCharsPerChunk = 6000) {
  const content = String(text || "");
  const chunkSize = Math.max(1, Number(maxCharsPerChunk) || 6000);
  const chunks = [];

  for (let start = 0; start < content.length; start += chunkSize) {
    const chunkText = content.slice(start, start + chunkSize);
    chunks.push({
      text: chunkText,
      tokenLength: Math.round(chunkText.length / 4),
    });
  }

  return chunks;
}

/**
 * processTaskClaims({
 *    query,
 *    taskContentId,
 *    text,
 *    claimType = 'task',
 *    taskClaimsContext = null,
 *    clearOldLinks = false,
 *    title = null,
 *    byline = null,
 *    date = null,
 *    headings = null
 * })
 *
 * NEW FLOW (Prompt 4→5→6→7→8):
 *    1. detectArticleFrame() → provisional frame (Prompt 4)
 *    2. surveyTaskContent() → survey packets (Prompt 5)
 *    3. fuseSurveyThemesIntoFrame() → final frame (Prompt 6)
 *    4. clusterCandidates() → clustered candidates (Prompt 7 prep)
 *    5. reduceEvaluationClaims() → selectedEvaluationClaims (Prompt 8)
 *    6. reduceBackgroundClaims() → selectedSourceBackgroundClaims (Prompt 8)
 *    7. Persist ONLY selectedEvaluationClaims and selectedSourceBackgroundClaims
 *
 * CRITICAL RESTRICTIONS:
 *    - NO raw survey packets persisted
 *    - NO raw evaluation candidates persisted
 *    - NO raw background candidates persisted
 *    - NO mini-themes persisted
 *    - NO pillar hints persisted
 *    - NO duplicate variants persisted
 *    - NO omitted synthesis records persisted
 *    - NO repair candidates before reduction persisted
 *    - NO candidateOnly=true records persisted
 *    - selectedEvaluationClaims.length <= 12
 *    - selectedSourceBackgroundClaims.length <= CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS
 *
 * Returns:
 *    [{ id: claimId, text, role, ... }] - Only from selected reducer outputs
 *
 * @param clearOldLinks - If true, clear existing content_claims links before persisting
 * @param title - Article title (for frame detection, not persisted)
 * @param byline - Article byline/author (for frame detection, not persisted)
 * @param date - Article publication date (for frame detection, not persisted)
 * @param headings - Article headings array (for frame detection, not persisted)
 */
export async function processTaskClaims({
  query,
  taskContentId,
  text,
  claimType = "task",
  taskClaimsContext = null,
  clearOldLinks = false,
  title = null,
  byline = null,
  date = null,
  headings = null,
}) {
  logger.log("🟩 [processTaskClaims] NEW FLOW: Survey → Frame → Fuse → Cluster → Reduce → Persist");

  if (!query) throw new Error("processTaskClaims: missing query");
  if (!taskContentId) throw new Error("processTaskClaims: missing taskContentId");

  if (!text || !text.trim()) {
    logger.warn("⚠️ [processTaskClaims] Empty text, skipping claims.");
    return [];
  }

  logger.log(
    `📝 [processTaskClaims] Text length: ${text.length} chars, first 300 chars: "${text.substring(0, 300).replace(/\s+/g, " ")}..."`
  );

  // =====================================================
  // PROMPT 4: Detect provisional article frame
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 1/6: Detect provisional frame (Prompt 4)…");
  const provisionalFrame = await detectArticleFrame({
    llm: openAiLLM,
    text,
    title,
    byline,
    date,
    headings,
  });

  if (provisionalFrame) {
    logArticleFrameSeeded(provisionalFrame);
  }

  const provisionalFrameText = provisionalFrame?.provisionalThesis || "Article stance unclear";
  logger.log(`[processTaskClaims] Provisional frame: "${provisionalFrameText.substring(0, 100)}..."`);

  // =====================================================
  // PROMPT 5: Survey content for chunk-level candidates
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 2/6: Survey content for candidates (Prompt 5)…");
  const surveyResult = await surveyTaskContent({
    taskContentId,
    text,
    articleTitle: title || "",
    provisionalFrame: provisionalFrameText,
    maxConcurrency: 3,
  });

  const chunkSurveys = surveyResult.chunkSurveys || [];
  logger.log(`[processTaskClaims] Survey complete: ${chunkSurveys.length} chunks surveyed`);
  logger.log(`   - Evaluation candidates found: ${surveyResult.totalEvaluationCandidates}`);
  logger.log(`   - Background candidates found: ${surveyResult.totalBackgroundCandidates}`);

  if (chunkSurveys.length === 0) {
    logger.warn("⚠️ [processTaskClaims] No chunks surveyed, returning empty results");
    return [];
  }

  // =====================================================
  // PROMPT 6: Fuse chunk mini-themes into final frame
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 3/6: Fuse themes into final frame (Prompt 6)…");

  // Extract component arrays from survey packets for theme fusion
  const chunkMiniThemes = chunkSurveys.map((s) => ({
    chunkIndex: s.chunkIndex,
    chunkPosition: s.chunkPosition,
    miniTheme: s.chunkMiniTheme,
  }));

  const relationshipToProvisionalFrame = chunkSurveys.map((s) => ({
    chunkIndex: s.chunkIndex,
    relationship: s.relationshipToProvisionalFrame,
  }));

  const pillarHints = chunkSurveys
    .flatMap((s) =>
      (s.pillarHints || []).map((ph) => ({
        chunkIndex: s.chunkIndex,
        pillarText: ph.pillarText,
        confidence: ph.confidence,
      }))
    );

  const evaluationCandidateSummaries = chunkSurveys
    .flatMap((s) =>
      (s.evaluationCandidateClaims || []).map((ec) => ({
        chunkIndex: s.chunkIndex,
        claimText: ec.claimText,
        importance: ec.importanceToArticleGuess,
      }))
    );

  const sourceBackgroundCandidateSummaries = chunkSurveys
    .flatMap((s) =>
      (s.sourceBackgroundCandidates || []).map((bc) => ({
        chunkIndex: s.chunkIndex,
        claimText: bc.claimText,
        usefulness: bc.sourceUsefulness,
      }))
    );

  const namedAnchors = chunkSurveys
    .flatMap((s) =>
      (s.pillarHints || [])
        .flatMap((ph) => ph.supportingExcerpt || [])
    );

  const repeatedPersuasionSignals = chunkSurveys
    .flatMap((s) =>
      (s.localRepetitionSignals || []).map((rs) => ({
        phraseOrIdea: rs.phraseOrIdea,
        appearsToRepeatEarlierTheme: rs.appearsToRepeatEarlierArticleTheme,
      }))
    );

  const promptManager = query ? new PromptManager(query) : null;

  let finalFrame = null;
  try {
    finalFrame = await fuseSurveyThemesIntoFrame({
      provisionalFrame: provisionalFrameText,
      chunkMiniThemes,
      relationshipToProvisionalFrame,
      pillarHints,
      evaluationCandidateSummaries,
      sourceBackgroundCandidateSummaries,
      namedAnchors,
      repeatedPersuasionSignals,
      promptManager,
      timeout: 45000,
    });
    logger.log(`[processTaskClaims] Final frame created: ${finalFrame.finalPillars?.length || 0} pillars`);
  } catch (err) {
    logger.error("[processTaskClaims] Theme fusion failed, using minimal frame:", err.message);
    finalFrame = {
      finalThesis: provisionalFrameText,
      finalStance: "unclear",
      themeShiftFromSeed: "unclear",
      finalPillars: [],
      dominantNamedAnchors: [],
      repeatedPersuasionPatterns: [],
      coverageGaps: [],
    };
  }

  // =====================================================
  // REPAIR PASS: Targeted repair for coverage gaps
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 3.5/6: Running targeted repair pass…");

  let repairPassOutcome = "disabled";
  const { repairClaim, outcome: repairOutcome } = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys,
    selectedEvaluationClaims: [], // Empty at this stage, but available for context
  });

  repairPassOutcome = repairOutcome;

  if (repairClaim) {
    logger.log(`[processTaskClaims] Repair pass generated claim: "${repairClaim.claimText.substring(0, 60)}..."`);
  } else {
    logger.log(`[processTaskClaims] Repair pass outcome: ${repairOutcome}`);
  }

  // =====================================================
  // PROMPT 7 PREP: Cluster candidates
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 4/6: Cluster candidates…");
  const clusterResult = await clusterCandidates(chunkSurveys);
  let evaluationClusterGroups = clusterResult.evaluationClusterGroups || [];
  const backgroundClusterGroups = clusterResult.backgroundClusterGroups || [];
  logger.log(`[processTaskClaims] Clustering complete: ${evaluationClusterGroups.length} evaluation clusters, ${backgroundClusterGroups.length} background clusters`);

  // Add repair claim to evaluation clusters if generated
  if (repairClaim) {
    const repairCluster = {
      representative: repairClaim,
      variants: [repairClaim],
      clusterScore: repairClaim.importanceToArticleGuess || 0.7,
      sourceChunks: new Set([repairClaim.sourceChunkIndex || 0]),
    };
    evaluationClusterGroups.push(repairCluster);
    logger.log(`[processTaskClaims] Added repair claim to evaluation clusters (now ${evaluationClusterGroups.length} total)`);
  }

  // =====================================================
  // PROMPT 8: Reduce to selected claims
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 5/6: Reduce to selected claims (Prompt 8)…");

  // Reduce evaluation claims
  const selectedEvaluationClaims = await reduceEvaluationClaims(evaluationClusterGroups, finalFrame);

  // Check if repair claim was included in final selection
  const repairClaimIncluded = selectedEvaluationClaims.some((c) => c.repairPass === true);

  // Validate evaluation claims
  if (selectedEvaluationClaims.length > CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS) {
    logger.error(
      `🚨 [processTaskClaims] GUARD VIOLATION: selectedEvaluationClaims.length=${selectedEvaluationClaims.length} exceeds max ${CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS}`
    );
    selectedEvaluationClaims.splice(CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS);
  }

  // Check for candidateOnly=true in evaluation claims (CRITICAL)
  const evalCandidateOnlyCount = selectedEvaluationClaims.filter((c) => c.candidateOnly === true).length;
  if (evalCandidateOnlyCount > 0) {
    logger.error(
      `🚨 [processTaskClaims] GUARD VIOLATION: ${evalCandidateOnlyCount} evaluation claims have candidateOnly=true (should be 0)`
    );
    selectedEvaluationClaims = selectedEvaluationClaims.filter((c) => c.candidateOnly !== true);
  }

  logger.log(`[processTaskClaims] Evaluation claims selected: ${selectedEvaluationClaims.length}/${CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS}`);

  // Log REPAIR_PASS_COMPLETED with outcome
  let repairPassStatus = "none_needed";
  if (repairPassOutcome === "disabled") {
    repairPassStatus = "disabled";
  } else if (repairClaimIncluded) {
    repairPassStatus = "added";
  } else if (repairClaim !== null) {
    repairPassStatus = "rejected";
  } else if (repairPassOutcome === "attempted") {
    repairPassStatus = "none_found";
  }

  logger.log(
    `REPAIR_PASS_COMPLETED | status=${repairPassStatus} | repairClaimIncluded=${repairClaimIncluded} | coverageGaps=${finalFrame.coverageGaps?.length || 0}`
  );

  // Reduce background claims
  const selectedSourceBackgroundClaims = await reduceBackgroundClaims(backgroundClusterGroups, finalFrame);

  // Validate background claims
  if (selectedSourceBackgroundClaims.length > CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS) {
    logger.error(
      `🚨 [processTaskClaims] GUARD VIOLATION: selectedSourceBackgroundClaims.length=${selectedSourceBackgroundClaims.length} exceeds max ${CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS}`
    );
    selectedSourceBackgroundClaims.splice(CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS);
  }

  // Check for candidateOnly=true in background claims (CRITICAL)
  const bgCandidateOnlyCount = selectedSourceBackgroundClaims.filter((c) => c.candidateOnly === true).length;
  if (bgCandidateOnlyCount > 0) {
    logger.error(
      `🚨 [processTaskClaims] GUARD VIOLATION: ${bgCandidateOnlyCount} background claims have candidateOnly=true (should be 0)`
    );
    selectedSourceBackgroundClaims = selectedSourceBackgroundClaims.filter((c) => c.candidateOnly !== true);
  }

  logger.log(`[processTaskClaims] Background claims selected: ${selectedSourceBackgroundClaims.length}/${CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS}`);

  // =====================================================
  // PERSIST ONLY REDUCER OUTPUTS
  // NO RAW CANDIDATES, PACKETS, THEMES, OR INTERMEDIATE DATA
  // =====================================================
  logger.log("🟩 [processTaskClaims] STEP 6/6: Persist ONLY reducer outputs…");

  // Combine evaluation + background claims for persistence
  const allClaimsForPersistence = [
    ...selectedEvaluationClaims.map((claim) => ({
      text: claim.text,
      role: claim.role || "evaluation",
      type: "evaluation",
      importance: claim.importance,
      sourceChunks: claim.sourceChunks,
      claimType: claim.claimType,
      namedEntities: claim.namedActors || [],
      namedStudiesOrDocuments: claim.namedStudiesOrDocuments || [],
      sourceExcerpt: claim.localSourceExcerpt,
    })),
    ...selectedSourceBackgroundClaims.map((claim) => ({
      text: claim.text,
      role: "background",
      type: "background",
      usefulness: claim.usefulness,
      sourceChunks: claim.sourceChunks,
      claimType: claim.claimType,
      namedEntities: claim.namedActors || [],
      namedStudiesOrDocuments: claim.namedStudiesOrDocuments || [],
      sourceExcerpt: claim.localSourceExcerpt,
    })),
  ];

  // Normalize for persistence
  const claimsForPersistence = allClaimsForPersistence.map((claim) => {
    const normalized = {
      text: claim.text,
      role: claim.role || "unclear",
      namedEntities: claim.namedEntities || [],
      namedActors: claim.namedEntities || [],
      studiesOrDocuments: claim.namedStudiesOrDocuments || [],
      namedStudiesOrDocuments: claim.namedStudiesOrDocuments || [],
      sourceExcerpt: claim.sourceExcerpt || "",
    };

    // Add type-specific metadata
    if (claim.type === "evaluation") {
      normalized.importance = claim.importance;
      normalized.claimKind = claim.claimType?.attribution ? "attribution" : "factual";
      normalized.evidenceType = "claim";
    } else if (claim.type === "background") {
      normalized.usefulness = claim.usefulness;
      normalized.claimKind = "background";
      normalized.evidenceType = "context";
    }

    return normalized;
  });

  // Persist claims batch
  let claimIds = [];
  try {
    claimIds = await persistClaims(query, taskContentId, claimsForPersistence, claimType, claimType, clearOldLinks);
    if (!Array.isArray(claimIds)) {
      throw new Error("persistClaims returned invalid claimIds");
    }
  } catch (err) {
    logger.error("[processTaskClaims] Persistence failed:", err.message);
    throw err;
  }

  // =====================================================
  // Log CLAIMS_PERSISTED with exact counts
  // =====================================================
  logger.log(
    `CLAIMS_PERSISTED | evaluationLaneCount=${selectedEvaluationClaims.length} | backgroundLaneCount=${selectedSourceBackgroundClaims.length} | totalPersisted=${claimIds.length}`
  );

  // =====================================================
  // Return ONLY what was persisted (reducer outputs)
  // =====================================================
  const result = claimIds.map((id, i) => {
    const claimData = claimsForPersistence[i];
    return {
      id,
      text: claimData?.text || "",
      role: claimData?.role || "unclear",
      type: claimData?.evidenceType || "claim",
      importance: claimData?.importance || 0,
      usefulness: claimData?.usefulness || "medium",
      sourceExcerpt: claimData?.sourceExcerpt || "",
      namedEntities: claimData?.namedEntities || [],
      namedStudiesOrDocuments: claimData?.namedStudiesOrDocuments || [],
    };
  });

  logger.log(
    `🟩 [processTaskClaims] COMPLETE: Persisted ${result.length} claims (${selectedEvaluationClaims.length} evaluation + ${selectedSourceBackgroundClaims.length} background)`
  );

  return result;
}

/**
 * surveyTaskContent({
 *    taskContentId,
 *    text,
 *    articleTitle = "",
 *    provisionalFrame = "",
 *    maxConcurrency = 3
 * })
 *
 * Surveys content to extract claim candidates WITHOUT persistence or evidence.
 * Returns survey packets with metadata, pillar hints, evaluation candidates, and background candidates.
 *
 * @param taskContentId - Content identifier (for logging)
 * @param text - Article text to survey
 * @param articleTitle - Article title (for context)
 * @param provisionalFrame - Document-level provisional frame from Prompt 4
 * @param maxConcurrency - Max parallel chunk surveys (default: 3)
 *
 * Returns:
 *    {
 *      chunkSurveys: [ { chunkIndex, chunkPosition, chunkMiniTheme, relationshipToProvisionalFrame, pillarHints, evaluationCandidateClaims, sourceBackgroundCandidates, localRepetitionSignals, candidateOnly: true } ]
 *      totalChunks: number,
 *      totalEvaluationCandidates: number,
 *      totalBackgroundCandidates: number
 *    }
 */
export async function surveyTaskContent({
  taskContentId,
  text,
  articleTitle = "",
  provisionalFrame = "",
  maxConcurrency = 3,
}) {
  logger.log("🟩 [surveyTaskContent] Starting chunk survey (no persistence)…");
  logger.log(`📝 [surveyTaskContent] Article: "${articleTitle}"`);
  logger.log(
    `📝 [surveyTaskContent] Provisional frame: "${provisionalFrame.substring(0, 100)}${provisionalFrame.length > 100 ? "..." : ""}"`
  );

  if (!taskContentId) throw new Error("surveyTaskContent: missing taskContentId");

  if (!text || !text.trim()) {
    logger.warn("⚠️ [surveyTaskContent] Empty text, returning empty surveys.");
    return {
      chunkSurveys: [],
      totalChunks: 0,
      totalEvaluationCandidates: 0,
      totalBackgroundCandidates: 0,
    };
  }

  logger.log(`📝 [surveyTaskContent] Text length: ${text.length} chars`);

  // Chunk the content
  const chunks = chunkContentForClaimExtraction(text);
  logger.log(`📦 [surveyTaskContent] Chunked into ${chunks.length} survey chunk(s) (max 6000 chars each)`);

  // Create extractor and run surveys
  const extractor = new ClaimExtractor(openAiLLM);

  const surveyPackets = await extractor.surveyContent({
    chunks,
    articleTitle,
    provisionalFrame,
    maxConcurrency,
  });

  // Aggregate statistics
  let totalEvaluationCandidates = 0;
  let totalBackgroundCandidates = 0;

  for (const packet of surveyPackets) {
    totalEvaluationCandidates += (packet.evaluationCandidateClaims || []).length;
    totalBackgroundCandidates += (packet.sourceBackgroundCandidates || []).length;
  }

  logger.log(`🟩 [surveyTaskContent] Survey complete:`);
  logger.log(`   Chunks surveyed: ${surveyPackets.length}`);
  logger.log(`   Evaluation candidates found: ${totalEvaluationCandidates}`);
  logger.log(`   Background candidates found: ${totalBackgroundCandidates}`);

  return {
    chunkSurveys: surveyPackets,
    totalChunks: surveyPackets.length,
    totalEvaluationCandidates,
    totalBackgroundCandidates,
  };
}
