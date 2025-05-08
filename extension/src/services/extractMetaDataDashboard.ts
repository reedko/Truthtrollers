// extractMetaDataDashboard.ts
import * as cheerio from "cheerio";
import { Author, TaskData, Lit_references, Publisher } from "../entities/Task";
import { DiffbotData } from "../entities/diffbotData";
import {
  removeCookieWalls,
  detectRetraction,
  isLikelyRSS,
  resolveUrl,
  parseSrcset,
  isProcessableImage,
  testImageLoad,
  checkIfPdfViaHead,
} from "./extractMetaDataUtils";

import { fetchHtmlWithPuppeteer } from "./fetchHtmlWithPuppeteerDashboard";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

export const getExtractedText = async (
  url: string,
  html: string
): Promise<string> => {
  if (!html) {
    const response = await fetch(`${BASE_URL}/api/extractText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, html }),
    });

    const textResponse = await response.text();
    const data = JSON.parse(textResponse);
    if (!data.success || !data.pageText) {
      throw new Error(`Text extraction failed: ${JSON.stringify(data)}`);
    }
    return data.pageText;
  } else {
    return html;
  }
};

export const getClaims = async (text: string): Promise<any[]> => {
  const response = await fetch(`${BASE_URL}/api/claim-buster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json();
  if (!data.success) throw new Error("ClaimBuster request failed.");
  return data.claims;
};

export const getBestImage = async (
  url: string,
  extractedHtml: string,
  diffbotData: DiffbotData
): Promise<string> => {
  return (
    extractImageFromHtml(extractedHtml, url) ||
    `${BASE_URL}/assets/images/miniLogo.png`
  );
};

export const extractImageFromHtml = (
  html: string,
  url: string
): string | null => {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);

  let ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    ogImage = decodeURIComponent(ogImage);
    ogImage = resolveUrl(ogImage, baseUrl);
    if (isProcessableImage(ogImage)) return ogImage;
  }

  let maxArea = 0;
  let chosenImage: string | null = null;

  $("img").each((_, img) => {
    let src = $(img).attr("src") || "";
    let srcset = $(img).attr("srcset") || "";
    const width = parseInt($(img).attr("width") || "0", 10);
    const height = parseInt($(img).attr("height") || "0", 10);
    const area = width * height;

    if (srcset) {
      const bestSrc = parseSrcset(srcset);
      if (bestSrc) src = bestSrc;
    }
    src = resolveUrl(decodeURIComponent(src), baseUrl);

    if (area > maxArea && isProcessableImage(src)) {
      maxArea = area;
      chosenImage = src;
    }
  });

  if (!chosenImage) {
    $("img").each((_, img) => {
      let src = $(img).attr("src") || "";
      src = resolveUrl(decodeURIComponent(src), baseUrl);
      if (isProcessableImage(src)) {
        chosenImage = src;
        return false;
      }
    });
  }

  return chosenImage;
};

export const fetchPdfViaServer = async (url: string) => {
  const pdfRes = await fetch(`${BASE_URL}/api/fetch-pdf-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await pdfRes.json();
  if (!json?.success || !json.text)
    return { $: cheerio.load(""), isRetracted: false };

  const $ = cheerio.load(`<body>${json.text.trim()}</body>`);
  const thumbRes = await fetch(`${BASE_URL}/api/pdf-thumbnail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const thumbJson = await thumbRes.json();

  return {
    $,
    isRetracted: detectRetraction(json.text),
    pdfMeta: {
      title: json.title,
      author: json.author,
      thumbnailUrl: thumbJson?.imageUrl || undefined,
    },
  };
};

export const fetchHtmlViaServer = async (url: string) => {
  try {
    const res = await fetch(`${BASE_URL}/api/fetch-page-content`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const json = await res.json();
    const cleaned = removeCookieWalls(json.html);
    if (isLikelyRSS(cleaned))
      return { $: cheerio.load(""), isRetracted: false, isRSS: true };

    const $ = cheerio.load(cleaned);
    const len = $("body").text().trim().length;

    if (len < 300) {
      const alt =
        (await fetchViaPuppeteer(url)) ||
        (await fetchFromWaybackWithPuppeteer(url));
      return alt || { $: cheerio.load(""), isRetracted: false };
    }

    return { $, isRetracted: detectRetraction(cleaned) };
  } catch (err) {
    console.error("❌ Server fetch error:", err);
    return { $: cheerio.load(""), isRetracted: false };
  }
};

export const getExtractedTextFromBackground = async (
  url: string,
  html: string
): Promise<string> => {
  return await handleExtractText(url, html);
};

async function handleExtractText(url: string, html: string): Promise<string> {
  if (!html) {
    console.log("🌍 No HTML provided, fetching from backend:", url);
    try {
      const response = await fetch(`${BASE_URL}/api/extractText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html }),
      });

      const textResponse = await response.text();

      let data;
      try {
        data = JSON.parse(textResponse);
      } catch (err) {
        console.error("❌ JSON Parse Error:", textResponse);
        throw new Error("Invalid JSON returned from extractText API");
      }

      if (!data.success || !data.pageText) {
        throw new Error(`Text extraction failed: ${JSON.stringify(data)}`);
      }

      return data.pageText;
    } catch (error) {
      console.error("❌ Text extraction failed:", error);
      throw error; // Pass it up for orchestrateScraping to catch
    }
  } else {
    console.log("✅ HTML provided, skipping API request.");
    console.log("USE_HTML_DIRECTLY"); // ❗ Let orchestrateScraping handle it

    return html;
  }
}

export const fetchExternalPageContent = async (
  url: string
): Promise<{
  $: cheerio.CheerioAPI;
  isRetracted: boolean;
  isRSS?: boolean;
  pdfMeta?: {
    title?: string;
    author?: string;
    thumbnailUrl?: string;
  };
}> => {
  let isPdf = url.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    isPdf = await checkIfPdfViaHead(url);
  }

  if (isPdf) {
    // Server fallback
    return await fetchPdfViaServer(url);
  }

  // Server fallback
  return await fetchHtmlViaServer(url);
};

const fetchFromWaybackWithPuppeteer = async (originalUrl: string) => {
  const archiveUrl = `https://web.archive.org/web/${originalUrl}`;
  return await fetchViaPuppeteer(archiveUrl);
};
const fetchViaPuppeteer = async (url: string) => {
  console.warn("🤖 Fetching via Puppeteer:", url);
  const res = await fetchHtmlWithPuppeteer(url);
  if (res.success && res.html) {
    const cleaned = removeCookieWalls(res.html);
    const $ = cheerio.load(cleaned);
    const text = $("body").text().trim();
    if (text.length > 300) {
      console.log("✅ Puppeteer succeeded, length:", text.length);
      return { $, isRetracted: detectRetraction(cleaned) };
    }
  }
  return null;
};
