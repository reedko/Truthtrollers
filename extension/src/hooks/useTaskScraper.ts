import { useState } from "react";
import { scrapeContent } from "../services/scrapeContent"; // ✅ Import recursive scraper
import useTaskStore from "../store/useTaskStore"; // ✅ Zustand Store

export const useTaskScraper = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeTask = async (passedUrl?: string) => {
    setLoading(true);
    setError(null);

    try {
      console.log("🚀 Scraping started...");

      const store = useTaskStore.getState();
      const initialUrl = passedUrl || store.currentUrl; // ✅ Use passed URL or fallback to store

      if (!initialUrl) {
        console.error("❌ No valid URL found to scrape.");
        return;
      }

      console.log("🔗 Scraping URL:", initialUrl);

      // ✅ Store the starting URL in Zustand
      store.setCurrentUrl(initialUrl);

      // ✅ Notify background that scraping is active
      chrome.runtime.sendMessage({ action: "scrapingStarted" });

      await scrapeContent(initialUrl, "", "task"); // ✅ Call recursive scraper
      console.log("✅ Task and references fully scraped!");

      // ✅ Check the stored URL after scraping to see if user has navigated
      const finalUrl = store.currentUrl;
      const userStillOnSamePage = finalUrl === initialUrl;

      console.log(
        userStillOnSamePage
          ? "✅ User is still on the same page. Forcing popup update."
          : "⚠️ User navigated away. Not forcing popup."
      );

      // ✅ Ensure the popup updates with the newly scraped task
      chrome.runtime.sendMessage({
        action: "scrapeCompleted",
        url: initialUrl, // ✅ Send the scraped URL
        forceVisible: userStillOnSamePage,
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
