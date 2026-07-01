// backend/src/utils/fetchPageContent.js
// ─────────────────────────────────────────────
// Simple HTML fetch wrapper for backend scraping
// Uses fetchWithFallbacks and returns cheerio object
// ─────────────────────────────────────────────

import * as cheerio from "cheerio";
import { fetchTextWithFallbacks } from "./fetchWithFallbacks.js";
import logger from "./logger.js";

/**
 * fetchPageContent(url)
 *
 * Fetches HTML content and returns a cheerio object.
 * Uses fetchTextWithFallbacks for robust fetching (axios → puppeteer → wayback).
 *
 * Returns: cheerio.CheerioAPI object
 * Throws: Error if fetch fails
 */
export async function fetchPageContent(url) {
  try {
    logger.log(`🌐 [fetchPageContent] Fetching: ${url}`);

    const result = await fetchTextWithFallbacks(url);

    if (!result || !result.text) {
      throw new Error(`Failed to fetch content from ${url}`);
    }

    logger.log(
      `✅ [fetchPageContent] Fetched ${result.text.length} chars via ${result.method}`
    );

    // Load into cheerio
    const $ = cheerio.load(result.text);

    return $;
  } catch (err) {
    logger.error(`❌ [fetchPageContent] Error fetching ${url}:`, err);
    throw err;
  }
}
