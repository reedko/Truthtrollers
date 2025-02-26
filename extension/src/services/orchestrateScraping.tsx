// orchestrateScraping.tsx
import {
  fetchPageContent,
  fetchExternalPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
  getExtractedTextFromBackground,
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

  // Get headline

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
  // Capture thumbnail image
  let imageUrl = diffbotData.images?.[0]?.url || null;
  if (!imageUrl) {
    imageUrl = await new Promise<string>((resolve) => {
      chrome.runtime.sendMessage({ action: "captureImage" }, (res) =>
        resolve(res.imageUrl || "")
      );
    });
  }

  // Extract references only if processing as "reference" content type
  if (contentType === "task") {
    extractedReferences = await extractReferences($);
  }

  // I) Now call the server to get "clean text" (this is optional if you trust your local text)
  //    but let's do it for consistency with your /api/extractText approach:
  let extractedText = "";
  try {
    extractedText = await getExtractedTextFromBackground(url);
    console.log("✅ Extracted text from server for URL:", url);
  } catch (err) {
    console.warn("Failed to extract text from server:", err);
    // fallback to local text if needed
    extractedText = $("body").text().trim();
  }

  // Extract topics and claims
  const topicsAndClaims = await analyzeContent(extractedText);
  generalTopic = topicsAndClaims.generalTopic;
  specificTopics = topicsAndClaims.specificTopics;
  claims = topicsAndClaims.claims;

  // Fetch icon for topic
  const iconThumbnailUrl = await checkAndDownloadTopicIcon(generalTopic);

  /*   // J) Next, call ClaimBuster on that text
  let claimsFromCB: any[] = [];
  try {
    claimsFromCB = await getClaimsFromBackground(extractedText);
    console.log("✅ ClaimBuster returned claims:", claimsFromCB);
  } catch (err) {
    console.warn("⚠️ ClaimBuster call failed:", err);
  }
 */
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
