import { fetchExternalPageContent } from "../utils/fetchExternalPageContent.js";
import {
  fetchPdfBinaryWithFallbacks,
  fetchTextWithFallbacks,
  looksLikeGenuineArticleText,
} from "../utils/fetchWithFallbacks.js";
import {
  extractProductionHtmlDocument,
  extractProductionPdfDocument,
  extractProductionReadableHtml,
  productionDocumentType,
} from "../core/productionDocumentExtraction.js";

const MAX_ACQUIRED_CHARS = 2_000_000;

const uniqueUrls = (values) => [...new Set(values
  .flatMap((value) => Array.isArray(value) ? value : [value])
  .map((value) => String(value || "").trim())
  .filter((value) => /^https?:\/\//iu.test(value)))];

export function extractCfxReadableArticleText(raw, url = "https://invalid.local/") {
  const extracted = extractProductionReadableHtml(raw, {
    url,
    maximumCharacters: MAX_ACQUIRED_CHARS,
  });
  const text = extracted.text;
  const assessment = looksLikeGenuineArticleText(text);
  return {
    text,
    genuine: assessment.genuine && !extracted.botChallenge,
    reason: extracted.botChallenge ? "production_bot_challenge" : assessment.reason,
    extractionMethod: extracted.method,
    extractionSelector: extracted.selector,
  };
}

function normalizeAttempts(rows, { url, tier, ordinalStart }) {
  return rows.map((row, index) => ({
    ordinal: ordinalStart + index,
    method: tier === "direct_retry" && row.method === "axios" ? "platform_retry" : row.method,
    status: row.status,
    url,
    resolvedUrl: row.resolvedUrl || row.snapshotUrl || null,
    httpStatus: row.httpStatus ?? null,
    contentType: row.contentType ?? null,
    characterCount: Number(row.charCount ?? row.byteCount) || 0,
    timingMs: Number(row.elapsedMs) || 0,
    diagnostic: row.error || null,
    rawResponse: row.rawResponse ?? null,
    tier,
  }));
}

function providerText(candidate) {
  return String(candidate.providerFullText || candidate.fullText || candidate.providerText
    || (candidate.provider === "pubmed" ? candidate.abstractOrSnippet : "") || "").trim();
}

function alternateUrls(candidate, primaryUrl) {
  return uniqueUrls([
    candidate.resolvedUrl,
    candidate.canonicalUrl,
    candidate.alternateCanonicalUrl,
    candidate.alternateUrls,
    candidate.repositoryUrls,
    candidate.acceptedManuscriptUrls,
    candidate.preprintUrls,
  ]).filter((url) => url !== primaryUrl);
}

export async function acquireCfxDocumentAutomatically({
  candidate,
  academic = null,
  fetchText = fetchTextWithFallbacks,
  fetchExternal = fetchExternalPageContent,
  fetchPdf = fetchPdfBinaryWithFallbacks,
  extractPdf = extractProductionPdfDocument,
}) {
  const attempts = [];
  const primaryUrl = String(candidate.canonicalUrl || candidate.resolvedUrl || candidate.url || "").trim();
  let ordinal = 1;

  const finish = ({ cleanedText, method, sourceUrl, resolvedUrl = null, contentType = null, completeness = "complete", extractedDocument = null }) => ({
    acquired: true,
    cleanedText,
    method,
    sourceUrl,
    resolvedUrl,
    contentType,
    completeness,
    extractedDocument,
    attempts,
  });

  if (academic?.cleanText) {
    attempts.push({
      ordinal: ordinal++, method: academic.retrievalMode === "full_text" ? "pmc" : "pubmed",
      status: "success", url: primaryUrl, resolvedUrl: primaryUrl || null,
      httpStatus: null, contentType: "application/xml", characterCount: academic.cleanText.length,
      timingMs: 0, diagnostic: null, rawResponse: JSON.stringify(academic), tier: "structured_api",
    });
    return finish({
      cleanedText: academic.cleanText,
      method: academic.retrievalMode === "full_text" ? "pmc" : "pubmed",
      sourceUrl: primaryUrl,
      resolvedUrl: primaryUrl || null,
      contentType: "application/xml",
      completeness: academic.retrievalMode === "full_text" ? "complete" : "abstract",
      extractedDocument: {
        documentType: "academic",
        title: academic.title || candidate.title || null,
        authors: (academic.authors || []).map((name) => ({ name })),
        publisher: academic.publisher || academic.journal
          ? { name: academic.publisher || academic.journal }
          : null,
        publishingIdentity: academic.publishingIdentity || null,
      },
    });
  }

  const supplied = providerText(candidate);
  if (supplied) {
    const assessment = looksLikeGenuineArticleText(supplied);
    attempts.push({
      ordinal: ordinal++, method: "provider", status: assessment.genuine ? "success" : "parse_failure",
      url: primaryUrl, resolvedUrl: primaryUrl || null, httpStatus: null, contentType: "text/plain",
      characterCount: supplied.length, timingMs: 0,
      diagnostic: assessment.genuine ? null : assessment.reason, rawResponse: supplied, tier: "provider_text",
    });
    if (assessment.genuine) return finish({
      cleanedText: supplied,
      method: candidate.provider === "pubmed" ? "pubmed" : "provider",
      sourceUrl: primaryUrl,
      contentType: "text/plain",
      completeness: candidate.provider === "pubmed" ? "abstract" : "complete",
      extractedDocument: {
        documentType: "provider_text",
        title: candidate.title || null,
        authors: (candidate.authors || []).map((name) => ({ name })),
        publisher: candidate.publication ? { name: candidate.publication } : null,
        publishingIdentity: null,
      },
    });
  }

  const urls = uniqueUrls([primaryUrl, alternateUrls(candidate, primaryUrl)]);
  const isScholarly = Boolean(candidate.pmid || candidate.doi || academic);
  const directStages = [];
  if (primaryUrl) {
    directStages.push({ url: primaryUrl, tier: isScholarly ? "publisher" : "normal_platform_scrape" });
    if (!isScholarly) directStages.push({ url: primaryUrl, tier: "direct_retry" });
  }
  for (const url of urls.filter((value) => value !== primaryUrl)) {
    directStages.push({ url, tier: "alternate_canonical" });
  }

  for (const stage of directStages) {
    if (/\.pdf(?:$|[?#])/iu.test(stage.url)) {
      const started = Date.now();
      try {
        const page = await fetchExternal(stage.url);
        const cleanedText = String(page?.$?.root?.().text?.() || page?.$?.text?.() || "")
          .replace(/\s+/gu, " ").trim().slice(0, MAX_ACQUIRED_CHARS);
        const assessment = looksLikeGenuineArticleText(cleanedText);
        attempts.push({
          ordinal: ordinal++, method: "publisher_pdf", status: assessment.genuine ? "success" : "parse_failure",
          url: stage.url, resolvedUrl: stage.url, httpStatus: null, contentType: "application/pdf",
          characterCount: cleanedText.length, timingMs: Date.now() - started,
          diagnostic: assessment.genuine ? null : assessment.reason, rawResponse: null, tier: stage.tier,
        });
        if (assessment.genuine) return finish({
          cleanedText,
          method: "publisher_pdf",
          sourceUrl: stage.url,
          contentType: "application/pdf",
          extractedDocument: {
            documentType: "pdf",
            title: page?.pdfMeta?.title || candidate.title || null,
            authors: (page?.pdfMeta?.authors || candidate.authors || []).map((name) => typeof name === "string" ? { name } : name),
            publisher: page?.pdfMeta?.publisher ? { name: page.pdfMeta.publisher } : null,
            publishingIdentity: page?.pdfMeta?.identity || null,
            extractionMethod: "production_pdf_url",
          },
        });
      } catch (error) {
        attempts.push({
          ordinal: ordinal++, method: "publisher_pdf", status: "failed", url: stage.url,
          resolvedUrl: null, httpStatus: null, contentType: "application/pdf", characterCount: 0,
          timingMs: Date.now() - started, diagnostic: error.message, rawResponse: null, tier: stage.tier,
        });
      }
      continue;
    }
    let accepted = null;
    const result = await fetchText(stage.url, MAX_ACQUIRED_CHARS, {
      includeDirect: true,
      allowHeadless: false,
      fallbackOrder: [],
      captureBinary: true,
      async acceptResponse(raw, context) {
        const type = productionDocumentType({
          url: context.url,
          contentType: context.contentType,
          bodyBuffer: context.bodyBuffer,
        });
        const document = type === "pdf"
          ? await extractProductionPdfDocument({
              buffer: context.bodyBuffer,
              url: context.url,
              providedTitle: candidate.title,
              providedAuthors: candidate.authors,
              maximumCharacters: MAX_ACQUIRED_CHARS,
            })
          : await extractProductionHtmlDocument({
              rawHtml: raw,
              url: context.url,
              providedTitle: candidate.title,
              maximumCharacters: MAX_ACQUIRED_CHARS,
            });
        const assessment = looksLikeGenuineArticleText(document.text);
        if (assessment.genuine && !document.botChallenge) accepted = document;
        return Boolean(accepted);
      },
    });
    const normalized = normalizeAttempts(result.attempts, { url: stage.url, tier: stage.tier, ordinalStart: ordinal });
    attempts.push(...normalized);
    ordinal += normalized.length;
    if (result.text && accepted) return finish({
      cleanedText: accepted.text,
      method: accepted.documentType === "pdf"
        ? "publisher_pdf"
        : stage.tier === "direct_retry" ? "platform_retry" : "publisher_html",
      sourceUrl: stage.url, resolvedUrl: result.resolvedUrl || stage.url, contentType: result.contentType,
      extractedDocument: accepted,
    });
  }

  for (const fallback of ["wayback", "headless"]) {
    for (const url of urls) {
      if (/\.pdf(?:$|[?#])/iu.test(url)) {
        const result = await fetchPdf(url, undefined, {
          includeDirect: false,
          allowHeadless: fallback === "headless",
          fallbackOrder: [fallback],
        });
        const normalized = normalizeAttempts(result.attempts || [], {
          url,
          tier: fallback,
          ordinalStart: ordinal,
        });
        attempts.push(...normalized);
        ordinal += normalized.length;
        if (!result.buffer) continue;

        const document = await extractPdf({
          buffer: result.buffer,
          url: result.resolvedUrl || result.snapshotUrl || url,
          providedTitle: candidate.title,
          providedAuthors: candidate.authors,
          maximumCharacters: MAX_ACQUIRED_CHARS,
        });
        const assessment = looksLikeGenuineArticleText(document.text);
        if (!assessment.genuine) {
          attempts.push({
            ordinal: ordinal++,
            method: fallback === "headless" ? "headless_pdf_binary" : "wayback_pdf_binary",
            status: "parse_failure",
            url,
            resolvedUrl: result.resolvedUrl || result.snapshotUrl || null,
            httpStatus: null,
            contentType: result.contentType || "application/pdf",
            characterCount: document.text?.length || 0,
            timingMs: 0,
            diagnostic: assessment.reason,
            rawResponse: null,
            tier: fallback,
          });
          continue;
        }
        return finish({
          cleanedText: document.text,
          method: fallback === "headless" ? "headless_browser" : "wayback",
          sourceUrl: url,
          resolvedUrl: result.resolvedUrl || result.snapshotUrl || url,
          contentType: result.contentType || "application/pdf",
          extractedDocument: document,
        });
      }

      let accepted = null;
      const result = await fetchText(url, MAX_ACQUIRED_CHARS, {
        includeDirect: false,
        allowHeadless: fallback === "headless",
        fallbackOrder: [fallback],
        async acceptResponse(raw, context) {
          const document = await extractProductionHtmlDocument({
            rawHtml: raw,
            url: context.url,
            providedTitle: candidate.title,
            maximumCharacters: MAX_ACQUIRED_CHARS,
          });
          const assessment = looksLikeGenuineArticleText(document.text);
          if (assessment.genuine && !document.botChallenge) accepted = document;
          return Boolean(accepted);
        },
      });
      const normalized = normalizeAttempts(result.attempts, { url, tier: fallback, ordinalStart: ordinal });
      attempts.push(...normalized);
      ordinal += normalized.length;
      if (result.text && accepted) return finish({
        cleanedText: accepted.text,
        method: fallback === "headless" ? "headless_browser" : "wayback",
        sourceUrl: url, resolvedUrl: result.resolvedUrl || result.snapshotUrl || url,
        contentType: result.contentType || "text/html",
        extractedDocument: accepted,
      });
    }
  }

  return { acquired: false, cleanedText: null, method: null, sourceUrl: primaryUrl || null, resolvedUrl: null, contentType: null, completeness: "unknown", attempts };
}
