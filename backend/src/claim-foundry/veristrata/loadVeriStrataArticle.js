import { Cf1Error } from "../errors.js";
import { readFile as defaultReadFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_DOCUMENT_ROOT = path.join(BACKEND_ROOT, "assets/documents/tasks");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function authorName(row) {
  return clean([row.author_first_name, row.author_middle_name, row.author_last_name]
    .filter(Boolean).join(" "));
}

function safeUrl(value, warnings) {
  const url = clean(value);
  if (!url) return undefined;
  try {
    if (["http:", "https:"].includes(new URL(url).protocol)) return url;
  } catch { /* warning below */ }
  warnings.push("Stored URL was omitted because it is not an absolute HTTP(S) URL.");
  return undefined;
}

async function persistedText(content, contentId, { readFile, documentRoot }) {
  const databaseText = clean(content.content_text);
  if (databaseText) return { text: databaseText, warning: null };
  const expectedName = `content_id_${contentId}.txt`;
  const expectedRef = `assets/documents/tasks/${expectedName}`;
  if (![clean(content.url), clean(content.thumbnail)].includes(expectedRef)) return null;
  const root = path.resolve(documentRoot);
  const file = path.resolve(root, expectedName);
  if (path.dirname(file) !== root) return null;
  try {
    const text = clean(await readFile(file, "utf8"));
    return text ? { text, warning: "Article text was loaded from its persisted TextPad document." } : null;
  } catch (cause) {
    throw new Cf1Error("CF1_CONTENT_DOCUMENT_UNAVAILABLE",
      "Persisted TextPad document could not be read", { status: 422, cause });
  }
}

export async function loadVeriStrataArticle(query, contentId, options = {}) {
  if (typeof query !== "function") throw new TypeError("VeriStrata article loader requires query()");
  if (!Number.isInteger(contentId) || contentId <= 0) {
    throw new Cf1Error("CF1_INVALID_CONTENT_ID", "contentId must be a positive integer", { status: 400 });
  }
  const content = (await query(`SELECT content_id, content_name, content_text, url, thumbnail,
    media_source, is_active, is_retracted FROM content WHERE content_id = ? LIMIT 1`, [contentId]))[0];
  if (!content) throw new Cf1Error("CF1_CONTENT_NOT_FOUND", "VeriStrata content was not found", { status: 404 });
  const title = clean(content.content_name);
  if (!title) throw new Cf1Error("CF1_CONTENT_TITLE_UNAVAILABLE", "Stored content has no title", { status: 422 });
  const stored = await persistedText(content, contentId, {
    readFile: options.readFile ?? defaultReadFile,
    documentRoot: options.documentRoot ?? DEFAULT_DOCUMENT_ROOT,
  });
  if (!stored) throw new Cf1Error("CF1_CONTENT_TEXT_UNAVAILABLE",
    "Stored content has no full content_text; shadow mode never re-scrapes or uses the truncated details field", { status: 422 });

  const authorRows = await query(`SELECT a.author_first_name, a.author_middle_name, a.author_last_name
    FROM content_authors ca INNER JOIN authors a ON a.author_id = ca.author_id
    WHERE ca.content_id = ? ORDER BY a.author_id`, [contentId]);
  const publisherRows = await query(`SELECT p.publisher_name FROM content_publishers cp
    INNER JOIN publishers p ON p.publisher_id = cp.publisher_id
    WHERE cp.content_id = ? ORDER BY p.publisher_id`, [contentId]);
  const warnings = [];
  if (stored.warning) warnings.push(stored.warning);
  const allAuthors = [...new Set(authorRows.map(authorName).filter(Boolean))];
  if (!allAuthors.length) warnings.push("No persisted authors were available.");
  if (allAuthors.length > 20) warnings.push("Persisted author list was limited to the first 20 names.");
  const publisher = clean(publisherRows[0]?.publisher_name) || clean(content.media_source);
  if (!publisher) warnings.push("No persisted publisher was available.");
  if (content.is_active === 0) warnings.push("The bound VeriStrata content is inactive.");
  if (content.is_retracted === 1) warnings.push("The bound VeriStrata content is marked retracted.");
  const url = safeUrl(content.url, warnings);
  return { consumerContentRef: `veristrata:content:${contentId}`, title, text: stored.text,
    ...(url ? { url } : {}), ...(publisher ? { publisher: publisher.slice(0, 500) } : {}),
    authors: allAuthors.slice(0, 20), metadataWarnings: warnings };
}
