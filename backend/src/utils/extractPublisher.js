// backend/src/utils/extractPublisher.js
// ─────────────────────────────────────────────
// Extract publisher metadata from HTML using cheerio
// Ported from extension/src/services/extractMetaDataUtils.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

/**
 * extractPublisher($)
 *
 * Extracts publisher information from various sources:
 * - og:site_name meta tag
 * - publisher meta tag
 * - citation_journal_title meta tag
 * - JSON-LD metadata (publisher object, isPartOf, NewsMediaOrganization)
 *
 * Returns: { name: string }
 */
export async function extractPublisher($) {
  let publisherName =
    $('meta[property="og:site_name"]').attr("content") ||
    $('meta[name="publisher"]').attr("content") ||
    $('meta[name="citation_journal_title"]').attr("content") ||
    "Unknown Publisher";

  // Extract from JSON-LD
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const metadata = JSON.parse($(scriptTag).text().trim());

      // Check if publisher exists as an object
      if (
        metadata.publisher &&
        typeof metadata.publisher === "object" &&
        metadata.publisher.name
      ) {
        publisherName = metadata.publisher.name;
        return false; // Exit early if found
      }

      // If `publisher` is nested within another structure (e.g., `isPartOf`)
      if (
        metadata.isPartOf &&
        typeof metadata.isPartOf === "object" &&
        metadata.isPartOf.name
      ) {
        publisherName = metadata.isPartOf.name;
        return false;
      }

      // Recursive fallback for complex structures
      const findPublisher = (data) => {
        if (Array.isArray(data))
          return data.map(findPublisher).find((name) => name) || null;
        if (typeof data === "object" && data) {
          if (data["@type"] === "NewsMediaOrganization" && data.name)
            return data.name;
          return (
            Object.values(data)
              .map(findPublisher)
              .find((name) => name) || null
          );
        }
        return null;
      };

      const foundPublisher = findPublisher(metadata);
      if (foundPublisher) {
        publisherName = foundPublisher;
      }
    } catch (err) {
      logger.warn(`⚠️ Failed to parse ld+json script: ${err}`);
    }
  });

  return { name: publisherName };
}
