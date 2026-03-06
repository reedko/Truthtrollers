// backend/src/utils/extractAuthors.js
// ─────────────────────────────────────────────
// Extract author metadata from HTML using cheerio
// Ported from extension/src/services/extractMetaDataUtils.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

/**
 * extractAuthors($)
 *
 * Extracts author information from various sources:
 * - CHD article headers (Children's Health Defense)
 * - Author wrapper elements
 * - JSON-LD metadata
 * - Meta tags
 * - Citation meta tags
 * - CHD GA4 data
 *
 * Returns: Array of { name, description, image }
 */
export async function extractAuthors($) {
  const authors = [];

  // ✅ Extract directly from article header (CHD-specific)
  const authorRegex =
    /<span class="chd-defender-article__authors-name">.*?<a.*?>(.*?)<\/a>/;
  const match = $.html().match(authorRegex);

  if (match) {
    logger.log("🧠 Found author in CHD article header span.");
    authors.push({
      name: match[1].trim(),
      description: null,
      image: null,
    });
  }

  // ✅ Extract from byline containers with author links and avatars
  // Common pattern: <div class="byline"><a rel="author"><div class="avatar"><img></div><span class="name">Name</span></a></div>
  const bylineSelectors = [
    '.byline a[rel="author"]',
    'a[rel="author"]',
    '.author-info a[rel="author"]',
    '.story-header a[rel="author"]',
    'div[class*="byline"] a[href*="/author"]',
    'div[class*="author"] a[href*="/author"]'
  ];

  bylineSelectors.forEach(selector => {
    $(selector).each((_, authorLink) => {
      const $link = $(authorLink);

      // Skip if inside related posts
      if ($link.closest('.ast-single-related-posts-container, article.ast-related-post, .related').length > 0) {
        return;
      }

      // Try to find author name from various common patterns
      let name =
        $link.find('.name, .author-name, span[class*="name"]').first().text().trim() ||
        $link.text().trim();

      // Clean up name - remove dates, times, and extra whitespace
      name = name.replace(/\s*\/\s*\d+.*$/g, '').trim();  // Remove "/ December 05, 2020" etc
      name = name.replace(/\s+/g, ' ').trim();  // Normalize whitespace

      if (!name || name.length < 2) return;

      // Try to find author image from avatar containers or img tags
      let image =
        $link.find('.avatar img, div[class*="avatar"] img').first().attr('src') ||
        $link.find('img').first().attr('src') ||
        null;

      // If we have srcset, extract the base URL (first one is usually fine)
      if (!image) {
        const srcset = $link.find('.avatar img, img').first().attr('srcset');
        if (srcset) {
          const match = srcset.match(/https?:\/\/[^\s,]+/);
          if (match) image = match[0];
        }
      }

      if (!authors.find((a) => a.name === name)) {
        logger.log(`👤 Found author from byline structure: ${name}${image ? ' (with image)' : ''}`);
        authors.push({
          name,
          description: null,
          image,
        });
      }
    });
  });

  // ✅ Extract from span.author-name (e.g. Brownstone byline)
  // Skip any that live inside Related Articles containers
  $('span.author-name').each((_, nameEl) => {
    const $nameEl = $(nameEl);

    // Exclude if inside related posts container or a related post article
    if ($nameEl.closest('.ast-single-related-posts-container, article.ast-related-post').length > 0) {
      return;
    }

    const name = $nameEl.text().trim();

    // img.avatar is a sibling inside the same <a> parent
    const $parent = $nameEl.parent();

    const image =
      $parent.find("img.avatar").first().attr("src") ||
      $parent.find("img.multiple_authors_guest_author_avatar").first().attr("src") ||
      null;

    if (name && name.length > 2 && !authors.find((a) => a.name === name)) {
      authors.push({
        name,
        description: null,
        image,
      });
    }
  });

  // ✅ Extract from JSON-LD (even if we already have authors - dedupe will handle it)
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      let raw = $(scriptTag).text().trim() || "{}";
      // 🧽 Clean up malformed endings like stray semicolons or double JSON
      if (raw.endsWith(";")) raw = raw.slice(0, -1);

      // ✅ Handle multiple JSON blobs in one script tag
      const entries = raw.split(/}\s*{/).map((s, i, arr) => {
        if (arr.length === 1) return s;
        return i === 0
          ? s + "}"
          : i === arr.length - 1
          ? "{" + s
          : "{" + s + "}";
      });

      entries.forEach(() => {
        const metadata = JSON.parse(raw);

        // 🔍 Look directly for metadata.author
        const authorArray = Array.isArray(metadata.author)
          ? metadata.author
          : metadata.author
          ? [metadata.author]
          : [];

        authorArray.forEach((author) => {
          if (author?.name) {
            const authorName = author.name.trim();
            // Check for duplicates before pushing
            if (!authors.find((a) => a.name === authorName)) {
              logger.log(
                "👤 Found author from metadata.author array:",
                authorName
              );
              authors.push({
                name: authorName,
                description: author.description || null,
                image: author.image?.contentUrl || null,
              });
            }
          }
        });
      });
    } catch (err) {
      logger.error("❌ Error parsing ld+json for authors:", err);
    }
  });

  // ✅ Extract from meta tags
  if (!authors.length) {
    const rawAuthorNames =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content");

    if (rawAuthorNames) {
      logger.log("📦 Found author in meta tag:", rawAuthorNames);
      rawAuthorNames
        .split(/\s*and\s*|,\s*/)
        .forEach((name) => {
          const authorName = name.trim();
          if (!authors.find((a) => a.name === authorName)) {
            authors.push({ name: authorName, description: null, image: null });
          }
        });
    }
  }

  // ✅ Extract from citation meta tags
  if (!authors.length) {
    $(
      'meta[name="citation_author"], meta[property="article:citation_author"]'
    ).each((_, metaTag) => {
      const rawAuthorName = $(metaTag).attr("content");
      if (rawAuthorName) {
        logger.log("📚 Found citation_author meta:", rawAuthorName);
        rawAuthorName
          .split(/\s*and\s*|,\s*/)
          .forEach((name) => {
            const authorName = name.trim();
            if (!authors.find((a) => a.name === authorName)) {
              authors.push({ name: authorName, description: null, image: null });
            }
          });
      }
    });
  }

  // ✅ Special case: Extract authors from CHD (Children's Health Defense)
  if (!authors.length) {
    const scripts = $("script");

    scripts.each((_, scriptTag) => {
      const scriptText = $(scriptTag).text().trim();
      if (scriptText.includes("var chd_ga4_data =")) {
        try {
          const match = scriptText.match(/var chd_ga4_data = (\{.*?\});/s);
          if (match && match[1]) {
            const chdData = JSON.parse(match[1]);
            if (chdData.contentAuthor) {
              const authorName = chdData.contentAuthor;
              if (!authors.find((a) => a.name === authorName)) {
                logger.log(
                  "🏥 Found author in chd_ga4_data:",
                  authorName
                );
                authors.push({
                  name: authorName,
                  description: chdData.contentAuthorTitle || null,
                  image: null,
                });
              }
            }
          }
        } catch (err) {
          logger.error("❌ Error parsing chd_ga4_data:", err);
        }
      }
    });
  }

  // ✅ ALWAYS deduplicate authors by name before returning (belt-and-suspenders approach)
  if (authors.length > 1) {
    logger.log(`🔍 [extractAuthors] Pre-dedupe: Found ${authors.length} author entries`);
    logger.log(`   Author names: ${authors.map(a => a.name).join(", ")}`);
  }

  const uniqueAuthors = authors.filter((author, index, self) =>
    index === self.findIndex((a) => a.name === author.name)
  );

  const duplicatesRemoved = authors.length - uniqueAuthors.length;
  if (duplicatesRemoved > 0) {
    logger.warn(`⚠️  [extractAuthors] Removed ${duplicatesRemoved} duplicate author(s) during final deduplication`);
    logger.warn(`   This indicates a bug in one of the extraction methods above!`);
  }

  if (!uniqueAuthors.length) {
    logger.warn("🚫 No authors found from any source.");
  } else {
    logger.log(`✅ [extractAuthors] Returning ${uniqueAuthors.length} unique authors:`, uniqueAuthors.map(a => a.name).join(", "));
  }

  return uniqueAuthors;
}
