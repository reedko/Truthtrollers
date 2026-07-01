// backend/src/utils/extractAuthors.js
// ─────────────────────────────────────────────
// Extract author metadata from HTML using cheerio
// Ported from extension/src/services/extractMetaDataUtils.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";
import * as cheerio from "cheerio";

const PROFILE_PATH_RE = /^\/(authors?|contributors?|team|staff|bio|profile|about\/[^/]+)\//i;
const MAX_PROFILE_PAGES = 3;
const PROFILE_FETCH_TIMEOUT_MS = 5000;

export function mergeAuthors(...lists) {
  const merged = [];
  const seen = new Set();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const author of list) {
      const normalized = typeof author === "string" ? { name: author } : author;
      const name = normalized?.name?.trim();
      const key = name?.toLocaleLowerCase();
      if (!name || seen.has(key)) continue;
      merged.push({ ...normalized, name });
      seen.add(key);
    }
  }

  return merged;
}

function normalizeJsonLdAuthor(author) {
  if (!author) return null;
  if (typeof author === "string") {
    const name = author.trim();
    return name ? { name, description: null, image: null } : null;
  }
  if (typeof author !== "object") return null;

  const rawName = typeof author.name === "string"
    ? author.name
    : author.name?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return null;

  const rawImage = author.image;
  const image = typeof rawImage === "string"
    ? rawImage
    : rawImage?.contentUrl || rawImage?.url || null;
  return {
    name,
    description: typeof author.description === "string" ? author.description : null,
    image,
  };
}

function collectJsonLdAuthors(value, results = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonLdAuthors(entry, results));
    return results;
  }
  if (typeof value !== "object") return results;

  if (value.author) {
    const authorValues = Array.isArray(value.author) ? value.author : [value.author];
    authorValues.forEach((author) => {
      const normalized = normalizeJsonLdAuthor(author);
      if (normalized) results.push(normalized);
    });
  }

  // Structured data commonly nests the Article in @graph, mainEntity, or an
  // array. Walk all child objects so the canonical extractor handles each form.
  Object.values(value).forEach((child) => {
    if (child && typeof child === "object" && child !== value.author) {
      collectJsonLdAuthors(child, results);
    }
  });
  return results;
}

function addAuthor(authors, value, method = "html_metadata") {
  const normalized = normalizeJsonLdAuthor(value);
  if (!normalized?.name) return;
  if (authors.some((author) => author.name.toLowerCase() === normalized.name.toLowerCase())) return;
  logger.log(`👤 Found author from ${method}: ${normalized.name}`);
  authors.push(normalized);
}

function parseAuthorsMeta(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map((author) => {
      if (typeof author === "string") return author;
      return {
        name: author?.name || author?.Name,
        description: author?.description || author?.Description || author?.Institution || null,
        image: author?.image || author?.Image || null,
      };
    });
  } catch {
    return raw.split(/\s+and\s+|\s*;\s*/i);
  }
}

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

  // CMS metadata aliases. Some publishers expose an `authors` JSON array
  // rather than standard `author`/`citation_author` tags, while others use
  // Dublin Core's `creator` name without a namespace.
  $('meta[name="authors"], meta[property="authors"]').each((_, metaTag) => {
    parseAuthorsMeta($(metaTag).attr("content")).forEach((author) =>
      addAuthor(authors, author, "authors metadata"),
    );
  });
  if (!authors.length) {
    const creator =
      $('meta[name="creator"], meta[property="creator"], meta[name="dc.creator"], meta[name="DC.creator"]').first().attr("content");
    if (creator) addAuthor(authors, creator, "creator metadata");
  }

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

  // ✅ Fox News specific: author-byline with author-headshot
  // Pattern: <div class="author-byline"><span class="author-headshot"><img src="..." alt="Name"></span> By <a href="/person/s/name">Name</a></div>
  $('.author-byline').each((_, byline) => {
    const $byline = $(byline);

    // Get author image from author-headshot
    const image = $byline.find('.author-headshot img').first().attr('src') || null;

    // Get author name from link or alt text
    let name = $byline.find('a[href*="/person"]').first().text().trim();

    // Fallback to img alt if no link found
    if (!name) {
      name = $byline.find('.author-headshot img').first().attr('alt') || '';
    }

    // Clean up name
    name = name.replace(/^By\s+/i, '').trim();

    if (name && name.length > 2 && !authors.find((a) => a.name === name)) {
      logger.log(`👤 Found author from Fox News byline: ${name}${image ? ' (with image)' : ''}`);
      authors.push({
        name,
        description: null,
        image,
      });
    }
  });

  // ✅ ScienceDirect specific: .author-group with buttons and links
  // Pattern: <div class="author-group"><button><span class="given-name">First</span> <span class="text surname">Last</span></button>, <a><span class="given-name">First</span> <span class="text surname">Last</span></a></div>
  $('.author-group button[data-xocs-content-type="author"], .author-group a[href*="/author"]').each((_, element) => {
    const $element = $(element);

    // Extract given name and surname separately
    const givenName = $element.find('.given-name').text().trim();
    const surname = $element.find('.text.surname, .surname').text().trim();

    if (givenName && surname) {
      const name = `${givenName} ${surname}`;

      if (!authors.find((a) => a.name === name)) {
        logger.log(`👤 Found author from ScienceDirect author-group: ${name}`);
        authors.push({
          name,
          description: null,
          image: null,
        });
      }
    }
  });

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

  // ✅ Drupal / generic CMS bylines (e.g. CIDRAP field--name-field-bio-name)
  // These use relative profile paths like /chris-dall-ma rather than /author/...
  const cmsAuthorSelectors = [
    '.author-and-date a',
    '[class*="bio-name"] a',
    '[class*="field--name-field-author"] a',
    '[class*="field--name-field-bio"] a',
    '.field--type-name a',
    '.byline-author a',
  ];

  cmsAuthorSelectors.forEach(selector => {
    $(selector).each((_, el) => {
      const name = $(el).text().trim();
      if (name && name.length > 2 && !authors.find(a => a.name === name)) {
        logger.log(`👤 Found author from CMS byline (${selector}): ${name}`);
        authors.push({ name, description: null, image: null });
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

      const metadata = JSON.parse(raw);
      collectJsonLdAuthors(metadata).forEach((author) => {
        if (!authors.some((existing) => existing.name === author.name)) {
          logger.log("👤 Found author from JSON-LD:", author.name);
          authors.push(author);
        }
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

  // Visible generic bylines that are plain text rather than author links.
  if (!authors.length) {
    $('[class*="byline"], [class*="article-info"], [itemprop="author"]').each((_, element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      const match = text.match(/^by\s+([\p{L}.'’\-]+(?:\s+[\p{L}.'’\-]+){1,5})(?=\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})|$)/iu);
      if (match) addAuthor(authors, match[1], "visible byline");
    });
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

/**
 * Fetch a single author profile page and extract the person's name.
 * Tries: JSON-LD Person, og:title (first segment), h1.
 */
export async function extractAuthorFromProfilePage(profileUrl) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROFILE_FETCH_TIMEOUT_MS);
    const res = await fetch(profileUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TruthTrollers/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    let name = null;

    // 1. JSON-LD Person or @graph entry
    $('script[type="application/ld+json"]').each((_, s) => {
      if (name) return;
      try {
        const data = JSON.parse($(s).text());
        const person = data['@type'] === 'Person' ? data
          : Array.isArray(data['@graph']) ? data['@graph'].find(n => n['@type'] === 'Person') : null;
        if (person?.name) name = String(person.name).trim();
      } catch {}
    });

    // 2. og:title — "First Last | Site Name" → take first segment
    if (!name) {
      const ogTitle = $('meta[property="og:title"]').attr('content') || '';
      if (ogTitle && !/(not found|404|error|access denied)/i.test(ogTitle)) {
        const seg = ogTitle.split(/[|\-–]/)[0].trim();
        if (seg.length > 2 && seg.length < 80) name = seg;
      }
    }

    // 3. h1 fallback
    if (!name) {
      const h1 = $('h1').first().text().trim();
      if (h1.length > 2 && h1.length < 100) name = h1;
    }

    if (name) {
      logger.log(`👤 [extractAuthorFromProfilePage] "${name}" from ${profileUrl}`);
      return { name, description: null, image: null };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scan article HTML for author profile links, fetch each, return author objects.
 * Only fires when no authors were found by the primary extractors — avoids extra fetches.
 */
export async function followProfileLinks($, baseUrl) {
  if (!$ || !baseUrl) return [];
  let curHost;
  try { curHost = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { return []; }

  const seen = new Set();
  const profileUrls = [];

  $('a[href]').each((_, a) => {
    if (profileUrls.length >= MAX_PROFILE_PAGES) return;
    const href = $(a).attr('href');
    if (!href) return;
    try {
      const full = new URL(href, baseUrl);
      const host = full.hostname.replace(/^www\./, '');
      // Accept same-domain profile links (e.g. childrenshealthdefense.org/authors/foo)
      // and ignore clearly off-topic external domains
      if (host !== curHost && !/\.(gov|edu)$/.test(host)) return;
      if (!PROFILE_PATH_RE.test(full.pathname)) return;
      const canonical = full.origin + full.pathname;
      if (!seen.has(canonical)) { seen.add(canonical); profileUrls.push(full.href); }
    } catch {}
  });

  if (!profileUrls.length) return [];
  logger.log(`🔗 [followProfileLinks] Following ${profileUrls.length} profile link(s): ${profileUrls.join(' | ')}`);

  const results = await Promise.all(profileUrls.map(u => extractAuthorFromProfilePage(u)));
  return results.filter(Boolean);
}
