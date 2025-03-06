import { useState } from "react";
import { scrapeContent } from "../services/scrapeContent"; // ✅ Import new recursive scraper

export const useTaskScraper = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeTask = async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      console.log("🚀 Scraping started...");

      // ✅ Tell background.js that scraping is active
      chrome.runtime.sendMessage({ action: "scrapingStarted" });

      await scrapeContent(url, "", "task"); // ✅ Call recursive scraper
      console.log("✅ Task and references fully scraped!");

      // ✅ unpause the Content Injection
      chrome.runtime.sendMessage({
        action: "scrapeCompleted",
        forceVisible: false,
      });

      // ✅ UI update happens only ONCE at the end
      chrome.runtime.sendMessage({
        action: "checkContent",
        forceVisible: true,
      });
    } catch (err) {
      console.error("❌ Error during task scraping:", err);
      setError("An error occurred while scraping.");
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, scrapeTask };
};
