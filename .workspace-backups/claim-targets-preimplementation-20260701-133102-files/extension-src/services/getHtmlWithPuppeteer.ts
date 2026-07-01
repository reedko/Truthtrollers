import browser from "webextension-polyfill";

interface PuppeteerFetchResponse {
  success: boolean;
  html?: string;
  error?: string;
}

export const fetchHtmlWithPuppeteer = async (
  url: string
): Promise<PuppeteerFetchResponse> => {
  if (url.includes("sciencedirect.com")) {
    console.warn("🐛 DEBUG: Puppeteer requested for ScienceDirect:", url);
  }

  try {
    const response = (await browser.runtime.sendMessage({
      action: "puppeteerFetch",
      url,
    })) as PuppeteerFetchResponse;

    if (!response || !response.success) {
      return {
        success: false,
        error: response?.error || "No response or fetch failed",
      };
    }

    // ✅ ADD DEBUG LOGGING HERE
    if (url.includes("sciencedirect.com") && response.html) {
      console.log("📦 Puppeteer response size:", response.html.length);
      console.log("📃 Snippet:", response.html.slice(0, 500));
    }

    return response;
  } catch (err) {
    console.error("❌ fetchHtmlWithPuppeteer failed:", err);
    return { success: false, error: String(err) };
  }
};
