// backend/src/core/assessClaimRelevance.js
/**
 * Lightweight AI assessment for reference claim → task claim relevance
 * Simpler than full evidence engine - just compares two claims directly
 */

import { openAiLLM } from "./openAiLLM.js";

/**
 * Assess whether a reference claim supports/refutes/nuances a task claim
 * @param {Object} params
 * @param {string} params.referenceClaimText - Claim from scraped reference
 * @param {string} params.taskClaimText - Claim from the task
 * @param {string} [params.systemPrompt] - Optional custom system prompt
 * @param {string} [params.customInstructions] - Optional additional instructions
 * @returns {Promise<Object>} Assessment with stance, confidence, rationale
 */
export async function assessClaimRelevance({
  referenceClaimText,
  taskClaimText,
  systemPrompt,
  customInstructions,
}) {
  const defaultSystem = `You are assessing whether a reference claim is relevant to a task claim.

Guidelines:
- "support": Reference claim provides evidence FOR the task claim
- "refute": Reference claim provides evidence AGAINST the task claim
- "nuance": Reference claim adds context or partial support/refutation
- "insufficient": Reference claim is not relevant or doesn't provide meaningful evidence

- confidence: 0-1 (how certain you are of the stance)
- quality: 0-1.2 (how strong/useful the reference claim is as evidence)
- rationale: 1-2 sentences explaining WHY this stance applies`;

  const system = systemPrompt || defaultSystem;

  let user = `TASK CLAIM:
"${taskClaimText}"

REFERENCE CLAIM:
"${referenceClaimText}"

Analyze whether the reference claim supports, refutes, nuances, or is insufficient for evaluating the task claim.`;

  if (customInstructions) {
    user += `\n\nADDITIONAL INSTRUCTIONS:\n${customInstructions}`;
  }

  const schemaHint = `{
  "stance": "support|refute|nuance|insufficient",
  "confidence": 0.85,
  "quality": 0.9,
  "rationale": "Brief explanation of the relationship between the claims",
  "quote": "Most relevant part of reference claim if applicable"
}`;

  try {
    const assessment = await openAiLLM.generate({
      system,
      user,
      schemaHint,
      temperature: 0.3,
      maxRetries: 2,
      timeout: 15000,
    });

    // Validate required fields
    if (!assessment.stance || assessment.confidence === undefined || assessment.quality === undefined) {
      throw new Error("Invalid assessment format from AI");
    }

    // Calculate support_level using stance multiplier
    const stanceMultiplier = {
      support: 1.0,
      refute: -1.0,
      nuance: 0.5,
      insufficient: 0.0,
    };

    const multiplier = stanceMultiplier[assessment.stance] || 0;
    assessment.support_level = multiplier * assessment.confidence * assessment.quality;

    console.log(
      `[AI Assessment] stance=${assessment.stance}, confidence=${assessment.confidence}, quality=${assessment.quality}`
    );

    return assessment;
  } catch (error) {
    console.error("[AI Assessment] Error:", error);

    // Fallback response
    return {
      stance: "insufficient",
      confidence: 0.3,
      quality: 0.3,
      support_level: 0,
      rationale: "Failed to assess claim relevance due to error",
      quote: null,
    };
  }
}
