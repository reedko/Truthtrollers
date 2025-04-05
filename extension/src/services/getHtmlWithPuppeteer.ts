export const fetchHtmlWithPuppeteer = (
  url: string
): Promise<{ success: boolean; html?: string; error?: string }> => {
  if (url.includes("sciencedirect.com")) {
    console.warn("🐛 DEBUG: Puppeteer requested for ScienceDirect:", url);
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "puppeteerFetch",
        url,
      },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({
            success: false,
            error:
              chrome.runtime.lastError?.message ||
              "No response from background",
          });
        } else {
          // ✅ ADD DEBUG LOGGING HERE
          if (url.includes("sciencedirect.com") && response.html) {
            console.log("📦 Puppeteer response size:", response.html.length);
            console.log("📃 Snippet:", response.html.slice(0, 500));
          }

          resolve(response);
        }
      }
    );
  });
};
