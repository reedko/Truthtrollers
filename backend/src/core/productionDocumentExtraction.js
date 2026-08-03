// Shared deterministic extraction seam for production task/reference scraping
// and CFX evidence acquisition. This module does not fetch URLs and does not
// invent a new scraper. It composes the extractors already used by production:
// Readability, the legacy selector cascade, canonical headline/author/
// publishing-identity extraction, image extraction, and PDF fallback parsing.

import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { extractAuthors, mergeAuthors } from "../utils/extractAuthors.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { getBestImage } from "../utils/getBestImage.js";
import { extractInlineRefs } from "../utils/extractInlineRefs.js";
import { processPublishingIdentity } from "../services/publishingIdentityPipeline.js";
import { extractPdfTextWithFallback } from "./citationExpansion.js";

const DEFAULT_MAX_CHARS = 60_000;
const BOT_MARKUP_RE = /class="[^"]*g-recaptcha|id="challenge-(?:form|stage|running)"|class="[^"]*cf-challenge|challenges\.cloudflare\.com|ddos-guard/iu;
const BOT_TEXT_RE = /checking your browser|just a moment\.\.\.|enable javascript and cookies to continue|are you a robot\?|please complete the security check|access to this page has been denied/iu;

function normalizedText(value, maximum = DEFAULT_MAX_CHARS) {
  return String(value || "")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\r/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, maximum);
}

export function isProductionBotChallengeHtml(html) {
  const source = String(html || "");
  if (source.length < 50) return false;
  if (BOT_MARKUP_RE.test(source)) return true;
  // Challenge prose can be quoted by a legitimate article. Treat it as a
  // blocker only on a small page with no article/main content structure.
  return source.length < 10_000
    && !/<(?:article|main)\b/iu.test(source)
    && BOT_TEXT_RE.test(source);
}

function cleanForSelectorExtraction(html) {
  const $ = cheerio.load(String(html || ""));
  $("script, style, link, noscript, iframe, embed, object").remove();
  $("[class*='ad-'], [id*='ad-'], [class*='banner'], [id*='banner']").remove();
  $("[class*='popup'], [id*='popup'], [class*='modal'], [id*='modal']").remove();
  $("[class*='overlay'], [id*='overlay'], [class*='promo'], [id*='promo']").remove();
  $("[class*='newsletter'], [id*='newsletter'], [class*='subscribe'], [id*='subscribe']").remove();
  $("nav, footer, aside").remove();
  $(".navigation, .navbar, .menu, .sidebar, .footer").remove();
  $(".social, .share, .comments, .related, .recommended").remove();
  $("#navigation, #navbar, #menu, #sidebar, #footer").remove();
  $("[style*='display: none'], [style*='display:none'], .hidden, .hide, .invisible").remove();
  return $.html();
}

function selectorCascade(url) {
  const isJournalSite = /sciencedirect\.com|elsevier\.com/iu.test(url);
  const isSubstack = /substack\.com/iu.test(url);
  return [
    ...(isSubstack ? [
      { selector: ".available-content .body.markup", raw: true, minimum: 100 },
      { selector: ".available-content", raw: true, minimum: 100 },
    ] : []),
    ...(isJournalSite ? [
      { selector: ".Abstracts, .Body", raw: true, minimum: 100 },
      { selector: "#abstracts, #body", raw: false, minimum: 100 },
      { selector: ".Abstracts", raw: false, minimum: 100 },
      { selector: ".Body", raw: false, minimum: 100 },
      { selector: "#body", raw: false, minimum: 100 },
    ] : []),
    { selector: "article", raw: false, minimum: 200 },
    { selector: ".article-content", raw: false, minimum: 200 },
    { selector: ".post-content", raw: false, minimum: 200 },
    { selector: ".entry-content", raw: false, minimum: 200 },
    { selector: ".article-body", raw: false, minimum: 200 },
    { selector: ".story-body", raw: false, minimum: 200 },
    { selector: '[role="main"]', raw: false, minimum: 200 },
    { selector: "main", raw: false, minimum: 200 },
    { selector: ".content", raw: false, minimum: 200 },
    { selector: "#content", raw: false, minimum: 200 },
  ];
}

/**
 * Run the production HTML text cascade after the raw response has been
 * retained. Challenge detection is reported as metadata; it never prevents
 * the caller from preserving or inspecting the raw HTML.
 */
export function extractProductionReadableHtml(rawHtml, {
  url = "https://invalid.local/",
  maximumCharacters = DEFAULT_MAX_CHARS,
} = {}) {
  const html = String(rawHtml || "");
  if (!html.trim()) {
    return { text: "", method: "empty", botChallenge: false, selector: null };
  }
  const botChallenge = isProductionBotChallengeHtml(html);

  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = normalizedText(article?.textContent, maximumCharacters);
    if (text.length >= 100) {
      return { text, method: "readability", botChallenge, selector: null };
    }
  } catch {
    // Continue into the exact selector/manual fallback used by production.
  }

  const $raw = cheerio.load(html);
  $raw("script, style, noscript").remove();
  const $clean = cheerio.load(cleanForSelectorExtraction(html));
  for (const row of selectorCascade(url)) {
    const source = row.raw ? $raw : $clean;
    const text = normalizedText(source(row.selector).text(), maximumCharacters);
    if (text.length > row.minimum) {
      return {
        text,
        method: "production_selector",
        botChallenge,
        selector: row.selector,
      };
    }
  }
  return {
    text: normalizedText($clean.text(), maximumCharacters),
    method: "production_page_text",
    botChallenge,
    selector: "document",
  };
}

/** @param {any} input */
export async function extractProductionHtmlDocument({
  rawHtml,
  url,
  providedTitle = null,
  providedAuthors = [],
  providedPublishingIdentity = null,
  maximumCharacters = DEFAULT_MAX_CHARS,
} = {}) {
  const html = String(rawHtml || "");
  const $ = cheerio.load(html);
  const readable = extractProductionReadableHtml(html, { url, maximumCharacters });
  const title = providedTitle || await getMainHeadline($) || "AI Reference";
  const htmlAuthors = readable.botChallenge ? [] : await extractAuthors($);
  const identityResult = providedPublishingIdentity
    ? await processPublishingIdentity({ identity: providedPublishingIdentity })
    : readable.botChallenge
      ? { identity: null, legacyPublisher: null, authors: [] }
      : await processPublishingIdentity({ $, sourceUrl: url });
  const nonAuthorEntityNames = new Set([
    identityResult.identity?.entities?.original_publisher?.name,
    identityResult.identity?.entities?.parent_organization?.name,
  ].filter(Boolean).map((name) => String(name).trim().toLowerCase()));
  const filteredAuthors = mergeAuthors(identityResult.authors, mergeAuthors(providedAuthors, htmlAuthors))
    .filter((author) => {
      const name = String(author?.name || author?.displayName || author || "").trim();
      if (!name || /^(?:full profile|profile|the conversation)$/iu.test(name)) return false;
      return !nonAuthorEntityNames.has(name.toLowerCase());
    });
  const authors = [];
  for (const author of filteredAuthors) {
    const name = String(author?.name || author?.displayName || author || "").trim();
    if (/^(?:MD|DO|PhD|DPhil|MPH|MSc|MA|JD)$/u.test(name) && authors.length) {
      const previous = authors.at(-1);
      previous.name = `${previous.name}, ${name}`;
      continue;
    }
    authors.push(typeof author === "string" ? { name } : { ...author, name });
  }
  const inlineRefs = readable.text.length >= 100 ? extractInlineRefs(readable.text) : [];
  const domReferenceCount = $("a[href]").length;
  return {
    documentType: /facebook\.com|fb\.com/iu.test(url || "") ? "facebook" : "html",
    title,
    authors,
    publisher: identityResult.legacyPublisher || null,
    publishingIdentity: identityResult.identity || null,
    thumbnail: readable.botChallenge ? "" : getBestImage($, url) || "",
    text: readable.text,
    rawHtml: html,
    extractionMethod: readable.method,
    extractionSelector: readable.selector,
    botChallenge: readable.botChallenge,
    citationCount: inlineRefs.length + domReferenceCount,
  };
}

function pdfTitle(infoTitle, text, url) {
  if (String(infoTitle || "").trim().length > 3) return String(infoTitle).trim();
  const line = String(text || "").split(/\n+/u).map((value) => value.trim())
    .find((value) => value.length > 10 && value.length < 200);
  if (line) return line;
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "PDF Document";
  } catch {
    return "PDF Document";
  }
}

/** @param {any} input */
export async function extractProductionPdfDocument({
  buffer = null,
  rawText = null,
  url,
  providedTitle = null,
  providedAuthors = [],
  maximumCharacters = DEFAULT_MAX_CHARS,
} = {}) {
  let parsed = null;
  let text = normalizedText(rawText, maximumCharacters);
  if (!text && buffer) {
    parsed = await extractPdfTextWithFallback(Buffer.from(buffer), {
      primaryParser: pdfParse,
    });
    text = normalizedText(parsed.text, maximumCharacters);
  }
  const identityResult = await processPublishingIdentity({
    documentType: "pdf",
    pdfInfo: parsed?.info || {},
    pdfMetadata: parsed?.metadata || null,
    pdfText: text,
    sourceUrl: url,
  });
  const metadataAuthors = parsed?.info?.Author
    ? String(parsed.info.Author).split(/[,;]|\sand\s/iu).map((name) => ({ name: name.trim() }))
    : [];
  const authors = mergeAuthors(identityResult.authors, mergeAuthors(providedAuthors, metadataAuthors));
  return {
    documentType: "pdf",
    title: providedTitle || pdfTitle(parsed?.info?.Title, text, url),
    authors,
    publisher: identityResult.legacyPublisher || null,
    publishingIdentity: identityResult.identity || null,
    thumbnail: "",
    text,
    rawHtml: null,
    extractionMethod: parsed?.method || (rawText ? "provided_pdf_text" : "pdf_parse_failed"),
    extractionSelector: null,
    botChallenge: false,
    citationCount: text.length >= 100 ? extractInlineRefs(text).length : 0,
    parserAttempts: parsed?.attempts || [],
  };
}

/** @param {any} input */
export function productionDocumentType({ url = "", contentType = "", bodyBuffer = null } = {}) {
  const header = String(contentType || "").toLowerCase();
  const bytes = bodyBuffer ? Buffer.from(bodyBuffer).subarray(0, 5).toString("ascii") : "";
  if (header.includes("application/pdf") || /\.pdf(?:$|[?#])/iu.test(url) || bytes === "%PDF-") return "pdf";
  if (/facebook\.com|fb\.com/iu.test(url)) return "facebook";
  if (/youtube\.com|youtu\.be/iu.test(url)) return "youtube";
  return "html";
}
