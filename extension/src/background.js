// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
import browser from "webextension-polyfill";
import { generateDeviceFingerprint } from "../../dashboard/src/utils/generateDeviceFingerprint";

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

const injectPopup = async (tabId) => {
  try {
    await browser.scripting.executeScript(tabId, { code });
    await browser.scripting.executeScript(tabId, { file: "popup.js" });
  } catch (err) {
    console.error("❌ Popup injection failed:", err);
    // Optionally log fallback here
  }
};

let isScraperActive = false; // ✅ Track scraper state
//get stored url
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "getStoredUrl") {
    return browser.storage.local.get("lastVisitedURL").then((data) => {
      console.log("📌 Stored URL retrieved:", data);
      return { url: data.lastVisitedURL || null };
    });
  }
});

//SCRAPING

//scraping started messages

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === "scrapingStarted") {
    console.log("⏳ Scraping in progress... Blocking new injections.");
    isScraperActive = true;
    activeScrapeTabId = sender.tab?.id ?? null; // Use optional chaining
  }

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
  }
});

//scrape completed call check content
browser.runtime.onMessage.addListener(async (message, sender) => {
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
  }
});

// ✅ Detect when user navigates to a new page
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  checkContentAndUpdatePopup(tabId, tab.url, false);
});

// ✅ Detect when user clicks the extension icon
browser.action.onClicked.addListener((tab) => {
  if (!tab.url) return;

  console.log("🔍 Extension icon clicked - Forcing popup for:", tab.url);
  checkContentAndUpdatePopup(tab.id, tab.url, true);
});

async function generateExtensionFingerprint() {
  const key = "tt_device_fp";

  const stored = await browser.storage.local.get(key);
  if (stored && stored[key]) return stored[key];

  const components = [
    navigator.userAgent,
    navigator.language,
    "1920x1080", // ✅ fixed value
    "24", // ✅ fixed color depth
    new Date().getTimezoneOffset(),
    "Africa/Nairobi",
  ];

  const raw = components.join("|");
  const hash = btoa(raw);
  await browser.storage.local.set({ [key]: hash });
  return hash;
}

// export if needed elsewhere in background.js
// module.exports = { generateExtensionFingerprint };

//DiscussionTab listener
// 🧪 DiscussionTab listener
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.fn === "openDiscussionTab") {
    console.log("🧪 Argue button clicked");

    // ✅ Await the fingerprint
    const deviceFingerprint = await generateExtensionFingerprint();
    console.log("🧬 Device Fingerprint:", deviceFingerprint);

    let fullUrl = msg.url;

    try {
      const response = await fetch(
        `${BASE_URL}/api/get-session-user?fingerprint=${deviceFingerprint}`
      );

      const { jwt } = await response.json();
      if (response.ok && jwt) {
        await browser.storage.local.set({ jwt });
        fullUrl = msg.url;
        console.log("✅ Found session, using full access");
      } else {
        throw new Error("Session lookup failed");
      }
    } catch (err) {
      const demoJwt = await getReadOnlyDemoJwt();
      fullUrl = `${msg.url}?demo=${encodeURIComponent(demoJwt)}`;
      console.log("🔁 Falling back to demo session", fullUrl);
    }

    await browser.tabs.create({ url: fullUrl });
  }
});

// fetch a read-only demo JWT once, cache it in storage.local
async function getReadOnlyDemoJwt() {
  const { tt_demo_jwt } = await browser.storage.local.get("tt_demo_jwt");
  if (tt_demo_jwt) return tt_demo_jwt;

  // 🔐 call your API login endpoint
  const res = await fetch("http://localhost:3000/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Skip-Captcha": "true", // ← bypass CAPTCHA
    },
    body: JSON.stringify({
      username: "critic",
      password: "newPassword", // or hard-coded for demo
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

const shouldIgnoreUrl = (url) => {
  const ignoredSites = ["facebook.com/messages", "messenger.com"];
  const isIgnored = ignoredSites.some((site) => url.includes(site));
  if (isIgnored) console.log("🚫 Ignored URL:", url);
  return isIgnored;
};

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

let lastStoredUrl = "";
//on activate new tab, write url to db
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

//send current tab as reponse
browser.runtime.onMessage.addListener(async (message) => {
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
});

//capture image
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action !== "captureImage") return;

  const { url, html, diffbotData } = message;
  const baseUrl = new URL(url).origin;
  const pageUrl = new URL(url);

  // ✅ 1. Extract from provided HTML
  let imageUrl = extractImageFromHtml(html, pageUrl);
  if (imageUrl) {
    console.log("✅ Found image in extracted HTML:", imageUrl);
    return { imageUrl };
  }

  console.warn("⚠️ No image in extracted HTML. Checking Diffbot...");

  // ✅ 2. Fallback to Diffbot
  if (diffbotData?.images?.length > 0) {
    imageUrl = diffbotData.images[0].url;
    console.log("✅ Found image in Diffbot:", imageUrl);
    return { imageUrl };
  }

  console.warn("⚠️ No image from Diffbot. Checking current tab...");

  // ✅ 3. Get current active tab
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (currentTab?.url === url) {
    console.log("🔍 Extracting image from CURRENT tab:", currentTab.url);
    return await extractImageFromTab(currentTab.id);
  }

  console.log("🌍 Opening hidden tab to capture image from:", url);

  // ✅ 4. Open hidden tab and wait for it to load
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
});

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

//add content to db, calls api route
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "addContent") {
    return addContent(message.taskData)
      .then((contentId) => {
        console.log("✅ Background: Received taskId from backend:", contentId);
        const responsePayload = { contentId };
        console.log("🚀 Sending response to createTask.ts:", responsePayload);
        return responsePayload;
      })
      .catch((err) => {
        console.error("❌ Background: Failed to create content:", err);
        return { error: "Failed to create content" };
      });
  }

  if (message.action === "addAuthors") {
    return addAuthorsToServer(message.contentId, message.authors)
      .then(() => ({ success: true }))
      .catch(() => ({ success: false }));
  }

  if (message.action === "addPublisher") {
    return addPublisherToServer(message.contentId, message.publisher)
      .then(() => ({ success: true }))
      .catch(() => ({ success: false }));
  }

  if (message.action === "addSources") {
    return addSourcesToServer(message.taskId, message.content)
      .then(() => ({ success: true }))
      .catch(() => ({ success: false }));
  }

  if (message.action === "fetchDiffbotData") {
    return fetchDiffbotData(message.articleUrl)
      .then((data) => data || { success: false })
      .catch(() => ({ success: false }));
  }
});

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

//check for current db -- not sure this is used anymore--handled in storedproc
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkDatabaseForReference") {
    console.log(`🔍 Received request to check DB for: ${message.url}`);

    return fetch(
      `${BASE_URL}/api/check-reference?url=${encodeURIComponent(message.url)}`,
      {
        method: "GET", // ✅ Now using GET
        headers: { "Content-Type": "application/json" },
      }
    )
      .then((response) => response.json())
      .then((data) => {
        console.log(`📌 API Response for ${message.url}:`, data);
        return data.content_id || null; // ✅ Now correctly checking if ID exists
      })
      .catch((error) => {
        console.error("❌ Error checking reference in DB:", error);
        return null;
      });
  }
});

////add content task to reference relation -- not sure this is used anymore--handled in storedproc
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
});

//pass text to handleextracttext, pass claims to store claims on server
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, url, html } = request;

  switch (action) {
    case "extractText": {
      return handleExtractText(url, html, sender.tab.url)
        .then((resp) => {
          return { success: true, pageText: resp };
        })
        .catch((err) => {
          console.error("Error extracting text:", err);
          return { success: false, error: err.message };
        });
    }

    // ... other actions (like addContent, addAuthors, etc.)
    case "storeClaims": {
      const { contentId, claims, contentType } = request.data;

      return storeClaimsOnServer(contentId, claims, contentType)
        .then(() => {
          return { success: true };
        })
        .catch((err) => {
          console.error("Error storing claims:", err);
          return { success: false, error: err.message };
        });
    }

    default:
      break;
  }
});

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
      user_id: userId,
    }), // ✅ Ensure content_id is correct
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error("Server responded with an error storing claims");
  }
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkIfPdf") {
    return fetch(request.url, { method: "HEAD" })
      .then((res) => {
        const type = res.headers.get("Content-Type") || "";
        return { isPdf: type.includes("application/pdf") };
      })
      .catch((err) => {
        console.error("❌ HEAD request failed:", err);
        return { isPdf: false };
      });
  }
});

browser.runtime.onMessage.addListener(async (request, sender) => {
  if (request.action === "fetchPdfText") {
    try {
      console.log("📨 Received fetchPdfText request for:", request.url);

      // 🔹 Fetch PDF text
      const textRes = await fetch(`${BASE_URL}/api/fetch-pdf-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: request.url }),
      });

      const textData = await textRes.json();
      console.log("📄 PDF text response:", textData);

      if (!textData.success || !textData.text?.trim()) {
        console.warn("❌ PDF parsing failed or returned empty text");
        return { success: false };
      }

      // 🔹 Fetch thumbnail
      const thumbRes = await fetch(`${BASE_URL}/api/pdf-thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: request.url }),
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
});

browser.runtime.onMessage.addListener(async (request, sender) => {
  if (request.action === "extractReadableText") {
    try {
      const res = await fetch(`${BASE_URL}/api/extract-readable-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: request.html,
          url: request.url,
        }),
      });
      return await res.json();
    } catch (err) {
      console.error("❌ Error calling readable text API:", err);
      return { success: false };
    }
  }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "puppeteerFetch") {
    return fetch(`${BASE_URL}/api/fetch-with-puppeteer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: request.url }),
    })
      .then((res) => res.json())
      .then((data) => {
        return data;
      })
      .catch((err) => {
        return { success: false, error: err.message };
      });
  }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkAndDownloadTopicIcon") {
    const { generalTopic } = request;

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
      .then((data) => {
        // Suppose the server returns { thumbnail_url: string | null }
        return { success: true, thumbnail_url: data.thumbnail_url };
      })
      .catch((err) => {
        console.error("Error in checkAndDownloadTopicIcon request:", err);
        return { success: false, error: err.message };
      });
  }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    // We handle the call asynchronously
    return callOpenAiAnalyze(request.content)
      .then((result) => ({
        success: true,
        data: result,
      }))
      .catch((err) => ({
        success: false,
        error: err.message,
      }));
  }
});

// Example function that calls OpenAI for both topics & claims
async function callOpenAiAnalyze(content) {
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
          content: "You are a combined topic and claim extraction assistant.",
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

Return your answer in strict JSON like this:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "claims": ["<claim1>", "<claim2>", ...]
}

Text:
${content}
          `,
        },
      ],
    }),
  });

  if (!response.ok) {
    let errorMessage = `OpenAI request failed: ${response.status} ${response.statusText}`;

    try {
      const errorData = await response.json();
      if (errorData?.error?.message) {
        errorMessage += ` — ${errorData.error.message}`;
      }
    } catch (jsonErr) {
      console.warn("⚠️ Failed to parse error response JSON", jsonErr);
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No completion returned from OpenAI");
  }

  const rawReply = data.choices[0].message.content.trim();
  let cleanedReply = rawReply.trim(); // Remove extra spaces

  // Strip GPT's triple backticks if present
  if (cleanedReply.startsWith("```json")) {
    cleanedReply = cleanedReply
      .replace(/^```json/, "")
      .replace(/```$/, "")
      .trim();
  }
  // Attempt to parse the JSON
  let parsed;
  try {
    parsed = JSON.parse(cleanedReply);
  } catch (err) {
    console.error("Invalid JSON from GPT:", cleanedReply);
    throw new Error("GPT returned invalid JSON");
  }

  const generalTopic = parsed.generalTopic || "Unknown";
  const specificTopics = Array.isArray(parsed.specificTopics)
    ? parsed.specificTopics
    : [];
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  return { generalTopic, specificTopics, claims };
}

//external
browser.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
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
  }
);

//internal
browser.runtime.onMessage.addListener((message, sender) => {
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
});

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

// get topics from text
browser.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "getTopicsFromText") {
    const { content } = request;

    return callOpenAiForTopics(content)
      .then((result) => ({ success: true, data: result }))
      .catch((err) => {
        console.error("Error calling OpenAI in background:", err);
        return { success: false, error: err.message };
      });
  }
});
