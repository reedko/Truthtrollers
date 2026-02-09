// backend/src/core/matchClaims.js
// ──────────────────────────────────────────────────────────────────
// Match reference claims to task claims using LLM
// Returns veracity scores, stance, and confidence for claim_links
// ──────────────────────────────────────────────────────────────────

import logger from "../utils/logger.js";

/**
 * Match reference claims to task claims using LLM
 *
 * @param {Object} params
 * @param {Array} params.referenceClaims - Array of { id, text } from processTaskClaims
 * @param {Array} params.taskClaims - Array of { id, text } from original task
 * @param {Object} params.llm - LLM instance with generate() method
 * @returns {Array} matches - Array of claim link objects
 */
export async function matchClaimsToTaskClaims({ referenceClaims, taskClaims, llm }) {
  if (!referenceClaims || referenceClaims.length === 0) {
    logger.log('🔗 [matchClaims] No reference claims to match');
    return [];
  }

  if (!taskClaims || taskClaims.length === 0) {
    logger.log('🔗 [matchClaims] No task claims to match against');
    return [];
  }

  logger.log(`🔗 [matchClaims] Matching ${referenceClaims.length} reference claims to ${taskClaims.length} task claims`);

  // Build prompt for LLM
  const system = `You are a fact-checking assistant that analyzes how reference claims relate to task claims.

For each reference claim, determine:
1. Which task claim(s) it addresses (if any)
2. The stance: support, refute, nuance, or insufficient
3. Veracity score (0-1): How truthful/reliable is this reference claim?
   - 0.9-1.0: Highly verified, strong evidence
   - 0.7-0.89: Well-supported, credible sources
   - 0.5-0.69: Moderate support, some evidence
   - 0.3-0.49: Weak support, limited evidence
   - 0.0-0.29: Unverified, questionable, or contradicted
4. Confidence (0.15-0.98): How confident are you in this match?
5. Support level (-1.2 to +1.2): Directional strength
   - Positive: supports the task claim
   - Negative: refutes the task claim
   - Magnitude: strength of support/refutation

Return ONLY matches where the reference claim meaningfully addresses a task claim.`;

  const user = `
TASK CLAIMS (what we're fact-checking):
${taskClaims.map((tc, i) => `[T${i + 1}] ${tc.text}`).join('\n')}

REFERENCE CLAIMS (from evidence source):
${referenceClaims.map((rc, i) => `[R${i + 1}] ${rc.text}`).join('\n')}

For each reference claim that addresses a task claim, return a match object.
ONLY include matches where there's a clear relationship.

Return valid JSON array:
[
  {
    "referenceClaimIndex": 1,  // Index in reference claims (1-based)
    "taskClaimIndex": 1,        // Index in task claims (1-based)
    "stance": "support|refute|nuance|insufficient",
    "veracityScore": 0.85,      // 0-1: truthfulness of reference claim
    "confidence": 0.92,          // 0.15-0.98: confidence in this match
    "supportLevel": 0.95,        // -1.2 to +1.2: directional strength
    "rationale": "Brief explanation of the relationship"
  }
]

If no reference claims address any task claims, return empty array [].`;

  const schemaHint = `[
  {
    "referenceClaimIndex": <number>,
    "taskClaimIndex": <number>,
    "stance": "support|refute|nuance|insufficient",
    "veracityScore": <number 0-1>,
    "confidence": <number 0.15-0.98>,
    "supportLevel": <number -1.2 to 1.2>,
    "rationale": "<string>"
  }
]`;

  try {
    const response = await llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2, // Low temperature for consistent matching
    });

    // Parse response
    let matches = [];
    if (Array.isArray(response)) {
      matches = response;
    } else if (response && Array.isArray(response.matches)) {
      matches = response.matches;
    } else {
      logger.warn('⚠️  [matchClaims] LLM response not in expected format:', response);
      return [];
    }

    logger.log(`🔗 [matchClaims] LLM found ${matches.length} matches`);

    // Convert to claim_links format
    const claimLinks = matches
      .filter(match => {
        // Validate match structure
        if (!match.referenceClaimIndex || !match.taskClaimIndex) {
          logger.warn('⚠️  [matchClaims] Invalid match - missing indices:', match);
          return false;
        }

        // Validate indices are in range
        const refIdx = match.referenceClaimIndex - 1; // Convert to 0-based
        const taskIdx = match.taskClaimIndex - 1;

        if (refIdx < 0 || refIdx >= referenceClaims.length) {
          logger.warn(`⚠️  [matchClaims] Invalid referenceClaimIndex ${match.referenceClaimIndex}`);
          return false;
        }

        if (taskIdx < 0 || taskIdx >= taskClaims.length) {
          logger.warn(`⚠️  [matchClaims] Invalid taskClaimIndex ${match.taskClaimIndex}`);
          return false;
        }

        return true;
      })
      .map(match => {
        const refIdx = match.referenceClaimIndex - 1; // Convert to 0-based
        const taskIdx = match.taskClaimIndex - 1;

        const referenceClaim = referenceClaims[refIdx];
        const taskClaim = taskClaims[taskIdx];

        // Normalize stance to database values
        let relationship = 'supports'; // default
        if (match.stance === 'refute' || match.stance === 'refutes') {
          relationship = 'refutes';
        } else if (match.stance === 'support' || match.stance === 'supports') {
          relationship = 'supports';
        } else if (match.stance === 'nuance') {
          relationship = 'supports'; // Nuance treated as weak support
        }

        // Clamp values to valid ranges
        const veracityScore = Math.max(0, Math.min(1, match.veracityScore || 0.5));
        const confidence = Math.max(0.15, Math.min(0.98, match.confidence || 0.5));
        const supportLevel = Math.max(-1.2, Math.min(1.2, match.supportLevel || 0));

        return {
          referenceClaimId: referenceClaim.id,
          taskClaimId: taskClaim.id,
          stance: relationship, // 'supports' or 'refutes'
          veracityScore,
          confidence,
          supportLevel,
          rationale: match.rationale || `${relationship} claim via automated matching`,
        };
      });

    // Log summary
    if (claimLinks.length > 0) {
      logger.log(`✅ [matchClaims] Created ${claimLinks.length} claim links:`);
      claimLinks.forEach((link, i) => {
        const refClaim = referenceClaims.find(rc => rc.id === link.referenceClaimId);
        const taskClaim = taskClaims.find(tc => tc.id === link.taskClaimId);
        logger.log(`   ${i + 1}. [${link.stance}] veracity=${link.veracityScore.toFixed(2)} confidence=${link.confidence.toFixed(2)}`);
        logger.log(`      Task: "${taskClaim?.text?.substring(0, 60)}..."`);
        logger.log(`      Ref:  "${refClaim?.text?.substring(0, 60)}..."`);
      });
    } else {
      logger.log('ℹ️  [matchClaims] No meaningful matches found between reference and task claims');
    }

    return claimLinks;

  } catch (err) {
    logger.error('❌ [matchClaims] Error matching claims:', err);
    return [];
  }
}
