const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

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
    return fetch(`${BASE_URL}/api/fetch-with-puppeteer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    })
      .then((res) => res.json())
      .then((data) => {
        return data;
      })
      .catch((err) => {
        return { success: false, error: err.message };
      });
  } catch (err) {
    console.error("❌ fetchHtmlWithPuppeteer failed:", err);
    return { success: false, error: String(err) };
  }
};
