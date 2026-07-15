import { CF1_LIMITS } from "./contract.js";
import { assertCf1, Cf1InputError } from "./errors.js";
import { hashArticleInput } from "./canonicalJson.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const BOILERPLATE_ONLY = /^(?:enable javascript(?: to continue)?|cookies? required|access denied|subscribe to continue|sign in to continue|loading)[.!\s]*$/i;

function normalizedString(value, field, { required = false, maximum } = {}) {
  if (value == null && !required) return undefined;
  assertCf1(typeof value === "string", "CF1_INVALID_FIELD_TYPE", `${field} must be a string`, { path: `/${field}` });
  const result = value.replace(/\r\n?/g, "\n").trim();
  assertCf1(!required || result.length > 0, "CF1_REQUIRED_FIELD_EMPTY", `${field} cannot be empty`, { path: `/${field}` });
  assertCf1(result.length <= maximum, "CF1_FIELD_TOO_LONG", `${field} exceeds ${maximum} characters`, { path: `/${field}` });
  return result;
}

function normalizedStringArray(value, field, { maximumItems, maximumChars, defaultValue } = {}) {
  const input = value ?? defaultValue;
  assertCf1(Array.isArray(input), "CF1_INVALID_FIELD_TYPE", `${field} must be an array`, { path: `/${field}` });
  assertCf1(input.length <= maximumItems, "CF1_TOO_MANY_ITEMS", `${field} exceeds ${maximumItems} items`, { path: `/${field}` });
  return input.map((entry, index) => normalizedString(entry, `${field}/${index}`, {
    required: true,
    maximum: maximumChars,
  }));
}

function normalizeUrl(value) {
  const result = normalizedString(value, "url", { maximum: CF1_LIMITS.urlChars });
  if (result === undefined) return undefined;
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Cf1InputError("CF1_INVALID_URL", "url must be an absolute HTTP(S) URL", { path: "/url" });
  }
  assertCf1(["http:", "https:"].includes(parsed.protocol), "CF1_INVALID_URL", "url must use HTTP or HTTPS", { path: "/url" });
  return result;
}

function normalizePublishedAt(value) {
  const result = normalizedString(value, "publishedAt", { maximum: CF1_LIMITS.publishedAtChars });
  if (result === undefined) return undefined;
  assertCf1(!Number.isNaN(Date.parse(result)), "CF1_INVALID_DATE", "publishedAt must be ISO-8601", { path: "/publishedAt" });
  assertCf1(/^\d{4}-\d{2}-\d{2}T/.test(result), "CF1_INVALID_DATE", "publishedAt must include an ISO-8601 date and time", { path: "/publishedAt" });
  return result;
}

export function validateArticleInput(input) {
  assertCf1(input && typeof input === "object" && !Array.isArray(input), "CF1_INVALID_ARTICLE", "article must be an object", { path: "/article" });

  const article = {
    title: normalizedString(input.title, "title", { required: true, maximum: CF1_LIMITS.titleChars }),
    text: normalizedString(input.text, "text", { required: true, maximum: CF1_LIMITS.articleTextChars }),
    authors: normalizedStringArray(input.authors, "authors", {
      maximumItems: CF1_LIMITS.authorCount,
      maximumChars: CF1_LIMITS.authorChars,
      defaultValue: [],
    }),
    metadataWarnings: normalizedStringArray(input.metadataWarnings, "metadataWarnings", {
      maximumItems: CF1_LIMITS.metadataWarningCount,
      maximumChars: CF1_LIMITS.metadataWarningChars,
      defaultValue: [],
    }),
  };

  assertCf1(!BOILERPLATE_ONLY.test(article.text), "CF1_ARTICLE_BOILERPLATE", "article text contains only access boilerplate", { path: "/text" });
  assertCf1(article.text.length >= CF1_LIMITS.minimumUsefulTextChars, "CF1_ARTICLE_TEXT_TOO_SHORT", "article text is too short to analyze", { path: "/text" });

  const optional = {
    consumerContentRef: normalizedString(input.consumerContentRef, "consumerContentRef", { maximum: CF1_LIMITS.consumerContentRefChars }),
    url: normalizeUrl(input.url),
    publisher: normalizedString(input.publisher, "publisher", { maximum: CF1_LIMITS.publisherChars }),
    publishedAt: normalizePublishedAt(input.publishedAt),
    language: normalizedString(input.language, "language", { maximum: CF1_LIMITS.languageChars }),
    observedHeadline: normalizedString(input.observedHeadline, "observedHeadline", { maximum: CF1_LIMITS.titleChars }),
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) article[key] = value;

  if (article.language) {
    assertCf1(LANGUAGE_PATTERN.test(article.language), "CF1_INVALID_LANGUAGE", "language must be a BCP-47 tag", { path: "/language" });
  }

  const calculatedHash = hashArticleInput(article);
  if (input.contentHash !== undefined) {
    assertCf1(typeof input.contentHash === "string" && HASH_PATTERN.test(input.contentHash), "CF1_INVALID_CONTENT_HASH", "contentHash must be lowercase SHA-256", { path: "/contentHash" });
    assertCf1(input.contentHash === calculatedHash, "CF1_CONTENT_HASH_MISMATCH", "contentHash does not match normalized title and text", { path: "/contentHash" });
  }
  article.contentHash = calculatedHash;
  Object.freeze(article.authors);
  Object.freeze(article.metadataWarnings);
  return Object.freeze(article);
}
