// backend/src/scrapers/facebookScraper.js
// ──────────────────────────────────────────────────────────────────
// Facebook Post Scraper using Puppeteer
// Extracts post content, author, timestamp, images, and reactions
// ──────────────────────────────────────────────────────────────────

import puppeteer from "puppeteer";
import logger from "../utils/logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scrape a Facebook post
 * @param {string} postUrl - Full URL to the Facebook post
 * @param {object} options - Optional configuration
 * @param {string} options.cookiesPath - Path to saved cookies file for authentication
 * @param {boolean} options.screenshot - Take screenshot for debugging
 * @returns {Promise<object>} Post data
 */
export async function scrapeFacebookPost(postUrl, options = {}) {
  const { cookiesPath, screenshot = false } = options;

  logger.log(`🔵 [FacebookScraper] Starting scrape for: ${postUrl}`);

  let browser = null;
  try {
    // Launch browser with stealth settings
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();

    // Set viewport and user agent to appear more human
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Load cookies if provided (for authenticated access)
    if (cookiesPath && fs.existsSync(cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
      await page.setCookie(...cookies);
      logger.log(`🍪 [FacebookScraper] Loaded ${cookies.length} cookies`);
    }

    // Navigate to the post
    logger.log(`🌐 [FacebookScraper] Navigating to post...`);
    await page.goto(postUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for main content to load
    await page.waitForSelector('[role="main"]', { timeout: 10000 });

    // Take screenshot if requested
    if (screenshot) {
      const screenshotPath = path.join(
        __dirname,
        "../../logs",
        `fb-post-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.log(`📸 [FacebookScraper] Screenshot saved: ${screenshotPath}`);
    }

    // Extract post data
    const postData = await page.evaluate(() => {
      // Helper to get text content safely
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      // Helper to get all matching text content
      const getAllText = (selector) => {
        const elements = Array.from(document.querySelectorAll(selector));
        return elements.map((el) => el.textContent.trim()).filter(Boolean);
      };

      // Extract post text - Facebook uses various selectors
      const postTextSelectors = [
        '[data-ad-preview="message"]',
        '[data-ad-comet-preview="message"]',
        '[data-testid="post_message"]',
        'div[dir="auto"]',
      ];

      let postText = null;
      for (const selector of postTextSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.length > 20) {
          postText = el.textContent.trim();
          break;
        }
      }

      // If still no text, try getting the largest text block
      if (!postText) {
        const divs = Array.from(document.querySelectorAll("div[dir='auto']"));
        const sorted = divs.sort(
          (a, b) => b.textContent.length - a.textContent.length
        );
        if (sorted.length > 0 && sorted[0].textContent.length > 20) {
          postText = sorted[0].textContent.trim();
        }
      }

      // Extract author name
      const authorSelectors = [
        'h2 a[role="link"]',
        'a[aria-label*="profile"]',
        'strong a[role="link"]',
      ];

      let authorName = null;
      for (const selector of authorSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.length > 0) {
          authorName = el.textContent.trim();
          break;
        }
      }

      // Extract timestamp
      const timestampSelectors = [
        'a[aria-label*="ago"]',
        'abbr',
        'a[role="link"] span',
      ];

      let timestamp = null;
      for (const selector of timestampSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.match(/\d+\s*(h|hr|hour|min|day|week)/i)) {
          timestamp = el.textContent.trim();
          break;
        }
      }

      // Extract images
      const images = Array.from(
        document.querySelectorAll('img[data-visualcompletion="media-vc-image"]')
      )
        .map((img) => img.src)
        .filter((src) => src.includes("fbcdn"));

      // Extract reactions count
      const reactionsText = getText('[aria-label*="reaction"]');
      let reactionsCount = 0;
      if (reactionsText) {
        const match = reactionsText.match(/(\d+(?:,\d+)*)/);
        if (match) {
          reactionsCount = parseInt(match[1].replace(/,/g, ""), 10);
        }
      }

      // Extract comments count
      const commentsText = getText('[aria-label*="comment"]');
      let commentsCount = 0;
      if (commentsText) {
        const match = commentsText.match(/(\d+(?:,\d+)*)/);
        if (match) {
          commentsCount = parseInt(match[1].replace(/,/g, ""), 10);
        }
      }

      // Extract shares count
      const sharesText = getText('[aria-label*="share"]');
      let sharesCount = 0;
      if (sharesText) {
        const match = sharesText.match(/(\d+(?:,\d+)*)/);
        if (match) {
          sharesCount = parseInt(match[1].replace(/,/g, ""), 10);
        }
      }

      return {
        postText,
        authorName,
        timestamp,
        images,
        reactionsCount,
        commentsCount,
        sharesCount,
        scrapedAt: new Date().toISOString(),
      };
    });

    logger.log(`✅ [FacebookScraper] Successfully extracted post data`, {
      hasText: !!postData.postText,
      hasAuthor: !!postData.authorName,
      imageCount: postData.images?.length || 0,
    });

    await browser.close();

    return {
      success: true,
      url: postUrl,
      ...postData,
    };
  } catch (error) {
    logger.error(`❌ [FacebookScraper] Error scraping post:`, error);

    if (browser) {
      await browser.close();
    }

    return {
      success: false,
      error: error.message,
      url: postUrl,
    };
  }
}

/**
 * Save browser cookies for future authenticated requests
 * This should be run once after manual login to save session
 * @param {string} cookiesPath - Where to save cookies
 */
export async function saveFacebookCookies(cookiesPath) {
  logger.log(`🍪 [FacebookScraper] Starting cookie save process...`);

  const browser = await puppeteer.launch({
    headless: false, // Show browser for manual login
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto("https://www.facebook.com/login");

  logger.log(
    `🔐 [FacebookScraper] Please login manually. Press Enter when done...`
  );

  // Wait for user to login
  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });

  // Save cookies
  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));

  logger.log(`✅ [FacebookScraper] Saved ${cookies.length} cookies to ${cookiesPath}`);

  await browser.close();
}

/**
 * Clean and normalize Facebook post text
 * @param {string} text - Raw post text
 * @returns {string} Cleaned text
 */
export function cleanFacebookPostText(text) {
  if (!text) return "";

  return (
    text
      // Remove excessive newlines
      .replace(/\n{3,}/g, "\n\n")
      // Remove "See more" / "See less" buttons
      .replace(/\b(See more|See less)\b/gi, "")
      // Trim whitespace
      .trim()
  );
}
