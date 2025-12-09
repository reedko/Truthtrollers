// extension/src/services/scrapeContent.ts
// ---------------------------------------------------------
// FINAL VERSION — uses background.js to call backend
// ---------------------------------------------------------

import browser from "webextension-polyfill";
import { orchestrateScraping } from "./orchestrateScrapingExtension";
import type { Lit_references, TaskData } from "../entities/Task";

// Prevent infinite recursion
export type CrawlCtx = {
  visited: Set<string>;
  depth: number;
  maxDepth: number;
};

type ScrapeBackendResponse = {
  success: boolean;
  contentId?: string;
  references?: {
    dom?: Lit_references[];
    ai?: Lit_references[];
  };
  error?: string;
};

/**
 * Scrape a URL as TASK or REFERENCE.
 *
 * 1) orchestrateScrapingExtension(url, ...) → TaskData envelope
 * 2) Send envelope to background.js via runtime.sendMessage
 *    - background calls /api/scrape-task or /api/scrape-reference
 * 3) Backend returns:
 *    { success, contentId, references: { dom, ai } }
 * 4) We recurse on those references (depth-limited).
 */
export async function scrapeContent(
  url: string,
  content_name: string,
  contentType: "task" | "reference",
  taskContentId: string | null = null,
  ctx: CrawlCtx = { visited: new Set<string>(), depth: 0, maxDepth: 2 },
  evidenceMetadata?: Partial<Lit_references>
): Promise<string | null> {
  const normUrl = url.trim();

  // ---------------------------------------
  // ⛔ Visited guard
  // ---------------------------------------
  if (ctx.visited.has(normUrl)) {
    console.log("↩️ Already visited in this scrape run:", normUrl);
    return null;
  }
  ctx.visited.add(normUrl);

  console.log(
    `🔎 scrapeContent (${contentType}) depth=${ctx.depth}/${ctx.maxDepth}:`,
    normUrl
  );

  // ---------------------------------------
  // 1. EXTENSION-SIDE SCRAPING → envelope
  // ---------------------------------------
  const envelope: TaskData | null = await orchestrateScraping(
    normUrl,
    content_name,
    contentType
  );

  if (!envelope) {
    console.warn("⚠️ orchestrateScraping returned null for:", normUrl);
    return null;
  }

  // For references, carry the parent task content_id
  if (contentType === "reference" && taskContentId) {
    envelope.taskContentId = taskContentId;
  }

  // For references, add evidence metadata (claimIds, stance, etc)
  if (contentType === "reference" && evidenceMetadata) {
    envelope.claimIds = evidenceMetadata.claimIds;
    envelope.stance = evidenceMetadata.stance;
    envelope.quote = evidenceMetadata.quote;
    envelope.summary = evidenceMetadata.summary;
    envelope.quality = evidenceMetadata.quality;
    envelope.location = evidenceMetadata.location;
    envelope.publishedAt = evidenceMetadata.publishedAt;
  }

  // ---------------------------------------
  // 2. ASK BACKGROUND TO CALL BACKEND
  // ---------------------------------------
  const action =
    contentType === "task" ? "scrapeTaskOnServer" : "scrapeReferenceOnServer";

  let backendResp: ScrapeBackendResponse;
  try {
    backendResp = (await browser.runtime.sendMessage({
      action,
      envelope,
    })) as ScrapeBackendResponse;
  } catch (err) {
    console.error("❌ Error sending scrape envelope to background:", err);
    return null;
  }

  if (!backendResp || !backendResp.success || !backendResp.contentId) {
    console.error("❌ Backend scrape failed:", backendResp?.error);
    return null;
  }

  const thisContentId = backendResp.contentId;
  console.log(`✅ ${contentType} persisted as content_id=${thisContentId}`);

  // Root task content_id flows down into references
  if (contentType === "task") {
    taskContentId = thisContentId;
  }

  // ---------------------------------------
  // 3. MERGE DOM + AI references (returned by backend)
  // ---------------------------------------
  const domRefs = backendResp.references?.dom || [];
  const aiRefs = backendResp.references?.ai || [];
  const nextRefs: Lit_references[] = [...domRefs, ...aiRefs];

  // ---------------------------------------
  // 4. RECURSE on nextRefs (depth-limited)
  // ---------------------------------------
  if (ctx.depth < ctx.maxDepth && nextRefs.length > 0) {
    const nextDepth = ctx.depth + 1;

    for (const ref of nextRefs) {
      const rurl = ref.url?.trim();
      if (!rurl) continue;

      console.log(
        `🔗 Recursing → depth ${nextDepth}/${ctx.maxDepth}`,
        ref.origin ? `[${ref.origin}]` : "",
        rurl
      );

      await scrapeContent(
        rurl,
        ref.content_name || "",
        "reference",
        taskContentId,
        {
          visited: ctx.visited,
          depth: nextDepth,
          maxDepth: ctx.maxDepth,
        },
        ref // Pass the entire ref object with evidence metadata
      );
    }
  }

  return thisContentId;
}
