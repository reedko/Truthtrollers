// backend/src/core/scrapeTask.js
// ─────────────────────────────────────────────
// STEP 1 of the TruthTrollers pipeline:
// Fetch readable text, metadata, DOM refs, inline refs
// Create/Persist the TASK content row (content_type = 'task')
// NO CLAIM EXTRACTION here
// ─────────────────────────────────────────────

import logger from "../utils/logger.js";
import { fetchExternalPageContent } from "../utils/fetchExternalPageContent.js";
import { fetchPageContent } from "../utils/fetchPageContent.js";
import { extractAuthors } from "../utils/extractAuthors.js";
import { extractPublisher } from "../utils/extractPublisher.js";
import { extractReferences } from "../utils/extractReferences.js";
import { extractInlineRefs } from "../utils/extractInlineRefs.js";
import { extractTestimonialsFromHtml } from "../utils/extractTestimonials.js";
import { extractTranscript } from "./youtubeTranscript.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { getBestImage } from "../utils/getBestImage.js";
import { persistTaskContent } from "../storage/persistContentAndEvidence.js";
import * as cheerio from "cheerio";

/**
 * scrapeTask(query, url, raw_html?, mediaSource?, providedAuthors?)
 *  • Fetch HTML, PDF, or YouTube transcript (OR use provided raw_html)
 *  • Extract: text, title, authors, publisher, thumbnail
 *  • Extract DOM references
 *  • Extract inline references from text
 *  • Persist the task content row in DB
 *  • Returns: { taskContentId, text, metadata, domRefs, inlineRefs }
 */
export async function scrapeTask(query, url, raw_html = null, mediaSource = null, providedAuthors = null) {
  try {
    logger.log(`🟦 [scrapeTask] Starting scrape for: ${url}`);
    if (mediaSource) {
      logger.log(`📌 [scrapeTask] Media source hint: ${mediaSource}`);
    }
    if (providedAuthors && providedAuthors.length > 0) {
      logger.log(`👤 [scrapeTask] Using ${providedAuthors.length} provided author(s):`, providedAuthors);
    }

    let $ = null;
    let text = "";
    let rawHtml = "";
    let title = "";
    let authors = providedAuthors || []; // Use provided authors if available
    let publisher = mediaSource; // Use hint if provided, will be overridden if extracted
    let thumbnail = "";
    let domRefs = [];
    let inlineRefs = [];
    let isPdf = /\.pdf($|\?)/i.test(url);

    // ─────────────────────────────────────────────
    // 1. FETCH CONTENT (or use provided HTML)
    // ─────────────────────────────────────────────

    // Use provided HTML if available (from extension's current page DOM)
    if (raw_html) {
      logger.log(`✅ [scrapeTask] Using provided HTML (${raw_html.length} chars, no fetch!)`);
      $ = cheerio.load(raw_html);
      rawHtml = raw_html;
    }
    // Otherwise fetch from URL
    else if (!isPdf) {
      try {
        $ = await fetchPageContent(url);
        rawHtml = $.html();
      } catch (err) {
        logger.warn("⚠️ fetchPageContent failed, trying external:", err);
      }
    }

    if (!$ && !raw_html) {
      const ext = await fetchExternalPageContent(url);
      if (!ext || !ext.$) {
        logger.warn("⚠️ No usable content. aborting:", url);
        return null;
      }
      $ = ext.$;
      rawHtml = $.html();

      // PDF metadata
      if (ext.pdfMeta) {
        if (ext.pdfMeta.title) title = ext.pdfMeta.title;
        if (ext.pdfMeta.thumbnailUrl) thumbnail = ext.pdfMeta.thumbnailUrl;

        if (ext.pdfMeta.authors?.length) {
          authors = ext.pdfMeta.authors.map((a) => ({
            name: a,
            description: null,
            image: null,
          }));
        }
      }
    }

    // ─────────────────────────────────────────────
    // 2. EXTRACT READABLE TEXT
    // ─────────────────────────────────────────────

    // YouTube transcripts
    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
    if (isYouTube) {
      const transcript = await extractTranscript(url);
      if (transcript) text = transcript;
    }

    // fallback: get readable text from HTML
    if (!text) {
      const cleanHtml = cleanForReadability(rawHtml);
      const $clean = cheerio.load(cleanHtml);

      let extracted = $clean.text().trim();
      if (extracted.length > 60000) extracted = extracted.slice(0, 60000);

      text = extracted;
    }

    // ─────────────────────────────────────────────
    // 3. EXTRACT METADATA: title, authors, publisher
    // ─────────────────────────────────────────────

    if (!title || title.length < 3) {
      title = (await getMainHeadline($)) || "Untitled Article";
    }

    // Only extract authors from HTML if not already provided
    if (!providedAuthors || providedAuthors.length === 0) {
      const htmlAuthors = await extractAuthors($);
      authors = mergeAuthors(authors, htmlAuthors);
    } else {
      logger.log(`✅ [scrapeTask] Skipping HTML author extraction (using provided authors)`);
    }

    // Only extract publisher if not already provided via mediaSource
    if (!publisher) {
      publisher = await extractPublisher($);
    }

    // Extract thumbnail if not already set (from PDF)
    if (!thumbnail) {
      thumbnail = getBestImage($, url) || "";
      if (thumbnail) {
        logger.log(`🖼️  [scrapeTask] Extracted thumbnail: ${thumbnail.slice(0, 80)}...`);
      }
    }

    // ─────────────────────────────────────────────
    // 4. REFERENCES
    // ─────────────────────────────────────────────

    domRefs = await extractReferences($);
    inlineRefs = extractInlineRefs(text);

    // dedupe inline/DOM duplicates
    const seen = new Set(domRefs.map((r) => r.url));
    inlineRefs = inlineRefs.filter((r) => !seen.has(r.url));

    // ─────────────────────────────────────────────
    // 5. PERSIST TASK CONTENT ROW (NO CLAIMS YET)
    // ─────────────────────────────────────────────

    const taskContentId = await persistTaskContent(query, {
      url,
      title,
      rawText: text,
      publisher: publisher?.name || null,
      authors, // persisted in child method
      thumbnail,
    });

    // ─────────────────────────────────────────────
    // 6. RETURN STRUCTURED TASK SCRAPE OUTPUT
    // ─────────────────────────────────────────────

    return {
      taskContentId,
      url,
      title,
      text,
      authors,
      publisher,
      thumbnail,
      domRefs,
      inlineRefs,
      rawHtml,
    };
  } catch (err) {
    logger.error("❌ [scrapeTask] Fatal error on:", url, err);
    return null;
  }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function cleanForReadability(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("script, style, link").remove();
  return $.html();
}

function mergeAuthors(a1, a2) {
  const out = [];
  const seen = new Set();

  [...a1, ...a2].forEach((a) => {
    const name = a?.name?.trim();
    if (name && !seen.has(name)) {
      out.push(a);
      seen.add(name);
    }
  });

  return out;
}
