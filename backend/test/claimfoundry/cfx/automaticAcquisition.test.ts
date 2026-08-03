import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireCfxDocumentAutomatically,
  extractCfxReadableArticleText,
} from "../../../src/services/cfxAutomaticAcquisition.js";

const articleHtml = (label: string) => `<html><head><title>${label}</title></head><body><article><h1>${label}</h1><p>${Array.from({length: 120}, (_, index) => `measured result ${index}`).join(" ")}</p></article></body></html>`;

test("readability rejects shells and retains genuine prose", () => {
  assert.equal(extractCfxReadableArticleText("<html><body>Sign in</body></html>").genuine, false);
  const result = extractCfxReadableArticleText(articleHtml("Study result"));
  assert.equal(result.genuine, true);
  assert.match(result.text, /measured result 119/u);
});

test("general acquisition tries direct, retry, alternate, Wayback, then headless", async () => {
  const calls: Array<{url:string;direct:boolean;fallback:string[]}> = [];
  const primary = "https://example.test/paper";
  const alternate = "https://mirror.test/paper";
  const result = await acquireCfxDocumentAutomatically({
    candidate: {
      url: primary,
      canonicalUrl: primary,
      alternateUrls: [alternate],
    },
    async fetchText(url:string, _maximum:number, options:any) {
      calls.push({url, direct:options.includeDirect, fallback:options.fallbackOrder});
      const succeeds = url === alternate && options.fallbackOrder[0] === "wayback";
      const raw = succeeds ? articleHtml("Archived study") : null;
      if (raw) await options.acceptResponse(raw, {method:"wayback",url:alternate,contentType:"text/html"});
      return {
        text: raw,
        method: succeeds ? "wayback" : null,
        snapshotUrl: succeeds ? `${alternate}/archive` : null,
        attempts: [{
          method: options.includeDirect ? "axios" : options.fallbackOrder[0],
          status: succeeds ? "success" : "failed",
          charCount: raw?.length || 0,
          elapsedMs: 1,
          rawResponse: raw,
        }],
      };
    },
  } as any);
  assert.equal(result.acquired, true);
  assert.equal(result.method, "wayback");
  assert.deepEqual(calls.map((call) => [call.url, call.direct, call.fallback[0] || "direct"]), [
    [primary, true, "direct"],
    [primary, true, "direct"],
    [alternate, true, "direct"],
    [primary, false, "wayback"],
    [alternate, false, "wayback"],
  ]);
  assert.equal(calls.some((call) => call.fallback[0] === "headless"), false);
});

test("provider abstract wins before any network tier", async () => {
  let networkCalls = 0;
  const abstract = Array.from({length: 100}, (_, index) => `abstract finding ${index}`).join(" ");
  const result = await acquireCfxDocumentAutomatically({
    candidate: { provider:"pubmed", abstractOrSnippet:abstract, url:"https://pubmed.test/1" },
    async fetchText() { networkCalls += 1; throw new Error("must not run"); },
  } as any);
  assert.equal(result.acquired, true);
  assert.equal(result.completeness, "abstract");
  assert.equal(networkCalls, 0);
});

test("PDF Wayback fallback stays binary and never enters HTML extraction", async () => {
  const pdfUrl = "https://example.test/study.pdf";
  const pdfBytes = Buffer.from("%PDF-1.7 archived bytes");
  const pdfCalls:Array<{url:string; fallback:string[]}> = [];
  let htmlCalls = 0;
  let extractedBuffer:Buffer|null = null;
  const pdfText = Array.from({length:100}, (_, index) =>
    `Archived PDF finding ${index} describes a measured study outcome.`).join(" ");

  const result = await acquireCfxDocumentAutomatically({
    candidate: { url:pdfUrl, canonicalUrl:pdfUrl, title:"Archived study" },
    async fetchExternal() { throw new Error("direct PDF denied"); },
    async fetchText() { htmlCalls += 1; throw new Error("PDF must not enter HTML transport"); },
    async fetchPdf(url:string, _maximum:number, options:any) {
      pdfCalls.push({url, fallback:options.fallbackOrder});
      return {
        buffer:pdfBytes,
        method:"wayback",
        snapshotUrl:"https://web.archive.org/web/20200101000000id_/https://example.test/study.pdf",
        resolvedUrl:"https://web.archive.org/web/20200101000000id_/https://example.test/study.pdf",
        contentType:"application/pdf",
        attempts:[{
          method:"wayback_pdf_binary", status:"success", byteCount:pdfBytes.length,
          contentType:"application/pdf", elapsedMs:1,
        }],
      };
    },
    async extractPdf(input:any) {
      extractedBuffer = Buffer.from(input.buffer);
      return {
        documentType:"pdf", title:"Archived study", authors:[], publisher:null,
        publishingIdentity:null, text:pdfText, rawHtml:null,
        extractionMethod:"test_pdf_parser", extractionSelector:null,
        botChallenge:false, citationCount:0, parserAttempts:[],
      };
    },
  } as any);

  assert.equal(result.acquired, true);
  assert.equal(result.method, "wayback");
  assert.ok((result as any).extractedDocument);
  assert.equal((result as any).extractedDocument.documentType, "pdf");
  assert.deepEqual(extractedBuffer, pdfBytes);
  assert.equal(htmlCalls, 0);
  assert.deepEqual(pdfCalls, [{url:pdfUrl, fallback:["wayback"]}]);
  assert.equal(result.attempts.some((attempt:any) =>
    attempt.method === "wayback_pdf_binary" && attempt.status === "success"), true);
});

test("PDF headless fallback captures bytes after Wayback failure without reading a viewer shell", async () => {
  const pdfUrl = "https://example.test/blocked.pdf";
  const pdfBytes = Buffer.from("%PDF-1.7 headless response bytes");
  const fallbacks:string[] = [];
  let htmlCalls = 0;
  const pdfText = Array.from({length:100}, (_, index) =>
    `Headless PDF finding ${index} describes a measured study outcome.`).join(" ");

  const result = await acquireCfxDocumentAutomatically({
    candidate: { url:pdfUrl, canonicalUrl:pdfUrl, title:"Blocked study" },
    async fetchExternal() { throw new Error("direct PDF denied"); },
    async fetchText() { htmlCalls += 1; throw new Error("PDF must not enter HTML transport"); },
    async fetchPdf(_url:string, _maximum:number, options:any) {
      const fallback = options.fallbackOrder[0];
      fallbacks.push(fallback);
      if (fallback === "wayback") {
        return {
          buffer:null, method:null,
          attempts:[{method:"wayback_pdf_binary",status:"not_found",elapsedMs:1}],
        };
      }
      return {
        buffer:pdfBytes, method:"headless", resolvedUrl:pdfUrl,
        contentType:"application/pdf",
        attempts:[{
          method:"headless_pdf_binary",status:"success",byteCount:pdfBytes.length,
          contentType:"application/pdf",elapsedMs:1,
        }],
      };
    },
    async extractPdf() {
      return {
        documentType:"pdf", title:"Blocked study", authors:[], publisher:null,
        publishingIdentity:null, text:pdfText, rawHtml:null,
        extractionMethod:"test_pdf_parser", extractionSelector:null,
        botChallenge:false, citationCount:0, parserAttempts:[],
      };
    },
  } as any);

  assert.equal(result.acquired, true);
  assert.equal(result.method, "headless_browser");
  assert.deepEqual(fallbacks, ["wayback", "headless"]);
  assert.equal(htmlCalls, 0);
});
