// backend/src/core/matchClaims.js
// ──────────────────────────────────────────────────────────────────
// Match reference claims to task claims using LLM
// Returns veracity scores, stance, and confidence for claim_links
// ──────────────────────────────────────────────────────────────────

import logger from "../utils/logger.js";
import { loadBearingGatingConfig } from "./bearingConfig.js";
import { applyQuantitativeStanceGuard } from "./quantitativeClaimGuard.js";

const bearingPacketConfigCache = new WeakMap();

const STANCE_CONTRACT = `STANCE CONTRACT:
- Judge stance only relative to the TASK CLAIM.
- "support" means the reference makes the task claim more likely true.
- "refute" means the reference contradicts or weakens the task claim.
- If the task claim says A > B and the reference says B > A, stance must be "refute".
- Never use "support" merely because the reference source appears credible or the reference claim is true.`;

const MISCONDUCT_CONTRACT = `MISCONDUCT / ATTRIBUTION CONTRACT:
- If the task claim contains an attribution wrapper such as "X revealed that Y", evaluate the core assertion Y while using X only as context.
- For claims alleging fraud, cover-up, suppression, destruction of evidence, data manipulation, or institutional misconduct, support requires the reference claim to address that specific misconduct.
- A reference claim saying data was "omitted", "excluded", "not reported", or "re-analyzed" does not support a task claim saying evidence was destroyed or that scientists were ordered to destroy it.
- A reference claim saying "MMR does not cause autism" does not by itself refute an alleged order to destroy evidence; it may be nuance unless it addresses the alleged order, destruction, concealment, or cover-up.
- Do not infer stronger misconduct than the reference actually states.`;

function normalizeStance(rawStance) {
  const stance = String(rawStance || "").trim().toLowerCase();
  if (["support", "supports", "supported", "for"].includes(stance)) return "support";
  if (["refute", "refutes", "refuted", "against", "contradict", "contradicts"].includes(stance)) return "refute";
  if (["nuance", "nuances", "related", "partial", "mixed"].includes(stance)) return "nuance";
  if (["insufficient", "irrelevant", "unclear", "unknown", "neutral"].includes(stance)) return "insufficient";
  return "insufficient";
}

function relationshipFromStance(stance) {
  if (stance === "support") return "supports";
  if (stance === "refute") return "refutes";
  if (stance === "nuance") return "related";
  return "insufficient";
}

function normalizeSupportLevel(rawSupportLevel, stance, confidence) {
  const parsed = Number(rawSupportLevel);
  const fallbackMagnitude = Math.max(0.15, Math.min(0.98, Number(confidence) || 0.5)) * 0.8;
  const magnitude = Math.max(0, Math.min(1.2, Number.isFinite(parsed) && parsed !== 0 ? Math.abs(parsed) : fallbackMagnitude));

  if (stance === "support") return magnitude;
  if (stance === "refute") return -magnitude;
  if (stance === "nuance") return Math.min(0.6, magnitude);
  return 0;
}

export function isBearingPacketEnabled(env = process.env) {
  return String(env.ENABLE_BEARING_PACKET || "false").trim().toLowerCase() === "true";
}

export function extractClaimMatchArray(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return null;
  if (Array.isArray(response.matches)) return response.matches;
  if (Array.isArray(response.claimMatches)) return response.claimMatches;
  if (Array.isArray(response.results)) return response.results;
  if (Array.isArray(response.data?.matches)) return response.data.matches;
  if (response.match && typeof response.match === "object") return [response.match];
  if (response.referenceClaimIndex && response.taskClaimIndex) return [response];
  return null;
}

export function describeClaimMatchResponse(response) {
  let preview = "";
  try {
    preview = JSON.stringify(response).slice(0, 1500);
  } catch {
    preview = "[unserializable]";
  }
  return {
    responseType: Array.isArray(response) ? "array" : response === null ? "null" : typeof response,
    topLevelKeys: response && typeof response === "object" && !Array.isArray(response)
      ? Object.keys(response).slice(0, 20)
      : [],
    preview,
  };
}

function normalizeBearingMatch(match) {
  const score = Number(match?.bearingScore ?? match?.bearing_score);
  const bearingScore = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  const allowedTypes = new Set(["direct", "indirect", "context", "origin", "steelman", "none"]);
  const allowedComponents = new Set(["whole_claim", "subject", "relation", "object", "scope", "attribution", "warrant", "none"]);
  const allowedCausal = new Set(["causal", "mechanistic", "associative", "correlational", "not_applicable", "unclear"]);
  const bearingTypeRaw = String(match?.bearingType || match?.bearing_type || "none").toLowerCase();
  const componentRaw = String(match?.claimComponentAddressed || match?.claim_component_addressed || "none").toLowerCase();
  const causalRaw = String(match?.causalStrength || match?.causal_strength || "unclear").toLowerCase();
  return {
    bearingScore,
    bearingType: allowedTypes.has(bearingTypeRaw) ? bearingTypeRaw : "none",
    claimComponentAddressed: allowedComponents.has(componentRaw) ? componentRaw : "none",
    causalStrength: allowedCausal.has(causalRaw) ? causalRaw : "unclear",
    bearingReason: String(match?.bearingReason || match?.bearing_reason || "").trim().slice(0, 500),
  };
}

function comparativeRiskOverride(taskClaimText, referenceClaimText, rationale) {
  const task = String(taskClaimText || "").toLowerCase();
  const ref = `${referenceClaimText || ""} ${rationale || ""}`.toLowerCase();

  const taskMentionsVaccineRiskGreater =
    /\b(vaccine|vaccination|shot|jab|covid shot|covid vaccine)s?\b/.test(task) &&
    /\b(virus|infection|covid[- ]?19 infection|disease)\b/.test(task) &&
    /\b(outweigh|greater than|higher than|more than|exceed|worse than)\b/.test(task) &&
    /\b(risk|risks|myocarditis|pericarditis|harm|harms|adverse)\b/.test(task);

  const referenceSaysInfectionRiskGreater =
    /\b(virus|infection|covid[- ]?19 infection|disease)\b/.test(ref) &&
    /\b(vaccine|vaccination|shot|jab|covid shot|covid vaccine)s?\b/.test(ref) &&
    (
      /\b(infection|virus|disease|covid[- ]?19 infection)\b.{0,80}\b(higher|greater|more|increased)\b.{0,80}\b(risk|myocarditis|pericarditis|harm)/.test(ref) ||
      /\b(risk|myocarditis|pericarditis|harm)\b.{0,80}\b(higher|greater|more|increased)\b.{0,80}\b(after|from|following)\b.{0,40}\b(infection|virus|disease)\b/.test(ref) ||
      /\b(vaccine|vaccination|shot|jab)\b.{0,80}\b(lower|smaller|less|reduced|quite small)\b.{0,80}\b(compared to|than|versus|vs\.?)\b.{0,80}\b(infection|virus|disease)\b/.test(ref)
    );

  if (taskMentionsVaccineRiskGreater && referenceSaysInfectionRiskGreater) {
    return {
      stance: "refute",
      reason: "comparative-risk inversion: task says vaccine risk exceeds infection risk, while reference says infection risk exceeds vaccine risk",
    };
  }

  return null;
}

/**
 * Match reference claims to task claims using LLM
 *
 * @param {Object} params
 * @param {Array} params.referenceClaims - Array of { id, text } from processTaskClaims
 * @param {Array} params.taskClaims - Array of { id, text } from original task
 * @param {Object} params.llm - LLM instance with generate() method
 * @param {Object} params.promptManager - Optional prompt manager for DB prompts
 * @returns {Array} matches - Array of claim link objects
 */
export async function matchClaimsToTaskClaims({
  referenceClaims,
  taskClaims,
  llm,
  promptManager,
  enableBearingPacket,
}) {
  if (!referenceClaims || referenceClaims.length === 0) {
    logger.log('🔗 [matchClaims] No reference claims to match');
    return [];
  }

  if (!taskClaims || taskClaims.length === 0) {
    logger.log('🔗 [matchClaims] No task claims to match against');
    return [];
  }

  if (typeof enableBearingPacket !== "boolean") {
    if (process.env.ENABLE_BEARING_PACKET === "true" || process.env.ENABLE_BEARING_PACKET === "false") {
      enableBearingPacket = isBearingPacketEnabled();
    } else if (typeof promptManager?.query === "function") {
      const cached = bearingPacketConfigCache.get(promptManager.query);
      if (cached && Date.now() - cached.loadedAt < 30_000) {
        enableBearingPacket = cached.enabled;
      } else {
        const bearingConfig = await loadBearingGatingConfig({ query: promptManager.query });
        enableBearingPacket = bearingConfig.enableBearingPacket;
        bearingPacketConfigCache.set(promptManager.query, {
          enabled: enableBearingPacket,
          loadedAt: Date.now(),
        });
      }
    } else {
      enableBearingPacket = isBearingPacketEnabled();
    }
  }

  logger.log(`🔗 [matchClaims] Matching ${referenceClaims.length} reference claims to ${taskClaims.length} task claims`);

  // Fallback prompts (used if DB load fails)
  const fallbackSystem = `You are a fact-checking assistant that analyzes how reference claims relate to task claims.

CRITICAL STANCE RULE:
The stance is ALWAYS relative to the TASK CLAIM being checked, not whether the reference claim is true in isolation.

For each reference claim, determine:
1. Which task claim(s) it addresses (if any)
2. The stance: support, refute, nuance, or insufficient
   - support: the reference makes the task claim more likely true
   - refute: the reference contradicts or weakens the task claim
   - nuance: the reference partially qualifies the task claim without clearly supporting or refuting it
   - insufficient: the reference does not meaningfully bear on the task claim
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

Example:
Task claim: "The risks of myocarditis from Covid shots outweigh the risk from the virus."
Reference claim: "COVID-19 infection poses a higher myocarditis risk than vaccination."
Correct stance: refute. The reference says the opposite of the task claim.

Return ONLY matches where the reference claim meaningfully addresses a task claim.`;

  const taskClaimsList = taskClaims.map((tc, i) => `[T${i + 1}] ${tc.text}`).join('\n');
  const referenceClaimsList = referenceClaims.map((rc, i) => `[R${i + 1}] ${rc.text}`).join('\n');

  const fallbackUser = `
TASK CLAIMS (what we're fact-checking):
${taskClaimsList}

REFERENCE CLAIMS (from evidence source):
${referenceClaimsList}

For each reference claim that addresses a task claim, return a match object.
ONLY include matches where there's a clear relationship.
Before choosing "support", ask: would this evidence make the task claim more true? If it says the opposite comparison, use "refute".
The rationale must explicitly explain how the reference supports, refutes, or nuances the task claim.

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

  let system = fallbackSystem;
  let user = fallbackUser;

  // Try to load from database if promptManager is available
  if (promptManager) {
    try {
      const systemPrompt = await promptManager.getPrompt(
        enableBearingPacket ? 'claim_matching_bearing_system' : 'claim_matching_system',
        { system: fallbackSystem, user: '', parameters: {} }
      );

      const userPrompt = await promptManager.getPrompt(
        enableBearingPacket ? 'claim_matching_bearing_user' : 'claim_matching_user',
        { system: '', user: fallbackUser, parameters: {} }
      );

      system = systemPrompt.system;
      user = userPrompt.user
        .replace(/\{\{taskClaims\}\}/g, taskClaimsList)
        .replace(/\{\{referenceClaims\}\}/g, referenceClaimsList);
    } catch (err) {
      logger.warn('[matchClaims] Error loading DB prompts, using fallback:', err.message);
    }
  }

  system = `${system}\n\n${STANCE_CONTRACT}\n\n${MISCONDUCT_CONTRACT}`;
  user = `${user}\n\nBefore returning JSON, verify each stance follows the stance contract and that supportLevel is positive for support, negative for refute, and zero for insufficient.`;
  if (enableBearingPacket) {
    system += `\n\nBEARING CONTRACT:\nScore whether each reference claim bears on the exact task claim, separately from source credibility. Topic overlap alone is bearingType none. Association cannot fully support a causal claim. A broad fact-check must address the exact component.`;
    user += `\n\nFor each match also return bearingScore (0-1), bearingType (direct|indirect|context|origin|steelman|none), claimComponentAddressed (whole_claim|subject|relation|object|scope|attribution|warrant|none), causalStrength (causal|mechanistic|associative|correlational|not_applicable|unclear), and a short bearingReason. Omit topic-only matches.`;
  }

  // openAiLLM uses response_format=json_object, so the top-level contract must
  // always be an object. Keep the same envelope in legacy and bearing modes.
  user += `\n\nFINAL JSON ENVELOPE (required): Return exactly {"matches":[...]} at the top level. If nothing matches, return {"matches":[]}. Do not return a bare array or use another wrapper key.`;

  const schemaHint = `{"matches":[
  {
    "referenceClaimIndex": <number>,
    "taskClaimIndex": <number>,
    "stance": "support|refute|nuance|insufficient",
    "veracityScore": <number 0-1>,
    "confidence": <number 0.15-0.98>,
    "supportLevel": <number -1.2 to 1.2>,
    "rationale": "<string>"${enableBearingPacket ? ',\n    "bearingScore": <number 0-1>,\n    "bearingType": "direct|indirect|context|origin|steelman|none",\n    "claimComponentAddressed": "whole_claim|subject|relation|object|scope|attribution|warrant|none",\n    "causalStrength": "causal|mechanistic|associative|correlational|not_applicable|unclear",\n    "bearingReason": "<string>"' : ''}
  }
]}`;

  try {
    const response = await llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.2, // Low temperature for consistent matching
    });

    // Parse response
    const matches = extractClaimMatchArray(response);
    if (!matches) {
      logger.warn(`[MATCH_CLAIMS_SCHEMA] ${JSON.stringify({
        event: "unexpected_claim_match_envelope",
        ...describeClaimMatchResponse(response),
      })}`);
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

        // Clamp values to valid ranges
        const veracityScore = Math.max(0, Math.min(1, match.veracityScore || 0.5));
        const confidence = Math.max(0.15, Math.min(0.98, match.confidence || 0.5));
        const proposedStance = normalizeStance(match.stance);
        const quantitativeOverride = applyQuantitativeStanceGuard({
          taskClaimText: taskClaim.text,
          evidenceText: `${referenceClaim.text || ""} ${match.rationale || ""}`,
          proposedStance,
        });
        const override = quantitativeOverride || comparativeRiskOverride(taskClaim.text, referenceClaim.text, match.rationale);
        const normalizedStance = override?.stance || proposedStance;
        const relationship = relationshipFromStance(normalizedStance);
        const supportLevel = normalizeSupportLevel(match.supportLevel, normalizedStance, confidence);
        const bearing = enableBearingPacket ? normalizeBearingMatch(match) : null;

        if (enableBearingPacket && (
          normalizedStance === "insufficient" ||
          bearing.bearingType === "none" ||
          bearing.bearingScore < 0.35
        )) {
          return null;
        }

        return {
          referenceClaimId: referenceClaim.id,
          taskClaimId: taskClaim.id,
          stance: relationship, // 'supports' or 'refutes'
          veracityScore,
          confidence,
          supportLevel,
          rationale: override
            ? `${match.rationale || ""} [Stance corrected: ${override.reason}]`.trim()
            : match.rationale || `${relationship} claim via automated matching`,
          ...(bearing ? bearing : {}),
        };
      })
      .filter(Boolean);

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
