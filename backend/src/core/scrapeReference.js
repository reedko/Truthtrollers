// backend/src/core/scrapeReference.js
// ─────────────────────────────────────────────
// Process an AI reference using pre-fetched text
// (avoiding double-fetch from evidence engine)
// ─────────────────────────────────────────────

import logger from "../utils/logger.js";
import * as cheerio from "cheerio";
import { extractAuthors } from "../utils/extractAuthors.js";
import { extractPublisher } from "../utils/extractPublisher.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { createContentInternal } from "../storage/createContentInternal.js";

/**
 * scrapeReference(query, { url, raw_text, raw_html, title, authors, taskContentId })
 *
 * Processes a reference using pre-fetched text/HTML:
 * - Parse HTML with cheerio (or use raw_text for PDFs)
 * - Extract metadata (authors, publisher, title)
 * - Create reference content row
 * - Returns: { referenceContentId, url, title, text, authors, publisher }
 *
 * NOTE: Claims extraction happens separately via processReferenceClaims
 */
export async function scrapeReference(query, { url, raw_text, raw_html, title, authors: providedAuthors, taskContentId }) {
  try {
    logger.log(`🟦 [scrapeReference] Processing reference: ${url}`);

    // Accept either raw_html or raw_text (raw_html takes precedence)
    const htmlContent = raw_html || raw_text;

    if (!htmlContent || htmlContent.length < 100) {
      logger.warn(`⚠️ [scrapeReference] Insufficient HTML/text for ${url}`);
      return null;
    }

    // ─────────────────────────────────────────────
    // 1. PARSE HTML (skip parsing if we only have plain text from PDF)
    // ─────────────────────────────────────────────

    const $ = raw_html ? cheerio.load(htmlContent) : null;

    // ─────────────────────────────────────────────
    // 2. EXTRACT METADATA: title, authors, publisher
    // ─────────────────────────────────────────────

    // Use provided title (from PDF metadata) or extract from HTML
    let finalTitle = title || ($? await getMainHeadline($) : null) || "AI Reference";
    if (finalTitle.length < 3) {
      finalTitle = ($? await getMainHeadline($) : null) || "AI Reference";
    }

    // Use provided authors (from PDF metadata) or extract from HTML
    const authors = providedAuthors || ($ ? await extractAuthors($) : []);
    const publisher = $ ? await extractPublisher($) : null;

    // ─────────────────────────────────────────────
    // 3. EXTRACT CLEAN TEXT
    // ─────────────────────────────────────────────

    let text;
    if (raw_html) {
      // Extract clean text from HTML
      $("script, style, link").remove();
      let cleanText = $.text().trim();
      if (cleanText.length > 60000) {
        cleanText = cleanText.slice(0, 60000);
      }
      text = cleanText;
    } else {
      // Use raw_text directly (for PDFs)
      text = raw_text.slice(0, 60000);
    }

    // ─────────────────────────────────────────────
    // 4. CREATE REFERENCE CONTENT ROW
    // ─────────────────────────────────────────────

    const referenceContentId = await createContentInternal(query, {
      content_name: finalTitle,
      url,
      media_source: publisher?.name || "Unknown",
      topic: "AI Evidence", // References inherit task topic in UI
      subtopics: [],
      content_type: "reference",
      taskContentId, // Link to parent task
      thumbnail: "", // AI refs don't have thumbnails from search
      details: text.slice(0, 500), // Preview
    });

    logger.log(
      `✅ [scrapeReference] Created reference content_id=${referenceContentId} for ${url}`
    );

    // ─────────────────────────────────────────────
    // 5. RETURN STRUCTURED OUTPUT
    // ─────────────────────────────────────────────

    return {
      referenceContentId,
      url,
      title: finalTitle,
      text,
      authors,
      publisher,
    };
  } catch (err) {
    logger.error("❌ [scrapeReference] Fatal error on:", url, err);
    return null;
  }
}
