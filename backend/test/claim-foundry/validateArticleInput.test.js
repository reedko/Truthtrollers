import test from "node:test";
import assert from "node:assert/strict";
import { hashArticleInput } from "../../src/claim-foundry/canonicalJson.js";
import { Cf1InputError } from "../../src/claim-foundry/errors.js";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";

const ARTICLE_TEXT = "The city audit found a two-year repair delay. Officials disputed who caused it.";

function validInput(overrides = {}) {
  return {
    consumerContentRef: "article-1",
    title: "  Audit Findings\r\n",
    text: `  ${ARTICLE_TEXT}\r\n`,
    url: "https://example.test/audit",
    publisher: "Example News",
    authors: ["Alex Rivera"],
    publishedAt: "2026-07-13T10:00:00Z",
    language: "en-US",
    observedHeadline: "Audit Findings",
    metadataWarnings: [],
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof Cf1InputError && error.code === code);
}

test("valid input is normalized and receives its deterministic content hash", () => {
  const article = validateArticleInput(validInput());
  assert.equal(article.title, "Audit Findings");
  assert.equal(article.text, ARTICLE_TEXT);
  assert.equal(article.contentHash, hashArticleInput({ title: "Audit Findings", text: ARTICLE_TEXT }));
  assert.ok(Object.isFrozen(article));
  assert.ok(Object.isFrozen(article.authors));
});

test("authors and metadata warnings default to empty portable arrays", () => {
  const input = validInput();
  delete input.authors;
  delete input.metadataWarnings;
  const article = validateArticleInput(input);
  assert.deepEqual(article.authors, []);
  assert.deepEqual(article.metadataWarnings, []);
});

test("matching supplied hashes are accepted and mismatches are rejected", () => {
  const normalized = validateArticleInput(validInput());
  assert.equal(validateArticleInput(validInput({ contentHash: normalized.contentHash })).contentHash, normalized.contentHash);
  expectCode(() => validateArticleInput(validInput({ contentHash: "a".repeat(64) })), "CF1_CONTENT_HASH_MISMATCH");
  expectCode(() => validateArticleInput(validInput({ contentHash: "INVALID" })), "CF1_INVALID_CONTENT_HASH");
});

test("invalid URLs, dates, and language tags fail with stable codes", () => {
  expectCode(() => validateArticleInput(validInput({ url: "file:///tmp/article" })), "CF1_INVALID_URL");
  expectCode(() => validateArticleInput(validInput({ publishedAt: "yesterday" })), "CF1_INVALID_DATE");
  expectCode(() => validateArticleInput(validInput({ language: "not a valid tag" })), "CF1_INVALID_LANGUAGE");
});

test("empty, tiny, boilerplate, and oversized inputs are blocked", () => {
  expectCode(() => validateArticleInput(validInput({ text: "" })), "CF1_REQUIRED_FIELD_EMPTY");
  expectCode(() => validateArticleInput(validInput({ text: "A short notice." })), "CF1_ARTICLE_TEXT_TOO_SHORT");
  expectCode(() => validateArticleInput(validInput({ text: "Enable JavaScript to continue." })), "CF1_ARTICLE_BOILERPLATE");
  expectCode(() => validateArticleInput(validInput({ text: "x".repeat(500_001) })), "CF1_FIELD_TOO_LONG");
});

test("consumer references and warnings do not affect content identity", () => {
  const first = validateArticleInput(validInput());
  const second = validateArticleInput(validInput({
    consumerContentRef: "different",
    metadataWarnings: ["metadata uncertain"],
  }));
  assert.equal(first.contentHash, second.contentHash);
});
