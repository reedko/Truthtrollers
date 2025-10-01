// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
import browser from "webextension-polyfill";
import { generateDeviceFingerprint } from "../../dashboard/src/utils/generateDeviceFingerprint";
import { extractVideoIdFromUrl } from "./services/parseYoutubeUrl";

const isDashboardUrl = (url) => {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "truthtrollers.com";
  } catch {
    return false;
  }
};

const BASE_URL =
  process.env.REACT_APP_EXTENSION_BASE_URL || "https://localhost:5001";

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
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

let activeScrapeTabId = null; // 👈 add this
/** @param {string} url */
async function syncTaskStateForUrl(url) {
  try {
    const resp = await fetch(`${BASE_URL}/api/check-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json();
    const isDetected = !!data.exists;
    const isCompleted =
      isDetected && data.task && data.task.progress === "Completed";
    const task = isDetected ? data.task : null;

    // keep background store in sync (your current logic)
    const store = useTaskStore.getState();
    store.setTask(task);
    store.setCurrentUrl(url);
    store.setContentDetected(isCompleted);

    // and mirror to storage for TaskCard/panel to read
    await browser.storage.local.set({
      task,
      currentUrl: url,
      contentDetected: isCompleted,
    });
  } catch (e) {
    console.error("syncTaskStateForUrl failed:", e);
  }
}

// ✅ Create Task
const addContent = async (taskData) => {
  try {
    const response = await fetch(`${BASE_URL}/api/addContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskData),
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
    for (const lit_reference of content) {
      await fetch(`${BASE_URL}/api/content/${taskId}/add-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lit_reference }),
      });
    }
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
        `Diffbot pre-scrape failed with status: ${response.status}`
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
        `❌ HTTP error: ${response.status} - ${response.statusText}`
      );
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const jsonResponse = await response.json();
    console.log(
      `✅ Received page content: ${jsonResponse.html?.length || 0} bytes`
    );

    return jsonResponse.html;
  } catch (error) {
    console.error("❌ Error fetching page content:", error);
    return null; // ✅ Avoid unhandled rejections
  }
};

let isScraperActive = false; // ✅ Track scraper state

let lastStoredUrl = "";

// --- SINGLE onMessage HANDLER ---
browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
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
        message.articleUrl
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
      console.log("⏳ Scraping in progress... Blocking new injections.");
      isScraperActive = true;
      activeScrapeTabId = sender.tab?.id ?? null;
      try {
        await browser.storage.local.set({ activeScrapeTabId });
      } catch (e) {
        console.warn("Failed to persist activeScrapeTabId:", e);
      }
      return;
    }

    // [5] scrapeStarted
    if (message.action === "scrapeStarted") {
      console.log("⏳ Scraping started... Setting activeScrapeTabId");
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs.length && tabs[0].id) {
          activeScrapeTabId = tabs[0].id;
          await browser.storage.local.set({ activeScrapeTabId });
        }
      } catch (err) {
        console.error("❌ Error querying active tab:", err);
      }
      return;
    }

    // [6] scrapeCompleted
    if (message.action === "scrapeCompleted") {
      console.log("✅ Scraping finished!");
      isScraperActive = false;
      try {
        const storeObj = await browser.storage.local.get("activeScrapeTabId");
        const storedId = storeObj?.activeScrapeTabId ?? null;
        const tabId = storedId ?? activeScrapeTabId ?? sender.tab?.id ?? null;
        const url = message.url;

        if (tabId) {
          console.log("📌 Updating popup in scrape tab:", tabId);
          await checkContentAndUpdatePopup(tabId, url, true);
        } else {
          console.warn("⚠️ No activeScrapeTabId found! Cannot show popup.");
        }

        await browser.storage.local.remove("activeScrapeTabId");
        activeScrapeTabId = null;
      } catch (err) {
        console.error("❌ Error finishing scrape:", err);
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
            contentId
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
          message.url
        )}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
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

        if (!textData.success || !textData.text?.trim()) {
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
          author: textData.author,
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
          `${BASE_URL}/api/youtube-transcript/${message.videoId}`
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
      return callOpenAiAnalyze(message.content, message.testimonials)
        .then((result) => ({ success: true, data: result }))
        .catch((err) => ({ success: false, error: err.message }));
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

    // [24] openDiscussionTab
    if (message.fn === "openDiscussionTab") {
      console.log("🧪 Argue button clicked");
      const deviceFingerprint = await generateExtensionFingerprint();
      console.log("🧬 Device Fingerprint:", deviceFingerprint);

      let fullUrl = message.url;
      console.log(fullUrl, "JKHHGFDS");
      try {
        const response = await fetch(
          `${BASE_URL}/api/get-session-user?fingerprint=${deviceFingerprint}`
        );
        const { jwt } = await response.json();
        if (response.ok && jwt) {
          await browser.storage.local.set({ jwt });
          fullUrl = message.url;
          console.log("✅ Found session, using full access");
        } else {
          throw new Error("Session lookup failed");
        }
      } catch (err) {
        await browser.storage.local.remove("jwt");
        await browser.storage.local.remove("user");
        const demoJwt = await getReadOnlyDemoJwt(deviceFingerprint);
        fullUrl = `${message.url}?demo=${encodeURIComponent(demoJwt)}`;
        console.log("🔁 Falling back to demo session", fullUrl);
      }
      console.log(fullUrl, "LJKJHJGFHJKK");
      await browser.tabs.create({ url: fullUrl });
      return;
    }

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
  if (isDashboardUrl(url)) {
    console.log("🚫 Skipping popup injection on dashboard:", url);
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}/api/check-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    const isDetected = data.exists;
    const isCompleted = data.exists && data.task.progress === "Completed";
    const task = data.exists ? data.task : null;
    const store = useTaskStore.getState();

    if (task) {
      // ✅ Store task details in Zustand BEFORE attempting to render popup

      store.setTask(task);
      store.setCurrentUrl(url);
      store.setContentDetected(isCompleted);

      console.log("📌 Updated Zustand Store:", {
        task: store.task,
        url: store.currentUrl,
        detected: store.contentDetected,
      });
    } else {
      // ❌ No task found → CLEAR previous task data
      store.setTask(null); // ✅ Ensures old data is removed
      store.setCurrentUrl(url);
      store.setContentDetected(false);
      console.log("📌 Updated Zustand Store:", {
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
async function showTaskCard(tabId, isDetected, forceVisible) {
  const code = `
    (function() {
      let popupRoot = document.getElementById("popup-root");
      if (popupRoot) popupRoot.remove();

      popupRoot = document.createElement("div");
      popupRoot.id = "popup-root";
      document.body.appendChild(popupRoot);

      popupRoot.className = ${JSON.stringify(
        isDetected || forceVisible ? "task-card-visible" : "task-card-hidden"
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
  userId = null
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

// Example function that calls OpenAI for both topics & claims
async function callOpenAiAnalyze(content, testimonials) {
  // Add a testimonialsText block if testimonials were passed
  const testimonialsText =
    testimonials && Array.isArray(testimonials) && testimonials.length > 0
      ? `
Below is a list of testimonials extracted by a preliminary detector. If they appear in the main text, deduplicate, dedupe, or combine as needed. Improve these if you see better info in the full article.

Extracted testimonials:
${JSON.stringify(testimonials, null, 2)}
      `
      : "";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a combined topic, claim, and testimonial extraction assistant.",
        },
        {
          role: "user",
          content: `
You are a fact-checking assistant.

First, identify the most general topic (max 2 words) for this text.
Then, list more specific subtopics under that topic (2 to 5).
Next, extract every distinct factual assertion or claim — especially those with numbers, statistics, or timelines. 
Avoid generalizations or summaries. Do not combine multiple claims. 
Each claim must be independently verifiable and phrased as a full sentence.

Also, extract any testimonials or first-person case studies in the text (phrases such as “I used this and it worked for me,” or “Bobby used this method and made $20 billion”), and try to include a name or image URL if present. Testimonials must be objects: { "text": "...", "name": "...", "imageUrl": "..." } (name and imageUrl are optional).

${testimonialsText}

Return your answer in strict JSON like this:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" },
    ...
  ]
}

Text:
${content}
          `,
        },
      ],
    }),
  });

  // ...the rest of your JSON parsing logic stays as you had it!
  if (!response.ok) {
    let errorMessage = `OpenAI request failed: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData?.error?.message) {
        errorMessage += ` — ${errorData.error.message}`;
      }
    } catch (jsonErr) {}
    throw new Error(errorMessage);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No completion returned from OpenAI");
  }

  let cleanedReply = data.choices[0].message.content.trim();
  if (cleanedReply.startsWith("```json")) {
    cleanedReply = cleanedReply
      .replace(/^```json/, "")
      .replace(/```$/, "")
      .trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(cleanedReply);
  } catch (err) {
    console.error("Invalid JSON from GPT:", cleanedReply);
    throw new Error("GPT returned invalid JSON");
  }

  return {
    generalTopic: parsed.generalTopic || "Unknown",
    specificTopics: Array.isArray(parsed.specificTopics)
      ? parsed.specificTopics
      : [],
    claims: Array.isArray(parsed.claims) ? parsed.claims : [],
    testimonials: Array.isArray(parsed.testimonials) ? parsed.testimonials : [],
  };
}

// ✅ Detect when user navigates to a new page
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  checkContentAndUpdatePopup(tabId, tab.url, false);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !isDashboardUrl(tab.url || "")) {
    const cleanUrl = changeInfo.url.split("?")[0];
    if (!shouldIgnoreUrl(cleanUrl) && cleanUrl !== lastStoredUrl) {
      console.log("🔄 Tab updated, storing URL:", cleanUrl);
      storeLastUrl(cleanUrl);
      lastStoredUrl = cleanUrl;
    }
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    if (!isDashboardUrl(tab.url || "")) {
      const cleanUrl = tab.url.split("?")[0];
      if (cleanUrl !== lastStoredUrl) {
        console.log("🔄 Tab switched, checking content:", cleanUrl);
        storeLastUrl(cleanUrl);
        lastStoredUrl = cleanUrl;
      }
    }
  } catch (err) {
    console.error("❌ Failed to get active tab:", err);
  }
});

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url) return;
  console.log("🔍 Extension icon clicked - Forcing popup for:", tab.url);
  // If it’s a PDF, reload into our viewer page and stop.
  if (await isTopLevelPdf(tab.id, tab.url)) {
    await openPdfViewerTab(tab.id, tab.url);
    return;
  }

  // HTML/YouTube/etc → keep your in-page overlay flow
  await syncTaskStateForUrl(tab.url);
  checkContentAndUpdatePopup(tab.id, tab.url, true);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab || !tab.url) return;

  await syncTaskStateForUrl(tab.url);

  if (await isTopLevelPdf(tabId, tab.url)) {
    // Don't try to inject into the PDF viewer
    return;
  }

  return checkContentAndUpdatePopup(tabId, tab.url, false);
});

//external
browser.runtime.onMessageExternal.addListener((message, sender) => {
  if (message.action === "fetchPageContent") {
    console.log(
      "📩 Received EXTERNAL fetchPageContent request for:",
      message.url
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
});
