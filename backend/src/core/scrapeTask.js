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
 *  • Persist the task content row clasudein DB
 *  • Returns: { taskContentId, text, metadata, domRefs, inlineRefs }
 */
export async function scrapeTask(
  query,
  url,
  raw_html = null,
  mediaSource = null,
  providedAuthors = null,
) {
  try {
    logger.log(`🟦 [scrapeTask] Starting scrape for: ${url}`);
    if (mediaSource) {
      logger.log(`📌 [scrapeTask] Media source hint: ${mediaSource}`);
    }
    if (providedAuthors && providedAuthors.length > 0) {
      logger.log(
        `👤 [scrapeTask] Using ${providedAuthors.length} provided author(s):`,
        providedAuthors,
      );
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
      logger.log(
        `✅ [scrapeTask] Using provided HTML (${raw_html.length} chars, no fetch!)`,
      );
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
      // Detect site type for intelligent selector priority
      const isJournalSite = url.includes('sciencedirect.com') || url.includes('elsevier.com');
      const isSubstack = url.includes('substack.com');

      // Load raw HTML and remove scripts/styles (but keep content structure)
      const $raw = cheerio.load(rawHtml);
      $raw("script, style, noscript").remove(); // Remove scripts/styles from raw HTML

      // Load fully cleaned HTML (removes content divs, nav, comments, etc.)
      const cleanHtml = cleanForReadability(rawHtml);
      const $clean = cheerio.load(cleanHtml);

      // Unified selector cascade - site-specific selectors first, then generic
      // Each entry: { selector, useRaw, minChars, description }
      const selectorCascade = [
        // Substack-specific selectors (only tested for Substack URLs)
        ...(isSubstack ? [
          { selector: ".available-content .body.markup", useRaw: true, minChars: 100, desc: "Substack article body" },
          { selector: ".available-content", useRaw: true, minChars: 100, desc: "Substack content container" },
        ] : []),

        // Journal-specific selectors (only tested for journal URLs)
        ...(isJournalSite ? [
          { selector: ".Abstracts, .Body", useRaw: true, minChars: 100, desc: "Journal abstract + body (raw)" },
          { selector: "#abstracts, #body", useRaw: false, minChars: 100, desc: "Journal abstract + body (clean)" },
          { selector: ".Abstracts", useRaw: false, minChars: 100, desc: "Journal abstract only" },
          { selector: ".Body", useRaw: false, minChars: 100, desc: "Journal body only" },
          { selector: "#body", useRaw: false, minChars: 100, desc: "Journal body ID" },
        ] : []),

        // Generic article selectors (tested for all URLs)
        { selector: "article", useRaw: false, minChars: 200, desc: "HTML5 article tag" },
        { selector: ".article-content", useRaw: false, minChars: 200, desc: "Article content class" },
        { selector: ".post-content", useRaw: false, minChars: 200, desc: "Post content class" },
        { selector: ".entry-content", useRaw: false, minChars: 200, desc: "Entry content class" },
        { selector: ".article-body", useRaw: false, minChars: 200, desc: "Article body class" },
        { selector: ".story-body", useRaw: false, minChars: 200, desc: "Story body class" },
        { selector: '[role="main"]', useRaw: false, minChars: 200, desc: "Main role (may include nav)" },
        { selector: "main", useRaw: false, minChars: 200, desc: "Main tag" },
        { selector: ".content", useRaw: false, minChars: 200, desc: "Content class" },
        { selector: "#content", useRaw: false, minChars: 200, desc: "Content ID" },
      ];

      let extracted = "";
      for (const { selector, useRaw, minChars, desc } of selectorCascade) {
        const $ = useRaw ? $raw : $clean;
        const content = $(selector).text().trim();
        const htmlType = useRaw ? "raw" : "clean";
        logger.log(`🔍 [scrapeTask] Testing "${selector}" (${htmlType}): ${content.length} chars - ${desc}`);

        if (content.length > minChars) {
          extracted = content;
          logger.log(`📝 [scrapeTask] ✓ Selected "${selector}" (${htmlType}): ${content.length} chars`);
          break;
        }
      }

      // Fallback: get all text if no content area found
      if (!extracted) {
        extracted = $clean.text().trim();
        logger.log(
          `📝 [scrapeTask] Using full page text (no selector matched) (${extracted.length} chars)`,
        );
      }

      if (extracted.length > 60000) {
        logger.log(`⚠️ [scrapeTask] Text truncated from ${extracted.length} to 60000 chars`);
        extracted = extracted.slice(0, 60000);
      }

      text = extracted;
    }

    logger.log(`📝 [scrapeTask] Final extracted text: ${text.length} chars, first 200: "${text.substring(0, 200).replace(/\s+/g, ' ')}"`);

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
      logger.log(
        `✅ [scrapeTask] Skipping HTML author extraction (using provided authors)`,
      );
    }

    // Only extract publisher if not already provided via mediaSource
    if (!publisher) {
      publisher = await extractPublisher($);
    }

    // Extract thumbnail if not already set (from PDF)
    if (!thumbnail) {
      thumbnail = getBestImage($, url) || "";
      if (thumbnail) {
        logger.log(
          `🖼️  [scrapeTask] Extracted thumbnail: ${thumbnail.slice(0, 80)}...`,
        );
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

/**
 * cleanForReadability - Clean HTML for TEXT EXTRACTION ONLY
 *
 * NOTE: This is ONLY used for extracting readable text content.
 * The original $ object with full HTML/meta tags is preserved
 * and used separately for metadata extraction (authors, publisher, etc.)
 */
function cleanForReadability(html) {
  if (!html) return "";
  const $ = cheerio.load(html);

  // Remove scripts, styles, and non-content elements
  $("script, style, link, noscript, iframe, embed, object").remove();

  // Remove common ad/banner/overlay selectors
  $("[class*='ad-'], [id*='ad-'], [class*='banner'], [id*='banner']").remove();
  $(
    "[class*='popup'], [id*='popup'], [class*='modal'], [id*='modal']",
  ).remove();
  $("[class*='overlay'], [id*='overlay']").remove();
  $("[class*='promo'], [id*='promo']").remove();
  $("[class*='newsletter'], [id*='newsletter']").remove();
  $("[class*='subscribe'], [id*='subscribe']").remove();

  // Remove navigation, header, footer, sidebar elements
  // (But keep <header> as it might contain article headers in some layouts)
  $("nav, footer, aside").remove();

  // Remove common non-content class/id names
  $(".navigation, .navbar, .menu, .sidebar, .footer").remove();
  $(".social, .share, .comments, .related, .recommended").remove();
  $("#navigation, #navbar, #menu, #sidebar, #footer").remove();

  // Remove hidden elements (often used for overlays/modals)
  $("[style*='display: none'], [style*='display:none']").remove();
  $(".hidden, .hide, .invisible").remove();

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
