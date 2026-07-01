// backend/src/utils/extractReferences.js
// ─────────────────────────────────────────────
// Extract lit_references from HTML DOM and JSON-LD
// Ported from extension/src/services/extractMetaDataUtils.ts
// and extension/src/services/referenceExtractor.ts
// ─────────────────────────────────────────────

import logger from "./logger.js";

// Content area selectors - article main content
const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".article-body",
  ".article__content",
  ".entry-content",
  ".post-content",
  ".content__article-body",
  ".story-body",
  ".story__content",
  ".rich-text",
  ".prose",
  ".content",
  ".body-content",
  ".article-content",
  ".articleText",
].join(",");

// Elements to avoid (navigation, ads, etc.)
const BAD_ANCESTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  ".menu",
  ".navbar",
  ".breadcrumbs",
  ".subscribe",
  ".share",
  ".social",
  ".recirc",
  ".recommended",
  ".most-read",
  ".mostViewed",
  ".newsletter",
  ".related-links",
  ".comments",
  ".outbrain",
  ".ad",
  ".advert",
  ".sponsored",
].join(",");

// Citation cues that indicate a reference
const CITATION_CUES = [
  "study",
  "paper",
  "report",
  "according to",
  "doi",
  "arxiv",
  "pubmed",
  "preprint",
  "dataset",
  "source",
  "footnote",
  "[",
  "§",
  "†",
  "pdf",
];

// URLs to exclude
const BAD_HOST_PATTERNS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "mailto:",
  "javascript:",
  "subscribe",
  "login",
  "share",
  "comment",
  "utm_",
];

const isLikelyBad = (href) =>
  BAD_HOST_PATTERNS.some((p) => href.includes(p)) ||
  href.startsWith("#") ||
  href.startsWith("mailto:") ||
  href.startsWith("javascript:");

const hasCitationCue = (text) => {
  const t = text.toLowerCase();
  return CITATION_CUES.some((cue) => t.includes(cue));
};

const formatUrlForTitle = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    const readablePart = pathname.split("/").filter((part) => part.length > 3);
    return readablePart.length
      ? readablePart.join(" ").replace(/[-_]/g, " ")
      : hostname;
  } catch {
    return url;
  }
};

/**
 * extractReferences($)
 *
 * Extracts references from:
 * 1. DOM content (paragraphs, list items, footnotes with citation cues)
 * 2. JSON-LD metadata (references/citation fields)
 *
 * Returns: Array of { url, content_name }
 * Limited to MAX_RESULTS (30)
 */
export async function extractReferences($) {
  const MAX_RESULTS = 30;
  const seen = new Set();
  const refs = [];

  const pushRef = (url, title) => {
    if (!url) return;
    const href = url.trim();
    if (!href || !href.startsWith("http") || isLikelyBad(href)) return;
    if (seen.has(href)) return;
    seen.add(href);
    refs.push({
      url: href,
      content_name: (title || "").trim() || formatUrlForTitle(href),
    });
  };

  // -------- 1) DOM crawl (content-scoped) --------
  const $scope = $(CONTENT_SELECTORS).length ? $(CONTENT_SELECTORS) : $.root();

  $scope.find("a[href]").each((_, el) => {
    const $a = $(el);
    const href = ($a.attr("href") || "").trim();
    if (!href || !href.startsWith("http") || isLikelyBad(href)) return;

    // avoid nav/recirc/etc
    if ($a.closest(BAD_ANCESTORS).length) return;

    // must live in reasonable text containers
    const tag = (
      $a.closest("p, li, figcaption, .footnote, sup").prop("tagName") || ""
    ).toLowerCase();
    if (!tag) return;

    // require a cue in anchor text or the container sentence
    const anchorText = $a.text().trim();
    const containerText =
      $a.closest("p, li, figcaption, .footnote").text().trim() || anchorText;
    if (!hasCitationCue(anchorText) && !hasCitationCue(containerText)) return;

    pushRef(href, anchorText);
  });

  // -------- 2) JSON-LD references (robust parsing) --------
  $('script[type="application/ld+json"]').each((_, scriptTag) => {
    let raw = $(scriptTag).text().trim();
    if (!raw) return;

    // Some sites stuff multiple JSON objects or arrays into one tag or have trailing semicolons.
    // Try a few safe parses:
    const candidates = [];

    const tryParse = (s) => {
      try {
        const v = JSON.parse(s);
        candidates.push(v);
      } catch {
        /* ignore */
      }
    };

    // 2a) raw as-is (common case)
    tryParse(raw);

    // 2b) strip trailing semicolon
    if (raw.endsWith(";")) tryParse(raw.slice(0, -1));

    // 2c) if looks like a "}{" concatenation, split naïvely into objects
    if (!candidates.length && /}\s*{/.test(raw)) {
      const parts = raw
        .split(/}\s*{/)
        .map((s, i, arr) =>
          i === 0 ? s + "}" : i === arr.length - 1 ? "{" + s : "{" + s + "}"
        );
      parts.forEach(tryParse);
    }

    const flatten = (v) =>
      Array.isArray(v) ? v.flatMap(flatten) : [v];

    const allObjs = candidates.flatMap(flatten);

    const pickRefs = (node) => {
      if (!node || typeof node !== "object") return;

      // Schema.org often puts references under `references`
      const refsNode =
        node.references ??
        node.citation ?? // some publishers
        null;

      const list = Array.isArray(refsNode)
        ? refsNode
        : refsNode
        ? [refsNode]
        : [];
      list.forEach((r) => {
        const u = typeof r === "string" ? r : r?.url;
        const name =
          (typeof r === "object" && (r.name || r.headline || r.title)) || "";
        pushRef(u, name);
      });

      // Recurse shallowly for nested structures (isPartOf/hasPart/graph)
      ["isPartOf", "hasPart", "@graph", "itemListElement"].forEach((k) => {
        const v = node[k];
        if (!v) return;
        flatten(v).forEach(pickRefs);
      });
    };

    allObjs.forEach(pickRefs);
  });

  // keep original order preference (DOM first, then JSON-LD appended)
  // already achieved because DOM emits before JSON-LD, and dedupe happens on push

  return refs.slice(0, MAX_RESULTS);
}
