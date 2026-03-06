// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
import browser from "webextension-polyfill";
import { generateDeviceFingerprint } from "../../dashboard/src/utils/generateDeviceFingerprint";
import { extractVideoIdFromUrl } from "./services/parseYoutubeUrl";

const BASE_URL =
  process.env.REACT_APP_EXTENSION_BASE_URL || "https://localhost:5001";

// Initialize and persist device fingerprint
let cachedFingerprint = null;

async function getDeviceFingerprint() {
  if (cachedFingerprint) return cachedFingerprint;

  // Check if we have it in storage
  const stored = await browser.storage.local.get("deviceFingerprint");
  if (stored.deviceFingerprint) {
    cachedFingerprint = stored.deviceFingerprint;
    console.log("🧬 Using stored fingerprint:", cachedFingerprint);
    return cachedFingerprint;
  }

  // Generate new fingerprint
  cachedFingerprint = await generateExtensionFingerprint();
  await browser.storage.local.set({ deviceFingerprint: cachedFingerprint });
  console.log("🧬 Generated new fingerprint:", cachedFingerprint);
  return cachedFingerprint;
}

const code = `
  (function() {
    let popupRoot = document.getElementById("popup-root");
    if (popupRoot) popupRoot.remove();

    popupRoot = document.createElement("div");
    popupRoot.id = "popup-root";
    document.body.appendChild(popupRoot);

    popupRoot.className = "task-card-visible";
  })();
`;

/** @param {string} url */
async function syncTaskStateForUrl(url, tabId = null) {
  try {
    console.log(`🔄 syncTaskStateForUrl: ${url}`);

    // For Facebook feeds, also try to detect the specific post URL in viewport
    let urlsToCheck = [url];
    const isGenericFacebookUrl =
      url === "https://www.facebook.com" ||
      url === "https://www.facebook.com/" ||
      url === "https://facebook.com" ||
      url === "https://facebook.com/";
    const isFacebookFeed =
      (url.includes("facebook.com") || url.includes("fb.com")) &&
      !url.includes("/posts/") &&
      !url.includes("/permalink");

    if ((isGenericFacebookUrl || isFacebookFeed) && tabId) {
      console.log(
        `🔵 [syncTaskState] Facebook feed detected, finding post in viewport...`,
      );
      // Check storage first to see if we already detected a post URL
      const stored = await browser.storage.local.get("currentUrl");
      if (stored.currentUrl && stored.currentUrl.includes("/posts/")) {
        console.log(
          `✅ [syncTaskState] Using stored post URL: ${stored.currentUrl}`,
        );
        urlsToCheck = [stored.currentUrl, url];
      }
    }

    // Try checking each URL until we find a match
    let task = null;
    let isDetected = false;
    let isCompleted = false;
    let matchedUrl = url;

    for (const checkUrl of urlsToCheck) {
      console.log(`  🔍 Checking URL: ${checkUrl}`);
      const resp = await fetch(`${BASE_URL}/api/check-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checkUrl }),
      });

      const data = await resp.json();
      if (data.exists) {
        isDetected = true;
        isCompleted = true; // Simplified: if it exists in DB, it's been processed
        task = data.task;
        matchedUrl = checkUrl;
        console.log(
          `✅ [syncTaskState] Found task at URL: ${checkUrl}, progress: ${data.task?.progress || "NONE"}`,
        );
        break;
      }
    }

    // keep background store in sync (your current logic)
    const store = useTaskStore.getState();
    store.setTask(task);
    store.setCurrentUrl(matchedUrl);
    store.setContentDetected(isCompleted);

    // and mirror to storage for TaskCard/panel to read
    await browser.storage.local.set({
      task,
      currentUrl: matchedUrl,
      contentDetected: isCompleted,
    });

    console.log(
      `✅ [syncTaskState] Updated storage with matchedUrl: ${matchedUrl}`,
    );
  } catch (e) {
    console.error("syncTaskStateForUrl failed:", e);
  }
}

// ✅ Create Task
const addContent = async (taskData) => {
  try {
    const fingerprint = await getDeviceFingerprint();

    const response = await fetch(`${BASE_URL}/api/addContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...taskData,
        fingerprint, // Include fingerprint for user tracking
      }),
    });

    const responseData = await response.json();

    return responseData.content_id;
  } catch (error) {
    console.error("Error adding task:", error);
    return null;
  }
};

// ✅ Add Authors
const addAuthorsToServer = async (contentId, authors) => {
  try {
    await fetch(`${BASE_URL}/api/content/${contentId}/authors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, authors }),
    });
    console.log("authors");
    return true;
  } catch (error) {
    console.error("Error adding authors:", error);
    return false;
  }
};

// ✅ Add Publisher
const addPublisherToServer = async (contentId, publisher) => {
  try {
    await fetch(`${BASE_URL}/api/content/${contentId}/publishers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, publisher }),
    });

    return true;
  } catch (error) {
    console.error("Error adding publisher:", error);
    return false;
  }
};

// ✅ Add Sources (References)
const addSourcesToServer = async (taskId, content) => {
  try {
    // Batch all API calls in parallel instead of sequential loop
    await Promise.all(
      content.map((lit_reference) =>
        fetch(`${BASE_URL}/api/content/${taskId}/add-source`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lit_reference }),
        }),
      ),
    );
    return true;
  } catch (error) {
    console.error("Error adding sources:", error);
    return false;
  }
};

// ✅ Fetch Diffbot pre-scrape data
const fetchDiffbotData = async (articleUrl) => {
  console.log(`🛠 Fetching Diffbot pre-scrape data for: ${articleUrl}`);

  try {
    const response = await fetch(`${BASE_URL}/api/pre-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl }),
    });

    if (!response.ok) {
      throw new Error(
        `Diffbot pre-scrape failed with status: ${response.status}`,
      );
    }

    const diffbotData = await response.json();
    console.log("✅ Diffbot pre-scrape data received:", diffbotData);
    return diffbotData;
  } catch (error) {
    console.warn("⚠️ Diffbot pre-scrape fetch failed:", error);
    return null;
  }
};

// ✅ Call backend scrape endpoints (task or reference)
const callBackendScrape = async (endpoint, envelope) => {
  console.log(`🛠 Calling backend scrape: ${endpoint}`);

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      throw new Error(`Backend scrape failed with status: ${response.status}`);
    }

    const data = await response.json();
    console.log(`✅ Backend scrape complete:`, data);
    return data;
  } catch (error) {
    console.error(`❌ Backend scrape failed for ${endpoint}:`, error);
    throw error;
  }
};

const shouldIgnoreUrl = (url) => {
  const ignoredSites = ["facebook.com/messages", "messenger.com"];
  const isIgnored = ignoredSites.some((site) => url.includes(site));
  if (isIgnored) console.log("🚫 Ignored URL:", url);
  return isIgnored;
};

const fetchExternalPage = async (url) => {
  try {
    console.log(`🌍 Fetching page content for: ${url}`);

    const response = await fetch(`${BASE_URL}/api/fetch-page-content`, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Content-Type": "application/json", // ✅ Fix: Ensure JSON body is read properly
        Referer: url, // ✅ Some sites check for a valid referrer
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      console.error(
        `❌ HTTP error: ${response.status} - ${response.statusText}`,
      );
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const jsonResponse = await response.json();
    console.log(
      `✅ Received page content: ${jsonResponse.html?.length || 0} bytes`,
    );

    return jsonResponse.html;
  } catch (error) {
    console.error("❌ Error fetching page content:", error);
    return null; // ✅ Avoid unhandled rejections
  }
};

// ✅ Track multiple simultaneous scrapes by tabId
// Map<tabId, { url: string, startedAt: number }>
const activeScrapes = new Map();

let lastStoredUrl = "";

// --- SINGLE onMessage HANDLER ---
browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    // [-1] Image blobber to avoid PNA errors
    if (message.action === "getAssetBlobUrl" && message.url) {
      try {
        const targetUrl = message.url.startsWith("http")
          ? message.url
          : `${BASE_URL}${message.url.startsWith("/") ? "" : "/"}${
              message.url
            }`;

        const res = await fetch(targetUrl, { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type =
          res.headers.get("Content-Type") || "application/octet-stream";
        const buf = await res.arrayBuffer();

        // SAFE encoder: no spread/apply, no chunking, avoids stack overflow
        const base64 = arrayBufferToBase64(buf);

        return { ok: true, type, base64 };
      } catch (err) {
        console.error("getAssetBlobUrl failed:", err);
        return { ok: false, error: String(err) };
      }
    }

    function arrayBufferToBase64(ab) {
      const bytes = new Uint8Array(ab);
      let binary = "";
      // Build the string in small pieces without apply/spread
      const step = 0x8000; // 32k
      for (let i = 0; i < bytes.length; i += step) {
        const chunk = bytes.subarray(i, i + step);
        let chunkStr = "";
        for (let j = 0; j < chunk.length; j++) {
          chunkStr += String.fromCharCode(chunk[j]);
        }
        binary += chunkStr;
      }
      return btoa(binary);
    }
    // [0] PING TEST
    if (message.action === "pingTest") {
      return { pong: true };
    }
    if (message?.action === "setViewedUrlFromViewer" && message.url) {
      return browser.storage.local
        .set({ lastVisitedURL: message.url, lastVisitedAt: Date.now() })
        .then(() => {
          // optional: notify popup/content so they update immediately
          browser.runtime.sendMessage({
            type: "CURRENT_URL_UPDATED",
            url: message.url,
          });
        });
    }
    // [1] fetchDiffbotDataTest
    if (message.action === "fetchDiffbotDataTest") {
      console.log(
        "🧪 [Background] Testing fetchDiffbotDataTest for:",
        message.articleUrl,
      );

      try {
        const response = await fetch(`${BASE_URL}/api/pre-scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleUrl: message.articleUrl }),
        });

        const result = await response.json();
        console.log("✅ [Background] Diffbot result:", result);
        return result;
      } catch (err) {
        console.error("❌ [Background] Diffbot error:", err);
        return { success: false, error: err.message };
      }
    }

    // [2] fetchDiffbotData
    if (message.action === "fetchDiffbotData") {
      console.log("[Background] fetchDiffbotData for:", message.articleUrl);
      try {
        const data = await fetchDiffbotData(message.articleUrl);
        console.log("[Background] fetchDiffbotData response:", data);
        return data;
      } catch (err) {
        console.error("[Background] fetchDiffbotData error:", err);
        return { success: false };
      }
    }

    // [3] getStoredUrl
    if (message.action === "getStoredUrl") {
      const data = await browser.storage.local.get("lastVisitedURL");
      console.log("📌 Stored URL retrieved:", data);
      return { url: data.lastVisitedURL || null };
    }

    // [4] scrapingStarted
    if (message.action === "scrapingStarted") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        console.warn("⚠️ scrapingStarted: No tab ID available");
        return;
      }

      console.log(`⏳ [Tab ${tabId}] Scraping started`);
      activeScrapes.set(tabId, {
        url: message.url || "unknown",
        startedAt: Date.now()
      });

      console.log(`📊 Active scrapes: ${activeScrapes.size} tab(s) currently scraping`);
      return;
    }

    // [5] scrapeStarted (alternative message - also track it)
    if (message.action === "scrapeStarted") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        console.warn("⚠️ scrapeStarted: No tab ID available, trying to query active tab");
        try {
          const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tabs.length && tabs[0].id) {
            const activeTabId = tabs[0].id;
            console.log(`⏳ [Tab ${activeTabId}] Scraping started (via query)`);
            activeScrapes.set(activeTabId, {
              url: message.url || "unknown",
              startedAt: Date.now()
            });
          }
        } catch (err) {
          console.error("❌ Error querying active tab:", err);
        }
        return;
      }

      console.log(`⏳ [Tab ${tabId}] Scraping started`);
      activeScrapes.set(tabId, {
        url: message.url || "unknown",
        startedAt: Date.now()
      });
      console.log(`📊 Active scrapes: ${activeScrapes.size} tab(s) currently scraping`);
      return;
    }

    // [6] scrapeCompleted
    if (message.action === "scrapeCompleted") {
      const tabId = sender.tab?.id ?? null;
      const url = message.url;

      console.log(`✅ [Tab ${tabId}] Scraping finished!`);
      console.log(`🔍 [scrapeCompleted] Received URL: ${url}`);

      try {
        if (!tabId) {
          console.warn("⚠️ No tab ID found! Cannot show popup.");
        } else {
          // Remove this tab from active scrapes
          const scrapeInfo = activeScrapes.get(tabId);
          if (scrapeInfo) {
            const duration = Date.now() - scrapeInfo.startedAt;
            console.log(`⏱️ [Tab ${tabId}] Scrape took ${(duration / 1000).toFixed(1)}s`);
            activeScrapes.delete(tabId);
          }

          console.log(`📊 Active scrapes remaining: ${activeScrapes.size} tab(s)`);

          // Is this the extension PDF viewer?
          const tab = await browser.tabs.get(tabId);
          const viewerPrefix = browser.runtime.getURL("viewer.html");

          if (tab?.url && tab.url.startsWith(viewerPrefix)) {
            // 🧠 We're on viewer.html → do NOT inject. Just tell it to refresh.
            try {
              await checkContentAndUpdatePopup(tabId, url, true);
              console.log("🟣 checkContentAndUpdatePopup ran for viewer.html");
            } catch (e) {
              console.warn(
                "⚠️ checkContentAndUpdatePopup failed on viewer:",
                e,
              );
            }
            try {
              await browser.tabs.sendMessage(tabId, {
                action: "taskcard:update",
                payload: { url, status: "complete" },
              });
              console.log("📣 Notified viewer to refresh taskcard.");
            } catch (e) {
              console.warn(
                "⚠️ Could not message viewer (no listener yet?):",
                e,
              );
            }
          } else {
            // 🌐 Normal page → keep your existing flow
            console.log("📌 Updating popup on normal page:", url);
            await checkContentAndUpdatePopup(tabId, url, true);
          }
        }
      } catch (err) {
        console.error("❌ Error finishing scrape:", err);
        // Make sure we clean up even on error
        if (tabId && activeScrapes.has(tabId)) {
          activeScrapes.delete(tabId);
        }
      }
      return;
    }

    // [7] getCurrentTabUrl
    if (message.action === "getCurrentTabUrl") {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (tabs.length > 0 && tabs[0].url) {
          return { url: tabs[0].url };
        } else {
          console.error("No active tab or URL found");
          return { error: "No active tab or URL found" };
        }
      } catch (err) {
        console.error("Error querying tabs:", err);
        return { error: err.message };
      }
    }

    // [8] captureImage
    if (message.action === "captureImage") {
      const { url, html, diffbotData } = message;
      const pageUrl = new URL(url);

      let imageUrl = extractImageFromHtml(html, pageUrl);
      if (imageUrl) {
        console.log("✅ Found image in extracted HTML:", imageUrl);
        return { imageUrl };
      }

      console.warn("⚠️ No image in extracted HTML. Checking Diffbot...");
      if (diffbotData?.images?.length > 0) {
        imageUrl = diffbotData.images[0].url;
        console.log("✅ Found image in Diffbot:", imageUrl);
        return { imageUrl };
      }

      console.warn("⚠️ No image from Diffbot. Checking current tab...");
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const currentTab = tabs[0];

      if (currentTab?.url === url) {
        console.log("🔍 Extracting image from CURRENT tab:", currentTab.url);
        return await extractImageFromTab(currentTab.id);
      }

      console.log("🌍 Opening hidden tab to capture image from:", url);
      const newTab = await browser.tabs.create({ url, active: false });

      return new Promise((resolve) => {
        const listener = async (tabId, changeInfo) => {
          if (tabId === newTab.id && changeInfo.status === "complete") {
            console.log("📡 Hidden tab loaded, extracting image...");
            const result = await extractImageFromTab(tabId);
            browser.tabs.remove(tabId);
            browser.tabs.onUpdated.removeListener(listener);
            resolve(result);
          }
        };
        browser.tabs.onUpdated.addListener(listener);
      });
    }

    // [9] addContent
    if (message.action === "addContent") {
      return addContent(message.taskData)
        .then((contentId) => {
          console.log(
            "✅ Background: Received taskId from backend:",
            contentId,
          );
          const responsePayload = { contentId };
          console.log("🚀 Sending response to createTask.ts:", responsePayload);
          return responsePayload;
        })
        .catch((err) => {
          console.error("❌ Background: Failed to create content:", err);
          return { error: "Failed to create content" };
        });
    }

    // [10] addAuthors
    if (message.action === "addAuthors") {
      return addAuthorsToServer(message.contentId, message.authors)
        .then(() => ({ success: true }))
        .catch(() => ({ success: false }));
    }

    // [11] addPublisher
    if (message.action === "addPublisher") {
      return addPublisherToServer(message.contentId, message.publisher)
        .then(() => ({ success: true }))
        .catch(() => ({ success: false }));
    }

    // [12] addSources
    if (message.action === "addSources") {
      return addSourcesToServer(message.taskId, message.content)
        .then(() => ({ success: true }))
        .catch(() => ({ success: false }));
    }

    // [13] checkDatabaseForReference
    if (message.action === "checkDatabaseForReference") {
      console.log(`🔍 Received request to check DB for: ${message.url}`);
      return fetch(
        `${BASE_URL}/api/check-reference?url=${encodeURIComponent(
          message.url,
        )}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      )
        .then((response) => response.json())
        .then((data) => {
          console.log(`📌 API Response for ${message.url}:`, data);
          return data.content_id || null;
        })
        .catch((error) => {
          console.error("❌ Error checking reference in DB:", error);
          return null;
        });
    }

    // [14] addContentRelation
    if (message.action === "addContentRelation") {
      return fetch(`${BASE_URL}/api/add-content-relation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskContentId: message.taskContentId,
          referenceContentId: message.referenceContentId,
        }),
      })
        .then((response) => response.json())
        .then(() => {
          return { success: true };
        })
        .catch((error) => {
          console.error("Error adding content relation:", error);
          return { success: false };
        });
    }

    // [15] extractText / storeClaims (switch style)
    if (message.action === "extractText") {
      return handleExtractText(message.url, message.html, sender.tab?.url)
        .then((resp) => ({ success: true, pageText: resp }))
        .catch((err) => {
          console.error("Error extracting text:", err);
          return { success: false, error: err.message };
        });
    }

    if (message.action === "storeClaims") {
      const { contentId, claims, contentType } = message.data;
      return storeClaimsOnServer(contentId, claims, contentType)
        .then(() => ({ success: true }))
        .catch((err) => {
          console.error("Error storing claims:", err);
          return { success: false, error: err.message };
        });
    }
    if (message.action === "storeTestimonials") {
      const { contentId, testimonials, userId } = message.data;
      return storeTestimonialsOnServer(contentId, testimonials, userId)
        .then(() => ({ success: true }))
        .catch((err) => {
          console.error("Error storing testimonials:", err);
          return { success: false, error: err.message };
        });
    }
    // [16] checkIfPdf
    if (message.action === "checkIfPdf") {
      return fetch(message.url, { method: "HEAD" })
        .then((res) => {
          const type = res.headers.get("Content-Type") || "";
          return { isPdf: type.includes("application/pdf") };
        })
        .catch((err) => {
          console.error("❌ HEAD request failed:", err);
          return { isPdf: false };
        });
    }

    // [17] fetchPdfText
    // [17] fetchPdfText
    if (message.action === "fetchPdfText") {
      try {
        console.log("📨 Received fetchPdfText request for:", message.url);

        const textRes = await fetch(`${BASE_URL}/api/fetch-pdf-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: message.url }),
        });

        const textData = await textRes.json();
        console.log("📄 PDF text response:", textData);

        if (!textData.success || !textData.text || !textData.text.trim()) {
          console.warn("❌ PDF parsing failed or returned empty text");
          return { success: false };
        }

        const thumbRes = await fetch(`${BASE_URL}/api/pdf-thumbnail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: message.url }),
        });

        const thumbData = await thumbRes.json();
        console.log("🖼️ PDF thumbnail response:", thumbData);

        return {
          success: true,
          text: textData.text,
          title: textData.title,
          authors: Array.isArray(textData.authors) ? textData.authors : [],
          thumbnailUrl: thumbData.imageUrl || null,
        };
      } catch (err) {
        console.error("📄❌ PDF fetch error in background script:", err);
        return { success: false };
      }
    }

    // [18] extractReadableText
    if (message.action === "extractReadableText") {
      try {
        const res = await fetch(`${BASE_URL}/api/extract-readable-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html: message.html,
            url: message.url,
          }),
        });
        return await res.json();
      } catch (err) {
        console.error("❌ Error calling readable text API:", err);
        return { success: false };
      }
    }
    //18.5 puppetteerTranscriptFetch

    if (message.action === "extractYoutubeTranscript" && message.videoId) {
      (async () => {
        try {
          const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          const tab = tabs[0];
          if (!tab?.id) throw new Error("No active tab ID");

          const [result] = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const transcriptElems = [
                ...document.querySelectorAll("ytd-transcript-segment-renderer"),
              ];
              return transcriptElems.map((e) => e.innerText).join(" ");
            },
          });

          const transcriptText = result?.result || "";

          if (transcriptText.length > 10) {
            sendResponse({ success: true, transcriptText });
          } else {
            sendResponse({ success: false });
          }
        } catch (err) {
          console.error("❌ DOM injection transcript fetch failed:", err);
          sendResponse({ success: false });
        }
      })();

      return true; // ✅ Keeps the message channel open for async sendResponse
    }
    // 18.6 fallbackYoutubeTranscript => calls backend API to get transcript
    if (message.action === "fallbackYoutubeTranscript" && message.videoId) {
      try {
        const response = await fetch(
          `${BASE_URL}/api/youtube-transcript/${message.videoId}`,
        );
        const data = await response.json();
        if (data.success && data.transcriptText) {
          return { success: true, transcriptText: data.transcriptText };
        } else {
          return { success: false };
        }
      } catch (err) {
        console.error("❌ Fallback API call failed:", err);
        return { success: false };
      }
    }

    if (message.action === "storeExtractedContent") {
      try {
        console.log(message.data, ":           IS THIS JSON");
        const response = await fetch(`${BASE_URL}/api/store-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.data),
        });
        const json = await response.json();
        return json;
      } catch (err) {
        console.error("Failed to store content:", err);
        return { success: false };
      }
    }
    // [19] puppeteerFetch
    if (message.action === "puppeteerFetch") {
      return fetch(`${BASE_URL}/api/fetch-with-puppeteer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: message.url }),
      })
        .then((res) => res.json())
        .then((data) => data)
        .catch((err) => ({ success: false, error: err.message }));
    }

    // [20] checkAndDownloadTopicIcon
    if (message.action === "checkAndDownloadTopicIcon") {
      const { generalTopic } = message;
      return fetch(`${BASE_URL}/api/checkAndDownloadTopicIcon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generalTopic }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to check/download icon: ${res.statusText}`);
          }
          return res.json();
        })
        .then((data) => ({
          success: true,
          thumbnail_url: data.thumbnail_url,
        }))
        .catch((err) => {
          console.error("Error in checkAndDownloadTopicIcon request:", err);
          return { success: false, error: err.message };
        });
    }

    // [21] analyzeContent
    if (message.action === "analyzeContent") {
      console.log("[BG][analyzeContent] incoming:", message);

      try {
        const res = await fetch(`${BASE_URL}/api/analyze-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: message.content,
            testimonials: message.testimonials,
            options: { includeEvidence: message.includeEvidence === true },
          }),
        });

        const raw = await res.text();
        console.log("[BG][analyzeContent] raw backend response:", raw);

        let json;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          console.error("[BG][analyzeContent] JSON parse error:", err);
          return {
            success: false,
            error: "Invalid JSON returned from backend",
            raw,
          };
        }

        console.log("[BG][analyzeContent] parsed JSON:", json);

        if (!res.ok || !json.success) {
          return {
            success: false,
            error: json?.error || `HTTP ${res.status} ${res.statusText}`,
          };
        }

        // BACKEND RETURNS: { success: true, data: {...} }
        const data = json.data || {};

        return {
          success: true,
          data: {
            generalTopic: data.generalTopic || "Unknown",
            specificTopics: Array.isArray(data.specificTopics)
              ? data.specificTopics
              : [],
            claims: Array.isArray(data.claims) ? data.claims : [],
            testimonials: Array.isArray(data.testimonials)
              ? data.testimonials
              : [],
            claimSourcePicks: data.claimSourcePicks || [],
            evidenceRefs: data.evidenceRefs || [],
          },
        };
      } catch (err) {
        console.error("[BG][analyzeContent] request failed:", err);
        return {
          success: false,
          error: err?.message || "unknown background error",
        };
      }
    }

    // [22] getTopicsFromText
    if (message.action === "getTopicsFromText") {
      const { content } = message;
      return callOpenAiForTopics(content)
        .then((result) => ({ success: true, data: result }))
        .catch((err) => {
          console.error("Error calling OpenAI in background:", err);
          return { success: false, error: err.message };
        });
    }

    // [23] fetchPageContent (INTERNAL)
    if (message.action === "fetchPageContent") {
      console.log("📩 Received fetchPageContent request for:", message.url);

      return fetchExternalPage(message.url)
        .then((html) => {
          console.log("📬 Sending HTML response:", html ? "Success" : "NULL");
          return { success: !!html, html };
        })
        .catch((error) => {
          console.error("❌ Error fetching:", error);
          return { success: false, error: error.message };
        });
    }

    // [23.5] fetchClaimScores
    if (message.action === "fetchClaimScores") {
      try {
        const { contentId, userId } = message;
        const url = `${BASE_URL}/api/content/${contentId}/scores${userId ? `?viewerId=${userId}` : ""}`;

        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        return {
          success: true,
          verimeterScore: Number(data.verimeter_score) || 0,
        };
      } catch (err) {
        console.error("[Background] fetchClaimScores error:", err);
        return { success: false, error: err.message };
      }
    }

    // [24] openDiscussionTab
    if (message.fn === "openDiscussionTab") {
      console.log("🧪 Discuss button clicked");
      const deviceFingerprint = await getDeviceFingerprint();
      console.log("🧬 Device Fingerprint:", deviceFingerprint);

      let fullUrl = message.url;
      let jwt = null;

      try {
        // Look up session by fingerprint
        const response = await fetch(
          `${BASE_URL}/api/get-session-user?fingerprint=${encodeURIComponent(deviceFingerprint)}`,
        );

        if (response.ok) {
          const data = await response.json();
          jwt = data.jwt;

          if (jwt) {
            console.log(
              "✅ Found session, opening dashboard with authentication",
            );

            // Store JWT in extension storage for future use
            await browser.storage.local.set({ jwt, user: data.user });

            // Pass JWT to dashboard via URL so it can auto-login
            const urlObj = new URL(fullUrl);
            urlObj.searchParams.set("extJwt", jwt);
            fullUrl = urlObj.toString();
          } else {
            throw new Error("No JWT in response");
          }
        } else {
          throw new Error("Session lookup failed");
        }
      } catch (err) {
        console.log(
          "⚠️ No authenticated session found, using read-only demo mode",
        );
        await browser.storage.local.remove("jwt");
        await browser.storage.local.remove("user");

        const demoJwt = await getReadOnlyDemoJwt(deviceFingerprint);
        if (demoJwt) {
          const urlObj = new URL(fullUrl);
          urlObj.searchParams.set("demo", demoJwt);
          fullUrl = urlObj.toString();
          console.log("🔁 Falling back to demo session");
        }
      }

      console.log("🚀 Opening dashboard:", fullUrl);
      await browser.tabs.create({ url: fullUrl });
      return;
    }

    // [25] scrape task (NEW: sends payload with just URL)
    if (message.action === "scrapeTaskOnServer") {
      return callBackendScrape("/api/scrape-task", message.payload);
    }

    // [26] scrape Facebook post
    if (message.action === "scrapeFacebookPostOnServer") {
      console.log(
        "🔵 [Background] Scraping Facebook post:",
        message.payload.url,
      );
      return callBackendScrape("/api/scrape-facebook-post", {
        url: message.payload.url,
        createContent: message.payload.createContent !== false, // Default true
        // Include ALL extracted data from extension
        raw_text: message.payload.postText,
        title: message.payload.postText?.substring(0, 100),
        authors: message.payload.authorName
          ? [
              {
                author_first_name:
                  message.payload.authorName.split(" ")[0] || "",
                author_last_name:
                  message.payload.authorName.split(" ").slice(1).join(" ") ||
                  "",
              },
            ]
          : undefined,
        // Add images and metadata
        images: message.payload.images || [],
        timestamp: message.payload.timestamp,
        reactionsCount: message.payload.reactionsCount || 0,
        commentsCount: message.payload.commentsCount || 0,
        sharesCount: message.payload.sharesCount || 0,
      });
    }

    // NOTE: scrapeReferenceOnServer removed - backend now processes
    // all references inline during evidence engine (no recursion needed)

    // Default: fall through
    return Promise.resolve(undefined);
  } catch (err) {
    console.error("❌ Handler error:", err);
    return Promise.resolve(undefined);
  }
});

// --- Helper functions below, copy yours here ---

// e.g. fetchDiffbotData, addContent, addAuthorsToServer, etc.
/** @param {number} tabId @param {string} url */
async function isTopLevelPdf(tabId, url) {
  // Fast URL heuristic
  try {
    const u = new URL(url);
    if (/\.pdf($|[?#])/i.test(u.pathname)) return true;
    const fmt = (u.searchParams.get("format") || "").toLowerCase();
    if (fmt === "pdf") return true;
  } catch (_) {}

  // Probe document.contentType; viewer returns application/pdf or blocks
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: "MAIN",
      func: () => ({ ct: document.contentType || "" }),
    });
    return /application\/pdf/i.test((res && res.result && res.result.ct) || "");
  } catch {
    // Restricted surface (built-in viewer) → treat as PDF
    return true;
  }
}
/** Swap current tab to our viewer; the viewer embeds the PDF and loads popup.js */
async function openPdfViewerTab(tabId, pdfUrl) {
  const href =
    browser.runtime.getURL("viewer.html") +
    "?src=" +
    encodeURIComponent(pdfUrl);
  // Swap the URL first (fast, user-gesture safe), then hydrate state
  await browser.tabs.update(tabId, { url: href });
  // Prepare TaskCard data in the background for the viewer to read
  syncTaskStateForUrl(pdfUrl).catch(() => {});
}

async function generateExtensionFingerprint() {
  // Normalize userAgent: only keep browser family (Chrome/Firefox/Safari/Edge)
  let browser = "Unknown";
  const ua = navigator.userAgent;

  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";

  const components = [
    browser, // Now version-agnostic!
    navigator.platform || "", // Platform, e.g. "MacIntel"
    navigator.language,
    "1920x1080", // Fixed for your app
    "24", // Fixed for your app
    new Date().getTimezoneOffset(),
    "Africa/Nairobi",
  ];

  const raw = components.join("|");
  return btoa(raw);
}

// fetch a read-only demo JWT once, cache it in storage.local
async function getReadOnlyDemoJwt() {
  const { tt_demo_jwt } = await browser.storage.local.get("tt_demo_jwt");
  if (tt_demo_jwt) return tt_demo_jwt;
  // 👇 Generate fingerprint on the fly
  const fingerprint = generateDeviceFingerprint();
  console.log("Demo login with fingerprint:", fingerprint);
  // 🔐 call your API login endpoint
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Skip-Captcha": "true", // ← bypass CAPTCHA
    },
    body: JSON.stringify({
      username: "critic",
      password: "newPassword",
      fingerprint, // or hard-coded for demo
    }),
  });

  if (!res.ok) return null;
  const { token } = await res.json();
  await browser.storage.local.set({ tt_demo_jwt: token });
  return token;
}
// ✅ Check if URL is in database & update popup
async function checkContentAndUpdatePopup(tabId, url, forceVisible) {
  console.log(
    `🔍 [checkContent] Called with URL: ${url}, forceVisible: ${forceVisible}`,
  );

  if (isDashboardUrl(url)) {
    console.log("🚫 Skipping popup injection on dashboard:", url);
    return;
  }

  // 🔵 For Facebook pages, check if we already have a stored post URL
  let actualUrl = url;
  const isGenericFacebookUrl =
    url === "https://www.facebook.com" ||
    url === "https://www.facebook.com/" ||
    url === "https://facebook.com" ||
    url === "https://facebook.com/";
  const isFacebookFeed =
    (url.includes("facebook.com") || url.includes("fb.com")) &&
    !url.includes("/posts/") &&
    !url.includes("/permalink");

  console.log(
    `🔍 [checkContent] Facebook detection: isGeneric=${isGenericFacebookUrl}, isFeed=${isFacebookFeed}`,
  );

  if (isGenericFacebookUrl || isFacebookFeed) {
    console.log("🔵 [Background] Facebook feed detected in checkContent");

    // First, check if we have a stored post URL from a recent scrape
    try {
      const stored = await browser.storage.local.get("currentUrl");
      console.log(
        `🔍 [checkContent] Storage check: currentUrl=${stored.currentUrl || "NONE"}`,
      );
      if (stored.currentUrl && stored.currentUrl.includes("/posts/")) {
        console.log(
          `✅ [Background] Using stored Facebook post URL: ${stored.currentUrl}`,
        );
        actualUrl = stored.currentUrl;
      } else {
        console.log(
          "⚠️ [Background] No stored post URL, will check both feed URL and look for post in viewport",
        );
        // Note: We don't try to detect the URL here anymore - that happens in TaskCard on mount
        // Just check with the feed URL for now
      }
    } catch (err) {
      console.warn(
        "⚠️ [Background] Failed to check storage for Facebook post URL:",
        err,
      );
    }
  } else if (url.includes("facebook.com") || url.includes("fb.com")) {
    console.log(`✅ [Background] Using provided Facebook post URL: ${url}`);
  }

  console.log(`🔍 [checkContent] Final actualUrl: ${actualUrl}`);

  try {
    // For Facebook feeds, try to check both the detected post URL and the feed URL
    let urlsToCheck = [actualUrl];
    if ((isGenericFacebookUrl || isFacebookFeed) && actualUrl !== url) {
      // We have both a stored post URL and the current feed URL - check both
      urlsToCheck = [actualUrl, url];
      console.log(
        `🔍 [checkContent] Will check both URLs: ${actualUrl} and ${url}`,
      );
    } else {
      console.log(`🔍 [checkContent] Will check single URL: ${actualUrl}`);
    }

    let data = null;
    let matchedUrl = actualUrl;

    // Try each URL until we find a match
    for (const checkUrl of urlsToCheck) {
      console.log(`🔍 [checkContent] Checking database for URL: ${checkUrl}`);
      const response = await fetch(`${BASE_URL}/api/check-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checkUrl }),
      });

      const rawText = await response.text();
      console.log(
        `🔍 [checkContent] Raw response (status=${response.status}):`,
        rawText.substring(0, 500),
      );
      let result;
      try {
        result = JSON.parse(rawText);
      } catch (parseErr) {
        console.error(
          `❌ [checkContent] JSON parse failed for ${checkUrl}. Server returned:`,
          rawText.substring(0, 1000),
        );
        continue;
      }
      console.log(
        `🔍 [checkContent] Database response for ${checkUrl}: exists=${result.exists}`,
      );
      if (result.exists) {
        data = result;
        matchedUrl = checkUrl;
        console.log(`✅ [checkContent] Found task at URL: ${checkUrl}`);
        break;
      } else {
        console.log(`❌ [checkContent] No task found for URL: ${checkUrl}`);
      }
    }

    // If no match found, use the last response
    if (!data) {
      const response = await fetch(`${BASE_URL}/api/check-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: actualUrl }),
      });
      const rawText = await response.text();
      console.log(
        `🔍 [checkContent] Fallback raw response (status=${response.status}):`,
        rawText.substring(0, 500),
      );
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error(
          `❌ [checkContent] Fallback JSON parse failed. Server returned:`,
          rawText.substring(0, 1000),
        );
        data = { exists: false };
      }
      matchedUrl = actualUrl;
    }

    const isDetected = data.exists;
    const isCompleted = data.exists && data.isCompleted;
    const task = data.exists ? data.task : null;
    const store = useTaskStore.getState();

    if (data.exists) {
      console.log(
        `🔍 [checkContent] Task exists, progress field: ${data.task?.progress || "NONE"}`,
      );
    }

    if (task) {
      // ✅ Store task details in Zustand BEFORE attempting to render popup
      console.log(`🔍 [checkContent] Task data:`, {
        content_id: task.content_id,
        content_name: task.content_name?.substring(0, 50),
        progress: task.progress,
        isCompleted: isCompleted,
      });

      // Fetch verimeter score for this content
      try {
        const scoreResponse = await fetch(
          `${BASE_URL}/api/content/${task.content_id}/scores`,
          {
            method: "GET",
            credentials: "include",
          },
        );
        if (scoreResponse.ok) {
          const scoreData = await scoreResponse.json();
          task.verimeter_score = Number(scoreData.verimeter_score) || 0;
          console.log(
            `✅ [checkContent] Fetched verimeter_score: ${task.verimeter_score}`,
          );
        }
      } catch (scoreErr) {
        console.warn(
          `⚠️ [checkContent] Failed to fetch verimeter score:`,
          scoreErr,
        );
      }

      store.setTask(task);
      store.setCurrentUrl(matchedUrl); // Use the URL that actually matched
      store.setContentDetected(isCompleted);

      // Also update storage to persist the matched URL
      await browser.storage.local.set({
        task,
        currentUrl: matchedUrl,
        contentDetected: isCompleted,
      });

      console.log("📌 Updated Zustand Store:", {
        task: store.task,
        url: store.currentUrl,
        detected: store.contentDetected,
      });
    } else {
      // ❌ No task found → CLEAR previous task data
      store.setTask(null); // ✅ Ensures old data is removed
      store.setCurrentUrl(matchedUrl);
      store.setContentDetected(false);

      await browser.storage.local.set({
        task: null,
        currentUrl: matchedUrl,
        contentDetected: false,
      });

      console.log("📌 Updated Zustand Store (NO TASK):", {
        task: store.task,
        url: store.currentUrl,
        detected: store.contentDetected,
      });
    }
    console.log("🔎 Content check result:", { isDetected, isCompleted, task });

    // ✅ Show popup automatically if content is completed
    // ✅ Force show popup if the user clicked the extension icon
    if (isCompleted || forceVisible) {
      showTaskCard(tabId, isDetected, forceVisible);
    }
  } catch (error) {
    console.error("⚠️ Error checking content:", error);
  }
}

// ✅ Injects & controls the task-card popup
async function showTaskCardx(tabId, isDetected, forceVisible) {
  const code = `
    (function() {
      let popupRoot = document.getElementById("popup-root");
      if (popupRoot) popupRoot.remove();

      popupRoot = document.createElement("div");
      popupRoot.id = "popup-root";
      document.body.appendChild(popupRoot);

      popupRoot.className = ${JSON.stringify(
        isDetected || forceVisible ? "task-card-visible" : "task-card-hidden",
      )};
    })();
  `;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (isDetected, forceVisible) => {
        let popupRoot = document.getElementById("popup-root");
        if (popupRoot) popupRoot.remove();

        popupRoot = document.createElement("div");
        popupRoot.id = "popup-root";
        document.body.appendChild(popupRoot);

        popupRoot.className =
          isDetected || forceVisible ? "task-card-visible" : "task-card-hidden";
      },
      args: [isDetected, forceVisible],
    });

    await browser.scripting.executeScript({
      target: { tabId },
      files: ["popup.js"],
    });

    console.log("✅ Task-card injected successfully");
  } catch (err) {
    console.error("❌ Error injecting task card:", err);
  }
}
async function showTaskCard(tabId, isDetected, forceVisible) {
  const code = `
    (function() {
      let popupRoot = document.getElementById("popup-root");
      if (popupRoot) popupRoot.remove();

      popupRoot = document.createElement("div");
      popupRoot.id = "popup-root";
      document.body.appendChild(popupRoot);

      popupRoot.className = ${JSON.stringify(
        isDetected || forceVisible ? "task-card-visible" : "task-card-hidden",
      )};
    })();
  `;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN", // 🔥 THIS IS THE FIX
      func: (isDetected, forceVisible) => {
        const oldHost = document.getElementById("tt-popup-host");
        if (oldHost) oldHost.remove();

        const host = document.createElement("div");
        host.id = "tt-popup-host";
        host.style.position = "fixed";
        host.style.top = "10px";
        host.style.right = "20px";
        host.style.zIndex = "2147483647";
        host.style.pointerEvents = "auto";
        host.style.width = "320px";

        host.className =
          isDetected || forceVisible ? "task-card-visible" : "task-card-hidden";

        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: "open" });

        const baseStyle = document.createElement("style");
        baseStyle.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    /* Minority Report Button Styles */
    .mr-button {
      position: relative;
      padding: 10px 24px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.85));
      border: 1px solid rgba(0, 162, 255, 0.4);
      border-radius: 6px;
      color: #00a2ff;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
      font-size: 0.75rem;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.12);
      overflow: hidden;
    }

    .mr-button::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: 8px;
      height: 100%;
      background: linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, transparent 100%);
      pointer-events: none;
    }

    .mr-button:hover {
      background: linear-gradient(135deg, rgba(0, 162, 255, 0.2), rgba(0, 162, 255, 0.15));
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      border-color: #00a2ff;
    }

    .mr-button:active {
      transform: translateY(0);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 25px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    /* UserConsensusBar Pulsing Animation */
    .pulsing-glow.true {
      animation: pulse-green 1.6s infinite ease-in-out;
    }

    .pulsing-glow.false {
      animation: pulse-red 1.6s infinite ease-in-out;
    }

    @keyframes pulse-green {
      0% {
        box-shadow: 0 0 8px rgba(0, 255, 0, 0.4);
        transform: translateX(-0%) scale(0.97);
      }
      50% {
        box-shadow: 0 0 26px rgba(0, 255, 0, 0.8);
        transform: translateX(-0%) scale(1.03);
      }
      100% {
        box-shadow: 0 0 8px rgba(0, 255, 0, 0.4);
        transform: translateX(-0%) scale(0.97);
      }
    }

    @keyframes pulse-red {
      0% {
        box-shadow: 0 0 8px rgba(255, 0, 0, 0.4);
        transform: translateX(-0%) scale(0.97);
      }
      50% {
        box-shadow: 0 0 26px rgba(255, 0, 0, 0.8);
        transform: translateX(-0%) scale(1.03);
      }
      100% {
        box-shadow: 0 0 8px rgba(255, 0, 0, 0.4);
        transform: translateX(-0%) scale(0.97);
      }
    }
  `;
        shadow.appendChild(baseStyle);

        const emotionHost = document.createElement("div");
        emotionHost.id = "tt-emotion";
        shadow.appendChild(emotionHost);

        const mount = document.createElement("div");
        mount.id = "popup-root";
        shadow.appendChild(mount);
      },
      args: [isDetected, forceVisible],
    });

    await browser.scripting.executeScript({
      target: { tabId },
      files: ["popup.js"],
    });

    console.log("✅ Task-card injected successfully");
  } catch (err) {
    console.error("❌ Error injecting task card:", err);
  }
}

//call api rout to update latest url visited
async function storeLastUrl(url) {
  try {
    await fetch(`${BASE_URL}/api/store-last-visited-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    console.log("📌 Last visited URL stored in DB:", url);
  } catch (error) {
    console.error("⚠️ Error storing last visited URL:", error);
  }
}

// 🛠 Single function for extracting images from a given tab
async function extractImageFromTab(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      let maxArea = 0;
      let chosenImage = null;

      document.querySelectorAll("img").forEach((img) => {
        const width = parseInt(img.getAttribute("width") || "0", 10);
        const height = parseInt(img.getAttribute("height") || "0", 10);
        const area = width * height;

        let imgSrc = img.src;

        if (imgSrc.startsWith("/")) {
          imgSrc = window.location.origin + imgSrc;
        }

        if (area > maxArea && imgSrc) {
          maxArea = area;
          chosenImage = imgSrc;
        }
      });

      return chosenImage || null;
    },
  });

  const imageUrl =
    results[0]?.result || `${BASE_URL}/assets/images/miniLogo.png`;
  console.log("✅ Extracted Image:", imageUrl);
  return { imageUrl };
}

// 1) Extract Text from Node server (/api/extractText)
// Extract text logic
async function handleExtractText(url, html) {
  console.log(`🔄 Processing text extraction for URL: ${url}`);

  if (!html) {
    console.log("🌍 No HTML provided, fetching from backend:", url);

    try {
      const response = await fetch(`${BASE_URL}/api/extractText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html }),
      });

      const textResponse = await response.text();
      console.log("🧐 Raw extractText API response:", textResponse);

      let data;
      try {
        data = JSON.parse(textResponse);
      } catch (err) {
        console.error("❌ JSON Parse Error:", textResponse);
        throw new Error("Invalid JSON returned from extractText API");
      }

      console.log("✅ Parsed API response:", data);

      return data.pageText || "";
    } catch (error) {
      console.error("❌ Text extraction failed:", error);
      throw error;
    }
  } else {
    console.log("✅ HTML provided, skipping API request.");
    console.log("USE_HTML_DIRECTLY"); // ❗ Allow orchestrateScraping to handle it
    return html;
  }
}

async function storeClaimsOnServer(contentId, claims, contentType) {
  const response = await fetch(`${BASE_URL}/api/claims/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content_id: contentId,
      claims,
      content_type: contentType,
      user_id: null,
    }), // ✅ Ensure content_id is correct
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error("Server responded with an error storing claims");
  }
}
/**
 * Store testimonials for a content item on the server.
 * @param {string} contentId - The content ID.
 * @param {Array<{ text: string, name?: string, imageUrl?: string }>} testimonials - Array of testimonial objects.
 * @param {number|null} userId - Optional user ID, or null.
 * @returns {Promise<void>}
 */
async function storeTestimonialsOnServer(
  contentId,
  testimonials,
  userId = null,
) {
  const response = await fetch(`${BASE_URL}/api/testimonials/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content_id: contentId,
      testimonials,
      user_id: userId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to store testimonials: ${errorText}`);
  }

  // Optional: handle JSON response if you want to check { success: true }
  // const data = await response.json();
  // if (!data.success) throw new Error(data.error || "Server error storing testimonials");
}

// --- helpers you already have / minimal tweaks ---

function isDashboardUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true; // skip chrome-extension://, about:, file:// etc.
    const host = u.hostname.replace(/^www\./, "");
    return host === "localhost" || host === "truthtrollers.com";
  } catch {
    return true; // invalid URL → skip
  }
}

function getCleanUrlFromUpdate(changeInfo, tab) {
  const raw = changeInfo?.url || tab?.url || "";
  return raw ? raw.split("?")[0] : "";
}

// --- ONE onUpdated listener ---
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const cleanUrl = getCleanUrlFromUpdate(changeInfo, tab);
  if (!cleanUrl || isDashboardUrl(cleanUrl)) return;

  // Store last visited (on any URL-change), throttled by lastStoredUrl
  if (
    changeInfo.url &&
    !shouldIgnoreUrl(cleanUrl) &&
    cleanUrl !== lastStoredUrl
  ) {
    try {
      console.log("🔄 Tab updated, storing URL:", cleanUrl);
      await storeLastUrl(cleanUrl);
      lastStoredUrl = cleanUrl;
    } catch (err) {
      console.warn("⚠️ Error storing last visited URL:", err);
    }
  }

  // Only run content checks/injection when the load is complete
  if (changeInfo.status === "complete") {
    try {
      // Prep TaskCard data regardless of page type
      await syncTaskStateForUrl(cleanUrl, tabId);

      // If it’s a top-level PDF, don't try to inject overlay
      if (await isTopLevelPdf(tabId, cleanUrl)) {
        return;
      }

      // Normal HTML/YouTube/etc → update popup/overlay
      await checkContentAndUpdatePopup(tabId, cleanUrl, false);
    } catch (err) {
      console.warn("⚠️ Error checking content:", err);
    }
  }
});

// --- ONE onActivated listener ---
browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    const cleanUrl = (tab?.url || "").split("?")[0];
    if (!cleanUrl || isDashboardUrl(cleanUrl)) return;

    if (cleanUrl !== lastStoredUrl) {
      try {
        console.log("🔄 Tab switched, checking content:", cleanUrl);
        await storeLastUrl(cleanUrl);
        lastStoredUrl = cleanUrl;
      } catch (err) {
        console.warn("⚠️ Error storing last visited URL on switch:", err);
      }

      // Optionally refresh popup/overlay on tab switch
      try {
        // If top-level PDF, skip overlay
        if (!(await isTopLevelPdf(activeInfo.tabId, cleanUrl))) {
          await checkContentAndUpdatePopup(activeInfo.tabId, cleanUrl, false);
        }
      } catch (err) {
        console.warn("⚠️ Error updating popup on switch:", err);
      }
    }
  } catch (err) {
    console.error("❌ Failed to get active tab:", err);
  }
});

// --- action click (unchanged except minor guards) ---
browser.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab?.url) return;
  const cleanUrl = tab.url.split("?")[0];
  console.log("🔍 Extension icon clicked - Forcing popup for:", cleanUrl);

  // PDF: route to viewer
  if (await isTopLevelPdf(tab.id, cleanUrl)) {
    await openPdfViewerTab(tab.id, cleanUrl);
    return;
  }

  // HTML/YouTube/etc → in-page overlay flow
  await syncTaskStateForUrl(cleanUrl);
  await checkContentAndUpdatePopup(tab.id, cleanUrl, true);
});

browser.runtime.onMessageExternal.addListener((message, sender) => {
  if (message.action === "fetchPageContent") {
    console.log(
      "📩 Received EXTERNAL fetchPageContent request for:",
      message.url,
    );
    return fetchExternalPage(message.url)
      .then((html) => {
        console.log("📬 Sending HTML response:", html ? "Success" : "NULL");
        return { success: !!html, html };
      })
      .catch((error) => {
        console.error("❌ Error fetching:", error);
        return { success: false, error: error.message };
      });
    // ✅ Keeps the async response open
  }

  // 🆕 Get HTML from a tab matching the URL (for manual dashboard scrapes)
  if (message.action === "getHTMLFromTab") {
    console.log("📩 Received getHTMLFromTab request for:", message.url);

    return (async () => {
      try {
        // Find all tabs
        const tabs = await browser.tabs.query({});

        // Normalize URLs for comparison (remove trailing slashes, fragments, etc)
        const normalizeUrl = (url) => {
          try {
            const urlObj = new URL(url);
            return urlObj.origin + urlObj.pathname; // Just origin + path, no query/fragment
          } catch {
            return url;
          }
        };

        const normalizedMessageUrl = normalizeUrl(message.url);
        console.log(`🔍 Looking for tab matching: ${normalizedMessageUrl}`);
        console.log(`📋 Found ${tabs.length} open tabs`);

        // Find tab matching the URL (compare normalized versions)
        const matchingTab = tabs.find((tab) => {
          if (!tab.url) return false;
          const normalizedTabUrl = normalizeUrl(tab.url);
          const matches =
            normalizedTabUrl === normalizedMessageUrl ||
            tab.url === message.url ||
            tab.url?.startsWith(message.url);
          if (matches) {
            console.log(`✅ Match found: ${tab.url}`);
          }
          return matches;
        });

        if (!matchingTab || !matchingTab.id) {
          console.warn(`⚠️ No tab found matching URL: ${message.url}`);
          console.log(
            `Available tabs:`,
            tabs.map((t) => t.url),
          );
          return {
            success: false,
            error: `No tab found for URL: ${message.url}`,
          };
        }

        console.log(
          `✅ Found matching tab ID: ${matchingTab.id} in window ${matchingTab.windowId}`,
        );

        // Execute script in the matching tab to get its HTML
        const results = await browser.scripting.executeScript({
          target: { tabId: matchingTab.id },
          func: () => document.documentElement.outerHTML,
        });

        if (!results || !results[0] || !results[0].result) {
          return {
            success: false,
            error: `Failed to get HTML from tab ${matchingTab.id}`,
          };
        }

        const html = results[0].result;
        console.log(
          `📄 Retrieved ${html.length} chars of HTML from tab ${matchingTab.id}`,
        );

        return { success: true, html };
      } catch (error) {
        console.error("❌ Error getting HTML from tab:", error);
        return { success: false, error: error.message };
      }
    })();
  }
});

// ============================================================
// SCRAPE JOB POLLING
// Poll backend for pending scrape jobs and process them
// ============================================================

const POLL_INTERVAL_MS = 10000; // 10 seconds - reduced from 3s to reduce DB load
const INSTANCE_ID = `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let lastPollAt = 0;

// ---------- helpers ----------

async function pollForScrapeJob() {
  // debounce
  if (Date.now() - lastPollAt < POLL_INTERVAL_MS) return;
  lastPollAt = Date.now();

  try {
    const res = await fetch(`${BASE_URL}/api/scrape-jobs/pending`, {
      credentials: "include",
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!res.ok) {
      console.error(`[EXT] ❌ Failed to fetch pending jobs: ${res.status} ${res.statusText}`);
      return;
    }

    const jobs = await res.json();
    if (!jobs || jobs.length === 0) return;

    // Process first job (FIFO)
    const job = jobs[0];
    console.log(`[EXT] 📋 Processing scrape job ${job.scrape_job_id}: mode=${job.scrape_mode}, url=${job.target_url || 'N/A'}, task=${job.task_content_id || 'N/A'}`);

    await handleScrapeJob(job);
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.error("[EXT] ❌ Poll timeout - backend may be overloaded or unreachable");
    } else if (err.name === 'NetworkError') {
      console.error("[EXT] ❌ Network error during poll - check connection to backend");
    } else {
      console.error("[EXT] ❌ Poll error:", err.message);
      console.error("[EXT] 📍 Stack:", err.stack);
    }
  }
}

async function handleScrapeJob(job) {
  const { scrape_job_id, scrape_mode, target_url, task_content_id } = job;
  let jobClaimed = false;

  try {
    // Step 1: Claim the job
    const claimRes = await fetch(`${BASE_URL}/api/scrape-jobs/${scrape_job_id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ instance_id: INSTANCE_ID }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!claimRes.ok) {
      const errorText = await claimRes.text().catch(() => 'unknown error');
      console.log(`[EXT] ⚠️ Could not claim job ${scrape_job_id} - status ${claimRes.status} (${errorText})`);
      return; // Job was claimed by another instance, skip it
    }

    jobClaimed = true;
    console.log(`[EXT] ✅ Successfully claimed job ${scrape_job_id}`);

    let targetTab, url;

    // Step 2: Find the appropriate tab based on scrape mode
    console.log(`[EXT] 🔍 Finding target tab for mode: ${scrape_mode}`);
    const tabs = await safeTabQuery({});

    if (scrape_mode === "scrape_last_viewed") {
      // Use active tab
      const activeTabs = await safeTabQuery({
        active: true,
        currentWindow: true,
      });
      if (!activeTabs || activeTabs.length === 0) {
        throw new Error("No active tab found for scrape_last_viewed mode - user may have closed all tabs");
      }
      targetTab = activeTabs[0];
      url = targetTab.url;
      console.log(`[EXT] 📍 Using active tab ${targetTab.id}: ${url}`);
    } else if (scrape_mode === "scrape_specific_url") {
      // Find tab matching target_url
      targetTab = tabs.find(
        (t) => t.url === target_url || t.url?.startsWith(target_url),
      );
      if (!targetTab) {
        console.error(`[EXT] ❌ No tab found matching target URL: ${target_url}`);
        console.log(`[EXT] 📋 Available tabs (${tabs.length}):`, tabs.map(t => ({ id: t.id, url: t.url })));
        throw new Error(`No tab found for URL: ${target_url} - user may have closed the tab`);
      }
      url = targetTab.url;
      console.log(`[EXT] 📍 Found tab ${targetTab.id} matching URL: ${url}`);
    }

    if (!targetTab?.id) {
      throw new Error("Target tab not found - invalid scrape mode or no matching tab");
    }

    // Step 3: Check if this is a PDF
    const viewerPrefix = browser.runtime.getURL("viewer.html");
    const isPdfViewer = targetTab.url && targetTab.url.startsWith(viewerPrefix);

    let raw_html = null;
    let pdfText = null;
    let pdfTitle = null;
    let pdfAuthors = null;
    let actualUrl = url;

    // For viewer.html tabs, extract the actual PDF URL from query params
    if (isPdfViewer) {
      const urlParams = new URLSearchParams(new URL(targetTab.url).search);
      actualUrl = urlParams.get("src");
    }

    // Simple PDF detection: try to fetch as PDF if URL suggests it might be one
    const mightBePdf =
      url &&
      (url.toLowerCase().includes(".pdf") ||
        url.toLowerCase().includes("/download"));

    if (isPdfViewer || mightBePdf) {
      // Try to extract as PDF
      console.log(
        `[EXT] Attempting PDF extraction from tab ${targetTab.id} for ${actualUrl}`,
      );

      try {
        // Try to fetch the PDF blob from the loaded tab
        console.log(`[EXT] 📥 Fetching PDF from: ${actualUrl}`);
        const pdfResponse = await fetch(actualUrl, {
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });

        if (!pdfResponse.ok) {
          console.log(
            `[EXT] PDF fetch failed with status ${pdfResponse.status}, will try HTML extraction`,
          );
          throw new Error(`PDF fetch failed: HTTP ${pdfResponse.status}`);
        }

        const pdfBlob = await pdfResponse.arrayBuffer();
        console.log(`[EXT] Got blob from browser: ${pdfBlob.byteLength} bytes`);

        if (!pdfBlob || pdfBlob.byteLength === 0) {
          throw new Error("Blob is empty - PDF may not be accessible");
        }

        // Send blob to backend for parsing
        console.log(`[EXT] 📤 Sending ${pdfBlob.byteLength} bytes to backend for parsing...`);
        const pdfRes = await fetch(`${BASE_URL}/api/parse-pdf-blob`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          credentials: "include",
          body: pdfBlob,
          signal: AbortSignal.timeout(60000) // 60 second timeout for PDF parsing
        });

        if (!pdfRes.ok) {
          const errorText = await pdfRes.text();
          console.log(
            `[EXT] PDF parsing failed with status ${pdfRes.status}: ${errorText}, will try HTML extraction`,
          );
          throw new Error(`PDF parsing failed: ${errorText}`);
        }

        const pdfData = await pdfRes.json();
        if (pdfData.success && pdfData.text) {
          pdfText = pdfData.text;
          pdfTitle = pdfData.title || null;
          pdfAuthors = pdfData.authors || null;
          console.log(
            `[EXT] ✅ Extracted ${pdfText.length} chars from PDF (title: ${pdfTitle})`,
          );
        } else {
          throw new Error("PDF parsing returned no text");
        }
      } catch (err) {
        // Enhanced error logging for PDF extraction failures
        if (err.name === 'TimeoutError') {
          console.error(`[EXT] ❌ PDF extraction timed out after 30 seconds`);
        } else if (err.name === 'NetworkError') {
          console.error(`[EXT] ❌ Network error while fetching PDF:`, err.message);
        } else {
          console.error(`[EXT] ❌ PDF extraction error:`, err.message);
        }
        // PDF extraction failed, fall back to HTML
        console.log(
          `[EXT] PDF extraction failed (${err.message}), falling back to HTML extraction`,
        );
        raw_html = await safeExecuteScript(
          targetTab.id,
          () => document.documentElement.outerHTML,
          'PDF fallback HTML extraction'
        );
        console.log(
          `[EXT] Extracted ${raw_html.length} chars HTML from tab ${targetTab.id}`,
        );
      }
    } else {
      // Extract HTML from regular webpage
      raw_html = await safeExecuteScript(
        targetTab.id,
        () => document.documentElement.outerHTML,
        'HTML extraction'
      );

      console.log(
        `[EXT] Extracted ${raw_html.length} chars from tab ${targetTab.id}`,
      );
    }

    // Step 4: Send to scrape-reference endpoint (not scrape-task - we don't want evidence engine)
    console.log(`[EXT] 📤 Sending scrape data to backend: url=${actualUrl}, html_length=${raw_html?.length || 0}, pdf_text_length=${pdfText?.length || 0}`);

    const scrapeRes = await fetch(`${BASE_URL}/api/scrape-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        url: actualUrl,
        raw_html: raw_html,
        raw_text: pdfText, // Send PDF text if available
        title: pdfTitle, // Send PDF title from metadata
        authors: pdfAuthors, // Send PDF authors from metadata
        taskContentId: task_content_id,
      }),
      signal: AbortSignal.timeout(120000) // 2 minute timeout for scrape API
    });

    if (!scrapeRes.ok) {
      const errorText = await scrapeRes.text();
      console.error(`[EXT] ❌ Scrape API returned error ${scrapeRes.status}: ${errorText}`);
      throw new Error(`Scrape API failed: ${scrapeRes.status} - ${errorText}`);
    }

    const scrapeResult = await scrapeRes.json();

    if (!scrapeResult.success) {
      console.error(`[EXT] ❌ Scrape result indicates failure:`, scrapeResult);
      throw new Error(scrapeResult.error || "Scrape failed");
    }

    const referenceContentId = scrapeResult.contentId;
    console.log(`[EXT] ✅ Scrape successful, content_id: ${referenceContentId}`);

    // Step 5: Mark job as completed
    console.log(`[EXT] 📝 Marking job ${scrape_job_id} as completed...`);
    const completeRes = await fetch(`${BASE_URL}/api/scrape-jobs/${scrape_job_id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        content_id: referenceContentId,
        instance_id: INSTANCE_ID,
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!completeRes.ok) {
      const errorText = await completeRes.text().catch(() => 'unknown error');
      console.error(`[EXT] ⚠️ Failed to mark job as completed: ${completeRes.status} - ${errorText}`);
      console.error(`[EXT] 📋 Job ${scrape_job_id} completed successfully but status update failed - backend will see stale 'claimed' status and reset after 5 min`);
    }

    console.log(
      `[EXT] ✅ Scrape job ${scrape_job_id} completed successfully, reference_content_id: ${referenceContentId}`,
    );
  } catch (err) {
    console.error(`[EXT] ❌ Scrape job ${scrape_job_id} FAILED at step:`, err.message);
    console.error(`[EXT] 📍 Error stack:`, err.stack);
    console.error(`[EXT] 📋 Job details: mode=${scrape_mode}, url=${target_url || 'N/A'}, task=${task_content_id || 'N/A'}`);

    // Only mark as failed if we successfully claimed it
    // Otherwise the job is still pending and another instance can try
    if (jobClaimed) {
      console.log(`[EXT] 📝 Marking job ${scrape_job_id} as failed...`);
      try {
        const failRes = await fetch(`${BASE_URL}/api/scrape-jobs/${scrape_job_id}/fail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            error_message: err.message,
            instance_id: INSTANCE_ID,
          }),
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!failRes.ok) {
          const errorText = await failRes.text().catch(() => 'unknown error');
          console.error(`[EXT] ⚠️ Failed to mark job as failed: ${failRes.status} - ${errorText}`);
          console.log(`[EXT] 🔄 Job will be auto-reset to pending after 5 minutes by backend`);
        } else {
          console.log(`[EXT] ✅ Job ${scrape_job_id} marked as failed successfully`);
        }
      } catch (failErr) {
        if (failErr.name === 'TimeoutError') {
          console.error("[EXT] ❌ Timeout while marking job as failed - backend may be overloaded");
        } else {
          console.error("[EXT] ❌ Exception while marking job as failed:", failErr.message);
        }
        console.log(`[EXT] 🔄 Job will be auto-reset to pending after 5 minutes by backend`);
      }
    } else {
      console.log(`[EXT] ⏭️ Job ${scrape_job_id} was not claimed by this instance, skipping fail marker`);
    }
  }
}

// ---------- triggers ----------

// Poll periodically (fallback)
setInterval(() => {
  pollForScrapeJob().catch(err => {
    console.error('[EXT] 🚨 Polling interval caught error:', err);
  });
}, POLL_INTERVAL_MS);

// Poll when dashboard tab becomes active
browser.tabs.onActivated.addListener(async () => {
  try {
    await pollForScrapeJob();
  } catch (err) {
    console.error('[EXT] 🚨 Tab activation polling caught error:', err);
  }
});

// Poll when dashboard finishes loading
browser.tabs.onUpdated.addListener((_, changeInfo, tab) => {
  try {
    if (
      changeInfo.status === "complete" &&
      tab.url &&
      (tab.url.includes("localhost:5173") ||
        tab.url.includes("truthtrollers.com"))
    ) {
      pollForScrapeJob().catch(err => {
        console.error('[EXT] 🚨 Tab update polling caught error:', err);
      });
    }
  } catch (err) {
    console.error('[EXT] 🚨 Tab update listener caught error:', err);
  }
});

// ============================================================
// CRASH DETECTION & PREVENTION
// Prevents extension crashes from locking up scrape jobs
// ============================================================

// Global error handler - catches uncaught errors
self.addEventListener('error', (event) => {
  console.error('[EXT] 🚨 UNCAUGHT ERROR:', event.error);
  console.error('[EXT] 📍 Error message:', event.message);
  console.error('[EXT] 📍 Error filename:', event.filename);
  console.error('[EXT] 📍 Error line:', event.lineno);
  console.error('[EXT] 📍 Stack:', event.error?.stack);

  // Log crash to storage for detection
  browser.storage.local.set({
    lastCrash: {
      timestamp: Date.now(),
      error: event.message,
      stack: event.error?.stack,
      instanceId: INSTANCE_ID
    }
  }).catch(err => console.error('[EXT] Failed to log crash:', err));
});

// Global unhandled promise rejection handler
self.addEventListener('unhandledrejection', (event) => {
  console.error('[EXT] 🚨 UNHANDLED PROMISE REJECTION:', event.reason);
  console.error('[EXT] 📍 Promise:', event.promise);

  // Log crash to storage for detection
  browser.storage.local.set({
    lastCrash: {
      timestamp: Date.now(),
      error: `Unhandled promise rejection: ${event.reason}`,
      stack: event.reason?.stack,
      instanceId: INSTANCE_ID
    }
  }).catch(err => console.error('[EXT] Failed to log crash:', err));

  // Prevent default to avoid console spam
  event.preventDefault();
});

// Heartbeat system - updates every 30 seconds to prove extension is alive
const HEARTBEAT_INTERVAL_MS = 30000;
let lastHeartbeat = Date.now();

setInterval(() => {
  lastHeartbeat = Date.now();
  browser.storage.local.set({
    extensionHeartbeat: {
      timestamp: lastHeartbeat,
      instanceId: INSTANCE_ID,
      activeJobs: 0 // Could track active jobs here if needed
    }
  }).catch(err => console.error('[EXT] Failed to update heartbeat:', err));
}, HEARTBEAT_INTERVAL_MS);

// On startup, check if we crashed previously
browser.storage.local.get(['lastCrash', 'extensionHeartbeat']).then(result => {
  if (result.lastCrash) {
    const crashTime = result.lastCrash.timestamp;
    const timeSinceCrash = Date.now() - crashTime;

    // If crash was recent (< 5 minutes), log it
    if (timeSinceCrash < 5 * 60 * 1000) {
      console.error('[EXT] 🚨 EXTENSION RECOVERED FROM RECENT CRASH');
      console.error('[EXT] 📍 Crash time:', new Date(crashTime).toISOString());
      console.error('[EXT] 📍 Time since crash:', Math.round(timeSinceCrash / 1000), 'seconds');
      console.error('[EXT] 📍 Crash error:', result.lastCrash.error);
      console.error('[EXT] 📍 Previous instance:', result.lastCrash.instanceId);
      console.error('[EXT] 📍 Current instance:', INSTANCE_ID);
      console.log('[EXT] 🔄 Any jobs claimed by crashed instance will be auto-reset by backend after 5 minutes');
    }

    // Clear the crash record after logging
    browser.storage.local.remove('lastCrash');
  }

  if (result.extensionHeartbeat) {
    const lastBeat = result.extensionHeartbeat.timestamp;
    const timeSinceLastBeat = Date.now() - lastBeat;

    // If last heartbeat was > 2 minutes ago, extension was likely restarted
    if (timeSinceLastBeat > 2 * 60 * 1000) {
      console.warn('[EXT] ⚠️ Extension was inactive for', Math.round(timeSinceLastBeat / 1000), 'seconds');
      console.log('[EXT] 📋 Previous instance:', result.extensionHeartbeat.instanceId);
      console.log('[EXT] 📋 Current instance:', INSTANCE_ID);
    }
  }

  console.log('[EXT] ✅ Crash detection and prevention initialized');
  console.log('[EXT] 📋 Instance ID:', INSTANCE_ID);
}).catch(err => {
  console.error('[EXT] Failed to check crash status:', err);
});

// Enhanced error wrapper for critical async operations
async function safeAsync(fn, context = 'unknown operation') {
  try {
    return await fn();
  } catch (err) {
    console.error(`[EXT] 🚨 Error in ${context}:`, err.message);
    console.error(`[EXT] 📍 Stack:`, err.stack);
    throw err; // Re-throw so caller can handle
  }
}

// Wrap tab access to handle common failures
async function safeTabQuery(queryInfo) {
  try {
    return await browser.tabs.query(queryInfo);
  } catch (err) {
    console.error('[EXT] ❌ Tab query failed:', err.message);
    console.error('[EXT] 📍 Query:', JSON.stringify(queryInfo));
    return [];
  }
}

// Wrap script execution to handle failures
async function safeExecuteScript(tabId, func, context = 'script execution') {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func
    });
    return results[0]?.result;
  } catch (err) {
    console.error(`[EXT] ❌ Script execution failed in ${context}:`, err.message);
    console.error('[EXT] 📍 Tab ID:', tabId);
    throw new Error(`Failed to execute script: ${err.message}`);
  }
}

// ============================================================================
// Tab close handler - clean up scrapes for closed tabs
// ============================================================================
browser.tabs.onRemoved.addListener((tabId) => {
  if (activeScrapes.has(tabId)) {
    const scrapeInfo = activeScrapes.get(tabId);
    console.warn(`⚠️ [Tab ${tabId}] Tab closed during scrape of ${scrapeInfo.url}`);
    activeScrapes.delete(tabId);
    console.log(`📊 Active scrapes remaining: ${activeScrapes.size} tab(s)`);
  }
});
