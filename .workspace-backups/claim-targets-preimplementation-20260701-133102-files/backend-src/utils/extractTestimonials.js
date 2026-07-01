// backend/src/utils/extractTestimonials.js
// ─────────────────────────────────────────────
// Extract testimonials/reviews from HTML
// Ported from extension/src/utils/extractTestimonials.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

/**
 * extractTestimonialsFromHtml(html)
 *
 * Extracts testimonials and reviews from HTML using heuristics:
 * 1. Elements with testimonial/review/case-study in class/id
 * 2. Blockquotes with attribution
 *
 * Returns: Array of { text, name?, imageUrl? }
 */
export function extractTestimonialsFromHtml(html) {
  // Note: This function expects raw HTML string, but scrapeTask.js
  // passes a cheerio object. Let's handle both cases.
  const $ = typeof html === "string" ? require("cheerio").load(html) : html;

  const testimonials = [];

  // Heuristic 1: Find common testimonial/review classes/ids
  $(
    '[class*="testimonial"], [id*="testimonial"], [class*="review"], [id*="review"], [class*="case-study"]'
  ).each((i, el) => {
    const text = $(el).text().trim();
    if (text.length < 40) return; // skip noise

    // Try to get name (look for em-dash, "by", etc)
    let name = undefined;
    let match = text.match(/[—-]\s*([A-Z][a-zA-Z .]+)/);
    if (match) name = match[1];

    // Try to get image url in this block
    let imageUrl = undefined;
    const img = $(el).find("img");
    if (img.length) imageUrl = img.attr("src");

    testimonials.push({ text, name, imageUrl });
  });

  // Heuristic 2: Blockquotes with attribution
  $("blockquote").each((i, el) => {
    const text = $(el).text().trim();
    if (text.length < 40) return;

    let name = undefined;
    let match = text.match(/[—-]\s*([A-Z][a-zA-Z .]+)/);
    if (match) name = match[1];

    testimonials.push({ text, name });
  });

  if (testimonials.length > 0) {
    logger.log(`💬 Found ${testimonials.length} testimonials`);
  }

  return testimonials;
}
