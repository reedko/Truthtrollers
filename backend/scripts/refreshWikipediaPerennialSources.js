#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

export const PERENNIAL_PAGE_TITLE = "Wikipedia:Reliable sources/Perennial sources";
export const PERENNIAL_PARSER_VERSION = "wikipedia-perennial-html-v1";
const API_URL = "https://en.wikipedia.org/w/api.php";
const CLASSIFICATION_BY_CLASS = Object.freeze({
  "s-gr": "generally reliable",
  "s-nc": "no consensus",
  "s-m": "no consensus",
  "s-gu": "generally unreliable",
  "s-d": "deprecated",
  "s-b": "blacklisted",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanText(value) {
  return String(value || "").replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function absoluteWikipediaUrl(value) {
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://en.wikipedia.org${value}`;
  return value;
}

function plausibleDomain(value) {
  const normalized = String(value || "").toLowerCase().replace(/^www\./u, "").replace(/[),.;:'"]+$/u, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(normalized)) return null;
  if (/^(?:en\.)?wikipedia\.org$|wikimedia\.org$/u.test(normalized)) return null;
  return normalized;
}

function domainsFromRow($, row) {
  const domains = new Set();
  const sourceCell = $(row).children("th,td").first();
  sourceCell.find("a[href]").each((_, link) => {
    const href = $(link).attr("href") || "";
    if (!/^https?:\/\//iu.test(href) || /wikipedia\.org|wikimedia\.org/iu.test(href)) return;
    try {
      const domain = plausibleDomain(new URL(href).hostname);
      if (domain) domains.add(domain);
    } catch {}
  });
  $(row).find("a[href]").each((_, link) => {
    const href = $(link).attr("href") || "";
    if (/insource(?:%3A|:)/iu.test(href)) {
      let decoded = href;
      try { decoded = decodeURIComponent(href); } catch {}
      for (const candidate of decoded.match(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/giu) || []) {
        const domain = plausibleDomain(candidate);
        if (domain) domains.add(domain);
      }
    }
  });
  return [...domains].sort();
}

function sourceAliases($, sourceCell, displayName, rowId) {
  const aliases = new Set([displayName, rowId.replace(/_/gu, " ")].filter(Boolean));
  $(sourceCell).find("a[href]").each((_, link) => {
    const href = $(link).attr("href") || "";
    const text = cleanText($(link).text());
    const title = cleanText($(link).attr("title"));
    if (/\/wiki\/Wikipedia:/iu.test(href) || /^WP:/iu.test(text)) return;
    if (text) aliases.add(text);
    if (title && !/^Wikipedia:/iu.test(title)) aliases.add(title);
  });
  return [...aliases].filter((value) => value.length >= 2).sort((a, b) => a.localeCompare(b));
}

export function parsePerennialSourcesHtml(html, { revisionId, revisionTimestamp, revisionSha1 } = {}) {
  const $ = cheerio.load(String(html || ""));
  const entries = [];
  $("tr[class]").each((_, row) => {
    const rowClasses = String($(row).attr("class") || "").split(/\s+/u);
    const sourceClass = rowClasses.find((value) => CLASSIFICATION_BY_CLASS[value]);
    if (!sourceClass) return;
    const cells = $(row).children("th,td");
    if (cells.length < 5) return;
    const sourceCell = cells.eq(0);
    const sourceClone = sourceCell.clone();
    sourceClone.find(".wp-rsp-sc,sup").remove();
    const displayName = cleanText(sourceClone.text());
    if (!displayName) return;
    const rowId = cleanText($(row).attr("id")) || displayName.replace(/\s+/gu, "_");
    const summary = cleanText(cells.eq(4).text());
    const discussions = cells.eq(2).find("a[href]").map((__, link) => absoluteWikipediaUrl($(link).attr("href"))).get().filter(Boolean);
    const useLinks = cells.eq(5).find("a[href]").map((__, link) => absoluteWikipediaUrl($(link).attr("href"))).get().filter(Boolean);
    entries.push({
      entryId: rowId,
      name: displayName,
      aliases: sourceAliases($, sourceCell, displayName, rowId),
      domains: domainsFromRow($, row),
      classification: CLASSIFICATION_BY_CLASS[sourceClass],
      rawClassification: cleanText(cells.eq(1).find("a[title]").first().attr("title")) || CLASSIFICATION_BY_CLASS[sourceClass],
      sourceClass,
      scopeAndSummary: summary,
      discussionUrls: [...new Set(discussions)],
      useUrls: [...new Set(useLinks)],
      evidenceUrl: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(PERENNIAL_PAGE_TITLE)}&oldid=${revisionId || ""}#${encodeURIComponent(rowId)}`,
    });
  });
  entries.sort((a, b) => a.entryId.localeCompare(b.entryId));
  const entriesHash = sha256(`${JSON.stringify(entries)}\n`);
  return {
    schemaVersion: "veristrata.wikipedia_perennial_sources.v1",
    provider: "wikipedia_perennial_sources",
    sourceTitle: PERENNIAL_PAGE_TITLE,
    sourceUrl: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(PERENNIAL_PAGE_TITLE)}&oldid=${revisionId || ""}`,
    revisionId: Number(revisionId),
    revisionTimestamp: revisionTimestamp || null,
    revisionSha1: revisionSha1 || null,
    parserVersion: PERENNIAL_PARSER_VERSION,
    rawHtmlSha256: sha256(String(html || "")),
    entriesSha256: entriesHash,
    entryCount: entries.length,
    classifications: Object.fromEntries(Object.values(CLASSIFICATION_BY_CLASS).map((classification) => [classification, entries.filter((entry) => entry.classification === classification).length])),
    license: "Wikipedia text is available under CC BY-SA 4.0; see the pinned source revision for attribution and terms.",
    entries,
  };
}

async function fetchRevision(revisionId = null) {
  const parseUrl = new URL(API_URL);
  parseUrl.search = new URLSearchParams({
    action: "parse",
    ...(revisionId ? { oldid: String(revisionId) } : { page: PERENNIAL_PAGE_TITLE }),
    prop: "text|revid",
    formatversion: "2",
    format: "json",
  });
  const headers = { "User-Agent": "VeriStrata/1.0 (SourceCrest perennial-source snapshot; contact@veristrata.com)" };
  const parseResponse = await fetch(parseUrl, { headers });
  if (!parseResponse.ok) throw new Error(`Wikipedia parse API HTTP ${parseResponse.status}`);
  const parsed = await parseResponse.json();
  if (!parsed?.parse?.revid || !parsed?.parse?.text) throw new Error("Wikipedia parse API returned no revision HTML");

  const metadataUrl = new URL(API_URL);
  metadataUrl.search = new URLSearchParams({
    action: "query",
    prop: "revisions",
    revids: String(parsed.parse.revid),
    rvprop: "ids|timestamp|sha1",
    formatversion: "2",
    format: "json",
  });
  const metadataResponse = await fetch(metadataUrl, { headers });
  if (!metadataResponse.ok) throw new Error(`Wikipedia revision API HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const revision = metadata?.query?.pages?.[0]?.revisions?.[0] || {};
  return {
    html: parsed.parse.text,
    revisionId: parsed.parse.revid,
    revisionTimestamp: revision.timestamp || null,
    revisionSha1: revision.sha1 || null,
  };
}

async function main() {
  const revisionArg = process.argv.find((value) => /^--revision=/u.test(value));
  const revisionId = revisionArg ? Number(revisionArg.split("=")[1]) : null;
  const fetched = await fetchRevision(revisionId);
  const dataset = parsePerennialSourcesHtml(fetched.html, fetched);
  if (dataset.entryCount < 400) throw new Error(`Perennial Sources parser retained only ${dataset.entryCount} entries`);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const output = path.resolve(scriptDir, "../services/sourceProviders/data", `wikipedia-perennial-sources.rev-${dataset.revisionId}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const serialized = `${JSON.stringify(dataset, null, 2)}\n`;
  let unchanged = false;
  try {
    await fs.writeFile(output, serialized, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(output, "utf8");
    if (existing !== serialized) {
      throw new Error(`Refusing to overwrite non-identical pinned snapshot ${output}`);
    }
    unchanged = true;
  }
  process.stdout.write(`${JSON.stringify({ output, revisionId: dataset.revisionId, entryCount: dataset.entryCount, rawHtmlSha256: dataset.rawHtmlSha256, entriesSha256: dataset.entriesSha256, unchanged }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
