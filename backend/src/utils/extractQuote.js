// backend/src/utils/extractQuote.js
// ─────────────────────────────────────────────
// Shared utility for extracting verbatim quotes from text
// Used by both evidence engine and manual scrape validation
// ─────────────────────────────────────────────

import { openAiLLM } from "../core/openAiLLM.js";
import logger from "./logger.js";

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
}) {
  try {
    const system = `You extract verbatim quotes from sources AND evaluate source quality in a single analysis. Return valid JSON only.`;

    const citationInfo = metadata.citationCount !== undefined
      ? `- Citations Extracted: ${metadata.citationCount} citations/references found\n`
      : '';

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

    const schema = `{
  "quotes": [
    {
      "quote": "verbatim text",
      "stance": "support|refute|nuance|insufficient",
      "summary": "brief explanation",
      "location": {"page": null, "section": "..."}
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

    const out = await openAiLLM.generate({
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
      .map((it) => ({
        quote: String(it.quote).trim(),
        stance: it.stance || "insufficient",
        summary: (it.summary || "").trim(),
        location: it.location || undefined,
      }));

    // Extract quality scores
    const qualityScores = out?.quality || {};

    // Calculate aggregate scores (same logic as SourceQualityScorer)
    const quality_score = calculateQualityScore(qualityScores);
    const risk_score = calculateRiskScore(qualityScores);
    const quality_tier = classifyQualityTier(quality_score, risk_score);

    logger.log(
      `✅ [extractQuotesAndScoreQuality] Extracted ${validQuotes.length} quote(s) + quality=${quality_tier} (${quality_score}/10) for: ${claimText.slice(0, 50)}...`
    );

    return {
      quotes: validQuotes,
      qualityScores: {
        ...qualityScores,
        quality_score,
        risk_score,
        quality_tier,
      },
    };
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
