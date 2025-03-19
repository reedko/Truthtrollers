const checkAndDownloadTopicIcon = async (
  generalTopic: string
): Promise<string | null> => {
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "checkAndDownloadTopicIcon",
          generalTopic,
        },
        (response) => {
          if (response && response.success) {
            resolve(response.thumbnail_url || null);
          } else {
            const errMsg =
              response?.error || "Failed to check and download topic icon";
            console.error("Error in checkAndDownloadTopicIcon:", errMsg);
            reject(new Error(errMsg));
          }
        }
      );
    });
  } else {
    console.warn("⚠️ Running outside extension, skipping topic icon check.");
    return null; // ✅ Avoids crashing in the dashboard
  }
};

export default checkAndDownloadTopicIcon;
