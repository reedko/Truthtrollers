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
import { getBestImage } from "../utils/getBestImage.js";

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

    // Use provided title (from PDF metadata) or extract from HTML/text
    let finalTitle = title || ($? await getMainHeadline($) : null) || "AI Reference";

    // If no title and we have raw_text (PDF), extract from first line
    if ((!finalTitle || finalTitle === "AI Reference" || finalTitle.length < 3) && raw_text && !raw_html) {
      const lines = raw_text.split('\n').map(l => l.trim()).filter(Boolean);
      // Use first substantial line as title (skip very short lines)
      for (const line of lines) {
        if (line.length > 10 && line.length < 200) {
          finalTitle = `[PDF] ${line}`;
          break;
        }
      }
    }

    if (!finalTitle || finalTitle.length < 3) {
      finalTitle = ($? await getMainHeadline($) : null) || "AI Reference";
    }

    // Use provided authors (from PDF metadata) or extract from HTML
    const authors = providedAuthors || ($ ? await extractAuthors($) : []);
    const publisher = $ ? await extractPublisher($) : null;

    // Extract thumbnail
    let thumbnail = "";
    const isPdf = !raw_html && raw_text; // PDF if we have text but no HTML

    if (isPdf) {
      // TODO: For PDFs scraped from extension, we need to pass the blob to thumbnail generator
      // For now, skip thumbnail generation (would need to refetch PDF which might be blocked)
      logger.log(`🖼️  [scrapeReference] Skipping PDF thumbnail (would require re-fetching blocked PDF)`);
    } else if ($) {
      // For HTML pages, extract image from page
      thumbnail = getBestImage($, url) || "";
      if (thumbnail) {
        logger.log(`🖼️  [scrapeReference] Extracted thumbnail: ${thumbnail.slice(0, 80)}...`);
      }
    }

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
      thumbnail,
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
