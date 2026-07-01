// orchestrateScrapingUtils.ts
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export function extractArticleRootHTML($: cheerio.CheerioAPI): string | null {
  const selectors = [
    '[data-cy="article-content"]',
    ".rawHtml-content-no-nativo",
    "article",
    '[role="main"]',
    ".main-content",
    "#main",
    ".content",
    ".post-content",
    ".entry-content",
  ];

  let bestNode: Cheerio<any> | null = null;
  let bestScore = 0;

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const node = $(el);
      const text = node.text().trim();
      const paraCount = node.find("p").length;
      const charCount = text.length;

      // Heuristic: favor nodes with many <p> and characters
      const score = paraCount * 10 + charCount;

      if (paraCount >= 2 && charCount > 200 && score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  }

  if (bestNode) {
    return (bestNode as Cheerio<any>).html()?.trim() || null;
  }

  // 🔻 Fallback to cleaned body if no good match
  console.warn(
    "⚠️ No strong article node found — falling back to cleaned <body>"
  );

  const body = $("body").clone();

  body.find("script, style, nav, footer, aside, iframe, header").remove();
  body
    .find(
      ".ad, .ads, .popup, .newsletter, .social-share, .comments, .related, .cookie, .cookie-banner, .cookie-consent, .cookie-notice, .privacy-banner, .gdpr, .gdpr-banner, [id*='cookie'], [id*='gdpr'], [class*='cookie'], [class*='gdpr'], [class*='privacy-notice'], [class*='consent-banner']"
    )
    .remove();

  const cleanedHtml = body.html()?.trim() || null;

  if (cleanedHtml) {
    const maxLength = 64000;
    return cleanedHtml.length > maxLength
      ? cleanedHtml.slice(0, maxLength) + "\n<!-- Truncated -->"
      : cleanedHtml;
  }

  return null;
}

export function trimTo60k(text: string): string {
  while (text.length > 60000) {
    const lastNewline = text.lastIndexOf("\n");

    if (lastNewline === -1) {
      text = text.slice(0, -1);
    } else {
      text = text.slice(0, lastNewline);
    }
  }
  return text;
}

export function smartCleanHTMLForReadability($: cheerio.CheerioAPI): string {
  const $clean = cheerio.load($.html());
  $clean(
    "style, link[rel='stylesheet'], script:not([type='application/ld+json'])"
  ).remove();
  $clean("img[src^='data:']").remove();
  $clean("figure, figcaption, .caption, .image, .media").remove();
  return $clean.html() || "";
}

// ✅ Fetch Diffbot pre-scrape data
export const fetchDiffbotData = async (articleUrl: string) => {
  console.log(`🛠 Fetching Diffbot pre-scrape data for: ${articleUrl}`);

  try {
    const response = await fetch(`${BASE_URL}/api/pre-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl }),
    });

    if (!response.ok) {
      throw new Error(
        `Diffbot pre-scrape failed with status: ${response.status}`
      );
    }

    const diffbotData = await response.json();
    console.log("✅ Diffbot pre-scrape data received:", diffbotData);
    return diffbotData;
  } catch (error) {
    console.warn("⚠️ Diffbot pre-scrape fetch failed:", error);
    return null;
  }
};
