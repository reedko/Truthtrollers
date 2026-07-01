// backend/src/core/youtubeTranscript.js
// ─────────────────────────────────────────────
// Extract YouTube video transcript from URL
// Wrapper around getYoutubeTranscriptWithPuppeteer
// ─────────────────────────────────────────────

import { getYoutubeTranscriptWithPuppeteer } from "../utils/getYoutubeTranscriptWithPuppeteer.js";
import logger from "../utils/logger.js";

/**
 * extractVideoId(url)
 *
 * Extracts YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 */
function extractVideoId(url) {
  try {
    const urlObj = new URL(url);

    // youtube.com/watch?v=...
    if (urlObj.hostname.includes("youtube.com") && urlObj.searchParams.has("v")) {
      return urlObj.searchParams.get("v");
    }

    // youtu.be/VIDEO_ID
    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1); // Remove leading /
    }

    // youtube.com/embed/VIDEO_ID
    if (urlObj.pathname.includes("/embed/")) {
      return urlObj.pathname.split("/embed/")[1].split("/")[0];
    }

    return null;
  } catch (err) {
    logger.error(`❌ [extractVideoId] Invalid URL: ${url}`, err);
    return null;
  }
}

/**
 * extractTranscript(url)
 *
 * Extracts YouTube transcript from a video URL.
 *
 * Returns: transcript text (string) or null if extraction fails
 */
export async function extractTranscript(url) {
  try {
    logger.log(`📹 [extractTranscript] Extracting transcript for: ${url}`);

    const videoId = extractVideoId(url);

    if (!videoId) {
      logger.warn(`⚠️ [extractTranscript] Could not extract video ID from: ${url}`);
      return null;
    }

    const transcript = await getYoutubeTranscriptWithPuppeteer(videoId);

    if (!transcript || transcript.length < 10) {
      logger.warn(`⚠️ [extractTranscript] Transcript empty or too short for: ${url}`);
      return null;
    }

    logger.log(`✅ [extractTranscript] Extracted ${transcript.length} chars from ${videoId}`);

    return transcript;
  } catch (err) {
    logger.error(`❌ [extractTranscript] Error extracting transcript from ${url}:`, err);
    return null;
  }
}
