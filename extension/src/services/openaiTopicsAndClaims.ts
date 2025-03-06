// openaiTopicsAndClaims.ts

export async function analyzeContent(content: string): Promise<{
  generalTopic: string;
  specificTopics: string[];
  claims: string[];
}> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "analyzeContent",
        content,
      },
      (response) => {
        if (response && response.success) {
          resolve(response.data);
        } else {
          const errorMsg =
            response?.error || "Failed to analyze content in background";
          reject(new Error(errorMsg));
        }
      }
    );
  });
}
