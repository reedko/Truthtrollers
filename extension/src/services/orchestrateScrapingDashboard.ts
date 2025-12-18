// orchestrateScrapingExtension.ts
import {
  fetchPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaDataUtils";
import {
  getBestImage,
  fetchExternalPageContent,
} from "./extractMetaDataDashboard";
import { getMainHeadline } from "../services/getMainHeadline";
import { analyzeContent } from "./openaiTopicsAndClaimsDashboard";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import { checkAndDownloadTopicIcon } from "../services/checkAndDownloadTopicIconDashboard";
import {
  extractArticleRootHTML,
  smartCleanHTMLForReadability,
  trimTo60k,
} from "./orchestrateScrapingUtils";
import type { TaskData, Lit_references } from "../entities/Task";
import type { DiffbotData } from "../entities/diffbotData";
import * as cheerio from "cheerio";
import { extractTestimonialsFromHtml } from "../utils/extractTestimonials";

// ...inside your main scraping/orchestration flow:

interface ReadabilityResponse {
  success: boolean;
  text?: string;
}

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
const fetchDiffbotData = async (articleUrl: string): Promise<any> => {
  try {
    return fetchDiffbotData(articleUrl)
      .then((data) => data || { success: false })
      .catch(() => ({ success: false }));
  } catch (err) {
    console.error("Failed to fetch Diffbot data:", err);
    return null;
  }
};
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

    // ✅ Always try to get HTML from loaded tab first (for manual dashboard scrapes)
    try {
      $ = await fetchPageContent(url);
      console.log("✅ fetchPageContent success (from loaded tab)");
    } catch (tabError) {
      // Fallback to external fetch if no tab found
      console.warn("⚠️ No loaded tab found, falling back to external fetch:", tabError);
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
    const extractedTestimonials = extractTestimonialsFromHtml(cleanHTML);

    const topicsAndClaims = await analyzeContent(
      extractedText,
      extractedTestimonials
    );
    const { generalTopic, specificTopics, claims, testimonials } =
      topicsAndClaims;

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
      testimonials,
    };
  } catch (e: any) {
    console.warn("🧨 Failed to load page content:", url);
    console.error("🧨 Error details:", e);
    return null;
  }
};
