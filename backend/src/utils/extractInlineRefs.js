// backend/src/utils/extractInlineRefs.js
// ─────────────────────────────────────────────
// Extract inline references from text content
// (URLs mentioned directly in text, not in HTML anchor tags)
// ─────────────────────────────────────────────

import logger from "./logger.js";

/**
 * extractInlineRefs(text)
 *
 * Extracts URLs that appear inline in text content:
 * - DOI links (doi.org, dx.doi.org)
 * - arXiv links
 * - PubMed links
 * - Research paper URLs
 * - Any http/https URLs that look like citations
 *
 * Returns: Array of { url, content_name }
 */
export function extractInlineRefs(text) {
  if (!text || typeof text !== "string") return [];

  const MAX_RESULTS = 20;
  const refs = [];
  const seen = new Set();

  // Regex patterns for common citation URLs
  const patterns = [
    // DOI links
    /https?:\/\/(?:dx\.)?doi\.org\/[^\s<>"']+/gi,
    // arXiv links
    /https?:\/\/arxiv\.org\/(?:abs|pdf)\/[^\s<>"']+/gi,
    // PubMed links
    /https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/[^\s<>"']+/gi,
    /https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/[^\s<>"']+/gi,
    // General academic/research domains
    /https?:\/\/(?:www\.)?(?:nature\.com|science\.org|sciencedirect\.com|springer\.com|wiley\.com|plos\.org|biorxiv\.org|medrxiv\.org)\/[^\s<>"']+/gi,
  ];

  // Extract URLs using each pattern
  patterns.forEach((pattern) => {
    const matches = text.match(pattern) || [];
    matches.forEach((url) => {
      // Clean up URL (remove trailing punctuation)
      let cleanUrl = url.replace(/[.,;:!?)]+$/, "");

      // Skip if already seen
      if (seen.has(cleanUrl)) return;

      // Skip social media and other excluded domains
      const excluded = [
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "linkedin.com",
        "youtube.com",
      ];
      if (excluded.some((domain) => cleanUrl.includes(domain))) return;

      seen.add(cleanUrl);

      // Generate a readable name from the URL
      let name = "Reference";
      try {
        const urlObj = new URL(cleanUrl);
        if (urlObj.hostname.includes("doi.org")) {
          name = `DOI: ${urlObj.pathname.slice(1)}`;
        } else if (urlObj.hostname.includes("arxiv.org")) {
          name = `arXiv: ${urlObj.pathname.split("/").pop()}`;
        } else if (urlObj.hostname.includes("pubmed")) {
          name = `PubMed: ${urlObj.pathname.split("/").pop()}`;
        } else {
          // Extract last meaningful path segment
          const parts = urlObj.pathname.split("/").filter((p) => p.length > 3);
          name = parts.length
            ? parts[parts.length - 1].replace(/[-_]/g, " ")
            : urlObj.hostname;
        }
      } catch (err) {
        // Invalid URL, use as-is
      }

      refs.push({
        url: cleanUrl,
        content_name: name,
      });
    });
  });

  logger.log(`📎 Found ${refs.length} inline references in text`);

  return refs.slice(0, MAX_RESULTS);
}
