// backend/src/utils/extractQuote.js
// ─────────────────────────────────────────────
// Shared utility for extracting verbatim quotes from text
// Used by both evidence engine and manual scrape validation
// ─────────────────────────────────────────────

import { openAiLLM } from "../core/openAiLLM.js";
import logger from "./logger.js";
import { applyQuantitativeStanceGuard } from "../core/quantitativeClaimGuard.js";

const BEARING_TYPES = new Set(["direct", "indirect", "context", "origin", "steelman", "none"]);
const CLAIM_COMPONENTS = new Set(["whole_claim", "subject", "relation", "object", "scope", "attribution", "warrant", "none"]);
const CAUSAL_STRENGTHS = new Set(["causal", "associative", "correlational", "mechanistic", "not_applicable"]);

export function isPostScrapeBearingEnabled(env = process.env) {
  if (env.ENABLE_BEARING_PACKET_LIVE === "true") return true;
  if (env.ENABLE_POST_SCRAPE_BEARING_SHADOW === "false") return false;
  if (env.ENABLE_POST_SCRAPE_BEARING_SHADOW === "true") return true;
  return env.NODE_ENV !== "production";
}

export function normalizePostScrapeBearingScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(Math.max(0, Math.min(1, parsed)) * 10000) / 10000;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizePostScrapeBearingFields(item) {
  return {
    bearing_score: normalizePostScrapeBearingScore(item?.bearing_score ?? item?.bearingScore),
    bearing_type: normalizeEnum(item?.bearing_type ?? item?.bearingType, BEARING_TYPES, "none"),
    claim_component_addressed: normalizeEnum(
      item?.claim_component_addressed ?? item?.claimComponentAddressed,
      CLAIM_COMPONENTS,
      "none",
    ),
    causal_strength: normalizeEnum(
      item?.causal_strength ?? item?.causalStrength,
      CAUSAL_STRENGTHS,
      "not_applicable",
    ),
    bearing_reason: boundedText(item?.bearing_reason ?? item?.bearingReason, 500),
  };
}

export function applyQuantitativeGuardToQuote(claimText, quote) {
  const guard = applyQuantitativeStanceGuard({
    taskClaimText: claimText,
    evidenceText: `${quote?.quote || ""} ${quote?.summary || ""}`,
    proposedStance: quote?.stance,
  });
  if (!guard) return quote;
  const reason = boundedText(`${guard.reason} ${quote?.bearing_reason || ""}`, 500);
  if (guard.stance === "insufficient") {
    return {
      ...quote,
      stance: "insufficient",
      bearing_score: Math.min(Number(quote?.bearing_score) || 0, 0.2),
      bearing_type: "context",
      claim_component_addressed: "scope",
      bearing_reason: reason,
      quantitative_guard: guard,
    };
  }
  return {
    ...quote,
    stance: guard.stance,
    bearing_reason: reason,
    quantitative_guard: guard,
  };
}

function logPostScrapeBearing({ claimText, sourceTitle, url, quotes, documentBearingScore }) {
  const record = {
    event: "post_scrape_bearing_shadow",
    claimText: boundedText(claimText, 500),
    sourceTitle: boundedText(sourceTitle, 500),
    url: boundedText(url, 2048),
    documentBearingScore,
    quoteCount: quotes.length,
    quotes: quotes.map((quote) => ({
      bearingScore: quote.bearing_score,
      bearingType: quote.bearing_type,
      claimComponentAddressed: quote.claim_component_addressed,
      causalStrength: quote.causal_strength,
      reason: boundedText(quote.bearing_reason, 500),
      quote: boundedText(quote.quote, 1000),
    })),
    method: "post_scrape_llm_v1",
  };
  logger.log(`[BEARING_POST_SCRAPE] ${JSON.stringify(record)}`);
}

/**
 * Extract verbatim quote(s) from text that relate to a claim
 *
 * @param {Object} params
 * @param {string} params.claimText - The claim to find evidence for
 * @param {string} params.fullText - The full text to extract quotes from
 * @param {string} params.sourceTitle - Optional source title for context
 * @param {number} params.maxChars - Max chars to send to LLM (default 8000)
 * @param {number} params.maxQuotes - Max number of quotes to extract (default 2)
 * @returns {Promise<Array>} Array of {quote, stance, summary, location}
 */
export async function extractQuotesFromText({
  claimText,
  fullText,
  sourceTitle = "Unknown Source",
  maxChars = 8000,
  maxQuotes = 2,
}) {
  try {
    const system =
      "You extract verbatim quotes that directly bear on a claim; classify stance.";

    const user = `Claim: ${claimText}\nSource: ${sourceTitle}\nText:\n${fullText.slice(0, maxChars)}`;

    const schema =
      '{"items":[{"quote":"...","stance":"support|refute|nuance|insufficient","summary":"...","location":{"page":null,"section":"..."}}]}';

    const out = await openAiLLM.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.1,
    });

    const items = out && Array.isArray(out.items) ? out.items : [];

    // Filter out items without quotes and limit to maxQuotes
    const validItems = items
      .filter((it) => it && it.quote)
      .slice(0, maxQuotes)
      .map((it) => ({
        quote: String(it.quote).trim(),
        stance: it.stance || "insufficient",
        summary: (it.summary || "").trim(),
        location: it.location || undefined,
      }));

    logger.log(
      `✅ [extractQuote] Extracted ${validItems.length} quote(s) for claim: ${claimText.slice(0, 50)}...`
    );

    return validItems;
  } catch (err) {
    logger.error(`❌ [extractQuote] Failed to extract quotes:`, err.message);
    return [];
  }
}

/**
 * Extract single best quote from text (convenience wrapper)
 * Returns null if no quote found
 */
export async function extractBestQuote({
  claimText,
  fullText,
  sourceTitle,
  maxChars = 8000,
}) {
  const quotes = await extractQuotesFromText({
    claimText,
    fullText,
    sourceTitle,
    maxChars,
    maxQuotes: 1,
  });

  return quotes.length > 0 ? quotes[0] : null;
}

/**
 * COMBINED: Extract quotes AND score source quality in a single LLM call
 * This reduces LLM calls by ~50% compared to separate extract + score calls
 *
 * @param {Object} params
 * @param {string} params.claimText - The claim to find evidence for
 * @param {string} params.fullText - The full text to extract quotes from
 * @param {string} params.sourceTitle - Source title for context
 * @param {string} params.url - Source URL
 * @param {string} params.domain - Source domain
 * @param {Object} params.metadata - Author/publisher metadata
 * @param {number} params.maxChars - Max chars to send to LLM (default 8000)
 * @param {number} params.maxQuotes - Max number of quotes to extract (default 2)
 * @param {Object} params.llm - Optional LLM dependency for tests/callers
 * @param {boolean} params.enablePostScrapeBearing - Optional feature override
 * @returns {Promise<Object>} {quotes: [...], qualityScores: {...}}
 */
export async function extractQuotesAndScoreQuality({
  claimText,
  fullText,
  sourceTitle = "Unknown Source",
  url = "",
  domain = "",
  metadata = {},
  maxChars = 8000,
  maxQuotes = 2,
  llm = openAiLLM,
  enablePostScrapeBearing = isPostScrapeBearingEnabled(),
}) {
  try {
    const system = `You extract verbatim quotes from sources AND evaluate source quality in a single analysis. Return valid JSON only.`;

    const citationInfo = metadata.citationCount !== undefined
      ? `- Citations Extracted: ${metadata.citationCount} citations/references found\n`
      : '';

    const bearingFieldInstructions = enablePostScrapeBearing ? `
- bearing_score: 0.0-1.0, how strongly this exact quote could affect the truth value of the exact CLAIM
- bearing_type: direct|indirect|context|origin|steelman|none
- claim_component_addressed: whole_claim|subject|relation|object|scope|attribution|warrant|none
- causal_strength: causal|associative|correlational|mechanistic|not_applicable
- bearing_reason: one short explanation of the exact truth-value connection

BEARING RULES:
• Bearing is NOT source quality, authority, stance, confidence, or general topic similarity.
• A high-authority source can have low bearing; a low-quality source can have high bearing.
• High bearing requires a quote that could support, refute, or materially qualify the exact assertion.
• Generic background or same-topic discussion is low/zero bearing and should be stance "insufficient" unless it changes scope or warrant.
• For a causal CLAIM, association/correlation bears only partially unless causal or mechanistic evidence is explicit. Set causal_strength accurately.
• For "X said Y", evidence that X said Y addresses attribution; evidence about whether Y is true addresses the object assertion. Do not substitute one for the other.
• An article-level fact-check does not refute every embedded subclaim. Use refute only when this quote addresses the exact CLAIM or component.
• Skepticism, doubt, or criticism alone is not refutation. Refute requires a reason, finding, failed premise, or evidence that weakens the exact CLAIM.
• A different location, population, date, or dose is not automatically refutation. Treat it as scope-bearing only when it changes applicability or generality.
• Use nuance only for a material limitation or qualification. Use insufficient for merely topical context.
` : "";

    const criticalRules = enablePostScrapeBearing
      ? `CRITICAL:
- If the source gives evidence or a reason that the exact claim is wrong, classify "refute"
- If a fact-check tests this exact assertion and rates it false/misleading, classify "refute"
- If scope differs, classify by whether that difference actually affects the claim's scope or generality
- Don't confuse "mentions the claim" with "supports the claim"`
      : `CRITICAL:
- If the source expresses skepticism, doubt, or criticism → "refute"
- If the source is a fact-check that rates the claim false/misleading → "refute"
- If the source says "this is wrong", "contrary to claims", or "no evidence for" → "refute"
- If the source describes an incident at a DIFFERENT school/location than the claim → "refute" or "insufficient"
- Don't confuse "mentions the claim" with "supports the claim"`;

    const stanceClassificationRules = enablePostScrapeBearing
      ? `• support: Source provides evidence FOR the exact claim or makes it more likely true
• refute: Source provides evidence AGAINST the exact claim or makes it less likely true
• nuance: Source materially changes scope, magnitude, mechanism, applicability, or warrant without clearly supporting/refuting
• insufficient: Source merely mentions the topic/claim or provides background with no truth-value impact`
      : `• support: Source provides evidence FOR the claim, confirms it, or corroborates it
• refute: Source contradicts the claim, questions it, debunks it, fact-checks it as false, or provides evidence AGAINST it
• nuance: Source adds context, caveats, limitations, or partial agreement/disagreement
• insufficient: Source mentions the claim but takes no clear position`;

    const attributionRule = enablePostScrapeBearing
      ? `• If CLAIM says "X said/revealed Y", distinguish two questions: whether X said Y (attribution) and whether Y is true (object). Label claim_component_addressed accordingly and do not substitute one for the other.`
      : `• If CLAIM includes an attribution wrapper like "X revealed that Y", evaluate Y as the core assertion and use X only for search/context.`;

    const user = `TASK 1: Extract verbatim quotes that directly bear on the claim and classify stance.
TASK 2: Score source quality across 8 dimensions (0-10 scale, matching GameSpace scoring).

CLAIM: ${claimText}

SOURCE METADATA:
- Title: ${sourceTitle}
- URL: ${url || 'unknown'}
- Domain: ${domain || 'unknown'}
- Author: ${metadata.author || 'unknown'}
- Publisher: ${metadata.publisher || 'unknown'}
${citationInfo}
CONTENT (first ${maxChars} chars):
${fullText.slice(0, maxChars)}

EXTRACT QUOTES (up to ${maxQuotes}):
For each quote, provide:
- quote: verbatim text from source
- stance: support|refute|nuance|insufficient
- summary: brief explanation
- location: {page: null, section: "..."}
${bearingFieldInstructions}

STANCE CLASSIFICATION RULES:
${stanceClassificationRules}

ATOMIC ASSERTION RULES:
• Evaluate the exact factual assertion in CLAIM, not a broader topic nearby.
${attributionRule}
• If CLAIM alleges misconduct such as "ordered scientists to destroy evidence", "destroyed evidence", "fraud", "cover-up", or "data manipulation", support requires a quote directly addressing that misconduct.
• A quote saying data was "omitted", "excluded", "not reported", or "re-analyzed" does NOT support a claim that evidence was destroyed or that scientists were ordered to destroy it.
• A quote saying "MMR does not cause autism" or "no link was found" does NOT by itself refute that someone ordered evidence destroyed; mark it nuance unless it also addresses the alleged order/destruction/cover-up.
• For destruction/order allegations, use refute only when the source says the alleged destruction/order did not happen, was unsupported, was false/misleading, or contradicts the alleged misconduct.
• Do not infer support from implication. The quote must bear on the specific assertion.

${criticalRules}

SCORE SOURCE QUALITY (0-10 scale):

TRANSPARENCY:
1. author_transparency: Named author with credentials? (10=expert, 5=named unclear, 0=anonymous)
2. publisher_transparency: Clear about page, editorial standards? (10=major publication, 5=some transparency, 0=hidden)

EVIDENCE:
3. evidence_density: Citations, documents, data, quotes? ${metadata.citationCount !== undefined ? `(Note: ${metadata.citationCount} citations extracted)` : ''} (10=extensive 15+, 5=some 3-10, 0=none 0-2)
4. claim_specificity: Concrete testable claims vs vague? (10=specific falsifiable, 5=mixed, 0=all vague)

RELIABILITY:
5. correction_behavior: Track record of corrections? (10=clear policy, 5=some corrections, 0=hides mistakes)
6. original_reporting: Firsthand vs recycled? (10=original investigative, 5=mix, 0=all recycled)

RISK (higher = riskier):
7. sensationalism_score: Emotional framing, outrage? (10=extreme, 5=some, 0=neutral)
8. monetization_pressure: Popups, clickbait? (10=aggressive, 5=moderate, 0=minimal)`;

    const bearingSchemaFields = enablePostScrapeBearing ? `,
      "bearing_score": 0.0,
      "bearing_type": "direct|indirect|context|origin|steelman|none",
      "claim_component_addressed": "whole_claim|subject|relation|object|scope|attribution|warrant|none",
      "causal_strength": "causal|associative|correlational|mechanistic|not_applicable",
      "bearing_reason": "short exact-claim explanation"` : "";

    const schema = `{
  "quotes": [
    {
      "quote": "verbatim text",
      "stance": "support|refute|nuance|insufficient",
      "summary": "brief explanation",
      "location": {"page": null, "section": "..."}${bearingSchemaFields}
    }
  ],
  "quality": {
    "author_transparency": 5.0,
    "publisher_transparency": 5.0,
    "evidence_density": 5.0,
    "claim_specificity": 5.0,
    "correction_behavior": 5.0,
    "original_reporting": 5.0,
    "sensationalism_score": 5.0,
    "monetization_pressure": 5.0,
    "reasoning": "brief explanation"
  }
}`;

    const out = await llm.generate({
      system,
      user,
      schemaHint: schema,
      temperature: 0.1,
    });

    // Extract quotes
    const quotesArray = out?.quotes || [];
    const validQuotes = quotesArray
      .filter((it) => it && it.quote)
      .slice(0, maxQuotes)
      .map((it) => {
        const legacyQuote = {
          quote: String(it.quote).trim(),
          stance: it.stance || "insufficient",
          summary: (it.summary || "").trim(),
          location: it.location || undefined,
        };
        return enablePostScrapeBearing
          ? applyQuantitativeGuardToQuote(claimText, { ...legacyQuote, ...normalizePostScrapeBearingFields(it) })
          : legacyQuote;
      });

    // Extract quality scores
    const qualityScores = out?.quality || {};

    // Calculate aggregate scores (same logic as SourceQualityScorer)
    const quality_score = calculateQualityScore(qualityScores);
    const risk_score = calculateRiskScore(qualityScores);
    const quality_tier = classifyQualityTier(quality_score, risk_score);

    logger.log(
      `✅ [extractQuotesAndScoreQuality] Extracted ${validQuotes.length} quote(s) + quality=${quality_tier} (${quality_score}/10) for: ${claimText.slice(0, 50)}...`
    );

    const result = {
      quotes: validQuotes,
      qualityScores: {
        ...qualityScores,
        quality_score,
        risk_score,
        quality_tier,
      },
    };

    if (enablePostScrapeBearing) {
      const scoredQuotes = validQuotes
        .map((quote) => quote.bearing_score)
        .filter((score) => Number.isFinite(score));
      result.documentBearingScore = scoredQuotes.length > 0 ? Math.max(...scoredQuotes) : null;
      logPostScrapeBearing({
        claimText,
        sourceTitle,
        url,
        quotes: validQuotes,
        documentBearingScore: result.documentBearingScore,
      });
    }

    return result;
  } catch (err) {
    logger.error(`❌ [extractQuotesAndScoreQuality] Failed:`, err.message);
    return {
      quotes: [],
      qualityScores: null,
    };
  }
}

/**
 * Calculate aggregate quality score (weighted average)
 * Returns 0-10 scale to match GameSpace
 */
function calculateQualityScore(scores) {
  const weights = {
    author_transparency: 1.0,
    publisher_transparency: 1.2,
    evidence_density: 1.5,
    claim_specificity: 1.3,
    correction_behavior: 1.0,
    original_reporting: 1.1,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dimension, weight] of Object.entries(weights)) {
    if (scores[dimension] !== undefined && scores[dimension] !== null) {
      weightedSum += scores[dimension] * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 5.0;
}

/**
 * Calculate aggregate risk score (weighted average)
 * Returns 0-10 scale to match GameSpace
 */
function calculateRiskScore(scores) {
  const weights = {
    sensationalism_score: 1.5,
    monetization_pressure: 1.0,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dimension, weight] of Object.entries(weights)) {
    if (scores[dimension] !== undefined && scores[dimension] !== null) {
      weightedSum += scores[dimension] * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 5.0;
}

/**
 * Classify quality tier based on quality and risk scores (0-10 scale)
 */
function classifyQualityTier(quality_score, risk_score) {
  if (quality_score > 7.0 && risk_score < 3.0) return 'high';
  if (quality_score < 4.0 || risk_score > 7.0) return 'unreliable';
  if (quality_score < 5.0) return 'low';
  return 'mid';
}
