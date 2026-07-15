import * as cheerio from "cheerio";
import { buildArticleDocument } from "./buildArticleDocument.js";
import { resolveHttpUrl } from "./links.js";
import { resolveStructureProfile } from "./defaultProfiles.js";
import { extractHtmlBibliographicMetadata } from "./htmlBibliographicMetadata.js";

const ADAPTER_IDENTITY = Object.freeze({ adapterId: "cf1.adapter.html-dom", adapterVersion: "2" });

const ROOT_SELECTORS = [
  "article", "[data-cy='article-content']", ".article-body", ".article__content",
  ".entry-content", ".post-content", ".story-body", ".rich-text", ".prose",
  "[role='main']", "main", "#content", ".content",
];
const JUNK = [
  "script:not([type='application/ld+json'])", "style", "noscript", "svg", "nav", "footer",
  "aside:not([role='doc-footnote']):not(.footnote):not(.endnote):not(.references)",
  "form", "button", "iframe", "canvas", ".comments", "#comments", ".related",
  ".recommended", ".share", ".social", ".newsletter", ".subscribe", ".outbrain",
  ".advert", ".advertisement", "[aria-hidden='true']", "[hidden]",
].join(",");

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

function candidateScore($, element) {
  const node = $(element).clone();
  node.find(JUNK).remove();
  const text = cleanText(node.text());
  const paragraphs = node.find("p").length;
  const headings = node.find("h1,h2,h3,h4,h5,h6").length;
  const junk = $(element).find(JUNK).length;
  return { text, score: text.length + paragraphs * 160 + headings * 100 - junk * 80 };
}

function selectRoot($) {
  let best = null;
  for (const selector of ROOT_SELECTORS) {
    $(selector).each((_, element) => {
      const scored = candidateScore($, element);
      if (scored.text.length < 200) return;
      if (!best || scored.score > best.score) best = { element, selector, ...scored };
    });
  }
  return best ?? { element: $("body").get(0) ?? $.root().get(0), selector: "body", score: 0 };
}

function offsetOf(text, needle, after = 0) {
  const found = text.indexOf(needle, after);
  return found >= 0 ? found : text.indexOf(needle);
}

function linkClassification($, anchor, url, inReference) {
  const context = `${$(anchor).attr("class") ?? ""} ${$(anchor).attr("rel") ?? ""} ${$(anchor).text()}`;
  if (/\b(?:share|social|login|sign.?in|subscribe|advert)/i.test(context)) return "non_retrieval";
  if (/doi\.org\/|pubmed\.ncbi\.nlm\.nih\.gov\//i.test(url)) return "identifier";
  return inReference ? "reference_link" : "content_link";
}

function linksWithin($, element, baseUrl, text, inReference) {
  const results = [];
  let cursor = 0;
  $(element).find("a[href]").addBack("a[href]").each((_, anchor) => {
    const originalHref = String($(anchor).attr("href") ?? "").trim();
    if (originalHref.startsWith("#")) return;
    const url = resolveHttpUrl(originalHref, baseUrl);
    if (!url) return;
    const anchorText = cleanText($(anchor).text());
    const startOffset = anchorText ? offsetOf(text, anchorText, cursor) : -1;
    if (startOffset >= 0) cursor = startOffset + anchorText.length;
    results.push({ url, originalHref, anchorText,
      startOffset: startOffset >= 0 ? startOffset : null,
      endOffset: startOffset >= 0 ? startOffset + anchorText.length : null,
      relation: inReference ? "reference_entry" : "inline_link",
      classification: linkClassification($, anchor, url, inReference), diagnosticFlags: [] });
  });
  return results;
}

function elementKey($, element) {
  return $(element).attr("id") || $(element).attr("name") || null;
}

function referenceContext($, element, inReferenceSection) {
  if (inReferenceSection) return true;
  const ancestry = $(element).parents().addBack().map((_, node) =>
    `${$(node).attr("id") ?? ""} ${$(node).attr("class") ?? ""} ${$(node).attr("role") ?? ""}`).get().join(" ");
  return /\b(?:references?|bibliography|footnotes?|endnotes?|doc-footnote)\b/i.test(ancestry);
}

function markerCandidates($, element, text) {
  const markers = [];
  const candidates = $(element).find("sup, a[href^='#']").toArray();
  candidates.forEach((node, candidateIndex) => {
    if (node.name === "a" && $(node).parents("sup").length) return;
    if (node.name === "sup" && $(node).parents("a[href^='#']").length) return;
    const displayText = cleanText($(node).text());
    if (!displayText || !/^(?:\[?\d+(?:\s*[-,–]\s*\d+)*\]?|[A-Z][A-Za-z-]+(?: et al\.)?,?\s*\d{4})$/.test(displayText)) return;
    const anchor = node.name === "a" ? $(node) : $(node).find("a[href^='#']").first();
    const href = String(anchor.attr("href") ?? "");
    const clone = $(element).clone();
    const cloneNode = clone.find("sup, a[href^='#']").get(candidateIndex);
    const sentinel = "\uE000";
    if (cloneNode) $(cloneNode).prepend(sentinel);
    const markedText = cleanText(clone.text());
    const startOffset = markedText.indexOf(sentinel);
    markers.push({ displayText, kind: node.name === "sup" || $(node).find("sup").length ? "superscript"
      : /^\[?\d/.test(displayText) ? "numeric" : "author_year",
    startOffset: Math.max(0, startOffset), endOffset: Math.max(0, startOffset) + displayText.length,
    targetFragment: href.startsWith("#") ? href.slice(1) : null, diagnosticFlags: [] });
  });
  for (const match of text.matchAll(/\(([A-Z][A-Za-z-]+(?: et al\.)?,\s*(?:19|20)\d{2})\)/g)) {
    if (markers.some((item) => item.startOffset === match.index + 1)) continue;
    markers.push({ displayText: match[1], kind: "author_year", startOffset: match.index + 1,
      endOffset: match.index + 1 + match[1].length, targetFragment: null,
      diagnosticFlags: ["unresolved_author_year"] });
  }
  return markers;
}

function referenceCandidate($, element, text, inReference) {
  if (!inReference) return null;
  const key = elementKey($, element);
  const label = key?.match(/(?:ref|note|fn)[-_]?(\d+)/i)?.[1]
    ?? text.match(/^\s*\[?(\d{1,4})[\].)]?\s+/)?.[1] ?? null;
  const backlinkTargets = $(element).find("a[href^='#']").map((_, anchor) =>
    String($(anchor).attr("href") ?? "").slice(1)).get().filter(Boolean);
  return { label, elementKeys: [key].filter(Boolean), backlinkTargets, diagnosticFlags: [] };
}

function atomFor($, element, baseUrl, pendingSeparator, inReferenceSection) {
  const tag = String(element.name || "").toLowerCase();
  const text = tag === "tr" ? $(element).find("th,td").map((_, cell) => cleanText($(cell).text()))
    .get().filter(Boolean).join(" | ") : cleanText($(element).text());
  if (!text) return null;
  const heading = /^h[1-6]$/.test(tag);
  const boldText = cleanText($(element).find("strong,b").text());
  const type = heading ? "heading" : tag === "blockquote" ? "quotation"
    : tag === "li" ? "list_item" : tag === "figcaption" ? "caption"
      : tag === "pre" ? "code_or_preformatted" : tag === "tr" ? "table_row" : "paragraph";
  const inReference = referenceContext($, element, inReferenceSection);
  return { type, text, links: linksWithin($, element, baseUrl, text, inReference),
    citationMarkers: inReference ? [] : markerCandidates($, element, text),
    referenceCandidate: referenceCandidate($, element, text, inReference), diagnosticFlags: [],
    layoutSignals: { htmlTag: tag, headingLevel: heading ? Number(tag[1]) : null,
      boldProportion: text.length ? Math.min(1, boldText.length / text.length) : 0,
      separatorBefore: pendingSeparator } };
}

function extractAtoms($, root, baseUrl) {
  const atoms = [];
  let pendingSeparator = false;
  let inReferenceSection = false;
  const visit = (element) => {
    if (element.type !== "tag") return;
    const tag = String(element.name || "").toLowerCase();
    if (tag === "hr") { pendingSeparator = true; return; }
    if (tag === "table") {
      $(element).find("tr").each((_, row) => {
        const draft = atomFor($, row, baseUrl, pendingSeparator, inReferenceSection);
        if (draft) atoms.push(draft);
        pendingSeparator = false;
      });
      return;
    }
    if (/^h[1-6]$/.test(tag) || ["p", "li", "blockquote", "figcaption", "pre"].includes(tag)) {
      const draft = atomFor($, element, baseUrl, pendingSeparator, inReferenceSection);
      if (draft) atoms.push(draft);
      if (/^h[1-6]$/.test(tag)) {
        inReferenceSection = /^(?:references?|bibliography|footnotes?|endnotes?|notes)$/i.test(draft?.text ?? "");
      }
      pendingSeparator = false;
      return;
    }
    for (const child of element.children ?? []) visit(child);
  };
  visit(root);
  return atoms;
}

export function articleDocumentFromHtml({ html, url, metadata = {}, sourceDescriptor = {},
  sourceFamily = "article", structureProfile } = {}) {
  const input = String(html ?? "");
  const $ = cheerio.load(input);
  const bibliographicMetadata = extractHtmlBibliographicMetadata($);
  const selected = selectRoot($);
  const root = $(selected.element).clone();
  const removedElements = root.find(JUNK).length;
  root.find(JUNK).remove();
  const draftAtoms = extractAtoms($, root.get(0), url);
  if (!draftAtoms.length && cleanText(root.text())) {
    draftAtoms.push({ type: "paragraph", text: cleanText(root.text()),
      links: linksWithin($, root.get(0), url, cleanText(root.text()), false),
      citationMarkers: [], referenceCandidate: null,
      diagnosticFlags: ["html_unstructured_fallback"],
      layoutSignals: { htmlTag: String(root.get(0)?.name || "unknown"), headingLevel: null,
        boldProportion: 0, separatorBefore: false } });
  }
  const profile = resolveStructureProfile(sourceFamily, structureProfile);
  return buildArticleDocument({ sourceKind: "html", sourceFamily, adapterIdentity: ADAPTER_IDENTITY,
    structureProfile: profile, draftAtoms,
    metadata: { ...metadata, title: metadata.title || bibliographicMetadata.title,
      bibliographicMetadata },
    sourceDescriptor: { ...sourceDescriptor, ...(url ? { url } : {}) },
    diagnostics: { adapter: "html", selectedRoot: selected.selector,
      selectedRootScore: selected.score, removedElements, inputCharacters: input.length,
      layoutMode: "dom_structure" } });
}
