// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
let isScraperActive = false; // ✅ Track scraper state

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    console.log("📩 External message received in background:", message);
    console.log("📡 Sender:", sender);

    if (message.action === "TEST_MESSAGE") {
      console.log("✅ Received TEST_MESSAGE from external source!");

      // ✅ Send an explicit response (wrapped in setTimeout to mimic async behavior)
      setTimeout(() => {
        sendResponse({ status: "Background received the message!" });
      }, 100); // 🔥 Small delay ensures Chrome doesn't close the response channel
    }

    return true; // ✅ REQUIRED: Keeps response channel open for async response
  }
);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapeCompleted") {
    console.log("✅ Scraping finished! Refreshing task status...");

    // ✅ After scraping, force the popup to check the newly scraped task
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0 || !tabs[0].id) return;
      const tabId = tabs[0].id;
      const url = tabs[0].url;

      // ✅ Ensure the popup updates with the newly scraped task
      checkContentAndUpdatePopup(tabId, url, true);
    });
  }
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
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (!tab.url.includes("localhost:5173") && tab.url) {
      console.log("🔄 Tab switched, checking content:", tab.url);
      storeLastUrl(tab.url);
    }
  });
});
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && !tab.url.includes("localhost:5173")) {
    storeLastUrl(tab.url);
  }
  console.log("diddididiid", tab.url);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapingStarted") {
    console.log("⏳ Scraping in progress... Blocking new injections.");
    isScraperActive = true;
  }

  if (message.action === "scrapeCompleted") {
    console.log("✅ Scraping finished! Re-enabling content injection.");
    isScraperActive = false; // Allow new content injections
  }
});

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
    console.log(responseData, ":REPSODFJKG");

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkDatabaseForReference") {
    fetch(`${BASE_URL}/api/check-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: message.url }),
    })
      .then((response) => response.json())
      .then((data) => sendResponse(data.id || null))
      .catch((error) => {
        console.error("Error checking reference in DB:", error);
        sendResponse(null);
      });

    return true; // Keeps the message channel open for async response
  }
});

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
async function handleExtractText(url, html, currentPage) {
  if (currentPage?.includes(url)) {
    console.log("✅ On the correct page, using extracted HTML.");
  } else if (!html) {
    console.log("🌍 No HTML provided, fetching from backend.");
  }

  // ✅ Send HTML (if extracted) or let the backend fetch the page
  const response = await fetch(`${BASE_URL}/api/extractText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, html }),
  });

  if (!response.ok) {
    throw new Error(`extractText failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`extractText error: ${data.error}`);
  }

  return data.pageText;
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
      model: "gpt-4-turbo",
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
    throw new Error(`OpenAI request failed: ${response.statusText}`);
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
  console.log("🔍 GPT Raw Response:", rawReply);
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchPageContent") {
    fetchExternalPage(message.url)
      .then((html) => sendResponse({ success: true, html }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
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

// The message listener
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
