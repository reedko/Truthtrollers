// orchestrateScrapingExtension.ts
import {
  fetchExternalPageContent,
  getBestImage,
} from "../services/extractMetaDataExtension";
import {
  fetchPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaDataUtils";
import { getMainHeadline } from "../services/getMainHeadline";
import { analyzeContent } from "./openaiTopicsAndClaimsExtension";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";

import { YoutubeTranscript } from "youtube-transcript";
import {
  extractArticleRootHTML,
  smartCleanHTMLForReadability,
  trimTo60k,
} from "./orchestrateScrapingUtils";

import type { TaskData, Lit_references } from "../entities/Task";
import type { DiffbotData } from "../entities/diffbotData";
import * as cheerio from "cheerio";
import browser from "webextension-polyfill";
import { extractTestimonialsFromHtml } from "../utils/extractTestimonials";
import { getYoutubeTranscriptFromDOM } from "./extractYoutubeTranscriptFromDOM";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

interface ReadabilityResponse {
  success: boolean;
  text?: string;
}
export function cleanTranscript(raw: string): string {
  // Remove timestamps (e.g., 0:00, 12:45)
  const noTimestamps = raw.replace(/\b\d{1,2}:\d{2}\b/g, "");

  // Normalize whitespace
  const normalized = noTimestamps
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Break into chunks based on long pauses or double newlines (simulate paragraphs)
  const paragraphBreaks = normalized
    .split(/(?<=[.?!])\s+(?=[A-Z])/g) // Break after sentence-ending punctuation before capital letters
    .reduce<string[]>((chunks, sentence) => {
      if (chunks.length === 0) {
        return [sentence];
      }

      const last = chunks[chunks.length - 1];
      if (last.length + sentence.length < 1000) {
        chunks[chunks.length - 1] = last + " " + sentence;
      } else {
        chunks.push(sentence);
      }
      return chunks;
    }, []);

  return paragraphBreaks.join("\n\n"); // Paragraph-style spacing for easier claim parsing
}

const fallbackTranscriptFromServer = async (
  videoId: string
): Promise<string | null> => {
  try {
    const response = (await browser.runtime.sendMessage({
      action: "fallbackYoutubeTranscript",
      videoId,
    })) as { success: boolean; transcriptText?: string }; // 👈 Add this

    if (response.success && response.transcriptText) {
      const cleanScript = cleanTranscript(response.transcriptText);
      return cleanScript;
    }
  } catch (err) {
    console.warn("❌ Extension background fallback failed:", err);
  }
  return null;
};

const fetchDiffbotData = async (articleUrl: string): Promise<any> => {
  const result = await browser.runtime.sendMessage({ action: "pingTest" });
  console.log("pongTest result:", result);
  try {
    console.log("🔔 [Content] about to ask background for Diffbot data…");
    const response = await browser.runtime.sendMessage({
      action: "fetchDiffbotDataTest",
      articleUrl,
    });
    console.log("🔔 [Content] got back from background:", response);
    const result2 = await browser.runtime.sendMessage({ action: "pingTest" });
    console.log("pongTest result2:", result2);
    return response;
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

  if (url.includes("feed") || url.endsWith(".xml")) {
    console.warn("⚠️ Skipping likely RSS/XML feed:", url);
    return null;
  }

  let imageUrl = "";

  const videoId = extractVideoIdFromUrl(url);

  if (videoId) {
    try {
      console.log("🎥 Fetching transcript for video ID:", videoId);
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);

      if (!Array.isArray(transcript) || transcript.length === 0) {
        console.warn("⚠️ Transcript empty, trying DOM fallback…");

        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];

        if (activeTab?.id) {
          const domResponse = (await browser.runtime.sendMessage({
            action: "extractYoutubeTranscript",
            videoId,
          })) as { success: boolean; transcriptText?: string };

          if (domResponse.success && domResponse.transcriptText) {
            extractedText = domResponse.transcriptText;
            console.log("✅ Extension background returned transcriptText");
          } else {
            console.warn(
              "❌ Extension background did not return valid transcriptText"
            );
            const puppetFallback = await fallbackTranscriptFromServer(videoId);
            if (puppetFallback) {
              extractedText = puppetFallback;
              console.log("✅ Puppeteer server returned fallback transcript");
            } else {
              console.warn(
                "❌ Puppeteer server also failed to return transcript"
              );
            }
          }
        }
      } else {
        const transcriptText = transcript.map((entry) => entry.text).join(" ");
        extractedText = transcriptText;
        console.log("✅ YouTube transcript stored in extractedText");
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch YouTube transcript:", err);
      const puppetFallback = await fallbackTranscriptFromServer(videoId);
      if (puppetFallback) {
        extractedText = puppetFallback;
        console.log("✅ Puppeteer server returned fallback transcript");
      } else {
        console.warn("❌ Puppeteer server also failed to return transcript");
      }
      console.log("trans:", extractedText);
    }
  }
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
        return null;
      }
      $ = result.$;
      isRetracted = result.isRetracted;
      if (result.pdfMeta) {
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

    let readableText = "";

    try {
      const response = (await browser.runtime.sendMessage({
        action: "extractReadableText",
        html: cleanHTML,
        url,
      })) as ReadabilityResponse;
      if (response?.success && response.text) {
        readableText = response.text;
      }
    } catch (err) {
      console.error("❌ Readability message error:", err);
    }

    if (!extractedText && readableText && readableText.length > 300) {
      extractedText = readableText;
    } else if (!extractedText) {
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
    const existingAuthors = authors;
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
    const extractedTestimonials = extractTestimonialsFromHtml(extractedHtml);
    const topicsAndClaims = await analyzeContent(
      extractedText,
      extractedTestimonials
    );
    const { generalTopic, specificTopics, claims, testimonials } =
      topicsAndClaims;

    const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);
    await browser.runtime.sendMessage({
      action: "storeExtractedContent",
      data: {
        url,
        content_type: contentType,
        media_source: videoId ? "YouTube" : "Web",
        content_name: mainHeadline || "",
        raw_text: extractedText,
        video_id: videoId || null,
        thumbnail: imageUrl,
        topic: generalTopic,
        subtopics: specificTopics,
        authors,
        publisherName: publisherName?.name || null,
        is_retracted: false,
      },
    });
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
      is_retracted: false,
      testimonials,
    };
  } catch (e: any) {
    console.warn("🧨 Failed to load page content:", url);
    console.error("🧨 Error details:", e);
    return null;
  }
};
