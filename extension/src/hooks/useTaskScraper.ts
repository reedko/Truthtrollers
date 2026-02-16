import { useState } from "react";
import { scrapeContent } from "../services/scrapeContent"; // ✅ Single-pass scraper (backend does everything)
import useTaskStore from "../store/useTaskStore"; // ✅ Zustand Store
import browser from "webextension-polyfill";

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
      browser.runtime.sendMessage({ action: "scrapingStarted" });

      await scrapeContent(initialUrl); // ✅ Backend does EVERYTHING (task + refs + claims + evidence)
      console.log("✅ Task and references fully scraped!");

      // ✅ For Facebook posts, the actual post URL might have been detected during scraping
      // Check storage for the updated URL (Facebook scraper stores the detected post URL)
      const storageData = await browser.storage.local.get('currentUrl');
      const scrapedUrl = storageData.currentUrl || initialUrl;

      console.log(`🔍 [useTaskScraper] Initial URL: ${initialUrl}`);
      console.log(`🔍 [useTaskScraper] Scraped URL: ${scrapedUrl}`);

      // ✅ Check the stored URL after scraping to see if user has navigated
      const finalUrl = store.currentUrl;
      const userStillOnSamePage = finalUrl === initialUrl || finalUrl === scrapedUrl;

      console.log(
        userStillOnSamePage
          ? "✅ User is still on the same page. Forcing popup update."
          : "⚠️ User navigated away. Not forcing popup."
      );

      // ✅ Ensure the popup updates with the newly scraped task
      browser.runtime.sendMessage({
        action: "scrapeCompleted",
        url: scrapedUrl, // ✅ Send the ACTUAL scraped URL (might be different for Facebook)
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
