// extractMetaDataExtension.ts
import browser from "webextension-polyfill";
import * as cheerio from "cheerio";
import { DiffbotData } from "../entities/diffbotData";
import { Author, Publisher, Lit_references } from "../entities/Task";
import {
  extractImageFromHtml,
  removeCookieWalls,
  detectRetraction,
  isLikelyRSS,
  testImageLoad,
  parseSrcset,
  resolveUrl,
  isProcessableImage,
  isNavigationLink,
  getNavCategoryPrefixes,
} from "./extractMetaDataUtils";

import { fetchHtmlWithPuppeteer } from "./fetchHtmlWithPuppeteerExtension";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

interface ExtractTextResponse {
  success: boolean;
  pageText?: string;
  error?: string;
}

export const getExtractedTextFromBackground = async (
  url: string,
  html: string
): Promise<string> => {
  const response = (await browser.runtime.sendMessage({
    action: "extractText",
    url,
    html,
  })) as ExtractTextResponse;

  if (response?.success && response.pageText) return response.pageText;
  throw new Error(response?.error || "Failed to extract text");
};

interface ClaimBusterResponse {
  success: boolean;
  claims?: any[];
  error?: string;
}

export const getClaimsFromBackground = async (text: string): Promise<any[]> => {
  const response = (await browser.runtime.sendMessage({
    action: "claimBuster",
    text,
  })) as ClaimBusterResponse;

  if (response.success && response.claims) return response.claims;
  throw new Error(response.error || "Failed to call ClaimBuster");
};

interface CaptureImageResponse {
  imageUrl?: string;
}

export const getBestImage = async (
  url: string,
  extractedHtml: string,
  diffbotData: DiffbotData
): Promise<string> => {
  const response = (await browser.runtime.sendMessage({
    action: "captureImage",
    url,
    html: extractedHtml,
    diffbotData,
  })) as CaptureImageResponse;

  return response?.imageUrl || `${BASE_URL}/assets/images/miniLogo.png`;
};

interface FetchPdfTextResponse {
  success: boolean;
  text?: string;
  title?: string;
  authors?: string[];
  thumbnailUrl?: string;
}

interface FetchPageContentResponse {
  success: boolean;
  text?: string;
  html: string;
}

export const fetchExternalPageContent = async (
  url: string
): Promise<{
  $: cheerio.CheerioAPI;
  isRetracted: boolean;
  isRSS?: boolean;
  pdfMeta?: {
    title?: string;
    authors?: string[];
    thumbnailUrl?: string;
  };
}> => {
  const checkPdfResponse = (await browser.runtime.sendMessage({
    action: "checkIfPdf",
    url,
  })) as { isPdf: boolean };

  if (checkPdfResponse?.isPdf) {
    const response = (await browser.runtime.sendMessage({
      action: "fetchPdfText",
      url,
    })) as FetchPdfTextResponse;
    console.log(response, ":::PDFMETA");
    if (!response?.success || !response.text)
      return { $: cheerio.load(""), isRetracted: false };

    const $ = cheerio.load(`<body>${response.text.trim()}</body>`);
    return {
      $,
      isRetracted: detectRetraction(response.text),
      pdfMeta: {
        title: response.title,
        authors: Array.isArray(response.authors)
          ? response.authors
          : ([] as string[]),

        thumbnailUrl: response.thumbnailUrl,
      },
    };
  }

  const response = (await browser.runtime.sendMessage({
    action: "fetchPageContent",
    url,
  })) as FetchPageContentResponse;

  if (!response?.success || !response.html)
    throw new Error("Extension fetch failed");

  const cleaned = removeCookieWalls(response.html);
  if (isLikelyRSS(cleaned)) {
    return { $: cheerio.load(""), isRetracted: false, isRSS: true };
  }

  const $ = cheerio.load(cleaned);
  const len = $("body").text().trim().length;

  if (len < 300) throw new Error("Too little content");

  return { $, isRetracted: detectRetraction(cleaned) };
};

export const fetchFromWaybackWithPuppeteer = async (originalUrl: string) => {
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
