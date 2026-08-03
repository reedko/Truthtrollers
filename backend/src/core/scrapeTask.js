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
import { extractAuthors, mergeAuthors } from "../utils/extractAuthors.js";
import { processPublishingIdentity } from "../services/publishingIdentityPipeline.js";
import { extractReferences } from "../utils/extractReferences.js";
import { extractInlineRefs } from "../utils/extractInlineRefs.js";
import { extractTestimonialsFromHtml } from "../utils/extractTestimonials.js";
import { extractTranscript } from "./youtubeTranscript.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { getBestImage } from "../utils/getBestImage.js";
import { persistTaskContent } from "../storage/persistContentAndEvidence.js";
import * as cheerio from "cheerio";
import { isUsableSourceEntityName } from "../utils/publisherNameValidation.js";
import { extractProductionReadableHtml } from "./productionDocumentExtraction.js";

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
    // "Web", "PDF", and platform labels describe the transport, not the
    // publisher. Treating them as publisher hints suppresses the canonical
    // extractor and is how otherwise valid publisher metadata gets missed.
    const usablePublisherHint = typeof mediaSource === "string" &&
      isUsableSourceEntityName(mediaSource) &&
      !/^(web|website|article|content|pdf|unknown( publisher)?|facebook|youtube)$/i.test(mediaSource.trim())
        ? mediaSource.trim()
        : null;
    let publisher = usablePublisherHint ? { name: usablePublisherHint } : null;
    let publishingIdentity = null;
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
        publishingIdentity = ext.pdfMeta.identity || null;
        if (!publisher && publishingIdentity) {
          publisher = (await processPublishingIdentity({ identity: publishingIdentity })).legacyPublisher;
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

    // Fallback: run the same shared production extraction seam used by
    // reference acquisition and CFX. Raw HTML remains available separately
    // for title/author/publisher/reference extraction below.
    if (!text) {
      const extracted = extractProductionReadableHtml(rawHtml, { url });
      text = extracted.text;
      logger.log(
        `📝 [scrapeTask] Shared production extraction=${extracted.method}` +
        `${extracted.selector ? ` selector=${extracted.selector}` : ""} chars=${text.length}`,
      );
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

    if (!isPdf) {
      const identityResult = await processPublishingIdentity({ $, sourceUrl: url });
      publishingIdentity = identityResult.identity;
      if (!publisher) publisher = identityResult.legacyPublisher;
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

    logger.log(
      `🧪 [scrapeTask] Metadata audit: title="${title.slice(0, 100)}" ` +
      `authors=${authors.length}${authors.length ? ` [${authors.map((author) => author?.name || author).join(", ")}]` : " (none explicitly identified)"} ` +
      `publisher="${publisher?.name || "none"}" thumbnail=${thumbnail ? "yes" : "no"} html=${rawHtml ? "yes" : "no"}`
    );

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
      publishingIdentity,
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
      publishingIdentity,
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
