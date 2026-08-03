// backend/src/utils/fetchWithFallbacks.js
// Robust URL fetcher with Puppeteer and Wayback Machine fallbacks

import axios from "axios";
import https from "https";
import puppeteer from "puppeteer";
import { DEFAULT_HEADERS } from "./helpers.js";
import logger from "./logger.js";

const REFERENCE_HEADING_RE = /^(?:references|bibliography|works cited|literature cited|reference list|citations|endnotes)$/iu;
const REFERENCE_ENTRY_PREFIX_RE = /^(?:[↑^]|\[?\d{1,3}\]?\s+|(?:\d{1,3}\s+){2,5}(?=[A-Z"“]))/u;
const REFERENCE_SIGNAL_RE = /\b(?:doi|pmid|pmc|isbn|issn|s2cid|bibcode|retrieved|archived from the original|et al\.)\b/giu;
const YEAR_RE = /\b(?:18|19|20)\d{2}\b/u;

function textLinesWithOffsets(source) {
  const rows = [];
  let offset = 0;
  for (const rawLine of String(source || "").split("\n")) {
    const leading = rawLine.search(/\S/u);
    if (leading >= 0) rows.push({ text: rawLine.trim(), offset: offset + leading });
    offset += rawLine.length + 1;
  }
  return rows;
}

function looksLikeReferenceEntry(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  const signals = [...text.matchAll(REFERENCE_SIGNAL_RE)].length;
  return (REFERENCE_ENTRY_PREFIX_RE.test(text) && (signals >= 1 || YEAR_RE.test(text)))
    || (signals >= 2 && YEAR_RE.test(text));
}

/**
 * Locate a structurally identifiable reference-list suffix. Explicit section
 * headings win. Some extractors (notably Readability on Wikipedia) omit the
 * heading, so a bounded run of citation-shaped lines is also recognized.
 * This does not decide relevance or remove the references from acquired text;
 * it only scopes the duplicate-boilerplate safety check to the article body.
 */
export function findReferenceSectionStart(extractedText) {
  const lines = textLinesWithOffsets(extractedText);
  for (const line of lines) {
    if (REFERENCE_HEADING_RE.test(line.text.replace(/[:.]$/u, "").trim())) return line.offset;
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!looksLikeReferenceEntry(lines[index].text)) continue;
    const window = lines.slice(index, index + 7);
    if (window.length >= 4 && window.filter((line) => looksLikeReferenceEntry(line.text)).length >= 4) {
      return lines[index].offset;
    }
  }
  return -1;
}

/**
 * Detect a page that returned 200 with plausible-looking HTML but is not
 * genuine article content: a bare navigation/menu shell, a duplicated
 * boilerplate fragment, or a page dominated by link text. This exists
 * because a "success" from axios/Puppeteer/Wayback is only meaningful if the
 * extracted text is actually the article -- a challenge page, consent
 * screen, or nav shell can be well-formed, non-blocked-looking HTML while
 * containing no real content. Runs against the *readable/extracted* text,
 * not raw HTML, so call after Readability/cheerio text extraction.
 */
export function looksLikeGenuineArticleText(extractedText, { minWords = 80 } = {}) {
  const source = String(extractedText || "").replace(/\r/gu, "").trim();
  const referenceSectionStart = findReferenceSectionStart(source);
  const bodySource = referenceSectionStart >= 0
    ? source.slice(0, referenceSectionStart)
    : source;
  const text = source.replace(/\s+/g, " ").trim();
  if (!text) return { genuine: false, reason: "empty" };

  const wordCount = text.split(" ").filter(Boolean).length;
  if (wordCount < minWords) {
    return { genuine: false, reason: "below_min_word_count", wordCount };
  }

  // Detect a shell dominated by short, repeated nav-like fragments (menu
  // items, category links) rather than prose: many short "sentences"
  // (split on '.', newlines already collapsed) with little variance.
  const fragments = text.split(/(?<=[.!?])\s+|\n/).map((f) => f.trim()).filter(Boolean);
  const shortFragmentRatio = fragments.length > 8
    ? fragments.filter((f) => f.split(" ").length <= 3).length / fragments.length
    : 0;
  if (shortFragmentRatio > 0.6) {
    return { genuine: false, reason: "nav_shell_shape", wordCount, shortFragmentRatio };
  }

  // Detect duplicated boilerplate: the same non-trivial fragment repeated
  // many times (cookie banners, "subscribe" prompts injected per-section).
  const bodyFragments = bodySource.replace(/\s+/gu, " ").trim()
    .split(/(?<=[.!?])\s+|\n/u).map((fragment) => fragment.trim()).filter(Boolean);
  const fragmentCounts = new Map();
  for (const fragment of bodyFragments) {
    if (fragment.length < 20) continue;
    fragmentCounts.set(fragment, (fragmentCounts.get(fragment) || 0) + 1);
  }
  const maxRepeat = Math.max(0, ...fragmentCounts.values());
  if (maxRepeat >= 4) {
    return {
      genuine: false,
      reason: "duplicated_fragment",
      wordCount,
      maxRepeat,
      referenceSectionDetected: referenceSectionStart >= 0,
      referenceSectionStart,
    };
  }

  return {
    genuine: true,
    reason: "ok",
    wordCount,
    referenceSectionDetected: referenceSectionStart >= 0,
    referenceSectionStart,
  };
}

// Low-concurrency gate shared across all callers of this module. Headless
// browser tiers are expensive and easy to bot-detect when parallelized; this
// caps how many Puppeteer instances (ordinary fetch or Wayback-via-Puppeteer)
// can run at once, regardless of how many callers invoke this module
// concurrently (e.g. multiple CFX documents in one run).
const MAX_CONCURRENT_HEADLESS = 2;
const DEFAULT_MAX_PDF_BYTES = 50 * 1024 * 1024;
let activeHeadless = 0;
const headlessWaiters = [];

async function acquireHeadlessSlot() {
  if (activeHeadless < MAX_CONCURRENT_HEADLESS) {
    activeHeadless += 1;
    return;
  }
  await new Promise((resolve) => headlessWaiters.push(resolve));
  activeHeadless += 1;
}

function releaseHeadlessSlot() {
  activeHeadless -= 1;
  const next = headlessWaiters.shift();
  if (next) next();
}

/**
 * Fetch URL with Puppeteer. Exactly one attempt: one page load, one bounded
 * wait for a challenge to resolve, no internal retry loop. Callers decide
 * whether a *new* headless attempt is warranted (see fetchTextWithFallbacks'
 * `allowHeadless` option) -- this function never re-attempts on its own.
 */
export async function fetchWithPuppeteer(url, { navigationTimeoutMs = 30000, challengeWaitMs = 6000 } = {}) {
  await acquireHeadlessSlot();
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
      await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

      await page.goto(url, { waitUntil: "networkidle2", timeout: navigationTimeoutMs });

      // Puppeteer 24 removed page.waitForTimeout(). Keep the existing single
      // bounded delay without adding a retry or navigation loop.
      await new Promise((resolve) => setTimeout(resolve, challengeWaitMs));

      const html = await page.content();
      return html;
    } finally {
      // browser.close() rejecting must not skip slot release below, so its
      // failure is swallowed here rather than left to the outer finally.
      await browser.close().catch(() => {});
    }
  } finally {
    releaseHeadlessSlot();
  }
}

function isPdfBuffer(value) {
  const buffer = value ? Buffer.from(value) : Buffer.alloc(0);
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

/**
 * Fetch a PDF with Chromium without reading the built-in PDF viewer DOM.
 *
 * Chrome may render a PDF in an extension shell (or abort the navigation after
 * handing it to that viewer). The evidence is the PDF network response, not
 * page.content(), so retain the qualifying response and read its bytes.
 */
export async function fetchPdfWithPuppeteer(url, {
  navigationTimeoutMs = 30000,
  responseWaitMs = 6000,
} = {}) {
  await acquireHeadlessSlot();
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
      await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

      const candidates = [];
      let notifyCandidate = () => {};
      const candidateArrived = new Promise((resolve) => { notifyCandidate = resolve; });
      page.on("response", (response) => {
        const contentType = String(response.headers()?.["content-type"] || "").toLowerCase();
        if (contentType.includes("application/pdf") || /\.pdf(?:$|[?#])/iu.test(response.url())) {
          candidates.push(response);
          notifyCandidate();
        }
      });

      let navigationResponse = null;
      let navigationError = null;
      try {
        navigationResponse = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
      } catch (error) {
        // Chromium commonly reports ERR_ABORTED when its PDF viewer takes over.
        // Keep inspecting captured network responses before treating it as a
        // transport failure.
        navigationError = error;
      }

      if (navigationResponse) candidates.push(navigationResponse);
      if (!candidates.length) {
        await Promise.race([
          candidateArrived,
          new Promise((resolve) => setTimeout(resolve, responseWaitMs)),
        ]);
      }

      for (const response of [...new Set(candidates)]) {
        try {
          const buffer = Buffer.from(await response.buffer());
          if (!isPdfBuffer(buffer)) continue;
          return {
            buffer,
            resolvedUrl: response.url() || url,
            contentType: response.headers()?.["content-type"] || "application/pdf",
            httpStatus: response.status?.() ?? null,
          };
        } catch {
          // A redirect or already-disposed response body is not the PDF. Try
          // the next captured PDF-looking response from this same navigation.
        }
      }

      if (navigationError) throw navigationError;
      throw new Error("Headless navigation produced no binary PDF response");
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    releaseHeadlessSlot();
  }
}

function recordAttempt(attempts, method, startedAt, fields) {
  attempts.push({
    method,
    elapsedMs: Date.now() - startedAt,
    ...fields,
  });
}

export async function fetchWaybackSnapshot(url, maxLength = 50000, {
  attempts = [],
  acceptResponse = null,
} = {}) {
  if (!url) return null;
  const startedAt = Date.now();
  try {
    logger.log(`🕰️ [fetchWithFallbacks] Checking Wayback availability: ${url}`);
    const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const availResp = await axios.get(availabilityUrl, { timeout: 5000 });
    const snapshot = availResp.data?.archived_snapshots?.closest;
    if (!snapshot?.available) {
      logger.warn(`⚠️ [fetchWithFallbacks] No Wayback snapshots available for: ${url}`);
      recordAttempt(attempts, "wayback", startedAt, { status: "not_found" });
      return null;
    }
    const snapshotUrl = snapshot.url;
    const rawSnapshotUrl = snapshotUrl.replace(/\/web\/(\d+)\//, "/web/$1id_/");
    logger.log(`🕰️ [fetchWithFallbacks] Fetching raw snapshot: ${rawSnapshotUrl}`);
    const html = await fetchWithPuppeteer(rawSnapshotUrl);
    if (!html || html.length < 100) {
      logger.warn(`⚠️ [fetchWithFallbacks] Wayback snapshot unusable for: ${url}`);
      recordAttempt(attempts, "wayback", startedAt, {
        status: "empty", charCount: html?.length || 0, snapshotUrl: rawSnapshotUrl,
      });
      return null;
    }
    if (acceptResponse && !(await acceptResponse(html, {
      method: "wayback", url: rawSnapshotUrl, contentType: "text/html",
    }))) {
      recordAttempt(attempts, "wayback", startedAt, {
        status: "parse_failure", charCount: html.length,
        snapshotUrl: rawSnapshotUrl, rawResponse: html,
        error: "Response was rejected by the caller's article-text validator",
      });
      return null;
    }
    logger.log(`✅ [fetchWithFallbacks] Success with Wayback (${html.length} chars)`);
    recordAttempt(attempts, "wayback", startedAt, {
      status: "success", charCount: html.length, snapshotUrl: rawSnapshotUrl,
      contentType: "text/html", rawResponse: html,
    });
    return { text: html.slice(0, maxLength), method: "wayback", snapshotUrl: rawSnapshotUrl, attempts };
  } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Wayback Machine failed:`, err.message);
    recordAttempt(attempts, "wayback", startedAt, { status: "failed", error: err.message });
    return null;
  }
}

/** Download an archived PDF as bytes from Wayback's raw (`id_`) endpoint. */
export async function fetchWaybackPdfSnapshot(url, maxBytes = DEFAULT_MAX_PDF_BYTES, {
  attempts = [],
  httpClient = axios,
} = {}) {
  if (!url) return null;
  const startedAt = Date.now();
  try {
    logger.log(`🕰️ [fetchWithFallbacks] Checking Wayback PDF availability: ${url}`);
    const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const availResp = await httpClient.get(availabilityUrl, { timeout: 5000 });
    const snapshot = availResp.data?.archived_snapshots?.closest;
    if (!snapshot?.available) {
      recordAttempt(attempts, "wayback_pdf_binary", startedAt, { status: "not_found" });
      return null;
    }

    const rawSnapshotUrl = String(snapshot.url).replace(/\/web\/(\d+)\//, "/web/$1id_/");
    const response = await httpClient.get(rawSnapshotUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 30000,
      responseType: "arraybuffer",
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const buffer = Buffer.from(response.data);
    const contentType = response.headers?.["content-type"] || null;
    const resolvedUrl = response.request?.res?.responseUrl || rawSnapshotUrl;
    if (!isPdfBuffer(buffer)) {
      recordAttempt(attempts, "wayback_pdf_binary", startedAt, {
        status: "parse_failure",
        httpStatus: response.status,
        byteCount: buffer.length,
        contentType,
        snapshotUrl: rawSnapshotUrl,
        resolvedUrl,
        rawResponse: buffer.length <= 100_000 ? buffer.toString("utf8") : null,
        error: "Wayback raw snapshot did not contain PDF bytes",
      });
      return null;
    }

    recordAttempt(attempts, "wayback_pdf_binary", startedAt, {
      status: "success",
      httpStatus: response.status,
      byteCount: buffer.length,
      contentType: contentType || "application/pdf",
      snapshotUrl: rawSnapshotUrl,
      resolvedUrl,
      rawResponse: null,
    });
    return {
      buffer,
      method: "wayback",
      snapshotUrl: rawSnapshotUrl,
      resolvedUrl,
      contentType: contentType || "application/pdf",
      attempts,
    };
  } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Wayback PDF failed:`, err.message);
    recordAttempt(attempts, "wayback_pdf_binary", startedAt, {
      status: err.code === "ECONNABORTED" ? "timeout" : "failed",
      httpStatus: err.response?.status ?? null,
      error: err.message,
    });
    return null;
  }
}

/**
 * Binary-only PDF ladder. A PDF URL passed here can never enter HTML,
 * Readability, or page.content() extraction.
 */
export async function fetchPdfBinaryWithFallbacks(url, maxBytes = DEFAULT_MAX_PDF_BYTES, {
  includeDirect = true,
  allowHeadless = true,
  fallbackOrder = ["wayback", "headless"],
  headlessFetcher = fetchPdfWithPuppeteer,
  httpClient = axios,
} = {}) {
  const attempts = [];
  if (!url) return { buffer: null, method: null, attempts };

  if (includeDirect) {
    const startedAt = Date.now();
    try {
      const response = await httpClient.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: 30000,
        responseType: "arraybuffer",
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const buffer = Buffer.from(response.data);
      const contentType = response.headers?.["content-type"] || null;
      const resolvedUrl = response.request?.res?.responseUrl || url;
      if (isPdfBuffer(buffer)) {
        recordAttempt(attempts, "pdf_binary", startedAt, {
          status: "success", httpStatus: response.status, byteCount: buffer.length,
          contentType: contentType || "application/pdf", resolvedUrl, rawResponse: null,
        });
        return { buffer, method: "direct", resolvedUrl, contentType: contentType || "application/pdf", attempts };
      }
      recordAttempt(attempts, "pdf_binary", startedAt, {
        status: "parse_failure", httpStatus: response.status, byteCount: buffer.length,
        contentType, resolvedUrl,
        rawResponse: buffer.length <= 100_000 ? buffer.toString("utf8") : null,
        error: "Direct response did not contain PDF bytes",
      });
    } catch (err) {
      recordAttempt(attempts, "pdf_binary", startedAt, {
        status: err.code === "ECONNABORTED" ? "timeout" : "failed",
        httpStatus: err.response?.status ?? null,
        error: err.message,
      });
    }
  }

  for (const fallback of fallbackOrder) {
    if (fallback === "wayback") {
      const archived = await fetchWaybackPdfSnapshot(url, maxBytes, { attempts, httpClient });
      if (archived) return archived;
      continue;
    }
    if (fallback !== "headless" || !allowHeadless) continue;
    const startedAt = Date.now();
    try {
      const captured = await headlessFetcher(url);
      if (!isPdfBuffer(captured?.buffer)) {
        recordAttempt(attempts, "headless_pdf_binary", startedAt, {
          status: "parse_failure",
          byteCount: captured?.buffer?.length || 0,
          contentType: captured?.contentType || null,
          resolvedUrl: captured?.resolvedUrl || null,
          error: "Headless navigation produced no PDF bytes",
        });
        continue;
      }
      recordAttempt(attempts, "headless_pdf_binary", startedAt, {
        status: "success", httpStatus: captured.httpStatus ?? null,
        byteCount: captured.buffer.length,
        contentType: captured.contentType || "application/pdf",
        resolvedUrl: captured.resolvedUrl || url,
        rawResponse: null,
      });
      return {
        buffer: Buffer.from(captured.buffer),
        method: "headless",
        resolvedUrl: captured.resolvedUrl || url,
        contentType: captured.contentType || "application/pdf",
        attempts,
      };
    } catch (err) {
      recordAttempt(attempts, "headless_pdf_binary", startedAt, {
        status: /timeout/iu.test(err.message || "") ? "timeout" : "failed",
        error: err.message,
      });
    }
  }

  logger.error(`❌ [fetchWithFallbacks] All binary PDF methods failed for: ${url}`);
  return { buffer: null, method: null, attempts };
}

/**
 * Fetch URL text with a bounded, forensically-logged acquisition ladder:
 * 1. axios with DEFAULT_HEADERS (ordinary HTTP fetch)
 * 2. if blocked/fails and allowHeadless -> exactly one Puppeteer attempt
 * 3. if that fails -> Wayback Machine (itself fetched via one Puppeteer load)
 *
 * Every tier's outcome is recorded in the returned `attempts` array
 * (method, status, httpStatus/error, charCount, elapsedMs) regardless of
 * whether that tier ultimately won -- this is what lets a caller later prove
 * which tier actually produced a given success, rather than only knowing the
 * terminal winner.
 *
 * `allowHeadless` (default true) lets a caller that has already spent one
 * headless attempt on this exact document skip straight to the caller's own
 * next step (e.g. queue for extension-assisted recovery) without spending a
 * second one, per the "at most one headless attempt per canonical document
 * unless explicitly retryable" policy -- that retry decision belongs to the
 * caller, not this shared utility.
 *
 * Returns: { text: string|null, method: string|null, attempts: Attempt[] }
 * `text` is raw HTML/text, not yet Readability-extracted; `method` is null
 * only when every tier failed.
 */
export async function fetchTextWithFallbacks(url, maxLength = 50000, {
  allowHeadless = true,
  includeDirect = true,
  fallbackOrder = ["headless", "wayback"],
  acceptResponse = null,
  captureBinary = false,
} = {}) {
  const attempts = [];
  if (!url) return { text: null, method: null, attempts };

  // Try 1: Axios with headers
  if (includeDirect) {
    const axiosStart = Date.now();
    try {
    logger.log(`🌐 [fetchWithFallbacks] Trying axios: ${url}`);
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 15000,
    });

    const response = await axiosInstance.get(url, {
      headers: DEFAULT_HEADERS,
      validateStatus: (status) => status >= 200 && status < 300,
      ...(captureBinary ? { responseType: "arraybuffer" } : {}),
    });

    const contentType = response.headers?.["content-type"] || null;
    const resolvedUrl = response.request?.res?.responseUrl || response.config?.url || url;
    const bodyBuffer = captureBinary ? Buffer.from(response.data) : null;
    const text = bodyBuffer
      ? bodyBuffer.toString("utf8")
      : typeof response.data === "string" ? response.data : String(response.data);
    // Raw HTML is evidence. Never classify or discard it here. The caller's
    // production document extractor decides whether the extracted document is
    // usable, after the exact response has been recorded.
    const accepted = !acceptResponse || await acceptResponse(text, {
      method: "axios", url: resolvedUrl, contentType, bodyBuffer,
    });
    if (accepted) {
      logger.log(`✅ [fetchWithFallbacks] Success with axios (${text.length} chars)`);
      recordAttempt(attempts, "axios", axiosStart, {
        status: "success", httpStatus: response.status, charCount: text.length,
        contentType, resolvedUrl,
        rawResponse: contentType?.includes("application/pdf") ? null : text,
      });
      return { text: text.slice(0, maxLength), method: "axios", resolvedUrl, contentType, attempts };
    }
    recordAttempt(attempts, "axios", axiosStart, {
      status: "parse_failure", httpStatus: response.status, charCount: text.length,
      contentType, resolvedUrl,
      rawResponse: contentType?.includes("application/pdf") ? null : text,
      error: "Response was rejected by the caller's production document extractor",
    });
    } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Axios failed:`, err.message);
    recordAttempt(attempts, "axios", axiosStart, {
      status: err.code === "ECONNABORTED" ? "timeout" : "failed",
      httpStatus: err.response?.status ?? null,
      error: err.message,
    });
    }
  }

  for (const fallback of fallbackOrder) {
    if (fallback === "wayback") {
      const wayback = await fetchWaybackSnapshot(url, maxLength, { attempts, acceptResponse });
      if (wayback) return wayback;
      continue;
    }
    if (fallback !== "headless" || !allowHeadless) continue;
    const puppeteerStart = Date.now();
    try {
      logger.log(`🧠 [fetchWithFallbacks] Trying Puppeteer (single attempt): ${url}`);
      const html = await fetchWithPuppeteer(url);
      if (acceptResponse && !(await acceptResponse(html, {
        method: "puppeteer", url, contentType: "text/html",
      }))) {
        recordAttempt(attempts, "puppeteer", puppeteerStart, {
          status: "parse_failure", charCount: html.length, rawResponse: html,
          contentType: "text/html",
          error: "Response was rejected by the caller's article-text validator",
        });
      } else {
        recordAttempt(attempts, "puppeteer", puppeteerStart, {
          status: "success", charCount: html.length, rawResponse: html,
          contentType: "text/html",
        });
        return { text: html.slice(0, maxLength), method: "puppeteer", contentType: "text/html", attempts };
      }
    } catch (err) {
      const timedOut = /timeout/i.test(err.message || "");
      recordAttempt(attempts, "puppeteer", puppeteerStart, {
        status: timedOut ? "timeout" : "failed", error: err.message,
      });
    }
  }

  // All methods failed -- this is expected to happen often for bot-walled or
  // paywalled sources. The caller is responsible for the next step (e.g.
  // queueing extension-assisted recovery); this function does not queue
  // anything itself.
  logger.error(`❌ [fetchWithFallbacks] All methods failed for: ${url}`);
  return { text: null, method: null, attempts };
}
