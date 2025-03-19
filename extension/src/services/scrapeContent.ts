import { orchestrateScraping } from "./orchestrateScraping";
import createTask from "./createTask";
import { TaskData, Lit_references } from "../entities/Task";

const EXTENSION_ID = "hfihldigngpdcbmedijohjdcjppdfepj";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

export const scrapeContent = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference",
  taskContentId?: string
): Promise<string | null> => {
  console.log(`🔍 Scraping ${contentType}: ${url}`);

  try {
    let contentData: TaskData | null = null;

    // ✅ Step 1: Pre-define contentData for non-scrapable references
    if (contentType === "reference" && isNonScrapable(url)) {
      console.warn("🚫 Non-scrapable file detected, skipping scraping:", url);
      contentData = {
        url,
        content_name: content_name || "Untitled Reference",
        content_type: "reference",
        media_source: "Unknown",
        assigned: "unassigned",
        progress: "Unassigned",
        users: "",
        details:
          "This reference is a non-scrapable file (e.g., PDF, audio, video).",
        topic: "general",
        subtopics: ["general", ""],
        thumbnail: `${BASE_URL}/assets/images/content/document-placeholder.png`, // ✅ Default document icon
        iconThumbnailUrl: null,
        authors: [],
        content: [],
        publisherName: null,
        Claims: [],
        taskContentId: taskContentId || null, // ✅ Ensuring the task reference is linked
      };
    }

    // ✅ Step 2: Scrape metadata (only if not nonScrapable)
    if (!contentData) {
      contentData = await orchestrateScraping(url, content_name, contentType);
    }

    if (!contentData) {
      console.error("🚨 Failed to obtain contentData for:", url);
      return null;
    }
    // ✅ Ensure taskContentId is set for references
    // ✅ Ensure taskContentId is assigned for scrapable references
    if (!contentData.taskContentId) {
      contentData.taskContentId = taskContentId || null;
    }

    // ✅ Step 3: Save content to DB (handles duplicate detection internally)
    console.log("📎 Saving content to DB:", contentData);
    const contentId = await createTask(contentData);
    if (!contentId) {
      console.error("❌ Failed to create content:", url);
      return "createTaskFAIL";
    }
    console.log(`✅ Content created with ID: ${contentId}`);

    // ✅ Step 4: Store references separately (only for tasks)
    const references: Lit_references[] =
      contentType === "task" ? [...contentData.content] : [];

    // ✅ If this is the first (main) task, store taskContentId for linking references
    if (contentType === "task" && !taskContentId) {
      taskContentId = contentId;
    }

    // ✅ Step 5: Recursively process references (only for tasks)
    if (contentType === "task" && references.length > 0) {
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
          taskContentId
        );
      }
    }

    return contentId;
  } catch (err) {
    console.error("❌ Error during content scraping:", err);
    return null;
  }
};

// ✅ Function to check if a URL is non-scrapable (PDFs, audio, video, etc.)
const isNonScrapable = (url: string) => {
  const nonScrapableFileTypes = [
    ".pdf",
    ".zip",
    ".exe",
    ".doc",
    ".ppt",
    ".xls", // Documents & archives
    ".mp3",
    ".wav",
    ".ogg",
    ".flac", // Audio
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm", // Video
  ];
  return nonScrapableFileTypes.some((ext) => url.toLowerCase().endsWith(ext));
};
