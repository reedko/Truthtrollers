import { useState } from "react";
import { scrapeContent } from "../services/scrapeContent"; // ✅ Import new recursive scraper

export const useTaskScraper = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeTask = async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      await scrapeContent(url, "", "task"); // ✅ Call recursive scraper
      console.log("✅ Task and references fully scraped!");

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
