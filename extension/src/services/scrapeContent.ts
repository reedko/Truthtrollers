import { orchestrateScraping } from "./orchestrateScrapingExtension";
import createTask from "./createTaskExtension";
import { TaskData, Lit_references } from "../entities/Task";
import { mapClaimsToSources } from "./claimsSourceMapper";

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
function dedupeRefs(refs: Lit_references[]): Lit_references[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (!r?.url) return false;
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

type CrawlCtx = {
  visited: Set<string>;
  depth: number;
  maxDepth: number;
};
/**
 * Scrape a URL as "task" or "reference", save it, then (for tasks) recurse into refs.
 * @param url
 * @param content_name
 * @param contentType "task" | "reference"
 * @param taskContentId parent task content_id (for references)
 * @param ctx crawl context (visited set, depth, maxDepth)
 */
export const scrapeContent = async (
  url: string,
  content_name: string,
  contentType: "task" | "reference",
  taskContentId?: string,
  ctx: CrawlCtx = { visited: new Set<string>(), depth: 0, maxDepth: 2 }
): Promise<string | null> => {
  const normUrl = url.trim();

  // 🚧 visited guard
  if (ctx.visited.has(normUrl)) {
    console.log("↩️ Already scraped this URL in this run, skipping:", normUrl);
    return null;
  }
  ctx.visited.add(normUrl);

  console.log(
    `🔍 Scraping ${contentType} (d=${ctx.depth}/${ctx.maxDepth}): ${normUrl}`
  );

  try {
    let contentData: TaskData | null = null;

    // Non-scrapable shortcut (unchanged)
    if (contentType === "reference" && isNonScrapable(normUrl)) {
      const fileType = getFileType(normUrl);
      const fileCategory = getFileCategory(fileType);
      contentData = {
        url: normUrl,
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
        testimonials: [],
      };
    }

    // Scrape normally if needed
    if (!contentData) {
      contentData = await orchestrateScraping(
        normUrl,
        content_name,
        contentType
      );
    }

    if (!contentData) {
      console.warn(
        `⚠️ Skipping ${contentType} — No usable content returned: ${normUrl}`
      );
      if (contentType === "task") {
        console.error("❌ Cannot continue. A task must have valid content.");
        return null;
      }
      return null;
    }

    // 🔗 Merge claim-sourced refs for TASKS (so they show on the Task)
    if (
      contentType === "task" &&
      Array.isArray(contentData.Claims) &&
      contentData.Claims.length
    ) {
      try {
        const claimTexts = contentData.Claims.map((c: any) =>
          typeof c === "string" ? c : c?.text || ""
        ).filter(Boolean);

        // Might be heavy; keep text slice or let backend do it.
        const claimRefs = await mapClaimsToSources(
          contentData.raw_text || "",
          claimTexts
        );

        const domRefs: Lit_references[] = Array.isArray(contentData.content)
          ? contentData.content
          : [];

        // merge + dedupe
        contentData.content = dedupeRefs([...domRefs, ...claimRefs]).slice(
          0,
          60
        ); // cap if you want
      } catch (e) {
        console.warn("⚠️ mapClaimsToSources failed; keeping DOM refs only:", e);
      }
    }

    // Ensure parent taskContentId flows down
    if (!contentData.taskContentId) {
      contentData.taskContentId = taskContentId || null;
    }

    // 💾 Save this content (your existing createTask)
    console.log("📎 Saving content to DB:", contentData);
    const contentId = await createTask(contentData);
    if (!contentId) {
      console.error("❌ Failed to create content:", normUrl);
      return "createTaskFAIL";
    }
    console.log(`✅ Content created with ID: ${contentId}`);

    // If this was the main task, remember its id for child refs
    if (contentType === "task" && !taskContentId) {
      taskContentId = contentId;
    }

    // 🪜 Recurse only if:
    // - this is a TASK
    // - we have refs
    // - depth < maxDepth
    if (
      contentType === "task" &&
      Array.isArray(contentData.content) &&
      contentData.content.length &&
      ctx.depth < ctx.maxDepth
    ) {
      const nextDepthCtx: CrawlCtx = {
        visited: ctx.visited,
        depth: ctx.depth + 1,
        maxDepth: ctx.maxDepth,
      };

      // Recurse on **ALL** unique refs (DOM + claim-sourced)
      for (const reference of contentData.content) {
        const refUrl = reference.url?.trim();
        if (!refUrl) continue;

        console.log(
          `🔗 Recursing (d=${nextDepthCtx.depth}/${nextDepthCtx.maxDepth})`,
          reference.origin ? `[${reference.origin}]` : "",
          refUrl
        );

        const result = await scrapeContent(
          refUrl,
          reference.content_name || "",
          "reference",
          taskContentId,
          nextDepthCtx
        );
        if (!result) {
          console.warn("⛔ Skipped reference (bad or blank):", refUrl);
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
