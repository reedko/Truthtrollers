// backend/src/utils/extractPublisher.js
// ─────────────────────────────────────────────
// Extract publisher metadata from HTML using cheerio
// Ported from extension/src/services/extractMetaDataUtils.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

// Strings that are definitely not a publisher name
const JUNK_NAME_RE = /^(home|skip to|toggle|menu|logo|icon|go to|navigation|main content|website|portal|online|search|login|sign in|subscribe|recaptcha|just a moment|cloudflare|attention required|one more step|checking your browser|access denied|403 forbidden)$/i;

function isJunkName(name) {
  if (!name || name.length < 4 || name.length > 150) return true;
  return JUNK_NAME_RE.test(name.trim());
}

function cleanName(str) {
  return str.replace(/\s+/g, " ").trim();
}

/**
 * extractPublisher($)
 *
 * Extracts publisher information from various HTML sources in priority order:
 *   1. og:site_name / publisher meta / citation_publisher / citation_journal_title
 *   2. JSON-LD (publisher, isPartOf, Organization types)
 *   3. Header logo <a> title attribute
 *   4. Header logo <img> alt attribute
 *   5. Copyright footer text (© YYYY Publisher Name)
 *   6. <title> tag suffix ("Article Title | Publisher Name")
 *
 * Returns: { name: string }
 */
export async function extractPublisher($) {
  // ── 1. High-specificity meta tags ─────────────────────────────────────────
  let publisherName =
    $('meta[property="og:site_name"]').attr("content") ||
    $('meta[name="publisher"]').attr("content") ||
    $('meta[name="citation_publisher"]').attr("content") ||
    $('meta[name="citation_journal_title"]').attr("content");

  if (publisherName && !isJunkName(publisherName)) {
    return { name: cleanName(publisherName) };
  }

  // ── 2. JSON-LD ─────────────────────────────────────────────────────────────
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const metadata = JSON.parse($(scriptTag).text().trim());

      if (metadata.publisher && typeof metadata.publisher === "object" && metadata.publisher.name) {
        publisherName = metadata.publisher.name;
        return false;
      }

      if (metadata.isPartOf && typeof metadata.isPartOf === "object" && metadata.isPartOf.name) {
        publisherName = metadata.isPartOf.name;
        return false;
      }

      // WebSite @type carries the site/organization name (e.g. CIDRAP)
      if (metadata["@type"] === "WebSite" && metadata.name && !isJunkName(metadata.name)) {
        publisherName = metadata.name;
        return false;
      }

      const ORG_TYPES = [
        "NewsMediaOrganization", "Organization", "MedicalOrganization",
        "GovernmentOrganization", "EducationalOrganization", "NGO",
        "Corporation", "LocalBusiness",
      ];

      const findPublisher = (data) => {
        if (Array.isArray(data)) return data.map(findPublisher).find(Boolean) || null;
        if (typeof data === "object" && data) {
          if (ORG_TYPES.includes(data["@type"]) && data.name) return data.name;
          return Object.values(data).map(findPublisher).find(Boolean) || null;
        }
        return null;
      };

      const found = findPublisher(metadata);
      if (found) publisherName = found;
    } catch (err) {
      logger.warn(`⚠️ Failed to parse ld+json script: ${err}`);
    }
  });

  if (publisherName && !isJunkName(publisherName)) {
    return { name: cleanName(publisherName) };
  }

  // ── 3. Header/nav logo <a> title attribute ─────────────────────────────────
  // Covers: <a href="/" title="Publisher Name"> patterns in header/nav/logo areas
  const logoLinkTitle = $(
    'header a[href="/"][title], .header a[href="/"][title], ' +
    'nav a[href="/"][title], .c-header-logo a[title], ' +
    '.site-header a[title], .logo a[title], a.logo[title], ' +
    '.navbar-brand[title], .brand[title], [class*="logo"] a[title]'
  ).first().attr("title")?.trim();

  if (logoLinkTitle && !isJunkName(logoLinkTitle)) {
    return { name: cleanName(logoLinkTitle) };
  }

  // ── 4. Logo <img> alt text in header/nav area ──────────────────────────────
  // Covers: <img alt="Publisher Name" class="logo"> and similar
  const logoImgAlt = $(
    'header img[alt]:not([alt=""]), .header img[alt]:not([alt=""]), ' +
    '.c-header-logo img[alt]:not([alt=""]), .logo img[alt]:not([alt=""]), ' +
    '.navbar-brand img[alt]:not([alt=""]), img.logo[alt]:not([alt=""]), ' +
    '[class*="logo"] img[alt]:not([alt=""])'
  ).first().attr("alt")?.trim();

  if (logoImgAlt && !isJunkName(logoImgAlt)) {
    return { name: cleanName(logoImgAlt) };
  }

  // ── 5. Copyright footer text ───────────────────────────────────────────────
  // Covers: "© 2024 Publisher Name. All Rights Reserved."
  const footerText = $(
    'footer, .footer, [class*="footer"], [class*="copyright"]'
  ).text();
  const textToSearch = footerText.length > 50 ? footerText : $("body").text().slice(-3000);
  const copyrightMatch = textToSearch.match(
    /©\s*(?:\d{4}\s*[-–]?\s*)?\d{4}\s+(.+?)(?:\.\s+All Rights|\.\s+All rights|,|\.\s|All Rights Reserved)/i
  );
  if (copyrightMatch) {
    const name = cleanName(copyrightMatch[1]);
    if (name && !isJunkName(name) && name.length <= 120) {
      return { name };
    }
  }

  // ── 6. <title> tag suffix ("Article Title | Publisher") ───────────────────
  // Covers: "Vaccines: Myths and Facts | AAAAI" or "Article - Publisher Name"
  const titleText = $("title").text().trim();
  if (titleText) {
    // Try strong separators first (| – —), then soft (-)
    const strongMatch = titleText.match(/\s+[|–—]\s+(.+)$/);
    if (strongMatch) {
      const name = cleanName(strongMatch[1]);
      if (name && !isJunkName(name) && name.length >= 4 && name.length <= 100) {
        return { name };
      }
    }
    const softMatch = titleText.match(/\s+-\s+([^-]{4,80})$/);
    if (softMatch) {
      const name = cleanName(softMatch[1]);
      if (name && !isJunkName(name)) {
        return { name };
      }
    }
  }

  return { name: "Unknown Publisher" };
}
