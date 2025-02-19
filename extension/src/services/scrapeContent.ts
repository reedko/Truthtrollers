import { orchestrateScraping } from "./orchestrateScraping";
import createTask from "./createTask";
import { Lit_references, TaskData } from "../entities/Task";

export const scrapeContent = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference"
) => {
  console.log(`🔍 Scraping ${contentType}: ${url}`);

  try {
    // Step 1: Scrape metadata
    const contentData = await orchestrateScraping(
      url,
      content_name,
      contentType
    );
    // Step 2: Store references separately (only if this is a task)
    const references: Lit_references[] =
      contentType === "task" ? [...contentData.content] : [];

    // Step 2: Save to database
    const contentId = await createTask(contentData);
    console.log(`✅ Content created with ID: ${contentId}`);

    // Step 3: Recursively scrape references if this is a task
    if (contentType === "task" && references.length > 0) {
      console.log("🔁 Recursively scraping references...");
      for (const reference of contentData.content) {
        await scrapeContent(
          reference.url,
          reference.content_name || "",
          "reference"
        ); // ✅ Recursively scrape each reference
      }
    }

    return contentId;
  } catch (err) {
    console.error("❌ Error during content scraping:", err);
    return null;
  }
};
