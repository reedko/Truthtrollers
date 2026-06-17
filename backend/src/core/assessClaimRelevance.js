// backend/src/core/assessClaimRelevance.js
/**
 * Lightweight AI assessment for reference claim → task claim relevance
 * Simpler than full evidence engine - just compares two claims directly
 */

import { openAiLLM } from "./openAiLLM.js";

const STANCE_CONTRACT = `STANCE CONTRACT:
- Judge stance only relative to the TASK CLAIM.
- "support" means the reference makes the task claim more likely true.
- "refute" means the reference contradicts or weakens the task claim.
- If the task claim says A > B and the reference says B > A, stance must be "refute".
- Never use "support" merely because the reference source appears credible or the reference claim is true.`;

function normalizeStance(rawStance) {
  const stance = String(rawStance || "").trim().toLowerCase();
  if (["support", "supports", "supported", "for"].includes(stance)) return "support";
  if (["refute", "refutes", "refuted", "against", "contradict", "contradicts"].includes(stance)) return "refute";
  if (["nuance", "nuances", "related", "partial", "mixed"].includes(stance)) return "nuance";
  if (["insufficient", "irrelevant", "unclear", "unknown", "neutral"].includes(stance)) return "insufficient";
  return "insufficient";
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
 * Assess whether a reference claim supports/refutes/nuances a task claim
 * @param {Object} params
 * @param {string} params.referenceClaimText - Claim from scraped reference
 * @param {string} params.taskClaimText - Claim from the task
 * @param {string} [params.systemPrompt] - Optional custom system prompt
 * @param {string} [params.customInstructions] - Optional additional instructions
 * @param {Object} [params.promptManager] - Optional prompt manager for DB prompts
 * @returns {Promise<Object>} Assessment with stance, confidence, rationale
 */
export async function assessClaimRelevance({
  referenceClaimText,
  taskClaimText,
  systemPrompt,
  customInstructions,
  promptManager,
}) {
  const defaultSystem = `You are assessing whether a reference claim is relevant to a task claim.

CRITICAL STANCE RULE:
The stance is ALWAYS relative to the TASK CLAIM being evaluated, not whether the reference claim is true in isolation.

Guidelines:
- "support": Reference claim provides evidence FOR the task claim or makes it more likely true
- "refute": Reference claim provides evidence AGAINST the task claim or makes it less likely true
- "nuance": Reference claim adds context or partial support/refutation without clearly proving or disproving it
- "insufficient": Reference claim is not relevant or doesn't provide meaningful evidence

Comparison rule:
If the task claim says A is greater than B and the reference says B is greater than A, the correct stance is "refute".
Example:
Task claim: "The risks of myocarditis from Covid shots outweigh the risk from the virus."
Reference claim: "COVID-19 infection poses a higher myocarditis risk than vaccination."
Correct stance: "refute" because the reference says the opposite of the task claim.

- confidence: 0-1 (how certain you are of the stance)
- quality: 0-1.2 (how strong/useful the reference claim is as evidence)
- rationale: 1-2 sentences explicitly explaining why the reference supports, refutes, or nuances the task claim`;

  const defaultUser = `TASK CLAIM:
"${taskClaimText}"

REFERENCE CLAIM:
"${referenceClaimText}"

Analyze whether the reference claim supports, refutes, nuances, or is insufficient for evaluating the task claim.
Do not label a reference "support" merely because the reference itself is credible or true.`;

  let system = systemPrompt || defaultSystem;
  let user = defaultUser;

  // Try to load from database if promptManager is available
  if (promptManager && !systemPrompt) {
    try {
      const systemPromptDB = await promptManager.getPrompt(
        'claim_relevance_assessment_system',
        { system: defaultSystem, user: '', parameters: {} }
      );

      const userPromptDB = await promptManager.getPrompt(
        'claim_relevance_assessment_user',
        { system: '', user: defaultUser, parameters: {} }
      );

      system = systemPromptDB.system;
      user = userPromptDB.user
        .replace(/\{\{taskClaimText\}\}/g, taskClaimText)
        .replace(/\{\{referenceClaimText\}\}/g, referenceClaimText)
        .replace(/\{\{customInstructions\}\}/g, customInstructions ? `\n\nADDITIONAL INSTRUCTIONS:\n${customInstructions}` : '');
    } catch (err) {
      console.warn('[assessClaimRelevance] Error loading DB prompts, using fallback:', err.message);
      // Use default fallback
      user = defaultUser;
      if (customInstructions) {
        user += `\n\nADDITIONAL INSTRUCTIONS:\n${customInstructions}`;
      }
    }
  } else {
    // No promptManager or custom systemPrompt provided
    if (customInstructions) {
      user += `\n\nADDITIONAL INSTRUCTIONS:\n${customInstructions}`;
    }
  }

  system = `${system}\n\n${STANCE_CONTRACT}`;
  user = `${user}\n\nBefore returning JSON, verify the stance follows the stance contract.`;

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

    const override = comparativeRiskOverride(taskClaimText, referenceClaimText, assessment.rationale);
    assessment.stance = override?.stance || normalizeStance(assessment.stance);
    if (override) {
      assessment.rationale = `${assessment.rationale || ""} [Stance corrected: ${override.reason}.]`.trim();
    }

    // Calculate support_level using stance multiplier
    const stanceMultiplier = {
      support: 1.0,
      refute: -1.0,
      nuance: 0.5,
      insufficient: 0.0,
    };

    const confidence = Math.max(0, Math.min(1, Number(assessment.confidence) || 0));
    const quality = Math.max(0, Math.min(1.2, Number(assessment.quality) || 0));
    assessment.confidence = confidence;
    assessment.quality = quality;

    const multiplier = stanceMultiplier[assessment.stance] || 0;
    assessment.support_level = multiplier * confidence * quality;

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
