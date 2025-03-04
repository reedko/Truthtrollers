import { orchestrateScraping } from "./orchestrateScraping";
import createTask from "./createTask";
import { Lit_references } from "../entities/Task";

export const addContentRelation = async (
  taskContentId: string,
  referenceContentId: string
) => {
  console.log(
    `🔗 Linking Task ${taskContentId} to Reference ${referenceContentId}`
  );

  return new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "addContentRelation", taskContentId, referenceContentId },
      (response) => {
        response?.success ? resolve() : reject("Failed to link reference");
      }
    );
  });
};

const checkDatabaseForReference = async (
  url: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "checkDatabaseForReference", url },
      (response) => {
        resolve(response);
      }
    );
  });
};

export const scrapeContent = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference",
  taskContentId?: string // ✅ For linking references to the task
) => {
  console.log(`🔍 Scraping ${contentType}: ${url}`);

  try {
    // ✅ If reference, check if it already exists in DB
    if (contentType === "reference") {
      console.log("RELATION ready");
      const existingContentId = await checkDatabaseForReference(url);

      if (existingContentId) {
        console.log(
          `✅ Reference already exists (ID: ${existingContentId}). Skipping scrape.`
        );
        if (taskContentId) {
          await addContentRelation(taskContentId, existingContentId);
        }
        console.log("RELATION SHOULD HAVE ADDED");
        return existingContentId; // ✅ Skip scraping
      }
    }

    // Step 1: Scrape metadata
    console.log(url, ":before");
    const contentData = await orchestrateScraping(
      url,
      content_name,
      contentType
    );

    // Step 2: Store references separately (only for tasks)
    const references: Lit_references[] =
      contentType === "task" ? [...contentData.content] : [];

    // Step 3: Save content to DB
    const contentId = await createTask(contentData);
    if (!contentId) {
      return "createTaskFAIL";
    }
    console.log(`✅ Content created with ID: ${contentId}`);

    // Step 4: If it's a reference, link it to the original task
    if (contentType === "reference" && taskContentId) {
      if (contentId) {
        await addContentRelation(taskContentId, contentId);
      } else {
        console.warn("Skipping addContentRelation because contentId is null");
      }
    }

    // Step 5: Recursively process references if this is a task
    if (contentType === "task" && references.length > 0) {
      console.log("🔁 Recursively scraping references...");
      if (contentId) {
        for (const reference of references) {
          console.log(
            "🔗 Scraping reference:",
            reference.url,
            "Title:",
            reference.content_name
          );
          await scrapeContent(
            reference.url,
            reference.content_name || "",
            "reference",
            contentId
          );
        }
      } else {
        console.warn("Skipping reference scraping because contentId is null");
      }
    }

    return contentId;
  } catch (err) {
    console.error("❌ Error during content scraping:", err);
    return null;
  }
};
