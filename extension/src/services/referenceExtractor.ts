import * as cheerio from "cheerio";

import type { Lit_references } from "../entities/Task";

export const CONTENT_SELECTORS = [
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

// very aggressive anti-nav/recirc
export const BAD_ANCESTORS = [
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

// phrases or tokens that often indicate a real citation/source
export const CITATION_CUES = [
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

export const BAD_HOST_PATTERNS = [
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

export const isLikelyBad = (href: string) =>
  BAD_HOST_PATTERNS.some((p) => href.includes(p)) ||
  href.startsWith("#") ||
  href.startsWith("mailto:") ||
  href.startsWith("javascript:");

export const hasCitationCue = (text: string) => {
  const t = text.toLowerCase();
  return CITATION_CUES.some((cue) => t.includes(cue));
};

export const formatUrlForTitle = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter((p) => p && p.length > 3);
    const txt = parts.join(" ").replace(/[-_]+/g, " ");
    return txt || hostname;
  } catch {
    return url;
  }
};

export function extractDomReferences(
  $: cheerio.CheerioAPI,
  max = 20
): Lit_references[] {
  const seen = new Set<string>();
  const refs: Lit_references[] = [];

  const $scope = $(CONTENT_SELECTORS).length ? $(CONTENT_SELECTORS) : $.root();

  $scope.find("a[href]").each((_, el) => {
    const $a = $(el);
    const href = ($a.attr("href") || "").trim();

    if (!href || !href.startsWith("http") || isLikelyBad(href)) return;
    if ($a.closest(BAD_ANCESTORS).length) return;

    // accept anchors in paragraphs / list items / figure captions / footnotes
    const tag = (
      $a.closest("p, li, figcaption, .footnote, sup").prop("tagName") || ""
    ).toLowerCase();
    if (!tag) return;

    // require cue in anchor text or the containing sentence
    const anchorText = $a.text().trim();
    const containerText =
      $a.closest("p, li, figcaption, .footnote").text().trim() || anchorText;

    if (!hasCitationCue(anchorText) && !hasCitationCue(containerText)) return;

    if (!seen.has(href)) {
      seen.add(href);
      refs.push({
        url: href,
        content_name: anchorText || formatUrlForTitle(href),
      });
    }
  });

  // cap to max; keep order of appearance
  return refs.slice(0, max);
}
