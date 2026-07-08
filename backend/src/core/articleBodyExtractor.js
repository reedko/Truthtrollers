/**
 * articleBodyExtractor.js
 *
 * Reusable module for extracting clean article body from HTML.
 *
 * Responsibilities:
 * - Find best article body root using multiple selector strategies
 * - Remove junk elements (ads, nav, comments, etc.)
 * - Extract title if available
 * - Return structured body data suitable for sectioning or chunking
 *
 * Usage:
 * const extractor = new ArticleBodyExtractor();
 * const result = await extractor.extract(htmlString);
 * // Returns: { title, bodyHtml, bodyText, bodySelectorUsed, diagnostics }
 */

import * as cheerio from "cheerio";

export class ArticleBodyExtractor {
  constructor(options = {}) {
    this.bodySelectors = options.bodySelectors || [
      ".et_pb_module.et_pb_post_content",
      ".et_pb_post_content",
      ".entry-content",
      ".post-content",
      "article",
      "main",
    ];

    this.junkSelectors = options.junkSelectors || [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      "button",
      "iframe",
      ".comment",
      ".comments",
      "#comments",
      ".related",
      ".related-posts",
      ".share",
      ".sharedaddy",
      ".social",
      ".newsletter",
      ".subscribe",
      ".et_pb_menu",
      ".et_pb_sidebar",
      ".et_pb_widget",
      ".et_pb_search",
      ".et_pb_comments_module",
    ];

    this.fallbackSelector = options.fallbackSelector || "body";
  }

  /**
   * Extract article body from HTML.
   *
   * Returns:
   * {
   *   title: string,
   *   bodyHtml: string,
   *   bodyText: string,
   *   bodySelectorUsed: string,
   *   diagnostics: {
   *     candidateSelectors: [...],
   *     selectedSelectorScore: number,
   *     textLength: number,
   *     paragraphCount: number,
   *     junkMarkerCount: number,
   *     fallbackUsed: boolean
   *   }
   * }
   */
  async extract(htmlString) {
    const $ = cheerio.load(htmlString);

    // Extract title
    const title = this.extractTitle($);

    // Find best body root
    const { selector: bodySelectorUsed, score: selectedScore, $ : $root } = this.findBestBodyRoot($);

    // Remove junk
    const $clean = $root.clone();
    this.removeJunk($clean);

    // Get text and HTML
    const bodyText = $clean.text().trim();
    const bodyHtml = $clean.html();

    // Build diagnostics
    const diagnostics = {
      candidateSelectors: this.bodySelectors,
      selectedSelectorScore: selectedScore,
      textLength: bodyText.length,
      paragraphCount: $clean.find("p").length,
      junkMarkerCount: this.countJunkMarkers($root),
      fallbackUsed: bodySelectorUsed === this.fallbackSelector,
    };

    return {
      title,
      bodyHtml,
      bodyText,
      bodySelectorUsed,
      diagnostics,
    };
  }

  /**
   * Extract title from HTML.
   */
  extractTitle($) {
    // Try common title selectors
    let title =
      $("h1.post-title").text().trim() ||
      $("h1.entry-title").text().trim() ||
      $("h1.page-title").text().trim() ||
      $("h1").first().text().trim() ||
      $("title").text().trim() ||
      "";

    return title;
  }

  /**
   * Find best body root from candidates.
   *
   * Scores based on: text length, paragraph count, low junk markers.
   */
  findBestBodyRoot($) {
    let bestCandidate = null;
    let bestScore = -1;

    for (const selector of this.bodySelectors) {
      const $candidate = $(selector).first();
      if ($candidate.length === 0) continue;

      const text = $candidate.text();
      const textLength = text.length;
      const paragraphCount = $candidate.find("p").length;
      const junkMarkerCount = this.countJunkMarkers($candidate);

      // Score: prefer long text, many paragraphs, low junk
      const score =
        (textLength > 40000 ? 10 : textLength > 20000 ? 5 : 0) +
        (paragraphCount > 50 ? 10 : paragraphCount > 30 ? 5 : 0) +
        (junkMarkerCount < 15 ? 10 : junkMarkerCount < 30 ? 5 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { selector, score, $: $candidate };
      }
    }

    // Fallback to body if no article selector worked
    if (!bestCandidate) {
      const $fallback = $(this.fallbackSelector).first();
      bestCandidate = { selector: this.fallbackSelector, score: 0, $: $fallback };
    }

    return bestCandidate;
  }

  /**
   * Count junk markers in element.
   */
  countJunkMarkers($elem) {
    let count = 0;
    for (const selector of this.junkSelectors) {
      count += $elem.find(selector).length;
    }
    return count;
  }

  /**
   * Remove junk elements from element.
   */
  removeJunk($elem) {
    for (const selector of this.junkSelectors) {
      $elem.find(selector).remove();
    }
  }
}

export default ArticleBodyExtractor;
