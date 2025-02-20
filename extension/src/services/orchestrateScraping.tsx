// orchestrateScraping.tsx
import {
  fetchPageContent,
  fetchExternalPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaData";
import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { getTopicsFromText } from "../services/openaiTopics";
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
  let specificTopics: string[] = [];
  let extractedReferences: Lit_references[] = [];

  try {
    diffbotData = await fetchDiffbotData(url);
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

  // Extract topics
  if (diffbotData.categories?.length) {
    generalTopic = diffbotData.categories[0]?.name || "General";
    specificTopics = diffbotData.categories.slice(1).map((c) => c.name);
  } else {
    const contentText = $("body").text().trim();
    const topics = await getTopicsFromText(contentText);
    generalTopic = topics.generalTopic;
    specificTopics = topics.specificTopics;
  }

  // Get headline

  const mainHeadline =
    content_name.length > 5
      ? content_name
      : diffbotData.title || (await getMainHeadline($));

  // Fetch authors and publisher in parallel
  console.log("HEEEEEEEED:", mainHeadline);
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

  // Capture thumbnail image
  let imageUrl = diffbotData.images?.[0]?.url || "";
  if (!imageUrl) {
    imageUrl = await new Promise<string>((resolve) => {
      chrome.runtime.sendMessage({ action: "captureImage" }, (res) =>
        resolve(res.imageUrl || "")
      );
    });
  }
  console.log(":IIIIIIMMMMMMAMMMMAMAMMAA:", imageUrl);

  // Fetch icon for topic
  const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);
  console.log(":iconThumbnailUrl:", iconThumbnailUrl);

  // Extract references only if processing as "reference" content type
  if (contentType === "task") {
    extractedReferences = await extractReferences($);
  }

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
  };
};
