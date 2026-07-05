// backend/src/utils/fetchWithFallbacks.js
// Robust URL fetcher with Puppeteer and Wayback Machine fallbacks

import axios from "axios";
import https from "https";
import puppeteer from "puppeteer";
import { DEFAULT_HEADERS } from "./helpers.js";
import logger from "./logger.js";

/**
 * Detect if HTML content is a blocked page (login wall, cookie banner, etc)
 */
function isBlockedContent(html, url = "") {
  if (!html || html.length < 100) {
    logger.log(`🚫 [isBlocked] Content too short: ${html?.length || 0} chars for ${url}`);
    return true;
  }

  const lowerHtml = html.toLowerCase();

  // Critical indicators = definite block
  const criticalIndicators = [
    "access denied",
    "403 forbidden",
    "404 not found",
    "captcha",
    "are you a robot",
    "cloudflare security check",
    "checking your browser",
    "enable cookies to continue",
    "enable javascript and cookies",
  ];

  // Soft indicators = might just be nav links
  const softIndicators = [
    "sign in",
    "log in",
    "login required",
    "please enable javascript",
  ];

  const matchedCritical = criticalIndicators.filter((indicator) =>
    lowerHtml.includes(indicator)
  );

  const matchedSoft = softIndicators.filter((indicator) =>
    lowerHtml.includes(indicator)
  );

  const criticalCount = matchedCritical.length;
  const softCount = matchedSoft.length;

  // Block if: 1+ critical, OR 4+ soft (all soft indicators present)
  const isBlocked = criticalCount >= 1 || softCount >= 4;

  if (isBlocked) {
    logger.log(
      `🚫 [isBlocked] BLOCKED for ${url}: critical=${criticalCount} [${matchedCritical.join(", ")}], soft=${softCount} [${matchedSoft.join(", ")}], htmlLength=${html.length}`
    );
  } else {
    logger.log(`✅ [isBlocked] OK for ${url}: htmlLength=${html.length}`);
  }

  return isBlocked;
}

/**
 * Fetch URL with Puppeteer
 */
async function fetchWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for Cloudflare challenge to complete (if present)
    // Cloudflare challenge takes 3-5 seconds to solve
    await page.waitForTimeout(6000);

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

export async function fetchWaybackSnapshot(url, maxLength = 50000) {
  if (!url) return null;
  try {
    logger.log(`🕰️ [fetchWithFallbacks] Checking Wayback availability: ${url}`);
    const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const availResp = await axios.get(availabilityUrl, { timeout: 5000 });
    const snapshot = availResp.data?.archived_snapshots?.closest;
    if (!snapshot?.available) {
      logger.warn(`⚠️ [fetchWithFallbacks] No Wayback snapshots available for: ${url}`);
      return null;
    }
    const snapshotUrl = snapshot.url;
    const rawSnapshotUrl = snapshotUrl.replace(/\/web\/(\d+)\//, "/web/$1id_/");
    logger.log(`🕰️ [fetchWithFallbacks] Fetching raw snapshot: ${rawSnapshotUrl}`);
    const html = await fetchWithPuppeteer(rawSnapshotUrl);
    if (!html || html.length < 100 || isBlockedContent(html, url)) {
      logger.warn(`⚠️ [fetchWithFallbacks] Wayback snapshot unusable for: ${url}`);
      return null;
    }
    logger.log(`✅ [fetchWithFallbacks] Success with Wayback (${html.length} chars)`);
    return { text: html.slice(0, maxLength), method: "wayback", snapshotUrl: rawSnapshotUrl };
  } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Wayback Machine failed:`, err.message);
    return null;
  }
}

/**
 * Fetch URL text with fallbacks:
 * 1. Try axios with DEFAULT_HEADERS
 * 2. If blocked/fails → try Puppeteer with DEFAULT_HEADERS
 * 3. If fails → try Wayback Machine with Puppeteer
 *
 * Returns: { text: string, method: 'axios' | 'puppeteer' | 'wayback' }
 */
export async function fetchTextWithFallbacks(url, maxLength = 50000) {
  if (!url) return null;

  // Try 1: Axios with headers
  try {
    logger.log(`🌐 [fetchWithFallbacks] Trying axios: ${url}`);
    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 15000,
    });

    const response = await axiosInstance.get(url, {
      headers: DEFAULT_HEADERS,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const html = response.data;

    if (isBlockedContent(html, url)) {
      logger.warn(
        `⚠️ [fetchWithFallbacks] Blocked content detected, trying Puppeteer...`
      );
    } else {
      const text = typeof html === "string" ? html : String(html);
      logger.log(
        `✅ [fetchWithFallbacks] Success with axios (${text.length} chars)`
      );
      return { text: text.slice(0, maxLength), method: "axios" };
    }
  } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Axios failed:`, err.message);
  }

  // Try 2: Puppeteer with DEFAULT_HEADERS
  try {
    logger.log(`🧠 [fetchWithFallbacks] Trying Puppeteer: ${url}`);
    const html = await fetchWithPuppeteer(url);

    if (isBlockedContent(html, url)) {
      logger.warn(
        `⚠️ [fetchWithFallbacks] Still blocked after Puppeteer, trying Wayback...`
      );
    } else {
      logger.log(
        `✅ [fetchWithFallbacks] Success with Puppeteer (${html.length} chars)`
      );
      return { text: html.slice(0, maxLength), method: "puppeteer" };
    }
  } catch (err) {
    logger.warn(`⚠️ [fetchWithFallbacks] Puppeteer failed:`, err.message);
  }

  // Try 3: Wayback Machine with Puppeteer
  const wayback = await fetchWaybackSnapshot(url, maxLength);
  if (wayback) return wayback;

  // All methods failed
  logger.error(`❌ [fetchWithFallbacks] All methods failed for: ${url}`);
  return null;
}
