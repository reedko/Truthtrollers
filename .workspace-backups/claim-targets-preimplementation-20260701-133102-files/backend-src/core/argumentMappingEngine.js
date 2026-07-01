import { openAiLLM } from "./openAiLLM.js";
import PromptManager from "./promptManager.js";
import { classifyAttributionClaim } from "../utils/normalizeEvidenceClaim.js";
import logger from "../utils/logger.js";

const ALLOWED_STANCES = new Set(["endorses", "rejects", "neutral", "unclear"]);
const ALLOWED_FUNCTIONS = new Set([
  "thesis",
  "supporting_premise",
  "evidence",
  "opposing_claim_to_refute",
  "background",
  "reported_neutral",
  "unclear",
]);
const ALLOWED_TRANSFORMS = new Set(["normal", "invert", "none", "review"]);

const FALLBACK_SYSTEM = `You map extracted case claims to their function inside the article's argument.

Return strict JSON only. Do not include markdown or commentary.

Decide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.

This is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.

For attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.

scoreTransform controls how evidence about the object claim should affect the article:
- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.
- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.
- none: the claim should not directly affect the article score.
- review: unclear; human review needed before scoring.

Use invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.
Use none for attribution-only, neutral reporting, or background that does not carry the argument.`;

const FALLBACK_USER = `Analyze this article excerpt and extracted claims.

ARTICLE EXCERPT:
{{articleExcerpt}}

EXTRACTED THESIS:
{{articleThesis}}

CLAIMS:
{{claimsJson}}

Return JSON with exactly this structure:
{
  "articleThesis": "",
  "claims": [
    {
      "claimId": 0,
      "objectClaim": "",
      "isAttribution": false,
      "speakerEntity": "",
      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",
      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
      "scoreTransform": "normal|invert|none|review",
      "accountabilityEligible": false,
      "confidence": 0,
      "rationale": ""
    }
  ]
}

Rules:
- Include one output item for every input claim.
- objectClaim is the factual assertion evidence search should evaluate.
- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.
- If the article uses Y as an example of what is wrong or false, use argumentFunction opposing_claim_to_refute and scoreTransform invert.
- If the article uses Y to support its own thesis, use normal.
- If the article merely says who said something and the object claim does not carry the article argument, use none.
- Keep rationales short.`;

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeBool(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function fillTemplate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function deriveTransform(argumentFunction, stance, existingTransform) {
  if (ALLOWED_TRANSFORMS.has(existingTransform)) return existingTransform;
  if (argumentFunction === "opposing_claim_to_refute" || stance === "rejects") return "invert";
  if (argumentFunction === "background" || argumentFunction === "reported_neutral" || stance === "neutral") return "none";
  if (argumentFunction === "unclear" || stance === "unclear") return "review";
  return "normal";
}

function normalizeMappingItem(raw, inputClaim) {
  const attribution = classifyAttributionClaim(inputClaim.text);
  const rawFunction = String(raw?.argumentFunction || raw?.argument_function || "").trim();
  const rawStance = String(raw?.articleStanceTowardObjectClaim || raw?.article_stance || "").trim();
  const rawTransform = String(raw?.scoreTransform || raw?.score_transform || "").trim();

  const argumentFunction = ALLOWED_FUNCTIONS.has(rawFunction) ? rawFunction : "unclear";
  const articleStance = ALLOWED_STANCES.has(rawStance) ? rawStance : "unclear";
  const scoreTransform = deriveTransform(argumentFunction, articleStance, rawTransform);
  const isAttribution = normalizeBool(raw?.isAttribution ?? raw?.is_attribution) ?? attribution.isAttribution;
  const objectClaim = String(raw?.objectClaim || raw?.object_claim_text || attribution.objectText || inputClaim.objectText || inputClaim.text || "")
    .trim()
    .replace(/\s+/g, " ");

  return {
    claimId: Number(raw?.claimId || raw?.claim_id || inputClaim.id),
    objectClaim,
    isAttribution,
    speakerEntity: String(raw?.speakerEntity || raw?.speaker_entity || attribution.speakerEntity || inputClaim.speakerEntity || "").trim(),
    articleStance,
    argumentFunction,
    scoreTransform,
    accountabilityEligible: normalizeBool(raw?.accountabilityEligible ?? raw?.accountability_eligible) ?? Boolean(attribution.accountabilityEligible),
    confidence: clamp01(raw?.confidence ?? raw?.argument_mapping_confidence, 0),
    rationale: String(raw?.rationale || "").trim().slice(0, 1000),
  };
}

export async function mapArgumentFunctions({
  query,
  taskContentId,
  articleText = "",
  claims = [],
}) {
  if (!query) throw new Error("mapArgumentFunctions: missing query");
  if (!taskContentId) throw new Error("mapArgumentFunctions: missing taskContentId");
  if (!Array.isArray(claims) || claims.length === 0) return [];

  const promptManager = new PromptManager(query);
  const systemPrompt = await promptManager.getPrompt("argument_mapping_system", {
    system: FALLBACK_SYSTEM,
    user: "",
    parameters: {},
  });
  const userPrompt = await promptManager.getPrompt("argument_mapping_user", {
    system: "",
    user: FALLBACK_USER,
    parameters: {},
  });

  const articleThesis =
    claims.find((claim) => String(claim.role || "").toLowerCase() === "thesis")?.text ||
    claims[0]?.text ||
    "";
  const compactClaims = claims.map((claim) => ({
    claimId: claim.id,
    text: claim.text,
    role: claim.role || null,
    relationshipType: claim.relationshipType || null,
    objectText: claim.objectText || null,
  }));
  const user = fillTemplate(userPrompt.user || FALLBACK_USER, {
    articleExcerpt: String(articleText || "").slice(0, 16000),
    articleThesis,
    claimsJson: JSON.stringify(compactClaims, null, 2),
  });

  let response;
  try {
    response = await openAiLLM.generate({
      system: systemPrompt.system || FALLBACK_SYSTEM,
      user,
      schemaHint: "",
      temperature: 0,
      maxRetries: 2,
      timeout: 45000,
    });
  } catch (err) {
    logger.warn("[argumentMapping] LLM mapping failed; using deterministic fallback:", err.message);
    response = { claims: [] };
  }

  const byInputId = new Map(claims.map((claim) => [Number(claim.id), claim]));
  const rawItems = Array.isArray(response?.claims) ? response.claims : [];
  const rawById = new Map(rawItems.map((item) => [Number(item?.claimId || item?.claim_id), item]));

  const mapped = claims.map((claim) => {
    const raw = rawById.get(Number(claim.id)) || {};
    return normalizeMappingItem(raw, byInputId.get(Number(claim.id)) || claim);
  });

  for (const item of mapped) {
    await query(
      `UPDATE content_claims
          SET object_claim_text = ?,
              is_attribution = ?,
              speaker_entity = NULLIF(?, ''),
              article_stance = ?,
              argument_function = ?,
              score_transform = ?,
              accountability_eligible = ?,
              argument_mapping_confidence = ?,
              argument_mapping_rationale = NULLIF(?, '')
        WHERE content_id = ? AND claim_id = ?`,
      [
        item.objectClaim || null,
        item.isAttribution ? 1 : 0,
        item.speakerEntity || "",
        item.articleStance,
        item.argumentFunction,
        item.scoreTransform,
        item.accountabilityEligible ? 1 : 0,
        item.confidence,
        item.rationale || "",
        taskContentId,
        item.claimId,
      ]
    );
  }

  logger.log(`🧭 [argumentMapping] Mapped ${mapped.length} claims for content ${taskContentId}`);
  return mapped;
}
