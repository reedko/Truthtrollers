// src/services/orchestrateScraping.ts

import {
  fetchPageContent,
  fetchExternalPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
  getExtractedTextFromBackground,
  getBestImage,
} from "../services/extractMetaData";
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";

import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { analyzeContent } from "./openaiTopicsAndClaims";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";
import { TaskData, Lit_references } from "../entities/Task";
import browser from "webextension-polyfill";

interface ReadabilityResponse {
  success: boolean;
  text?: string;
}
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
function extractArticleRootHTML($: cheerio.CheerioAPI): string | null {
  const selectors = [
    '[data-cy="article-content"]',
    ".rawHtml-content-no-nativo",
    "article",
    '[role="main"]',
    ".main-content",
    "#main",
    ".content",
    ".post-content",
    ".entry-content",
  ];

  let bestNode: Cheerio<any> | null = null;
  let bestScore = 0;

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const node = $(el);
      const text = node.text().trim();
      const paraCount = node.find("p").length;
      const charCount = text.length;

      // Heuristic: favor nodes with many <p> and characters
      const score = paraCount * 10 + charCount;

      if (paraCount >= 2 && charCount > 200 && score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  }

  if (bestNode) {
    return (bestNode as Cheerio<any>).html()?.trim() || null;
  }

  // 🔻 Fallback to cleaned body if no good match
  console.warn(
    "⚠️ No strong article node found — falling back to cleaned <body>"
  );

  const body = $("body").clone();

  body.find("script, style, nav, footer, aside, iframe").remove();
  body
    .find(
      ".ad, .ads, .popup, .newsletter, .social-share, .comments, .related, .cookie"
    )
    .remove();

  const cleanedHtml = body.html()?.trim() || null;

  if (cleanedHtml) {
    const maxLength = 64000;
    return cleanedHtml.length > maxLength
      ? cleanedHtml.slice(0, maxLength) + "\n<!-- Truncated -->"
      : cleanedHtml;
  }

  return null;
}
function trimTo60k(text: string) {
  while (text.length > 60000) {
    const lastNewline = text.lastIndexOf("\n");

    if (lastNewline === -1) {
      // No newline found; remove a single character.
      // This handles the case where it's just one long line.
      text = text.slice(0, -1);
    } else {
      // Drop the entire last line.
      text = text.slice(0, lastNewline);
    }
  }
  return text;
}

const fetchDiffbotData = async (articleUrl: string): Promise<any> => {
  try {
    const response = await browser.runtime.sendMessage({
      action: "fetchDiffbotData",
      articleUrl,
    });
    return response;
  } catch (err) {
    console.error("Failed to fetch Diffbot data:", err);
    return null;
  }
};
function smartCleanHTMLForReadability($: cheerio.CheerioAPI): string {
  const $clean = cheerio.load($.html());
  $clean(
    "style, link[rel='stylesheet'], script:not([type='application/ld+json'])"
  ).remove();
  $clean("img[src^='data:']").remove(); // Remove base64 images
  $clean("figure, figcaption, .caption, .image, .media").remove();
  return $clean.html() || "";
}
export const orchestrateScraping = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference"
): Promise<TaskData | null> => {
  let diffbotData: DiffbotData = {};
  let generalTopic = "";
  let claims: string[] = [];
  let specificTopics: string[] = [];
  let extractedReferences: Lit_references[] = [];
  let extractedText = "";
  let extractedHtml = "";
  let authors = [];

  try {
    if (contentType === "task") {
      diffbotData = await fetchDiffbotData(url);
      if (!diffbotData) throw new Error("Diffbot fetch returned null.");
      console.log("✅ Diffbot data received:", diffbotData);
    }
  } catch (error) {
    console.warn("⚠️ Diffbot fetch failed:", error);
  }

  // 🧠 Detect and skip RSS feeds
  if (url.includes("feed") || url.endsWith(".xml")) {
    console.warn("⚠️ Skipping likely RSS/XML feed:", url);
    return null;
  }

  // Fetch page content
  try {
    console.log("📦 Starting to fetch page content for", url);
    let $: cheerio.CheerioAPI;
    let isRetracted = false;
    let thumbNailUrl = "";
    if (contentType === "task") {
      $ = await fetchPageContent();
      console.log("✅ fetchPageContent success");
    } else {
      const result = await fetchExternalPageContent(url);

      if (!result || !result.$ || result.isRSS) {
        console.warn(
          `⚠️ fetchExternalPageContent returned no usable content for ${url}.`
        );
        result.isRSS && console.warn(`RSS feed.`);
        return null;
      }

      $ = result.$;
      isRetracted = result.isRetracted;
      if (result.pdfMeta) {
        console.log("📄 PDF metadata:", result.pdfMeta);
        if (!content_name || content_name.length < 5) {
          content_name = result.pdfMeta.title || content_name;
        }
        if (!authors.length && result.pdfMeta.author) {
          authors.push({
            name: result.pdfMeta.author,
            description: null,
            image: null,
          });
          thumbNailUrl = result.pdfMeta.thumbnailUrl || "";
        }
      }
      console.log("✅ fetchExternalPageContent success", result);
    }

    if (!$.html().trim()) {
      console.warn(`⚠️ No content loaded from: ${url}. Skipping.`);
      return null;
    }

    const $cleaned = cheerio.load($.html());
    extractedHtml = smartCleanHTMLForReadability($cleaned);
    const $smart = cheerio.load(extractedHtml);
    let cleanHTML = extractArticleRootHTML($smart);
    if (!cleanHTML) cleanHTML = extractedHtml;

    // ✅ Try Readability
    let readableText = "";

    if (typeof browser !== "undefined" && browser?.runtime?.id) {
      try {
        const response = (await browser.runtime.sendMessage({
          action: "extractReadableText",
          html: cleanHTML,
          url,
        })) as ReadabilityResponse;

        console.log("📦 Readability background response:", response);

        if (response?.success && response.text) {
          readableText = response.text;
        } else {
          console.warn("❌ Readability fallback triggered.");
          readableText = "";
        }
      } catch (err) {
        console.error("❌ Readability message error:", err);
        readableText = "";
      }
    } else {
      try {
        const res = await fetch(`${BASE_URL}/api/extract-readable-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: cleanHTML, url }),
        });
        const json = await res.json();
        readableText = json.text || "";
      } catch (err) {
        console.warn("❌ API call to Readability failed:", err);
        readableText = "";
      }
    }

    if (readableText && readableText.length > 300) {
      console.log("✅ Readability succeeded, using readableText");
      extractedText = readableText;
    } else {
      console.warn(
        "⚠️ Readability failed or text too long — using cleanHTML fallback"
      );

      extractedText = cleanHTML || "";
      const $ext = cheerio.load(cleanHTML);
      $ext(
        "style, link[rel='stylesheet'], script:not([type='application/ld+json'])"
      ).remove();
      extractedText = $ext.text();
    }

    if (extractedText.length > 60000) {
      extractedText = trimTo60k(extractedText);
    }

    const mainHeadline =
      content_name.length > 5
        ? content_name
        : diffbotData.title || (await getMainHeadline($));
    const existingAuthors = authors; // the array that might have PDF’s author
    const extractedAuthors = await extractAuthors($);
    const diffbotAuthors = diffbotData.author
      ? diffbotData.author.split(/[,&]/).map((name) => ({
          name: name.trim(),
          description: null,
          image: null,
        }))
      : [];

    const allAuthors = [
      ...extractedAuthors,
      ...diffbotAuthors,
      ...existingAuthors,
    ];
    const seen = new Set();
    authors = allAuthors.filter((author) => {
      const nameKey = author.name?.toLowerCase();
      if (nameKey && !seen.has(nameKey)) {
        seen.add(nameKey);
        return true;
      }
      return false;
    });

    const publisherName = diffbotData.publisher
      ? { name: diffbotData.publisher.trim() }
      : await extractPublisher($);

    const videoId = extractVideoIdFromUrl(url);
    let imageUrl = "";
    if (!thumbNailUrl) {
      imageUrl = await getBestImage(url, extractedHtml, diffbotData);
      const baseUrl = new URL(url);
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = new URL(imageUrl, baseUrl).href;
      }
    } else {
      imageUrl = thumbNailUrl;
    }

    if (contentType === "task") {
      extractedReferences = await extractReferences($);
      console.log("References to process:", extractedReferences);
    }

    const topicsAndClaims = await analyzeContent(extractedText);
    generalTopic = topicsAndClaims.generalTopic;
    specificTopics = topicsAndClaims.specificTopics;
    claims = topicsAndClaims.claims;

    const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);

    return {
      content_name: mainHeadline || "",
      media_source: videoId ? "YouTube" : "Web",
      url,
      assigned: "unassigned",
      progress: "Unassigned",
      users: "",
      details: url,
      topic: generalTopic,
      subtopics: specificTopics,
      thumbnail: imageUrl,
      iconThumbnailUrl: iconThumbnailUrl || null,
      authors,
      content: extractedReferences,
      publisherName,
      content_type: contentType,
      raw_text: extractedText,
      Claims: claims,
      is_retracted: isRetracted,
    };
  } catch (e: any) {
    console.warn("🧨 Failed to load page content:", url);
    console.error("🧨 Error details:", e);
    return null;
  }
};
