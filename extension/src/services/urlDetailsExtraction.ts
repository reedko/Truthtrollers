import axios from "axios";
import YouTubeTranscriptApi from "youtube-transcript-api";
import { Readability } from "@mozilla/readability";

// Helper function to extract YouTube transcript
export const getYoutubeTranscript = async (videoId: string | null) => {
  if (!videoId) return null;
  try {
    const transcript = await YouTubeTranscriptApi.getYoutubeTranscript(videoId);
    return transcript.map((entry: { text: any }) => entry.text).join(" "); // Combine transcript text into one string
  } catch (error) {
    console.error("Error fetching YouTube transcript:", error);
    return null;
  }
};

// Helper function to extract the main content from a URL (HTML pages)
export const extractContentFromUrl = async (url: string) => {
  try {
    const response = await axios.get(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(response.data, "text/html");
    const readabilityDoc = new Readability(doc).parse();

    return readabilityDoc?.textContent || "No content found"; // Extract main content using Readability
  } catch (error) {
    console.error("Error extracting content from URL:", error);
    return null;
  }
};

// Main function to handle content extraction based on URL or videoId
export const extractUrlDetails = async (
  url: string,
  videoId?: string | null
) => {
  if (videoId) {
    // Try to get content from YouTube transcript
    return videoId; //await getYoutubeTranscript(videoId);
  } else if (url) {
    // Try to get content from webpage
    console.log("Url in extratUrlDetails", url);
    return await extractContentFromUrl(url);
  } else {
    console.error("No URL or videoId provided.");
    return null;
  }
};
