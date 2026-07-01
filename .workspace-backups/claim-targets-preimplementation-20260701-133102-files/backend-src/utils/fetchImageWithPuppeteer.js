// backend/src/utils/fetchImageWithPuppeteer.js
import puppeteer from "puppeteer";
import { DEFAULT_HEADERS } from "./helpers.js";

/**
 * Fetch an image using Puppeteer (for images that fail with Axios)
 * @param {string} imageUrl - The URL of the image to fetch
 * @returns {Promise<Buffer>} - The image buffer
 */
export async function fetchImageWithPuppeteer(imageUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);

    await page.goto("about:blank");

    const viewSource = await page.goto(imageUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const buffer = await viewSource.buffer();
    await browser.close();

    return buffer;
  } catch (err) {
    if (browser) await browser.close();
    console.error("🧨 Puppeteer image error:", err.message);
    throw new Error(`Puppeteer image fetch failed: ${err.message}`);
  }
}
