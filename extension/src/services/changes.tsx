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

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

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

  // Fetch page content
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
      console.log("✅ fetchExternalPageContent success");
    }

    if (!$.html().trim()) {
      console.warn(`⚠️ No content loaded from: ${url}. Skipping.`);
      return null;
    }

    const $cleaned = cheerio.load($.html());
    $cleaned(
      "style, link[rel='stylesheet'], script:not([type='application/ld+json'])"
    ).remove();

    extractedHtml = $cleaned.html();

    // ✅ Use Readability for claim extraction text
    let readableText = "";

    if (typeof chrome !== "undefined" && chrome?.runtime?.id) {
      // Running in extension – use background message to call backend
      readableText = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "extractReadableText",
            html: $.html(),
            url,
          },
          (response) => {
            if (response?.success && response.text) {
              resolve(response.text);
            } else {
              console.warn(
                "❌ Failed to extract readable text via background."
              );
              resolve("");
            }
          }
        );
      });
    } else {
      // Running from server – call directly
      try {
        const res = await fetch(`${BASE_URL}/api/extract-readable-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: $.html(), url }),
        });
        const json = await res.json();
        readableText = json.text || "";
      } catch (err) {
        console.warn("❌ API call failed:", err);
        readableText = "";
      }
    }

    if (readableText && readableText.length > 300) {
      extractedText = readableText;
      console.log("✅ Using Readability textContent for claim analysis");
    } else {
      try {
        extractedText = await getExtractedTextFromBackground(
          url,
          extractedHtml
        );
      } catch (err: any) {
        console.warn("⚠️ Caught an error in orchestrateScraping:", err);
        if (err) {
          console.log("🚀 Using extracted HTML from page directly.");
          extractedText = $("body").text().trim();
        } else {
          extractedText = $cleaned("body").text().trim();
        }
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
      if (imageUrl) {
        if (!imageUrl.startsWith("http")) {
          imageUrl = new URL(imageUrl, baseUrl).href;
        }
      }
    } else {
      imageUrl = thumbNailUrl;
    }

    if (contentType === "task") {
      extractedReferences = await extractReferences($);
      console.log("References to process:", extractedReferences);
    }

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
      is_retracted: isRetracted,
    };
  } catch (e: any) {
    console.warn("🧨 Failed to load page content:", url);
    console.error("🧨 Error details:", e);
    return null;
  }
};
