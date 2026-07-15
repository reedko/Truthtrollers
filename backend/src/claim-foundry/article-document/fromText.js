import { buildArticleDocument } from "./buildArticleDocument.js";
import { resolveHttpUrl } from "./links.js";
import { resolveStructureProfile } from "./defaultProfiles.js";

const ADAPTER_IDENTITY = Object.freeze({ adapterId: "cf1.adapter.text-structure", adapterVersion: "2" });

const LIST = /^\s*(?:[-*+•] |\d+[.)] )/;
const URL = /https?:\/\/[^\s<>"']+/gi;
const SEPARATOR = /^[\s\-—–_=*•·]{3,}$/;

function visibleLinks(text) {
  return [...text.matchAll(URL)].map((match) => ({
    url: resolveHttpUrl(match[0].replace(/[.,;:!?)]+$/, "")),
    anchorText: match[0], classification: "unclassified", diagnosticFlags: ["visible_url"],
  })).filter((link) => link.url);
}

function cleanedLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function draftAtomsForChunk(chunk) {
  const lines = cleanedLines(chunk);
  if (!lines.length) return [];
  const markdownHeading = lines.length === 1 && /^#{1,6}\s+/.test(lines[0]);
  const quote = lines.every((line) => /^(?:>|[“"])/.test(line));
  const list = lines.every((line) => LIST.test(line));
  const table = lines.length > 1 && lines.every((line) => line.includes("|") || line.includes("\t"));
  const separator = lines.length === 1 && SEPARATOR.test(lines[0]);
  const words = lines.length === 1 ? lines[0].match(/[\p{L}\p{N}]+/gu) ?? [] : [];
  const letters = (lines[0] ?? "").replace(/[^\p{L}]/gu, "");
  const allCapsLabel = letters.length >= 5 && letters === letters.toUpperCase();
  const terminalPunctuation = /[,.!?;:…][”"'’)]?$/.test(lines[0] ?? "");
  const disallowedHeadingStart = /^(?:[>“"'‘—–-]|[-*+•]\s)/.test(lines[0] ?? "");
  const heading = markdownHeading || (lines.length === 1 && lines[0].length <= 140
    && !disallowedHeadingStart && !LIST.test(lines[0]) && !separator
    && (allCapsLabel || (words.length >= 3 && !terminalPunctuation)));
  if (list) return lines.map((line) => atom("list_item", line));
  if (table) return lines.map((line) => atom("table_row", line));
  if (separator) return [atom("separator", lines[0])];
  const text = lines.join("\n").replace(/^#{1,6}\s+/, "");
  return [atom(quote ? "quotation" : heading ? "heading" : "paragraph", text, {
    headingLevel: markdownHeading ? lines[0].match(/^#+/)?.[0].length : null,
  })];
}

function atom(type, text, layoutSignals = {}) {
  return { type, text, layoutSignals, links: visibleLinks(text), diagnosticFlags: [] };
}

export function articleDocumentFromText({ text, metadata = {}, sourceDescriptor = {},
  sourceFamily = "plain_text", structureProfile } = {}) {
  const normalized = String(text ?? "").normalize("NFC").replace(/\r\n?/g, "\n");
  const chunks = normalized.split(/\n[ \t]*\n+/).filter((chunk) => chunk.trim());
  const draftAtoms = chunks.flatMap(draftAtomsForChunk);
  const visibleUrlCount = draftAtoms.reduce((count, item) => count + item.links.length, 0);
  const internalLineBreaks = chunks.reduce((count, chunk) => count + Math.max(0, cleanedLines(chunk).length - 1), 0);
  const profile = resolveStructureProfile(sourceFamily, structureProfile);
  return buildArticleDocument({ sourceKind: "text", sourceFamily, adapterIdentity: ADAPTER_IDENTITY,
    structureProfile: profile, draftAtoms, metadata, sourceDescriptor,
    diagnostics: { adapter: "text", inputCharacters: normalized.length,
      paragraphGroups: chunks.length, retainedInternalLineBreaks: internalLineBreaks,
      layoutMode: "text_only", linkCoverage: { visibleUrlCount,
        annotationLinkCount: 0, unattachedAnnotationLinkCount: 0,
        attachmentMode: "visible_text_only", sourceAnnotationsAvailable: false } } });
}
