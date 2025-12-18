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
