// src/services/checkAndDownloadTopicIconExtension.ts

import browser from "webextension-polyfill";

interface TopicIconResponse {
  success: boolean;
  thumbnail_url?: string;
  error?: string;
}

export const checkAndDownloadTopicIconExtension = async (
  generalTopic: string
): Promise<string | null> => {
  try {
    const response = (await browser.runtime.sendMessage({
      action: "checkAndDownloadTopicIcon",
      generalTopic,
    })) as TopicIconResponse;

    if (response.success) {
      return response.thumbnail_url || null;
    } else {
      const errMsg =
        response.error || "Failed to check and download topic icon";
      console.error("❌ Error in checkAndDownloadTopicIcon:", errMsg);
      throw new Error(errMsg);
    }
  } catch (err) {
    console.error("❌ Exception in checkAndDownloadTopicIcon:", err);
    throw err;
  }
};

// src/services/checkAndDownloadTopicIconDashboard.ts

export const checkAndDownloadTopicIcon = async (
  generalTopic: string
): Promise<string | null> => {
  console.warn("⚠️ Running outside extension, skipping topic icon check.");
  return null;
};
export default checkAndDownloadTopicIcon;
