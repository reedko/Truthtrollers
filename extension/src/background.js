// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
import { scrapeContent } from "./services/scrapeContent";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

let isScraperActive = false; // ✅ Track scraper state
//get stored url
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getStoredUrl") {
    console.log("✅ Retrieving last visited URL...");

    chrome.storage.local.get("lastVisitedURL", (data) => {
      console.log("📌 Stored URL retrieved:", data);

      // 🔥🔥🔥 Ensure the response is sent properly
      sendResponse({ url: data.lastVisitedURL || null });
    });

    return true; // ✅ REQUIRED to keep message channel open!
  }
});

//SCRAPING
let activeScrapeTabId = null;

//scraping started messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapingStarted") {
    console.log("⏳ Scraping in progress... Blocking new injections.");
    isScraperActive = true;
    activeScrapeTabId = sender.tab.id; // ✅ Store the tab where scraping started
  }

  if (message.action === "scrapeStarted") {
    console.log("⏳ Scraping started... Setting activeScrapeTabId");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0 || !tabs[0].id) return;
      activeScrapeTabId = tabs[0].id;
    });
  }
});

//scrape completed call check content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapeCompleted") {
    console.log("✅ Scraping finished!");

    chrome.storage.local.get("activeScrapeTabId", (data) => {
      const url = message.url; // ✅ Now this should be defined!
      if (data.activeScrapeTabId) {
        console.log("📌 Updating popup in scrape tab:", data.activeScrapeTabId);
        checkContentAndUpdatePopup(data.activeScrapeTabId, url, true);
      } else {
        console.warn("⚠️ No activeScrapeTabId found! Using current tab.");
        checkContentAndUpdatePopup(sender.tab.id, url, true);
      }
    });
  }
});

// ✅ Detect when user navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return; // Only trigger on full load

  checkContentAndUpdatePopup(tabId, tab.url, false); // Don't force visible
});

// ✅ Detect when user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url) return;

  console.log("🔍 Extension icon clicked - Forcing popup for:", tab.url);
  checkContentAndUpdatePopup(tab.id, tab.url, true); // Force visible
});

// ✅ Check if URL is in database & update popup
async function checkContentAndUpdatePopup(tabId, url, forceVisible) {
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
function showTaskCard(tabId, isDetected, forceVisible) {
  /*   if (tabId !== activeScrapeTabId) {
    console.warn("🚫 Preventing popup on incorrect tab:", tabId);
    return;
  } */

  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: (isDetected, forceVisible) => {
        let popupRoot = document.getElementById("popup-root");

        if (popupRoot) popupRoot.remove(); // Remove any existing popup

        popupRoot = document.createElement("div");
        popupRoot.id = "popup-root";
        document.body.appendChild(popupRoot);

        popupRoot.className =
          isDetected || forceVisible ? "task-card-visible" : "task-card-hidden";
      },
      args: [isDetected, forceVisible],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          "⚠️ Error during executeScript:",
          chrome.runtime.lastError.message
        );
      } else {
        console.log("✅ Task-card injected successfully");
        chrome.scripting.executeScript({
          target: { tabId },
          files: ["popup.js"],
        });
      }
    }
  );
}

const shouldIgnoreUrl = (url) => {
  const ignoredSites = ["facebook.com/messages", "messenger.com"];
  const isIgnored = ignoredSites.some((site) => url.includes(site));
  if (isIgnored) console.log("🚫 Ignored URL:", url);
  return isIgnored;
};

//update new tab, write url to db
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !tab.url.includes("localhost:5173")) {
    const cleanUrl = changeInfo.url.split("?")[0]; // Strip query params
    if (!shouldIgnoreUrl(cleanUrl) && cleanUrl !== lastStoredUrl) {
      console.log("🔄 Tab updated, storing URL:", cleanUrl);
      storeLastUrl(cleanUrl);
      lastStoredUrl = cleanUrl;
    }
  }
});

let lastStoredUrl = "";
//on activate new tab, write url to db
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (!tab.url.includes("localhost:5173") && tab.url) {
      const cleanUrl = tab.url.split("?")[0]; // Remove query params
      if (cleanUrl !== lastStoredUrl) {
        console.log("🔄 Tab switched, checking content:", cleanUrl);
        storeLastUrl(cleanUrl);
        lastStoredUrl = cleanUrl;
      }
    }
  });
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

// Retry logic for sending messages
function sendMessageWithRetry(tabId, message, retries = 5, delay = 500) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending message:", chrome.runtime.lastError.message);

      if (retries > 0) {
        console.log(`Retrying... attempts left: ${retries}`);
        setTimeout(
          () => sendMessageWithRetry(tabId, message, retries - 1, delay),
          delay
        );
      } else {
        console.error("Failed to send message after retries.");
      }
    } else {
      console.log("Message successfully sent and received:", response);
    }
  });
}

//send current tab as reponse
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getCurrentTabUrl") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].url) {
        sendResponse({ url: tabs[0].url });
      } else {
        console.error("No active tab or URL found");
        sendResponse({ error: "No active tab or URL found" });
      }
    });
    return true; // Keeps the sendResponse channel open for async responses
  }
});

//capture image
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureImage") {
    const { url, html, diffbotData } = message;

    // ✅ 1) Try extracting from provided HTML first
    const Url = new URL(url); // Extract base domain from full URL
    const imageUrl = extractImageFromHtml(html, Url);
    const baseUrl = new URL(url).origin;

    if (imageUrl) {
      console.log("✅ Found image in extracted HTML:", imageUrl);
      sendResponse({ imageUrl });
      return; // 🚀 Exit early, no need for tab loading
    }
    if (!imageUrl) {
      console.warn("⚠️ No image in extracted HTML. Checking Diffbot...");
    }

    // ✅ 2) Use Diffbot as a fallback
    if (!imageUrl && diffbotData?.images?.length > 0) {
      imageUrl = diffbotData.images[0].url;
      console.log("✅ Found image in Diffbot:", imageUrl);
      sendResponse({ imageUrl });
      return; // 🚀 Exit early
    }

    if (!imageUrl) {
      console.warn("⚠️ No image from Diffbot. Checking current tab...");
    }

    // ✅ 3) Check if the current tab matches the requested URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];

      if (currentTab?.url === url) {
        console.log("🔍 Extracting image from CURRENT tab:", currentTab.url);
        extractImageFromTab(currentTab.id, sendResponse);
      } else {
        // ✅ Open hidden tab and extract image if URL doesn't match
        console.log("🌍 Opening hidden tab to capture image from:", url);
        chrome.tabs.create({ url, active: false }, (tab) => {
          if (!tab || !tab.id) {
            console.error("❌ Failed to open hidden tab.");
            sendResponse({
              imageUrl: `${BASE_URL}/assets/images/miniLogo.png`,
            });
            return;
          }

          // Wait for hidden tab to load, then extract image
          chrome.tabs.onUpdated.addListener(function listener(
            tabId,
            changeInfo
          ) {
            if (tabId === tab.id && changeInfo.status === "complete") {
              console.log("📡 Hidden tab loaded, extracting image...");
              extractImageFromTab(tab.id, (res) => {
                chrome.tabs.remove(tab.id); // ✅ Close hidden tab after extraction
                sendResponse(res);
              });
              chrome.tabs.onUpdated.removeListener(listener);
            }
          });
        });
      }
    });

    return true; // ✅ Keep async message open
  }
});

// 🛠 Single function for extracting images from a given tab
const extractImageFromTab = (tabId, sendResponse) => {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: () => {
        let maxArea = 0;
        let chosenImage = null;

        document.querySelectorAll("img").forEach((img) => {
          const width = parseInt(img.getAttribute("width") || "0", 10);
          const height = parseInt(img.getAttribute("height") || "0", 10);
          const area = width * height;

          let imgSrc = img.src;

          // ✅ Convert relative URLs to absolute
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
    },
    (results) => {
      const extractedImage = results[0]?.result;
      console.log("✅ Extracted Image:", extractedImage);
      sendResponse({
        imageUrl: extractedImage || `${BASE_URL}/assets/images/miniLogo.png`,
      });
    }
  );
};

//add content to db, calls api route
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addContent") {
    addContent(message.taskData)
      .then((contentId) => {
        console.log("✅ Background: Received taskId from backend:", contentId);
        const responsePayload = { contentId: contentId };
        console.log("🚀 Sending response to createTask.ts:", responsePayload);
        sendResponse(responsePayload); // Make sure we're sending back `contentId`
      })
      .catch((err) => {
        console.error("❌ Background: Failed to create content:", err);
        sendResponse({ error: "Failed to create content" });
      });

    return true; // Keep async connection open
  }

  if (message.action === "addAuthors") {
    addAuthorsToServer(message.contentId, message.authors)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));

    return true;
  }

  if (message.action === "addPublisher") {
    addPublisherToServer(message.contentId, message.publisher)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));

    return true;
  }

  if (message.action === "addSources") {
    addSourcesToServer(message.taskId, message.content)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));

    return true;
  }

  if (message.action === "fetchDiffbotData") {
    fetchDiffbotData(message.articleUrl)
      .then((data) => sendResponse(data))
      .catch(() => sendResponse(null));

    return true; // Keeps the message channel open for async response
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkDatabaseForReference") {
    console.log(`🔍 Received request to check DB for: ${message.url}`);

    fetch(
      `${BASE_URL}/api/check-reference?url=${encodeURIComponent(message.url)}`,
      {
        method: "GET", // ✅ Now using GET
        headers: { "Content-Type": "application/json" },
      }
    )
      .then((response) => response.json())
      .then((data) => {
        console.log(`📌 API Response for ${message.url}:`, data);
        sendResponse(data.content_id || null); // ✅ Now correctly checking if ID exists
      })
      .catch((error) => {
        console.error("❌ Error checking reference in DB:", error);
        sendResponse(null);
      });

    return true; // ✅ Keep message channel open for async response
  }
});

////add content task to reference relation -- not sure this is used anymore--handled in storedproc
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addContentRelation") {
    console.log("ADDING RELATION IN BACKGROUND");
    fetch(`${BASE_URL}/api/add-content-relation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskContentId: message.taskContentId,
        referenceContentId: message.referenceContentId,
      }),
    })
      .then((response) => response.json())
      .then((data) => sendResponse({ success: true }))
      .catch((error) => {
        console.error("Error adding content relation:", error);
        sendResponse({ success: false });
      });

    return true;
  }
});

//pass text to handleextracttext, pass claims to store claims on server
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, url, html } = request;

  switch (action) {
    case "extractText": {
      handleExtractText(url, html, sender.tab.url)
        .then((resp) => sendResponse({ success: true, pageText: resp }))
        .catch((err) => {
          console.error("Error extracting text:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Must return true for async
    }

    // ... other actions (like addContent, addAuthors, etc.)
    case "storeClaims": {
      const { contentId, claims, contentType } = request.data;

      storeClaimsOnServer(contentId, claims, contentType)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error("Error storing claims:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async response
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
    }), // ✅ Ensure content_id is correct
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error("Server responded with an error storing claims");
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkAndDownloadTopicIcon") {
    const { generalTopic } = request;

    fetch(`${BASE_URL}/api/checkAndDownloadTopicIcon`, {
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
        sendResponse({ success: true, thumbnail_url: data.thumbnail_url });
      })
      .catch((err) => {
        console.error("Error in checkAndDownloadTopicIcon request:", err);
        sendResponse({ success: false, error: err.message });
      });

    // Must return true for async response
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    // We handle the call asynchronously
    callOpenAiAnalyze(request.content)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    // Return true to indicate async response
    return true;
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
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a combined topic and claim extraction assistant.",
        },
        {
          role: "user",
          content: `
Identify the most general topic (at most two words) for this text, then provide a list of more specific topics under that general topic.
Additionally, extract every distinct factual assertion or claim (statements that can be tested or verified for truth).
Return your answer in valid JSON exactly like this:
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

//fetchPageContent
/* chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchPageContent") {
    fetchExternalPage(message.url)
      .then((html) => sendResponse({ success: true, html }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
}); */
//external
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (message.action === "fetchPageContent") {
      console.log(
        "📩 Received EXTERNAL fetchPageContent request for:",
        message.url
      );
      fetchExternalPage(message.url)
        .then((html) => {
          console.log("📬 Sending HTML response:", html ? "Success" : "NULL");
          sendResponse({ success: !!html, html });
        })
        .catch((error) => {
          console.error("❌ Error fetching:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // ✅ Keeps the async response open
    }
  }
);

//internal
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchPageContent") {
    console.log("📩 Received fetchPageContent request for:", message.url);
    fetchExternalPage(message.url)
      .then((html) => {
        console.log("📬 Sending HTML response:", html ? "Success" : "NULL");
        sendResponse({ success: !!html, html });
      })
      .catch((error) => {
        console.error("❌ Error fetching:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTopicsFromText") {
    const { content } = request;

    callOpenAiForTopics(content)
      .then((result) => {
        // result = { generalTopic, specificTopics }
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        console.error("Error calling OpenAI in background:", err);
        sendResponse({ success: false, error: err.message });
      });

    // IMPORTANT: return true to indicate we will send async response
    return true;
  }

  // ... other actions ...
});
