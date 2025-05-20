import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
import browser from "webextension-polyfill";
import { generateDeviceFingerprint } from "../../dashboard/src/utils/generateDeviceFingerprint";

// --- Constants and state ---
const BASE_URL =
  process.env.REACT_APP_EXTENSION_BASE_URL || "https://localhost:5001";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
let isScraperActive = false;
let lastStoredUrl = "";
let activeScrapeTabId = null;

// --- SINGLE onMessage HANDLER ---
browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    // [0] PING TEST
    if (message.action === "pingTest") {
      return { pong: true };
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
        if (tabs.length > 0 && tabs[0].id) {
          activeScrapeTabId = tabs[0].id;
        }
      } catch (err) {
        console.error("❌ Error querying active tab:", err);
      }
      return;
    }

    // [6] scrapeCompleted
    if (message.action === "scrapeCompleted") {
      console.log("✅ Scraping finished!");
      try {
        const { activeScrapeTabId } = await browser.storage.local.get(
          "activeScrapeTabId"
        );
        const url = message.url;
        const tabId = activeScrapeTabId || sender.tab?.id;

        if (tabId) {
          console.log("📌 Updating popup in scrape tab:", tabId);
          await checkContentAndUpdatePopup(tabId, url, true);
        } else {
          console.warn("⚠️ No activeScrapeTabId found! Cannot show popup.");
        }
      } catch (err) {
        console.error("❌ Error accessing browser.storage:", err);
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
      return callOpenAiAnalyze(message.content)
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
        const demoJwt = await getReadOnlyDemoJwt();
        fullUrl = `${message.url}?demo=${encodeURIComponent(demoJwt)}`;
        console.log("🔁 Falling back to demo session", fullUrl);
      }
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
