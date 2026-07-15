import test from "node:test";
import assert from "node:assert/strict";
import { loadVeriStrataArticle } from "../../src/claim-foundry/veristrata/loadVeriStrataArticle.js";

test("loader builds portable input only from persisted VeriStrata data", async () => {
  const queries = [];
  const query = async (sql) => {
    queries.push(sql.replace(/\s+/g, " ").trim());
    if (sql.includes("FROM content WHERE")) return [{ content_id: 7, content_name: "Stored title",
      content_text: "A persisted article body long enough for Claim Foundry analysis.",
      url: "https://example.com/article", media_source: "Legacy Publisher", is_active: 1, is_retracted: 0 }];
    if (sql.includes("FROM content_authors")) return [
      { author_first_name: "Ada", author_middle_name: null, author_last_name: "Lovelace" },
      { author_first_name: "Ada", author_middle_name: null, author_last_name: "Lovelace" }];
    return [{ publisher_name: "Canonical Publisher" }];
  };
  const article = await loadVeriStrataArticle(query, 7);
  assert.equal(article.consumerContentRef, "veristrata:content:7");
  assert.equal(article.publisher, "Canonical Publisher");
  assert.deepEqual(article.authors, ["Ada Lovelace"]);
  assert.equal(article.metadataWarnings.length, 0);
  assert.equal(queries.some((sql) => /scrap|fetch|http/i.test(sql)), false);
});

test("loader refuses missing full text instead of scraping or using details", async () => {
  let calls = 0;
  const query = async () => { calls += 1; return [{ content_id: 8, content_name: "Title",
    content_text: null, details: "Truncated text" }]; };
  await assert.rejects(loadVeriStrataArticle(query, 8),
    (error) => error.code === "CF1_CONTENT_TEXT_UNAVAILABLE");
  assert.equal(calls, 1);
});

test("loader accepts only the content-bound persisted TextPad document fallback", async () => {
  let call = 0;
  const query = async () => {
    call += 1;
    if (call === 1) return [{ content_id: 12, content_name: "TextPad title", content_text: null,
      url: "assets/documents/tasks/content_id_12.txt", thumbnail: null }];
    return [];
  };
  let readPath;
  const article = await loadVeriStrataArticle(query, 12, { documentRoot: "/safe/tasks",
    readFile: async (file) => { readPath = file; return "Persisted TextPad article content for CF1 shadow analysis."; } });
  assert.equal(readPath, "/safe/tasks/content_id_12.txt");
  assert.match(article.text, /Persisted TextPad/);
  assert.equal(article.metadataWarnings.includes(
    "Article text was loaded from its persisted TextPad document."), true);
});

test("loader records incomplete metadata without inventing it", async () => {
  let call = 0;
  const query = async () => {
    call += 1;
    if (call === 1) return [{ content_id: 9, content_name: "Title",
      content_text: "This stored article has sufficient text for the shadow adapter.",
      url: "not a URL", media_source: null, is_active: 0, is_retracted: 1 }];
    return [];
  };
  const article = await loadVeriStrataArticle(query, 9);
  assert.equal(article.url, undefined);
  assert.equal(article.publisher, undefined);
  assert.deepEqual(article.authors, []);
  assert.equal(article.metadataWarnings.length, 5);
});
