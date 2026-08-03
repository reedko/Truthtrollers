import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fetchPdfBinaryWithFallbacks,
  findReferenceSectionStart,
  looksLikeGenuineArticleText,
} from "../../src/utils/fetchWithFallbacks.js";

test("looksLikeGenuineArticleText accepts ordinary prose", () => {
  const prose = Array.from({ length: 40 }, (_, i) =>
    `This is sentence number ${i} of a genuine article discussing the topic in some depth with varied wording.`
  ).join(" ");
  const result = looksLikeGenuineArticleText(prose);
  assert.equal(result.genuine, true);
  assert.ok(result.wordCount >= 80);
});

test("looksLikeGenuineArticleText rejects text below the minimum word count", () => {
  const result = looksLikeGenuineArticleText("Short snippet only.");
  assert.equal(result.genuine, false);
  assert.equal(result.reason, "below_min_word_count");
});

test("looksLikeGenuineArticleText rejects a nav-shell of short fragments", () => {
  const navShell = Array.from({ length: 40 }, (_, i) => `Menu Item ${i}.`).join(" ");
  const result = looksLikeGenuineArticleText(navShell);
  assert.equal(result.genuine, false);
  assert.equal(result.reason, "nav_shell_shape");
});

test("looksLikeGenuineArticleText rejects duplicated boilerplate fragments", () => {
  const boilerplate = "Please accept cookies to continue using this website and its services.";
  const text = Array.from({ length: 6 }, () => boilerplate).join(" ") +
    " " + "Filler word ".repeat(60);
  const result = looksLikeGenuineArticleText(text);
  assert.equal(result.genuine, false);
  assert.equal(result.reason, "duplicated_fragment");
});

test("duplicate citations in an explicit reference list do not reject valid article prose", () => {
  const body = Array.from({ length: 35 }, (_, index) =>
    `Finding ${index} describes a distinct measured result with enough explanatory article prose.`
  ).join("\n");
  const repeatedCitation = "Smith AB, Jones CD (2014). MMR vaccine efficacy across demographic groups. Retrieved 8 January 2011.";
  const text = `${body}\n\nReferences\n${Array.from({length:8}, () => repeatedCitation).join("\n")}`;
  const result = looksLikeGenuineArticleText(text);
  assert.equal(result.genuine, true);
  assert.equal(result.referenceSectionDetected, true);
  assert.equal(findReferenceSectionStart(text), text.indexOf("References"));
});

test("Wikipedia-style citation runs are recognized when Readability omits the heading", () => {
  const body = Array.from({ length: 35 }, (_, index) =>
    `Article paragraph ${index} explains a different part of the controversy in substantive prose.`
  ).join("\n");
  const citations = [
    '1 2 3 Smith AB (2014). "Measured vaccine outcome". Journal. PMID 12345678. Retrieved 8 January 2011.',
    '↑ Jones CD (2015). "Measured vaccine outcome". Journal. PMID 22345678. Retrieved 8 January 2011.',
    '↑ Lee EF (2016). "Measured vaccine outcome". Journal. PMID 32345678. Retrieved 8 January 2011.',
    '↑ Patel GH (2017). "Measured vaccine outcome". Journal. PMID 42345678. Retrieved 8 January 2011.',
    '↑ Garcia IJ (2018). "Measured vaccine outcome". Journal. PMID 52345678. Retrieved 8 January 2011.',
  ].join("\n");
  const text = `${body}\n${citations}`;
  const result = looksLikeGenuineArticleText(text);
  assert.equal(result.genuine, true);
  assert.equal(result.referenceSectionDetected, true);
  assert.equal(findReferenceSectionStart(text), text.indexOf("1 2 3 Smith"));
});

test("a reference list cannot hide duplicated boilerplate in the article body", () => {
  const repeatedBody = "Subscribe to continue reading this article and accept every tracking cookie.";
  const body = `${Array.from({length:6}, () => repeatedBody).join(" ")} ${"Distinct filler wording ".repeat(80)}`;
  const references = Array.from({length:5}, (_, index) =>
    `↑ Author ${index} (20${10 + index}). Study title. PMID 1234567${index}. Retrieved 8 January 2011.`
  ).join("\n");
  const result = looksLikeGenuineArticleText(`${body}\nReferences\n${references}`);
  assert.equal(result.genuine, false);
  assert.equal(result.reason, "duplicated_fragment");
  assert.equal(result.referenceSectionDetected, true);
});

test("looksLikeGenuineArticleText rejects empty text", () => {
  const result = looksLikeGenuineArticleText("");
  assert.equal(result.genuine, false);
  assert.equal(result.reason, "empty");
});

test("fetch ladder preserves raw HTML for caller extraction and uses supported headless delay", async () => {
  const source = await readFile("src/utils/fetchWithFallbacks.js", "utf8");
  assert.doesNotMatch(source, /isBlockedContent\s*\(/u);
  assert.doesNotMatch(source, /await\s+page\.waitForTimeout/u);
  assert.match(source, /acceptResponse\(text/u);
  assert.match(source, /bodyBuffer/u);
});

test("Wayback PDF fallback downloads the raw archived bytes", async () => {
  const originalUrl = "https://example.test/report.pdf";
  const snapshotUrl = "https://web.archive.org/web/20200102030405/https://example.test/report.pdf";
  const rawSnapshotUrl = "https://web.archive.org/web/20200102030405id_/https://example.test/report.pdf";
  const pdf = Buffer.from("%PDF-1.7 archived report bytes");
  const calls = [];
  const httpClient = {
    async get(url, options) {
      calls.push({url, options});
      if (url.startsWith("https://archive.org/wayback/available")) {
        return {data:{archived_snapshots:{closest:{available:true,url:snapshotUrl}}}};
      }
      assert.equal(url, rawSnapshotUrl);
      assert.equal(options.responseType, "arraybuffer");
      return {
        data:pdf,
        status:200,
        headers:{"content-type":"application/pdf"},
        request:{res:{responseUrl:rawSnapshotUrl}},
      };
    },
  };

  const result = await fetchPdfBinaryWithFallbacks(originalUrl, undefined, {
    includeDirect:false,
    allowHeadless:false,
    fallbackOrder:["wayback"],
    httpClient,
  });

  assert.deepEqual(result.buffer, pdf);
  assert.equal(result.method, "wayback");
  assert.equal(result.snapshotUrl, rawSnapshotUrl);
  assert.equal(result.attempts[0].method, "wayback_pdf_binary");
  assert.equal(result.attempts[0].status, "success");
  assert.equal(calls.length, 2);
});

test("headless PDF fallback accepts only captured PDF bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7 captured network response");
  let headlessCalls = 0;
  const result = await fetchPdfBinaryWithFallbacks("https://example.test/report.pdf", undefined, {
    includeDirect:false,
    fallbackOrder:["headless"],
    async headlessFetcher(url) {
      headlessCalls += 1;
      return {buffer:pdf,resolvedUrl:url,contentType:"application/pdf",httpStatus:200};
    },
  });
  assert.deepEqual(result.buffer, pdf);
  assert.equal(result.method, "headless");
  assert.equal(headlessCalls, 1);
  assert.equal(result.attempts[0].method, "headless_pdf_binary");
});

test("PDF transport implementation never reads page.content", async () => {
  const source = await readFile("src/utils/fetchWithFallbacks.js", "utf8");
  const start = source.indexOf("export async function fetchPdfWithPuppeteer");
  const end = source.indexOf("function recordAttempt", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /page\.content\s*\(/u);
  assert.match(source.slice(start, end), /response\.buffer\s*\(/u);
});
