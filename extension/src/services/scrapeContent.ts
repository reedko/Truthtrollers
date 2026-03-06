// extension/src/services/scrapeContent.ts
// ---------------------------------------------------------
// SIMPLIFIED — sends URL to backend for single-pass scraping
// Backend handles: fetch, metadata, claims, evidence, references
// NO RECURSION - backend processes everything inline!
// ---------------------------------------------------------

import browser from "webextension-polyfill";
import { isFacebookPost, scrapeFacebookPost } from "./scrapeFacebookPost";

type ScrapeBackendResponse = {
  success: boolean;
  contentId?: string;
  references?: {
    dom?: any[];
    ai?: any[];
  };
  error?: string;
};

/**
 * Scrape current page as TASK.
 *
 * PROCESS-ONCE-INLINE FLOW:
 * 1) Capture current page DOM (if HTML, not PDF)
 * 2) Send URL (+ raw_html if available) to backend via background.js
 * 3) Backend does EVERYTHING:
 *    - Fetches page (or uses raw_html)
 *    - Extracts text + metadata (authors, publisher, title)
 *    - Creates task content row
 *    - Persists DOM/inline references
 *    - Extracts & persists task claims
 *    - Runs evidence engine → creates AI references INLINE during fetch
 *    - Creates reference_claim_links (task claims → AI refs)
 *    - Extracts claims FROM references
 * 4) Done! ✅ No recursion needed.
 */
export async function scrapeContent(url: string): Promise<string | null> {
  const normUrl = url.trim();

  console.log(`🔎 scrapeContent (task):`, normUrl);

  // ---------------------------------------
  // 0. CHECK IF FACEBOOK POST - use special scraper
  // ---------------------------------------
  if (isFacebookPost(normUrl)) {
    console.log("🔵 [Scraper] Detected Facebook post, using Facebook scraper");
    return scrapeFacebookPost(true); // createContent = true
  }

  // ---------------------------------------
  // 1. BUILD REQUEST PAYLOAD
  // ---------------------------------------
  let payload: any = {
    url: normUrl,
    force: true, // Allow re-scraping existing URLs
  };

  // For NON-PDF tasks: use already-loaded DOM (NO HTTP REQUEST!)
  const isPdf = /\.pdf($|\?)/i.test(normUrl);
  if (!isPdf) {
    try {
      // Get HTML from current page DOM (already loaded in browser!)
      const rawHtml = document.documentElement.outerHTML;
      payload.raw_html = rawHtml;
      console.log(
        `✅ Using current page DOM (${rawHtml.length} chars, no HTTP request)`
      );
    } catch (err) {
      console.warn(
        "⚠️ Could not access current page DOM, backend will fetch:",
        err
      );
      // Backend will fetch via URL as fallback
    }
  }
  // For PDFs: backend will fetch and parse with pdf-parse

  // ---------------------------------------
  // 2. ASK BACKGROUND TO CALL BACKEND
  // ---------------------------------------
  let backendResp: ScrapeBackendResponse;
  try {
    backendResp = (await browser.runtime.sendMessage({
      action: "scrapeTaskOnServer",
      payload,
    })) as ScrapeBackendResponse;
  } catch (err) {
    console.error("❌ Error sending scrape request to background:", err);
    return null;
  }

  if (!backendResp || !backendResp.success || !backendResp.contentId) {
    console.error("❌ Backend scrape failed:", backendResp?.error);
    return null;
  }

  const contentId = backendResp.contentId;
  const domCount = backendResp.references?.dom?.length || 0;
  const aiCount = backendResp.references?.ai?.length || 0;

  console.log(`✅ Task complete: content_id=${contentId}`);
  console.log(`   📄 DOM/inline refs: ${domCount}`);
  console.log(`   🤖 AI refs: ${aiCount} (fully processed)`);

  return contentId;
}
