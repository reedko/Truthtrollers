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
): Promise<TaskData> => {
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
  const $ =
    contentType === "task"
      ? fetchPageContent()
      : await fetchExternalPageContent(url);

  $("style, link[rel='stylesheet'], script").remove();

  extractedHtml = $.html();
  console.log(extractedHtml);
  try {
    extractedText = await getExtractedTextFromBackground(url, extractedHtml);
  } catch (err) {
    console.warn("⚠️ Failed to extract text from server:", err);
    extractedText = $("body").text().trim();
  }

  const mainHeadline =
    content_name.length > 5
      ? content_name
      : diffbotData.title || (await getMainHeadline($));

  const [authors, publisherName] = await Promise.all([
    diffbotData.author
      ? diffbotData.author.split(/[,&]/).map((name) => ({ name: name.trim() }))
      : extractAuthors($),
    diffbotData.publisher
      ? { name: diffbotData.publisher.trim() }
      : extractPublisher($),
  ]);

  const videoId = extractVideoIdFromUrl(url);
  console.log("✅ Extracted Publisher:", publisherName);
  console.log("✅ Extracted a:", authors);

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
    authors,
    content: extractedReferences,
    publisherName,
    content_type: contentType,
    raw_text: extractedText,
    Claims: claims,
  };
};
