const EXTENSION_ID = "hfihldigngpdcbmedijohjdcjppdfepj"; // ✅ Replace with actual ID

export const sendMessageToExtension = (
  action: string,
  data: Record<string, any>
): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime) {
      console.error("❌ chrome.runtime is not available");
      reject("Chrome runtime not available.");
      return;
    }

    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { action, ...data },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "❌ Error sending message:",
            chrome.runtime.lastError.message
          );
          reject(chrome.runtime.lastError.message);
        } else if (!response || response.success === false) {
          console.error("❌ Message failed:", response?.error);
          reject(response?.error || "Unknown error");
        } else {
          resolve(response);
        }
      }
    );
  });
};
