// backend/src/utils/fetchExternalPageContent.js
// ─────────────────────────────────────────────
// Fetch external content (PDFs, HTML) and return cheerio object
// Handles PDFs by parsing text and returning as HTML body
// ─────────────────────────────────────────────

import * as cheerio from "cheerio";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { fetchTextWithFallbacks } from "./fetchWithFallbacks.js";
import logger from "./logger.js";
import axios from "axios";
import https from "https";
import { DEFAULT_HEADERS } from "./helpers.js";

/**
 * chooseTitle - Extract title from PDF metadata or first lines
 */
function chooseTitle(infoTitle, lines, url) {
  if (infoTitle && infoTitle.length > 3) {
    return infoTitle;
  }

  // Look for title-like line in first 10 lines
  for (const line of lines.slice(0, 10)) {
    if (line.length > 10 && line.length < 200) {
      return line;
    }
  }

  // Fallback: use URL
  try {
    const { pathname } = new URL(url);
    return pathname.split("/").filter(Boolean).pop() || "PDF Document";
  } catch {
    return "PDF Document";
  }
}

/**
 * choosePdfAuthors - Extract authors from PDF metadata or first lines
 */
function choosePdfAuthors(infoAuthor, lines) {
  const authors = [];

  if (infoAuthor) {
    // Split by common separators
    const names = infoAuthor.split(/[,;]|\sand\s/).map((s) => s.trim());
    authors.push(...names);
  }

  // Look for "by Author Name" or "Author:" patterns in first lines
  const authorPatterns = [/^by\s+(.+)/i, /^author[s]?:\s*(.+)/i];

  for (const line of lines.slice(0, 15)) {
    for (const pattern of authorPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const names = match[1].split(/[,;]|\sand\s/).map((s) => s.trim());
        authors.push(...names);
      }
    }
  }

  // Deduplicate
  return [...new Set(authors)].filter(Boolean);
}

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
      const parsed = await pdfParse(buffer);

      const fullText = (parsed.text || "").replace(/\r/g, "");
      const infoTitle = (
        parsed.info && parsed.info.Title ? parsed.info.Title : ""
      ).trim();
      const infoAuthor = (
        parsed.info && parsed.info.Author ? parsed.info.Author : ""
      ).trim();

      // Extract title/authors from first chunk of text
      const head = fullText.slice(0, 4000);
      const lines = head
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const title = chooseTitle(infoTitle, lines, url);
      const authors = choosePdfAuthors(infoAuthor, lines);

      logger.log(`✅ [fetchExternalPageContent] PDF parsed: ${title}`);

      // Wrap text in HTML body for cheerio
      const htmlBody = `<body>${fullText}</body>`;
      const $ = cheerio.load(htmlBody);

      return {
        $,
        pdfMeta: {
          title,
          authors,
          thumbnailUrl: null, // Can add thumbnail generation later
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
