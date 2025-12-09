// extension/src/services/orchestrateScrapingExtension.ts
// -------------------------------------------------------
// PURE SCRAPER — NO LLM, NO analyzeContent.
// Sends only metadata + raw_text + DOM references to backend.
// -------------------------------------------------------

import browser from "webextension-polyfill";
import * as cheerio from "cheerio";

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

import { extractVideoIdFromUrl } from "../services/parseYoutubeUrl";
import { YoutubeTranscript } from "youtube-transcript";

import {
  smartCleanHTMLForReadability,
  extractArticleRootHTML,
  trimTo60k,
} from "./orchestrateScrapingUtils";

import { extractTestimonialsFromHtml } from "../utils/extractTestimonials";
import checkAndDownloadTopicIcon from "../services/checkAndDownloadTopicIcon";

import type {
  TaskData,
  Lit_references,
  Author,
  Publisher,
} from "../entities/Task";

interface ReadabilityResponse {
  success: boolean;
  text?: string;
}

// -------------------------------------------------------
// Small Helpers
// -------------------------------------------------------

function cleanTranscript(raw: string): string {
  const noTS = raw.replace(/\b\d{1,2}:\d{2}\b/g, "");
  const norm = noTS
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const paras = norm
    .split(/(?<=[.?!])\s+(?=[A-Z])/g)
    .reduce<string[]>((arr, sentence) => {
      if (!arr.length) return [sentence];
      const last = arr[arr.length - 1];
      if (last.length + sentence.length < 1000) {
        arr[arr.length - 1] = last + " " + sentence;
      } else arr.push(sentence);
      return arr;
    }, []);

  return paras.join("\n\n");
}

async function fallbackTranscript(videoId: string): Promise<string | null> {
  try {
    const resp = (await browser.runtime.sendMessage({
      action: "fallbackYoutubeTranscript",
      videoId,
    })) as { success: boolean; transcriptText?: string };

    if (resp.success && resp.transcriptText) {
      return cleanTranscript(resp.transcriptText);
    }
  } catch {}

  return null;
}

// -------------------------------------------------------
// MAIN FUNCTION
// -------------------------------------------------------

export async function orchestrateScraping(
  url: string,
  content_name: string,
  contentType: "task" | "reference"
): Promise<TaskData | null> {
  try {
    const isPdf = /\.pdf($|\?)/i.test(url);

    let extractedText = "";
    let extractedHtml = "";
    let authors: Author[] = [];
    let publisherName: Publisher | null = null;
    let references: Lit_references[] = [];
    let thumbnail = "";
    let topic = "general"; // placeholder; backend will override
    let subtopics: string[] = []; // placeholder
    let testimonials = [];

    // -------------------------------------------------------
    // 1. YOUTUBE TRANSCRIPT (if applicable)
    // -------------------------------------------------------
    const videoId = extractVideoIdFromUrl(url);

    if (videoId) {
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);

        if (Array.isArray(transcript) && transcript.length) {
          extractedText = transcript.map((e) => e.text).join(" ");
        } else {
          const domResp = (await browser.runtime.sendMessage({
            action: "extractYoutubeTranscript",
            videoId,
          })) as { success: boolean; transcriptText?: string };

          if (domResp.success && domResp.transcriptText) {
            extractedText = domResp.transcriptText;
          } else {
            const fb = await fallbackTranscript(videoId);
            if (fb) extractedText = fb;
          }
        }
      } catch {
        const fb = await fallbackTranscript(videoId);
        if (fb) extractedText = fb;
      }
    }

    // -------------------------------------------------------
    // 2. FETCH HTML OR PDF CONTENT
    // -------------------------------------------------------
    let $: cheerio.CheerioAPI;

    if (contentType === "task" && !isPdf) {
      // local DOM
      $ = await fetchPageContent();
    } else {
      // background fetch
      const result = await fetchExternalPageContent(url);
      if (!result?.$) return null;
      $ = result.$;

      // PDF metadata
      if (result.pdfMeta) {
        if (!content_name || content_name.length < 5) {
          content_name = result.pdfMeta.title || content_name;
        }

        if (Array.isArray(result.pdfMeta.authors)) {
          authors = result.pdfMeta.authors.map((name) => ({
            name,
            description: null,
            image: null,
          }));
        }

        if (result.pdfMeta.thumbnailUrl) {
          thumbnail = result.pdfMeta.thumbnailUrl;
        }
      }
    }

    if (!$.html().trim()) return null;

    // -------------------------------------------------------
    // 3. CLEAN HTML & EXTRACT READABLE TEXT
    // -------------------------------------------------------
    const $clean = cheerio.load($.html());
    extractedHtml = smartCleanHTMLForReadability($clean);

    const $smart = cheerio.load(extractedHtml);
    const articleRoot = extractArticleRootHTML($smart) || extractedHtml;

    try {
      const resp = (await browser.runtime.sendMessage({
        action: "extractReadableText",
        html: articleRoot,
        url,
      })) as ReadabilityResponse;

      if (resp.success && resp.text) extractedText = resp.text;
    } catch {}

    if (!extractedText) {
      const $manual = cheerio.load(articleRoot);
      $manual("style,link,script:not([type='application/ld+json'])").remove();
      extractedText = $manual.text();
    }

    extractedText = trimTo60k(extractedText);

    // -------------------------------------------------------
    // 4. METADATA EXTRACTION
    // -------------------------------------------------------

    // Authors (PDF + DOM)
    const domAuthors = await extractAuthors($);
    authors = [
      ...authors,
      ...domAuthors.filter(
        (a) => !authors.some((x) => x.name === (a?.name ?? ""))
      ),
    ];

    // Publisher
    publisherName = publisherName || (await extractPublisher($));

    // Thumbnail
    if (!thumbnail) {
      const guess = await getBestImage(url, extractedHtml, {});
      if (guess) {
        const base = new URL(url);
        thumbnail = guess.startsWith("http")
          ? guess
          : new URL(guess, base).href;
      }
    }

    // References (DOM-only, ONLY for task)
    if (contentType === "task") {
      references = await extractReferences($);
    }

    // Testimonials
    testimonials = extractTestimonialsFromHtml(extractedHtml);

    // Topic icon
    const iconThumbnailUrl = await checkAndDownloadTopicIcon(topic);

    // -------------------------------------------------------
    // 5. BUILD & RETURN TaskData (envelope)
    // -------------------------------------------------------
    const envelope: TaskData = {
      content_name,
      media_source: videoId ? "YouTube" : "Web",
      url,
      assigned: "unassigned",
      progress: "Unassigned",
      users: "",
      details: url,
      topic,
      subtopics,
      thumbnail,
      iconThumbnailUrl: iconThumbnailUrl || null,
      authors,
      content: references,
      publisherName,
      content_type: contentType,
      raw_text: extractedText,
      Claims: [], // backend only now
      taskContentId: null,
      is_retracted: false,
      testimonials,
    };

    return envelope;
  } catch (err) {
    console.error("❌ orchestrateScraping failed:", url, err);
    return null;
  }
}
