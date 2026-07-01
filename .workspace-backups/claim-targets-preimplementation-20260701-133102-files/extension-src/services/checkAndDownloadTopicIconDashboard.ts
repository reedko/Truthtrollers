// src/services/checkAndDownloadTopicIconDashboard.ts

export const checkAndDownloadTopicIcon = async (
  generalTopic: string
): Promise<string | null> => {
  console.warn("⚠️ Running outside extension, skipping topic icon check.");
  return null;
};
