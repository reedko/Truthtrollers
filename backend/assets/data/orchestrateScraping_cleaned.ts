// ✅ Full orchestrateScraping.ts with smart cleaning + slicing added

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

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";
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

  if (url.includes("feed") || url.endsWith(".xml")) {
    console.warn("⚠️ Skipping likely RSS/XML feed:", url);
    return null;
  }

  try {
    console.log("📦 Starting to fetch page content for", url);
    let $: cheerio.CheerioAPI;
    let isRetracted = false;
    let thumbNailUrl = "";

    if (contentType === "task") {
      $ = await fetchPageContent();
    } else {
      const result = await fetchExternalPageContent(url);
      if (!result || !result.$ || result.isRSS) return null;

      $ = result.$;
      isRetracted = result.isRetracted;
      if (result.pdfMeta) {
        if (!content_name || content_name.length < 5)
          content_name = result.pdfMeta.title || content_name;
        if (!authors.length && result.pdfMeta.author) {
          authors.push({
            name: result.pdfMeta.author,
            description: null,
            image: null,
          });
          thumbNailUrl = result.pdfMeta.thumbnailUrl || "";
        }
      }
    }

    if (!$.html().trim()) return null;

    const $cleaned = cheerio.load($.html());
    extractedHtml = smartCleanHTMLForReadability($cleaned);

    let cleanHTML = extractArticleRootHTML($cleaned);
    if (!cleanHTML) cleanHTML = extractedHtml;

    let readableText = "";
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

    if (
      readableText &&
      readableText.length > 300 &&
      readableText.length < 16000 * 4
    ) {
      extractedText = readableText;
    } else {
      try {
        extractedText = await getExtractedTextFromBackground(
          url,
          extractedHtml
        );
      } catch (err: any) {
        console.warn("⚠️ Caught error during fallback text extraction:", err);
        extractedText = $("body").text().trim();
      }
    }

    if (extractedText.length > 64000) {
      const lines = extractedText
        .split("\n")
        .filter((line) => line.trim().length > 0);
      let endIndex = lines.length;
      while (endIndex > 0 && lines[endIndex - 1].length < 120) endIndex--;
      const sliced = lines.slice(0, endIndex).join("\n").trim();
      if (sliced.length > 300) {
        console.log(
          "✂️ Sliced long text from",
          extractedText.length,
          "→",
          sliced.length
        );
        extractedText = sliced;
      }
    }

    const mainHeadline =
      content_name.length > 5
        ? content_name
        : diffbotData.title || (await getMainHeadline($));

    const extractedAuthors = await extractAuthors($);
    const diffbotAuthors = diffbotData.author
      ? diffbotData.author.split(/[,&]/).map((name) => ({
          name: name.trim(),
          description: null,
          image: null,
        }))
      : [];

    const allAuthors = [...extractedAuthors, ...diffbotAuthors];
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
    }

    const topicsAndClaims = await analyzeContent(cleanHTML);
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
