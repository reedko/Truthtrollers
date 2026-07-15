#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateArticleInput } from "../../backend/src/claim-foundry/validateArticleInput.js";

const args = process.argv.slice(2);
const one = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const many = (flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);

function cleanPdfText(value) {
  const beforeReferences = value.split(/^\s*ACKNOWLEDGMENTS\s*$/m)[0];
  const lines = beforeReferences.replace(/\r/g, "").split("\n").filter((line) => {
    const text = line.trim();
    return !/^Downloaded from www\.aappublications\.org/.test(text)
      && !/^PEDIATRICS Vol\./.test(text)
      && !/^ARTICLES$/.test(text)
      && !/^\d{3}$/.test(text)
      && !/^\d{3}\s+MMR VACCINATION/.test(text);
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeHtml(value) {
  const named = { nbsp: " ", amp: "&", quot: '"', apos: "'", rsquo: "’",
    lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? match;
    const radix = code[1].toLowerCase() === "x" ? 16 : 10;
    return String.fromCodePoint(Number.parseInt(code.slice(radix === 16 ? 2 : 1), radix));
  });
}

function normalizeHtml(value) {
  return decodeHtml(value.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/blockquote)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanHtml(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("HTML fixture markers were not found in order");
  return normalizeHtml(value.slice(start, end));
}

function removeHtmlRegion(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("Removable HTML fixture region was not found in order");
  return value.slice(0, start) + value.slice(end);
}

function cleanChdArticle(value) {
  const startMarker = "<p>Glyphosate has remained";
  const endMarker = "<p><strong>Watch Antoniou on ‘The Corbett Report’ here:</strong></p>";
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("CHD article boundaries were not found in order");
  let article = value.slice(start, end);
  article = removeHtmlRegion(article, "<div class=\"chd-shortcode-wrap\">",
    "<p><strong>‘Industry hides behind confidentiality clauses’&nbsp;</strong></p>");
  article = removeHtmlRegion(article,
    "<div class=\"chd-shortcode-wrap chd-shortcode-wrap--donation-ask box-border\">",
    "<p><strong>Regulators’ safety claims ‘clearly ignored’ critical piece of biology</strong></p>");
  return normalizeHtml(article);
}

function cleanPlainHtmlParagraphs(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("HTML fixture markers were not found in order");
  return [...value.slice(start, end).matchAll(/<p>([\s\S]*?)<\/p>/gi)]
    .map((match) => match[1].split("<div")[0])
    .map((paragraph) => decodeHtml(paragraph.replace(/<[^>]+>/g, " ")))
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean).join("\n\n");
}

function cleanKiosqBlocks(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("HTML fixture markers were not found in order");
  return [...value.slice(start, end).matchAll(/<(p|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .filter((match) => /\bkiosq-b\b/.test(match[2]))
    .map((match) => decodeHtml(match[3].replace(/<[^>]+>/g, " ")))
    .map((block) => block.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
}

function cleanNextUrqlArticle(value) {
  const match = value.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Next.js article payload was not found");
  const state = JSON.parse(match[1]).props?.pageProps?.urqlState ?? {};
  let article;
  for (const entry of Object.values(state)) {
    const data = typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
    if (data?.article?.title && Array.isArray(data.article.content)) article = data.article;
  }
  if (!article) throw new Error("Structured article content was not found");
  return article.content.filter((item) => item.__typename === "ArticleParagraphContent")
    .map((item) => decodeHtml(String(item.innerHtml ?? "")
    .replace(/<(?:br|\/p|\/h[1-6])>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n\n");
}

const source = one("--source");
const output = one("--output");
if (!source || !output || !one("--title")) {
  console.error("Usage: cf1_freeze_text_fixture.mjs --source text --output article.json --title title [metadata flags]");
  process.exitCode = 2;
} else {
  const raw = await readFile(resolve(source), "utf8");
  const format = one("--format");
  const text = format === "html" ? cleanHtml(raw, one("--start-marker"), one("--end-marker"))
    : format === "html-chd-article" ? cleanChdArticle(raw)
    : format === "html-plain-paragraphs"
      ? cleanPlainHtmlParagraphs(raw, one("--start-marker"), one("--end-marker"))
    : format === "html-kiosq-blocks"
      ? cleanKiosqBlocks(raw, one("--start-marker"), one("--end-marker"))
    : format === "next-urql-article" ? cleanNextUrqlArticle(raw) : cleanPdfText(raw);
  const article = validateArticleInput({ title: one("--title"), text, authors: many("--author"),
    publisher: one("--publisher"), publishedAt: one("--published-at"), url: one("--url"),
    language: one("--language") ?? "en", metadataWarnings: many("--warning") });
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: target, contentHash: article.contentHash,
    textChars: article.text.length }, null, 2));
}
