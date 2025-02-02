import {
  fetchPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaData";
import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { getTopicsFromText } from "../services/openaiTopics";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const orchestrateScraping = async (url: string) => {
  let diffbotData: DiffbotData = {};
  let generalTopic = "";
  let specificTopics: string[] = [];

  try {
    // Fetch Diffbot data first
    const diffbotResponse = await fetch(`${BASE_URL}/api/pre-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl: url }),
    });

    if (!diffbotResponse.ok) {
      throw new Error(
        `Diffbot call failed with status: ${diffbotResponse.status}`
      );
    }

    diffbotData = await diffbotResponse.json();
    console.log("Diffbot data received:", diffbotData);
  } catch (error) {
    console.warn("Diffbot fetch failed:", error);
  }

  // Manual Scraping Fallback (Only if Diffbot didn't provide data)
  const $ = diffbotData.text ? null : await fetchPageContent(url);

  // Determine Topics (from Diffbot or OpenAI)
  if (diffbotData.categories && Array.isArray(diffbotData.categories)) {
    generalTopic = diffbotData.categories[0]?.name || "General";
    specificTopics = diffbotData.categories
      .slice(1)
      .map((category) => category.name);
  } else if ($) {
    const contentText = $("body").text().trim();
    const topics = await getTopicsFromText(contentText);
    generalTopic = topics.generalTopic;
    specificTopics = topics.specificTopics;
  }

  // Get Headline (Diffbot or fallback)
  const mainHeadline =
    diffbotData.title || ($ ? await getMainHeadline(url) : "Untitled");

  // Get Publisher (Diffbot or fallback)
  const mediaSource =
    diffbotData.publisher || ($ ? await extractPublisher($, url) : "Unknown");

  // Get Authors (Diffbot or fallback)
  const authors = diffbotData.author
    ? [{ name: diffbotData.author }]
    : $
    ? await extractAuthors($)
    : [];

  // Get References (Diffbot or fallback)
  const references = diffbotData.links || ($ ? await extractReferences($) : []);

  // Get Video ID (if applicable)
  const videoId = extractVideoIdFromUrl(url);

  // Capture Image (Diffbot's largest image or fallback)
  let imageUrl = diffbotData.images?.[0]?.url || "";
  if (!imageUrl) {
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage(
        { action: "captureImage" },
        (response: { imageUrl?: string }) => {
          imageUrl = response.imageUrl || "";
          resolve();
        }
      );
    });
  }

  // Fetch icon for topic
  const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);

  // Prepare Task Data
  const taskData = {
    task_name: mainHeadline,
    media_source: videoId ? "YouTube" : mediaSource,
    url,
    assigned: "unassigned",
    progress: "Unassigned",
    users: "",
    details: url,
    topic: generalTopic,
    subtopics: specificTopics,
    thumbnail_url: imageUrl,
    iconThumbnailUrl: iconThumbnailUrl || null,
    authors,
    references,
  };

  return taskData;
};
