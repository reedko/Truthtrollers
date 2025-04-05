import { orchestrateScraping } from "./orchestrateScraping";
import createTask from "./createTask";
import { TaskData, Lit_references } from "../entities/Task";

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

const getFileType = (url: string): string => {
  const cleanUrl = url.split("?")[0].toLowerCase();
  const match = cleanUrl.match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
};

const getFileCategory = (ext: string): string => {
  const audio = [".mp3", ".wav", ".ogg", ".flac"];
  const video = [".mp4", ".avi", ".mov", ".mkv", ".webm"];
  const docs = [".doc", ".ppt", ".xls"];
  if (audio.includes(ext)) return "Audio";
  if (video.includes(ext)) return "Video";
  if (docs.includes(ext)) return "Document";
  return "Media";
};

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
      const fileType = getFileType(url); // 🆕 .mp3, .pdf, etc.
      const fileCategory = getFileCategory(fileType); // 🆕 Audio, Video, etc.

      console.warn(
        `🚫 Non-scrapable ${fileCategory} file detected: ${fileType}`
      );

      contentData = {
        url,
        content_name: content_name || `Untitled ${fileCategory} File`,
        content_type: "reference",
        media_source: fileCategory,
        assigned: "unassigned",
        progress: "Unassigned",
        users: "",
        details: `This reference is a non-scrapable ${fileCategory.toLowerCase()} file (${fileType}).`,
        topic: "general",
        subtopics: ["general", ""],
        thumbnail: `${BASE_URL}/assets/images/content/document-placeholder.png`,
        iconThumbnailUrl: null,
        authors: [],
        content: [],
        publisherName: null,
        Claims: [],
        taskContentId: taskContentId || null,
        is_retracted: false,
      };
    }
    // ✅ Step 2: Scrape metadata (only if not nonScrapable)
    if (!contentData) {
      contentData = await orchestrateScraping(url, content_name, contentType);
    }

    if (!contentData) {
      console.warn(
        `⚠️ Skipping ${contentType} — No usable content returned: ${url}`
      );

      // Optionally log more detail for tasks (e.g., add fallback entry later)
      if (contentType === "task") {
        console.error("❌ Cannot continue. A task must have valid content.");
        return null; // don't try to save this
      }

      return null; // skip bad reference
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

        const result = await scrapeContent(
          reference.url,
          reference.content_name || "",
          "reference",
          taskContentId
        );
        if (!result) {
          console.warn("⛔ Skipped reference (bad or blank):", reference.url);
        }
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
  const cleanUrl = url.split("?")[0].toLowerCase(); // strip query
  const nonScrapableFileTypes = [
    ".zip",
    ".exe",
    ".doc",
    ".ppt",
    ".xls",
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm",
  ];
  return nonScrapableFileTypes.some((ext) => cleanUrl.endsWith(ext));
};
