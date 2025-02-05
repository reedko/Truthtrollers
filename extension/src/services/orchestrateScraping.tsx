import {
  fetchPageContent, // ✅ Importing our existing function
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaData";
import { getMainHeadline } from "../services/getMainHeadline";
import { DiffbotData } from "../entities/diffbotData";
import { getTopicsFromText } from "../services/openaiTopics";
import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";
import { Author, Lit_references, Publisher } from "../entities/Task";

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const orchestrateScraping = async () => {
  let diffbotData: DiffbotData = {};
  let generalTopic = "";
  let specificTopics: string[] = [];

  try {
    // Fetch Diffbot Data
    const diffbotResponse = await fetch(`${BASE_URL}/api/pre-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl: window.location.href }), // Use the current page URL
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

  // ✅ Use our existing function to get the DOM via Cheerio
  const $ = fetchPageContent();

  // Determine Topics (from Diffbot or OpenAI)
  if (diffbotData.categories && Array.isArray(diffbotData.categories)) {
    generalTopic = diffbotData.categories[0]?.name || "General";
    specificTopics = diffbotData.categories
      .slice(1)
      .map((category) => category.name);
  } else {
    const contentText = $("body").text().trim();
    const topics = await getTopicsFromText(contentText);
    generalTopic = topics.generalTopic;
    specificTopics = topics.specificTopics;
  }

  // Get Headline (Diffbot or fallback)
  const mainHeadline = diffbotData.title || (await getMainHeadline($));

  // Get Publisher (Diffbot or fallback)
  const publisherName: Publisher | null = diffbotData.publisher
    ? { name: diffbotData.publisher.trim() }
    : await extractPublisher($);

  // Get Authors (Diffbot or fallback)
  const titleRegex = /^(Dr\.|Sir|Prof\.|Mr\.|Ms\.|Mrs\.)\s*/i;
  const postNominalRegex = /,\s*(PhD|MD|Esq|MBA|DDS|JD|DO|DVM)\b/i;

  const authors: Author[] = diffbotData.author
    ? diffbotData.author.split(/[,&]/).map((raw) => {
        let name = raw.trim();
        let titleMatch = name.match(titleRegex);
        let postNominalMatch = name.match(postNominalRegex);

        let title = titleMatch ? titleMatch[1] : null;
        if (title) name = name.replace(title, "").trim();

        let postNominal = postNominalMatch ? postNominalMatch[1] : null;
        if (postNominal) name = name.replace(postNominal, "").trim();

        return { name, title, postNominal };
      })
    : await extractAuthors($);

  // Get References (Diffbot or fallback)
  const lit_references: Lit_references[] = diffbotData.links?.length
    ? diffbotData.links.map((link) => ({
        lit_reference_link: link,
        lit_reference_title: "", // Title unknown for now
      }))
    : await extractReferences($);

  // Get Video ID (if applicable)
  const videoId = extractVideoIdFromUrl(window.location.href);

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
    media_source: videoId ? "YouTube" : "Web",
    url: window.location.href,
    assigned: "unassigned",
    progress: "Unassigned",
    users: "",
    details: window.location.href,
    topic: generalTopic,
    subtopics: specificTopics,
    thumbnail_url: imageUrl,
    iconThumbnailUrl: iconThumbnailUrl || null,
    authors,
    lit_references,
    publisherName,
  };

  return taskData;
};
