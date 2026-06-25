// backend/src/utils/extractPublisher.js
// ─────────────────────────────────────────────
// Extract publisher metadata from HTML using cheerio
// ─────────────────────────────────────────────

import logger from "./logger.js";

const JUNK_NAME_RE =
  /^(home|skip to|toggle|menu|logo|icon|go to|navigation|main content|website|portal|online|search|login|sign in|subscribe|recaptcha|just a moment|cloudflare|attention required|one more step|checking your browser|access denied|403 forbidden)$/i;

const AGGREGATOR_NAME_RE =
  /(bvs|biblioteca virtual em sa[uú]de|pesquisa bvs|pubmed|ncbi|google scholar|jstor|scielo|researchgate|semanticscholar|semantic scholar)/i;

function isJunkName(name) {
  if (!name || name.length < 4 || name.length > 150) return true;
  return JUNK_NAME_RE.test(name.trim());
}

function cleanName(str) {
  const cleaned = String(str || "")
    .replace(/\s+/g, " ")
    .replace(/[®™]/g, "")
    .replace(/^\s*[:：\-–—|]\s*/, "")
    .replace(/\s*[•:：\-–—|]\s*$/, "")
    .trim();
  if (/^Elsevier\s+B\.?V\.?$/i.test(cleaned)) return "Elsevier";
  if (/^Children[’']s Health Defense$/i.test(cleaned)) return "Children's Health Defense";
  return cleaned;
}

function isAggregatorName(name) {
  return AGGREGATOR_NAME_RE.test(cleanName(name));
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPageUrl($) {
  return (
    $('meta[property="og:url"]').attr("content") ||
    $('link[rel="canonical"]').attr("href") ||
    ""
  );
}

function isKnownAggregatorPage($, sourceUrl = "") {
  const url = getPageUrl($) || sourceUrl || "";
  const siteName = $('meta[property="og:site_name"]').attr("content") || "";
  return (
    /pesquisa\.bvsalud\.org/i.test(url) ||
    /pubmed\.ncbi\.nlm\.nih\.gov/i.test(url) ||
    isAggregatorName(siteName)
  );
}

function aggregatorFallbackName($, sourceUrl = "") {
  const url = getPageUrl($) || sourceUrl || "";
  if (/bvsalud\.org/i.test(url)) return "Biblioteca Virtual em Saúde";
  return null;
}

function firstClean($, selectors) {
  for (const selector of selectors) {
    const val =
      $(selector).first().attr("content") || $(selector).first().text();
    const name = cleanName(val);
    if (name && !isJunkName(name) && !isAggregatorName(name)) {
      const role = /journal|publicationName|source|conference/i.test(selector)
        ? "journal"
        : "publisher";
      return { name, role };
    }
  }
  return null;
}

function extractFromLabeledText($, labels) {
  const bodyText = $("body").text().replace(/\r/g, "\n");
  if (!bodyText) return null;

  for (const label of labels) {
    const re = new RegExp(
      `${escapeRegExp(label)}\\s*[:：]\\s*([^\\n|]{2,160})(?:\\n|\\||$)`,
      "i",
    );
    const match = bodyText.match(re);
    if (match) {
      const name = cleanName(match[1]);
      if (name && !isJunkName(name) && !isAggregatorName(name)) {
        const role = /journal|revista|periódico|periodico|fonte|source|fuente|publicado|published/i.test(label)
          ? "journal"
          : "publisher";
        return { name, role };
      }
    }
  }

  return null;
}

function extractScholarlyPublisherProxy($) {
  // Prefer true publisher if present.
  let found = firstClean($, [
    'meta[name="citation_publisher"]',
    'meta[name="dc.publisher"]',
    'meta[name="DC.publisher"]',
    'meta[name="publisher"]',
  ]);
  if (found) return {
    name: found.name,
    role: "publisher",
    confidence: "metadata",
    note: "Scholarly metadata identified a publisher field.",
  };

  // For records like BVS, journal/source is often the best available publisher proxy.
  found = firstClean($, [
    'meta[name="citation_journal_title"]',
    'meta[name="prism.publicationName"]',
    'meta[name="dc.source"]',
    'meta[name="DC.source"]',
    'meta[name="citation_conference_title"]',
  ]);
  if (found) return {
    name: found.name,
    role: "journal",
    confidence: "proxy",
    note: "Scholarly metadata identified the journal/source container, not a confirmed publisher.",
  };

  // BVS and similar pages often expose these as visible label/value fields.
  found = extractFromLabeledText($, [
    "Publisher",
    "Editora",
    "Editorial",
    "Journal",
    "Revista",
    "Periódico",
    "Periodico",
    "Fonte",
    "Source",
    "Fuente",
    "Publicado em",
    "Published in",
  ]);
  if (found) return {
    name: found.name,
    role: found.role,
    confidence: found.role === "publisher" ? "visible_metadata" : "proxy",
    note: found.role === "publisher"
      ? "Visible record metadata identified a publisher field."
      : "Visible record metadata identified the journal/source container, not a confirmed publisher.",
  };

  return null;
}

export async function extractPublisher($, sourceUrl = "") {
  const knownAggregator = isKnownAggregatorPage($, sourceUrl);

  // ── 0. Aggregator/scholarly record handling ───────────────────────────────
  // Avoid returning BVS/PubMed/etc. as publisher when the actual journal/source
  // is present on the record page.
  if (knownAggregator) {
    const scholarlyProxy = extractScholarlyPublisherProxy($);
    if (scholarlyProxy) return scholarlyProxy;
  }

  // ── 1. High-specificity meta tags ─────────────────────────────────────────
  let publisherName =
    $('meta[property="og:site_name"]').attr("content") ||
    $('meta[name="publisher"]').attr("content") ||
    $('meta[name="citation_publisher"]').attr("content") ||
    $('meta[name="citation_journal_title"]').attr("content");

  if (
    publisherName &&
    !isJunkName(publisherName) &&
    !(knownAggregator && isAggregatorName(publisherName))
  ) {
    return { name: cleanName(publisherName) };
  }

  // ── 2. JSON-LD ─────────────────────────────────────────────────────────────
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    try {
      const raw = $(scriptTag).text().trim();
      if (!raw) return;

      const metadata = JSON.parse(raw);

      const findPublisher = (data) => {
        if (Array.isArray(data)) {
          return data.map(findPublisher).find(Boolean) || null;
        }

        if (typeof data === "object" && data) {
          if (
            data.publisher &&
            typeof data.publisher === "object" &&
            data.publisher.name
          ) {
            return data.publisher.name;
          }

          if (
            data.isPartOf &&
            typeof data.isPartOf === "object" &&
            data.isPartOf.name
          ) {
            return data.isPartOf.name;
          }

          if (
            data.sourceOrganization &&
            typeof data.sourceOrganization === "object" &&
            data.sourceOrganization.name
          ) {
            return data.sourceOrganization.name;
          }

          if (
            data["@type"] === "WebSite" &&
            data.name &&
            !isJunkName(data.name)
          ) {
            return data.name;
          }

          const ORG_TYPES = [
            "NewsMediaOrganization",
            "Organization",
            "MedicalOrganization",
            "GovernmentOrganization",
            "EducationalOrganization",
            "NGO",
            "Corporation",
            "LocalBusiness",
            "Periodical",
          ];

          const type = Array.isArray(data["@type"])
            ? data["@type"]
            : [data["@type"]];
          if (type.some((t) => ORG_TYPES.includes(t)) && data.name) {
            return data.name;
          }

          return Object.values(data).map(findPublisher).find(Boolean) || null;
        }

        return null;
      };

      const found = findPublisher(metadata);
      if (
        found &&
        !isJunkName(found) &&
        !(knownAggregator && isAggregatorName(found))
      ) {
        publisherName = found;
        return false;
      }
    } catch (err) {
      logger.warn(`⚠️ Failed to parse ld+json script: ${err}`);
    }
  });

  if (
    publisherName &&
    !isJunkName(publisherName) &&
    !(knownAggregator && isAggregatorName(publisherName))
  ) {
    return { name: cleanName(publisherName) };
  }

  // ── 3. Header/nav logo <a> title attribute ─────────────────────────────────
  const logoLinkTitle = $(
    'header a[href="/"][title], .header a[href="/"][title], ' +
      'nav a[href="/"][title], .c-header-logo a[title], ' +
      ".site-header a[title], .logo a[title], a.logo[title], " +
      '.navbar-brand[title], .brand[title], [class*="logo"] a[title]',
  )
    .first()
    .attr("title")
    ?.trim();

  if (
    logoLinkTitle &&
    !isJunkName(logoLinkTitle) &&
    !(knownAggregator && isAggregatorName(logoLinkTitle))
  ) {
    return { name: cleanName(logoLinkTitle) };
  }

  // ── 4. Logo <img> alt text in header/nav area ──────────────────────────────
  const logoImgAlt = $(
    'header img[alt]:not([alt=""]), .header img[alt]:not([alt=""]), ' +
      '.c-header-logo img[alt]:not([alt=""]), .logo img[alt]:not([alt=""]), ' +
      '.navbar-brand img[alt]:not([alt=""]), img.logo[alt]:not([alt=""]), ' +
      '[class*="logo"] img[alt]:not([alt=""])',
  )
    .first()
    .attr("alt")
    ?.trim();

  if (
    logoImgAlt &&
    !isJunkName(logoImgAlt) &&
    !(knownAggregator && isAggregatorName(logoImgAlt))
  ) {
    return { name: cleanName(logoImgAlt) };
  }

  // ── 5. Copyright footer text ───────────────────────────────────────────────
  const footerText = $(
    "footer, .footer, [class*='footer'], [class*='copyright']",
  ).text();
  const textToSearch =
    footerText.length > 50 ? footerText : $("body").text().slice(-3000);
  const copyrightMatch = textToSearch.match(
    /©\s*(?:\d{4}\s*[-–]?\s*)?\d{4}\s+(.+?)(?:\.\s+All Rights|\.\s+All rights|,|\.\s|All Rights Reserved)/i,
  );

  if (copyrightMatch) {
    const name = cleanName(copyrightMatch[1]);
    if (
      name &&
      !isJunkName(name) &&
      name.length <= 120 &&
      !(knownAggregator && isAggregatorName(name))
    ) {
      return { name };
    }
  }

  // ── 6. <title> tag suffix ──────────────────────────────────────────────────
  const titleText = $("title").text().trim();
  if (titleText) {
    const strongMatch = titleText.match(/\s+[|–—]\s+(.+)$/);
    if (strongMatch) {
      const name = cleanName(strongMatch[1]);
      if (
        name &&
        !isJunkName(name) &&
        name.length >= 4 &&
        name.length <= 100 &&
        !(knownAggregator && isAggregatorName(name))
      ) {
        return { name };
      }
    }

    const softMatch = titleText.match(/\s+-\s+([^-]{4,80})$/);
    if (softMatch) {
      const name = cleanName(softMatch[1]);
      if (
        name &&
        !isJunkName(name) &&
        !(knownAggregator && isAggregatorName(name))
      ) {
        return { name };
      }
    }
  }

  // Last chance for aggregator records: if normal logic failed, try scholarly proxy again.
  if (knownAggregator) {
    const scholarlyProxy = extractScholarlyPublisherProxy($);
    if (scholarlyProxy) return scholarlyProxy;
    const fallbackName = aggregatorFallbackName($, sourceUrl);
    if (fallbackName) return {
      name: fallbackName,
      role: "repository",
      confidence: "fallback",
      note: "Aggregator/repository inferred from source URL; actual publisher unresolved.",
    };
  }

  return { name: "Unknown Publisher" };
}
