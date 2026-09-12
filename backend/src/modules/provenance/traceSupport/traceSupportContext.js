import { fetchExternalPageContent } from "../../../utils/fetchExternalPageContent.js";
import axios from "axios";
import * as cheerio from "cheerio";
import { DEFAULT_HEADERS } from "../../../utils/helpers.js";

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "among", "because",
  "before", "being", "between", "could", "does", "from", "have", "into",
  "more", "other", "over", "same", "such", "than", "that", "their",
  "there", "these", "they", "this", "those", "through", "under", "when",
  "where", "which", "while", "with", "would",
]);

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function terms(value = "") {
  return new Set(
    cleanText(value)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9'-]{2,}/g)
      ?.filter((term) => !STOP_WORDS.has(term)) || [],
  );
}

function overlapScore(assertionTerms, paragraph) {
  if (!assertionTerms.size) return 0;
  const paragraphTerms = terms(paragraph);
  let matches = 0;
  for (const term of assertionTerms) {
    if (paragraphTerms.has(term)) matches++;
  }
  return matches / assertionTerms.size;
}

function identifiers(text) {
  const value = String(text || "");
  const dois = [
    ...new Set(
      [...value.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi)].map(
        (match) => match[0].replace(/[).,;]+$/, ""),
      ),
    ),
  ].slice(0, 30);
  const pmids = [
    ...new Set(
      [...value.matchAll(/\bPMID\s*[:#]?\s*(\d{5,9})\b/gi)].map(
        (match) => match[1],
      ),
    ),
  ].slice(0, 30);
  return { dois, pmids };
}

function absoluteUrl(href, baseUrl) {
  try {
    const url = new URL(String(href || ""), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractStructuredHtml($, sourceUrl) {
  const scope = $(
    "article, main, [role='main'], .article-body, .entry-content, .post-content",
  ).first();
  const root = scope.length ? scope : $("body");
  const paragraphs = [];

  root.find("p, li, blockquote, figcaption").each((index, element) => {
    const text = cleanText($(element).text());
    if (text.length < 30) return;
    const links = [];
    $(element)
      .find("a[href]")
      .each((_, anchor) => {
        const url = absoluteUrl($(anchor).attr("href"), sourceUrl);
        if (!url) return;
        links.push({
          anchorText: cleanText($(anchor).text()),
          url,
        });
      });
    paragraphs.push({ index, text, links });
  });

  if (!paragraphs.length) {
    const text = cleanText(root.text());
    for (let start = 0, index = 0; start < text.length; start += 1200, index++) {
      paragraphs.push({ index, text: text.slice(start, start + 1400), links: [] });
    }
  }

  const referenceEntries = [];
  root.find("a[href]").each((_, anchor) => {
    const url = absoluteUrl($(anchor).attr("href"), sourceUrl);
    if (!url) return;
    const containerText = cleanText($(anchor).closest("p, li, dd").text());
    const anchorText = cleanText($(anchor).text());
    if (!containerText && !anchorText) return;
    referenceEntries.push({
      label: anchorText || containerText.slice(0, 240),
      citationText: containerText.slice(0, 800),
      url,
    });
  });

  return {
    paragraphs,
    referenceEntries: referenceEntries.slice(0, 80),
    documentText: cleanText(root.text()).slice(0, 60000),
  };
}

async function loadWordPressJsonDocument(content) {
  const sourceUrl = new URL(content.url);
  const slug = sourceUrl.pathname.split("/").filter(Boolean).at(-1);
  if (!slug) return null;

  const request = async (url) => {
    const response = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    });
    return response.data;
  };

  let entry = null;
  try {
    const postsUrl = new URL("/wp-json/wp/v2/posts", sourceUrl.origin);
    postsUrl.searchParams.set("slug", slug);
    const posts = await request(postsUrl.toString());
    entry = Array.isArray(posts) ? posts[0] : null;
  } catch {
    entry = null;
  }

  if (!entry?.content?.rendered) {
    const searchUrl = new URL("/wp-json/wp/v2/search", sourceUrl.origin);
    searchUrl.searchParams.set("search", content.content_name || slug.replace(/-/g, " "));
    searchUrl.searchParams.set("per_page", "10");
    const results = await request(searchUrl.toString());
    const match = (Array.isArray(results) ? results : []).find((result) => {
      try {
        return new URL(result.url).pathname.replace(/\/$/, "") === sourceUrl.pathname.replace(/\/$/, "");
      } catch {
        return false;
      }
    });
    const selfUrl = match?._links?.self?.[0]?.href;
    if (selfUrl) entry = await request(selfUrl);
  }

  const rendered = entry?.content?.rendered;
  if (!rendered) return null;
  return extractStructuredHtml(cheerio.load(`<article>${rendered}</article>`), content.url);
}

export function buildTraceContextFromDocument({
  assertion,
  sourceUrl,
  title,
  documentText = "",
  paragraphs = [],
  referenceEntries = [],
}) {
  const assertionTerms = terms(assertion);
  const ranked = paragraphs
    .map((paragraph, arrayIndex) => ({
      ...paragraph,
      arrayIndex,
      score: overlapScore(assertionTerms, paragraph.text),
    }))
    .sort((a, b) => b.score - a.score || a.arrayIndex - b.arrayIndex)
    .slice(0, 4);

  const selectedIndices = new Set();
  for (const candidate of ranked) {
    for (const index of [candidate.arrayIndex - 1, candidate.arrayIndex, candidate.arrayIndex + 1]) {
      if (index >= 0 && index < paragraphs.length) selectedIndices.add(index);
    }
  }

  const passageContext = [...selectedIndices]
    .sort((a, b) => a - b)
    .map((index) => paragraphs[index])
    .filter(Boolean)
    .slice(0, 12);
  const fallbackText = cleanText(documentText).slice(0, 12000);
  const combined = `${fallbackText}\n${JSON.stringify(referenceEntries)}\n${JSON.stringify(passageContext)}`;

  return {
    document: { title: title || null, url: sourceUrl || null },
    candidatePassages: passageContext,
    references: referenceEntries.slice(0, 80),
    identifiers: identifiers(combined),
    fallbackText: passageContext.length ? undefined : fallbackText,
  };
}

export async function loadTraceSupportContext({ content, assertion }) {
  let structured = null;
  let fetchError = null;
  let contextSource = "live_document";
  try {
    const fetched = await fetchExternalPageContent(content.url);
    structured = extractStructuredHtml(fetched.$, content.url);
  } catch (error) {
    fetchError = error.message;
    try {
      structured = await loadWordPressJsonDocument(content);
      if (structured) contextSource = "wordpress_json";
    } catch (wordpressError) {
      fetchError = `${fetchError}; WordPress JSON: ${wordpressError.message}`;
    }
  }

  const storedText = cleanText(content.content_text || content.details || "");
  if (!structured) {
    contextSource = "stored_text";
    const paragraphs = storedText
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .filter((text) => text.length >= 30)
      .map((text, index) => ({ index, text, links: [] }));
    structured = {
      paragraphs,
      referenceEntries: [],
      documentText: storedText,
    };
  }

  return {
    ...buildTraceContextFromDocument({
      assertion,
      sourceUrl: content.url,
      title: content.content_name,
      ...structured,
    }),
    contextSource,
    fetchError,
  };
}

export function collectTraceCandidates(context) {
  const byUrl = new Map();
  for (const entry of context?.references || []) {
    if (entry?.url && !byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  }
  for (const passage of context?.candidatePassages || []) {
    for (const link of passage.links || []) {
      if (!link?.url || byUrl.has(link.url)) continue;
      byUrl.set(link.url, {
        label: link.anchorText || link.url,
        citationText: passage.text,
        url: link.url,
      });
    }
  }
  return [...byUrl.values()];
}

export function collectRelevantPdfCandidates(context, assertion, minimumScore = 0.25) {
  const assertionTerms = terms(assertion);
  const byUrl = new Map();
  for (const entry of context?.references || []) {
    if (!/\.pdf(?:$|[?#])/i.test(String(entry?.url || ""))) continue;
    const score = overlapScore(
      assertionTerms,
      `${entry.label || ""} ${entry.citationText || ""}`,
    );
    if (score < minimumScore) continue;
    const current = byUrl.get(entry.url);
    if (!current || score > current.score) byUrl.set(entry.url, { ...entry, score });
  }
  return [...byUrl.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}
