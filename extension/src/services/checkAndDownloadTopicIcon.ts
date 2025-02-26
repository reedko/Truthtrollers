// checkAndDownloadTopicIcon.ts
const checkAndDownloadTopicIcon = async (
  generalTopic: string
): Promise<string | null> => {
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
};

export default checkAndDownloadTopicIcon;
