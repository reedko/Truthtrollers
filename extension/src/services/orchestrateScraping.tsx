// orchestrateScraping.tsx
import {
  fetchPageContent,
  fetchExternalPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
  getExtractedTextFromBackground,
  getBestImage,
} from "../services/extractMetaData";
import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { analyzeContent } from "./openaiTopicsAndClaims";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";
import { Lit_references } from "../entities/Task";

const fetchDiffbotData = async (articleUrl: string): Promise<any> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "fetchDiffbotData", articleUrl },
      (response) => resolve(response)
    );
  });
};

export const orchestrateScraping = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference"
) => {
  let diffbotData: DiffbotData = {};
  let generalTopic = "";
  let claims: string[] = [];
  let specificTopics: string[] = [];
  let extractedReferences: Lit_references[] = [];
  let extractedText = "";
  let extractedHtml = ""; // ✅ Store extracted HTML to avoid duplicate requests
  try {
    contentType === "task"
      ? (diffbotData = await fetchDiffbotData(url))
      : (diffbotData = {});

    if (!diffbotData) throw new Error("Diffbot fetch returned null.");
    console.log("✅ Diffbot data received:", diffbotData);
  } catch (error) {
    console.warn("⚠️ Diffbot fetch failed:", error);
  }

  // Fetch page content
  const $ =
    contentType === "task"
      ? fetchPageContent()
      : await fetchExternalPageContent(url); // ✅ Use correct fetch function
  // 🚨 Remove all <style>, <link rel="stylesheet">, and <script> tags
  $("style, link[rel='stylesheet'], script").remove();
  // I) Now call the server to get "clean text" (this is optional if you trust your local text)
  //    but let's do it for consistency with your /api/extractText approach:

  // ✅ Extract clean HTML using Cheerio instead of making another request
  extractedHtml = $.html(); // Get full HTML content

  try {
    extractedText = await getExtractedTextFromBackground(url, extractedHtml); // ✅ Pass HTML to background
  } catch (err) {
    console.warn("⚠️ Failed to extract text from server:", err);
    extractedText = $("body").text().trim(); // Fallback
  }

  // Get headline or content_name
  const mainHeadline =
    content_name.length > 5
      ? content_name
      : diffbotData.title || (await getMainHeadline($));

  // Fetch authors and publisher in parallel

  const [authors, publisherName] = await Promise.all([
    diffbotData.author
      ? diffbotData.author.split(/[,&]/).map((name) => ({ name: name.trim() }))
      : extractAuthors($),
    diffbotData.publisher
      ? { name: diffbotData.publisher.trim() }
      : extractPublisher($),
  ]);

  // Get video ID if applicable
  const videoId = extractVideoIdFromUrl(url);
  console.log("✅ Extracted Publisher:", publisherName);

  // 🚀 Get the best image using background processing
  let imageUrl = await getBestImage(url, extractedHtml, diffbotData);
  const baseUrl = new URL(url);
  if (imageUrl) {
    if (!imageUrl.startsWith("http")) {
      if (imageUrl.startsWith("/")) {
        // ✅ If it starts with `/`, use baseUrl (origin)
        imageUrl = new URL(imageUrl, baseUrl.origin).href;
      } else {
        // ✅ If no `/`, assume it's relative to the full article URL
        imageUrl = new URL(imageUrl, baseUrl).href;
      }
    }
  }
  console.log("🎯 Final Image Selected:", imageUrl);

  // Extract references only if processing as "reference" content type
  if (contentType === "task") {
    extractedReferences = await extractReferences($);
  }
  /*   if (contentType === "task") {
    const allReferences = await extractReferences($);
    extractedReferences = allReferences.length > 0 ? [allReferences[0]] : [];
  } */

  console.log(extractedReferences);

  // Extract topics and claims
  const topicsAndClaims = await analyzeContent(extractedText);

  generalTopic = topicsAndClaims.generalTopic;
  specificTopics = topicsAndClaims.specificTopics;
  claims = topicsAndClaims.claims;

  // Fetch icon for topic
  const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);

  return {
    content_name: mainHeadline ? mainHeadline : "",
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
    // L) Include the extracted TEXT & claims so we can store them in the DB
    raw_text: extractedText, // <--- new
    Claims: claims, // <--- new
  };
};
