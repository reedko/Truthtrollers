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
import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { analyzeContent } from "./openaiTopicsAndClaims";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";
import { TaskData, Lit_references } from "../entities/Task";

const EXTENSION_ID = "hfihldigngpdcbmedijohjdcjppdfepj";

const fetchDiffbotData = async (articleUrl: string): Promise<any> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { action: "fetchDiffbotData", articleUrl },
      (response) => resolve(response)
    );
  });
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

  try {
    if (contentType === "task") {
      diffbotData = await fetchDiffbotData(url);
      if (!diffbotData) throw new Error("Diffbot fetch returned null.");
      console.log("✅ Diffbot data received:", diffbotData);
    }
  } catch (error) {
    console.warn("⚠️ Diffbot fetch failed:", error);
  }

  // Fetch page content
  try {
    const $ =
      contentType === "task"
        ? fetchPageContent()
        : await fetchExternalPageContent(url);

    if (!$.html().trim()) {
      console.warn(`⚠️ No content loaded from: ${url}. Skipping.`);
      return null; // 👈 return early or handle however you want
    }

    const $cleaned = cheerio.load($.html()); // clone original
    $cleaned(
      "style, link[rel='stylesheet'], script:not([type='application/ld+json'])"
    ).remove();

    extractedHtml = $cleaned.html();

    try {
      extractedText = await getExtractedTextFromBackground(url, extractedHtml);
    } catch (err: any) {
      console.warn("⚠️ Caught an error in orchestrateScraping:", err);
      if (err) {
        console.log("🚀 Using extracted HTML from page directly.");
        extractedText = $("body").text().trim();
      } else {
        console.warn("⚠️ Failed to extract text from server:", err);
        extractedText = $cleaned("body").text().trim(); // 🔥 Fallback remains here
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

    // ✅ De-dupe based on name (case-insensitive)
    const seen = new Set();
    const authors = allAuthors.filter((author) => {
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

    let imageUrl = await getBestImage(url, extractedHtml, diffbotData);
    const baseUrl = new URL(url);
    if (imageUrl) {
      if (!imageUrl.startsWith("http")) {
        imageUrl = new URL(imageUrl, baseUrl).href;
      }
    }

    if (contentType === "task") {
      extractedReferences = await extractReferences($);
    }
    console.log(extractedReferences);
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
      authors: allAuthors,
      content: extractedReferences,
      publisherName,
      content_type: contentType,
      raw_text: extractedText,
      Claims: claims,
    };
  } catch (e) {
    console.warn("🧨 Failed to load page content:", url);
    return null; // fallback here too, if necessary
  }
};
