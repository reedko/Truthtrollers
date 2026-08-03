// backend/src/utils/fetchExternalPageContent.js
// ─────────────────────────────────────────────
// Fetch external content (PDFs, HTML) and return cheerio object
// Handles PDFs by parsing text and returning as HTML body
// ─────────────────────────────────────────────

import * as cheerio from "cheerio";
import { fetchTextWithFallbacks } from "./fetchWithFallbacks.js";
import logger from "./logger.js";
import axios from "axios";
import https from "https";
import { DEFAULT_HEADERS } from "./helpers.js";
import { extractProductionPdfDocument } from "../core/productionDocumentExtraction.js";

/**
 * fetchExternalPageContent(url)
 *
 * Fetches external content and returns:
 * {
 *   $: cheerio.CheerioAPI,
 *   pdfMeta?: { title, authors, thumbnailUrl }
 * }
 *
 * For PDFs: parses PDF, extracts text/metadata, returns as HTML body
 * For HTML: uses fetchTextWithFallbacks, returns cheerio object
 */
export async function fetchExternalPageContent(url) {
  try {
    // Check if URL is a PDF
    const isPdf = /\.pdf($|\?)/i.test(url);

    if (isPdf) {
      logger.log(`📄 [fetchExternalPageContent] Detected PDF: ${url}`);

      // Fetch PDF binary
      const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 30000,
      });

      const response = await axiosInstance.get(url, {
        responseType: "arraybuffer",
        headers: DEFAULT_HEADERS,
      });

      const buffer = Buffer.from(response.data);
      const extracted = await extractProductionPdfDocument({
        buffer,
        url,
        maximumCharacters: 2_000_000,
      });
      const fullText = extracted.text;
      const title = extracted.title;
      const authors = extracted.authors.map((author) => author?.name || author).filter(Boolean);
      const publisher = extracted.publisher?.name || null;
      const identity = extracted.publishingIdentity;

      logger.log(`✅ [fetchExternalPageContent] PDF parsed: ${title}${publisher ? ` | publisher: ${publisher}` : ""}`);

      // Wrap text in HTML body for cheerio
      const htmlBody = `<body>${fullText}</body>`;
      const $ = cheerio.load(htmlBody);

      return {
        $,
        pdfMeta: {
          title,
          authors,
          publisher, // null if not found
          identity,
          thumbnailUrl: null,
        },
      };
    } else {
      // Regular HTML fetch
      logger.log(`🌐 [fetchExternalPageContent] Fetching HTML: ${url}`);

      const result = await fetchTextWithFallbacks(url);

      if (!result || !result.text) {
        throw new Error(`Failed to fetch content from ${url}`);
      }

      logger.log(
        `✅ [fetchExternalPageContent] Fetched ${result.text.length} chars via ${result.method}`
      );

      const $ = cheerio.load(result.text);

      return { $ };
    }
  } catch (err) {
    logger.error(`❌ [fetchExternalPageContent] Error fetching ${url}:`, err);
    throw err;
  }
}
