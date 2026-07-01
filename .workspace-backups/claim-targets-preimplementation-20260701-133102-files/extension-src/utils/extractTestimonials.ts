// /utils/extractTestimonials.ts
import * as cheerio from "cheerio";

export function extractTestimonialsFromHtml(html: string) {
  const $ = cheerio.load(html);
  const testimonials: { text: string; name?: string; imageUrl?: string }[] = [];

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

  // Expand heuristics as you see fit!
  return testimonials;
}
