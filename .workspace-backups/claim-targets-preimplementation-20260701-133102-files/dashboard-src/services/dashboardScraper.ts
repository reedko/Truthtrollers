import { orchestrateScraping } from "../../../extension/src/services/orchestrateScrapingDashboard";
import createTask from "../../../extension/src/services/createTaskDashboard";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export const dashboardScraper = async (
  url: string,
  content_name: string = "",
  contentType: "task" | "reference",
  taskContentId?: string
): Promise<string | null> => {
  console.log(`🔍 Scraping from Dashboard: ${contentType} - ${url}`);

  try {
    let contentData = await orchestrateScraping(url, content_name, contentType);

    if (!contentData) {
      console.error("🚨 Failed to extract content from:", url);
      return null;
    }

    // ✅ Link reference to task if applicable
    if (contentType === "reference" && taskContentId) {
      contentData.taskContentId = taskContentId;
    }

    console.log("📎 Saving to DB:", contentData);
    const contentId = await createTask(contentData);
    if (!contentId) {
      console.error("❌ Failed to save scraped content:", url);
      return null;
    }

    console.log(`✅ Saved content with ID: ${contentId}`);
    return contentId;
  } catch (err) {
    console.error("❌ Error during dashboard scraping:", err);
    return null;
  }
};
