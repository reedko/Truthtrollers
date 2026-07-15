import pdfParseDefault from "pdf-parse/lib/pdf-parse.js";
import { buildArticleDocument } from "./buildArticleDocument.js";
import { resolveHttpUrl } from "./links.js";
import { resolveStructureProfile } from "./defaultProfiles.js";

const ADAPTER_IDENTITY = Object.freeze({ adapterId: "cf1.adapter.pdf-layout", adapterVersion: "2" });

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};
const itemX = (item) => Number(item.transform?.[4] ?? item.x ?? 0);
const itemY = (item) => Number(item.transform?.[5] ?? item.y ?? 0);
const itemFontSize = (item) => Math.hypot(Number(item.transform?.[2] ?? 0), Number(item.transform?.[3] ?? 0))
  || Math.hypot(Number(item.transform?.[0] ?? 0), Number(item.transform?.[1] ?? 0)) || Number(item.height ?? 0);
const normalizedRepeat = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function representativeBodyFont(lines) {
  const counts = new Map();
  for (const line of lines) {
    const size = Math.round(line.fontSize * 10) / 10;
    if (size > 0) counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const minimumCount = Math.max(6, Math.ceil(lines.length * 0.04));
  const recurringSizes = [...counts].filter(([, count]) => count >= minimumCount)
    .map(([size]) => size);
  return recurringSizes.length ? Math.max(...recurringSizes) : median(lines.map((line) => line.fontSize));
}

function pageLines(page) {
  const groups = [];
  const items = (page.items ?? []).filter((item) => String(item.str ?? "").trim());
  for (const item of items) {
    const y = itemY(item);
    const current = groups.at(-1);
    if (!current || Math.abs(current.y - y) > 2) groups.push({ y, items: [item] });
    else current.items.push(item);
  }
  return groups.map((line) => {
    const orderedItems = [...line.items].sort((a, b) => itemX(a) - itemX(b));
    const gaps = orderedItems.slice(1).map((item, index) => itemX(item)
      - itemX(orderedItems[index]) - Number(orderedItems[index].width ?? 0));
    return { pageNumber: page.pageNumber, y: line.y, text: line.items.map((item) => item.str).join(" ")
      .replace(/\s+/g, " ").trim(), x: Math.min(...line.items.map(itemX)),
    fontSize: median(line.items.map(itemFontSize)), fontNames: [...new Set(line.items.map((item) => item.fontName).filter(Boolean))],
    columnGapCount: gaps.filter((gap) => gap > 30).length };
  }).filter((line) => line.text);
}

function repeatedEdgeText(pages) {
  const counts = new Map();
  for (const lines of pages) {
    const byPagePosition = [...lines].sort((a, b) => b.y - a.y);
    const top = byPagePosition[0]?.y;
    const bottom = byPagePosition.at(-1)?.y;
    const edge = byPagePosition.filter((line) => line.y >= top - 20 || line.y <= bottom + 20);
    for (const key of new Set(edge.filter((line) => line.text.length <= 160)
      .map((line) => normalizedRepeat(line.text)).filter(Boolean))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.3));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([key]) => key));
}

function lineLinks(page, line) {
  const annotationLinks = (page.annotations ?? []).filter((annotation) => annotation.url
    && Array.isArray(annotation.rect)
    && line.y >= Math.min(annotation.rect[1], annotation.rect[3])
    && line.y <= Math.max(annotation.rect[1], annotation.rect[3])).map((annotation) => ({
    url: resolveHttpUrl(annotation.url), anchorText: "", classification: "unclassified",
    diagnosticFlags: ["pdf_annotation", "line_proximity"],
  })).filter((link) => link.url);
  const visibleLinks = [...line.text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => ({
    url: resolveHttpUrl(match[0].replace(/[.,;:!?)]+$/, "")), anchorText: match[0],
    classification: "unclassified", diagnosticFlags: ["visible_url"],
  })).filter((link) => link.url);
  return [...annotationLinks, ...visibleLinks];
}

function linesToAtoms(pages) {
  const atoms = [];
  const pageGroups = pages.map(pageLines);
  const repeated = repeatedEdgeText(pageGroups);
  let removedRepeatedLines = 0;
  let dehyphenatedLines = 0;
  let suspectedColumnLines = 0;
  let pageProximityLinkCount = 0;
  const documentBodyFont = representativeBodyFont(pageGroups.flat()) || 1;
  for (const [pageIndex, originalLines] of pageGroups.entries()) {
    const lines = originalLines.filter((line) => {
      const remove = repeated.has(normalizedRepeat(line.text));
      if (remove) removedRepeatedLines += 1;
      return !remove;
    });
    const fontMedian = Math.max(representativeBodyFont(lines) || 1, documentBodyFont);
    const gaps = lines.slice(1).map((line, index) => Math.abs(lines[index].y - line.y));
    const normalGap = median(gaps.filter((gap) => gap > 0)) || fontMedian;
    let current = null;
    const flush = () => { if (current?.text) atoms.push(current); current = null; };
    for (const [index, line] of lines.entries()) {
      if (line.columnGapCount) suspectedColumnLines += 1;
      const nextGap = index < lines.length - 1 ? Math.abs(line.y - lines[index + 1].y) : Infinity;
      const bold = line.fontNames.some((name) => /bold|black|heavy/i.test(name));
      const letters = line.text.replace(/[^A-Za-z]/g, "");
      const sectionLabel = letters.length >= 5 && line.text.length <= 100
        && letters === letters.toUpperCase();
      const statisticalCell = line.text.length <= 50 && /\d/.test(line.text)
        && /[%()[\]]/.test(line.text) && !/[.!?]$/.test(line.text);
      const heading = line.text.length >= 3 && line.text.length <= 180
        && !statisticalCell && (sectionLabel || line.fontSize >= fontMedian * 1.18 || bold)
        && !/[.!?]$/.test(line.text);
      const rowLike = line.columnGapCount >= 2 || statisticalCell;
      const layoutSignals = { pdfPage: line.pageNumber, fontSizeRatio: line.fontSize / fontMedian,
        bold: bold || null, x: line.x, y: line.y, verticalGapAfter: nextGap,
        columnGapCount: line.columnGapCount };
      if (heading || rowLike) {
        flush();
        atoms.push({ type: heading ? "heading" : "table_row", text: line.text, layoutSignals,
          links: lineLinks(pages[pageIndex], line), diagnosticFlags: [] });
        continue;
      }
      if (!current) current = { type: "paragraph", text: line.text, layoutSignals,
        links: lineLinks(pages[pageIndex], line), diagnosticFlags: [] };
      else {
        if (current.text.endsWith("-") && /^[a-z]/.test(line.text)) {
          current.text = current.text.slice(0, -1) + line.text;
          dehyphenatedLines += 1;
        } else current.text += ` ${line.text}`;
        for (const link of lineLinks(pages[pageIndex], line)) {
          if (!current.links.some((existing) => existing.url === link.url)) current.links.push(link);
        }
      }
      if (nextGap > normalGap * 1.45) flush();
    }
    flush();
    const pageAtoms = atoms.filter((atom) => atom.layoutSignals.pdfPage === pages[pageIndex].pageNumber);
    const firstAtom = pageAtoms[0];
    if (firstAtom) {
      for (const annotation of pages[pageIndex].annotations ?? []) {
        const url = resolveHttpUrl(annotation.url);
        if (url && !pageAtoms.some((atom) => atom.links.some((link) => link.url === url))) {
          firstAtom.links.push({ url, anchorText: "", classification: "unclassified",
            diagnosticFlags: ["pdf_annotation", "page_proximity"] });
          pageProximityLinkCount += 1;
        }
      }
    }
  }
  const annotationLinkCount = pages.reduce((count, page) => count
    + (page.annotations ?? []).filter((annotation) => resolveHttpUrl(annotation.url)).length, 0);
  const visibleUrlCount = atoms.reduce((count, item) => count
    + item.links.filter((link) => link.diagnosticFlags.includes("visible_url")).length, 0);
  return { atoms, diagnostics: { removedRepeatedLines, dehyphenatedLines,
    suspectedColumnLines, layoutMode: suspectedColumnLines ? "layout_with_column_warning" : "layout_items",
    linkCoverage: { visibleUrlCount, annotationLinkCount,
      unattachedAnnotationLinkCount: pageProximityLinkCount,
      attachmentMode: "line_or_page_proximity", sourceAnnotationsAvailable: true } } };
}

export async function extractPdfLayout(buffer, { pdfParse = pdfParseDefault } = {}) {
  const pages = [];
  const parsed = await pdfParse(buffer, { pagerender: async (pageData) => {
    const [content, annotations] = await Promise.all([
      pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }),
      typeof pageData.getAnnotations === "function" ? pageData.getAnnotations() : [],
    ]);
    pages.push({ pageNumber: Number(pageData.pageNumber ?? pages.length + 1),
      items: content.items.map((item) => ({ str: item.str, transform: item.transform,
        width: item.width, height: item.height, fontName: item.fontName, dir: item.dir })),
      annotations: annotations.map((item) => ({ url: item.url || item.unsafeUrl || null, rect: item.rect })) });
    return content.items.map((item) => item.str).join(" ");
  } });
  return { pages, metadata: { pdfInfo: parsed.info ?? {}, pageCount: parsed.numpages ?? pages.length } };
}

export function articleDocumentFromPdf({ pages, metadata = {}, sourceDescriptor = {},
  sourceFamily = "document", structureProfile } = {}) {
  const sourcePages = Array.isArray(pages) ? pages : [];
  const { atoms, diagnostics } = linesToAtoms(sourcePages);
  const profile = resolveStructureProfile(sourceFamily, structureProfile);
  return buildArticleDocument({ sourceKind: "pdf", sourceFamily, adapterIdentity: ADAPTER_IDENTITY,
    structureProfile: profile, draftAtoms: atoms, metadata,
    sourceDescriptor, diagnostics: { adapter: "pdf", pageCount: sourcePages.length, ...diagnostics } });
}
