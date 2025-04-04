// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
import { extractImageFromHtml } from "../src/services/extractMetaData";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
let isScraperActive = false; // ✅ Track scraper state

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ✅ Ignore "chrome://" pages
  if (tab.url.startsWith("chrome://")) return;

  // ✅ Ignore background-loaded tabs (used for image extraction)
  if (tab.active === false) return;

  // ✅ Block re-injecting content while the scraper is running
  if (isScraperActive) {
    console.log("🚨 Scraper is running, skipping content injection.");
    return;
  }
  if (changeInfo.status === "complete" && tab.url) {
    // Check if the content script is already loaded
    loadContentIfNotAlready(tabId)
      .then(() => {
        // Send the message after ensuring the content script is injected
        sendMessageWithRetry(tabId, {
          action: "triggerCheckContent",
          forceVisible: false,
        });
      })
      .catch((error) => {
        console.error("Error ensuring content script is loaded:", error);
      });
  }
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
/* chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url.startsWith("chrome://")) {
    if (changeInfo.status === "complete" && tab.url) {
      // Check if the content script is already loaded
      loadContentIfNotAlready(tabId)
        .then(() => {
          // Send the message after ensuring the content script is injected
          sendMessageWithRetry(tabId, {
            action: "triggerCheckContent",
            forceVisible: false,
          });
        })
        .catch((error) => {
          console.error("Error ensuring content script is loaded:", error);
        });
    }
  }
}); */

async function loadContentIfNotAlready(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Content script not loaded, inject it
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ["content.js"],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error injecting content script:",
                chrome.runtime.lastError.message
              );
              reject(chrome.runtime.lastError);
            } else {
              console.log("Content script injected successfully.");
              resolve();
            }
          }
        );
      } else {
        console.log("Content script already loaded.");
        resolve();
      }
    });
  });
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

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "toggleTaskCard" });
});

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
  if (message.action === "checkContent") {
    const { forceVisible } = message;
    console.log("fv1", forceVisible);
    // Get the active tab's URL
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (chrome.runtime.lastError) {
        console.error("Error querying tabs:", chrome.runtime.lastError.message);
        return;
      }
      if (tabs.length === 0 || !tabs[0].url) {
        console.error("No active tab or URL found.");
        return;
      }

      const url = tabs[0]?.url;

      if (!url) return;

      // Call the backend to check if content exists
      try {
        const response = await fetch(`${BASE_URL}/api/check-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        const data = await response.json();

        const isDetected = data.exists && data.task.progress === "Completed";
        const task = data.exists ? data.task : null;
        console.log("isdet", isDetected);

        // Use Zustand to update the store

        useTaskStore.getState().setTask(task);
        console.log("GETTING STATE", task);

        useTaskStore.getState().setCurrentUrl(url);
        useTaskStore.getState().setContentDetected(isDetected);
        console.log(
          "Updated task'[;plokjh] in background:",
          useTaskStore.getState().task
        );
        console.log(
          "Updated URL in background:",
          useTaskStore.getState().currentUrl
        );
        // Execute script to set globals and create popup-root if it doesn't exist
        chrome.scripting.executeScript(
          {
            target: { tabId: sender.tab.id },
            func: (isDetected, forceVisible) => {
              // Check if the popup-root div exists, if not, create it
              let popupRoot = document.getElementById("popup-root");

              if (popupRoot) {
                popupRoot.remove();
              }
              popupRoot = document.getElementById("popup-root");
              if (!popupRoot) {
                popupRoot = document.createElement("div");
                popupRoot.id = "popup-root";
                document.body.appendChild(popupRoot);
              }
              console.log("fv2", forceVisible);
              console.log("isDetected:", isDetected);
              console.log("forceVisible:", forceVisible);
              if (isDetected || forceVisible) {
                popupRoot.className = "task-card-visible";
                console.log("fv3", isDetected);
                console.log("fv31", isDetected || forceVisible);
              } else {
                popupRoot.className = "task-card-hidden"; // Initially visible
                console.log("fv4", isDetected);
              }
            },
            args: [isDetected, forceVisible],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error during executeScript:",
                chrome.runtime.lastError.message
              );
            } else {
              console.log("Globals set and popup-root created if needed");

              chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                files: ["popup.js"], // Ensure this file exists
              });
            }
          }
        );
      } catch (error) {
        console.error("Error checking content:", error);
      }
    });

    return true; // Keeps the sendResponse channel open for async operations
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
