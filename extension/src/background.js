// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
});

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

        //const useStore = require("../src/store/useTaskStore").default;

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
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentUrl = tabs[0].url;
      console.log("test1");

      if (tabs[0].id) {
        console.log("Current URL:", currentUrl);

        if (!currentUrl) {
          console.error("Current URL is undefined");
          sendResponse({ error: "Current URL is undefined" });
          return;
        }

        try {
          console.log("test2");

          chrome.scripting.executeScript(
            {
              target: { tabId: tabs[0].id },
              func: (url) => {
                console.log("test3:", url);
                let maxArea = 0;
                let chosenImage = null;

                if (!url) {
                  console.error("Passed URL is undefined inside func");
                  return null;
                }

                // YouTube-specific thumbnail extraction
                if (
                  url.indexOf("youtube.com") !== -1 &&
                  url.indexOf("/watch") !== -1
                ) {
                  const urlObj = new URL(url);
                  const videoId = urlObj.searchParams.get("v");
                  console.log(videoId);
                  if (videoId) {
                    const youtubeThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
                    return youtubeThumbnail; // Return YouTube thumbnail URL immediately
                  }
                }

                const parseSrcset = (srcset) => {
                  if (!srcset) return null;

                  // Define valid image extensions
                  const validImageExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;

                  // Split srcset and process each entry
                  const srcsetEntries = srcset.split(",").map((entry) => {
                    let src = entry.trim().split(" ")[0]; // Get the URL part

                    // Strip PHP-like processing or query prefixes
                    if (src.includes("?")) {
                      const cleanedSrc = src.split("?src=")[1] || src; // Keep only after "?" if exists
                      src = cleanedSrc;
                    }

                    // Remove any trailing parameters like `&w=1200`
                    src = src.split("&")[0];

                    // Return only if the src ends with a valid image extension
                    return validImageExtensions.test(src) ? src : null;
                  });

                  // Return the first valid image URL or null
                  return srcsetEntries.find((src) => src) || null;
                };

                // Extract the largest image based on src or srcset
                const images = document.querySelectorAll("img");
                images.forEach((img) => {
                  const area = img.offsetHeight * img.offsetWidth;

                  if (img.src && area > maxArea) {
                    maxArea = area;
                    chosenImage = img.src; // Prefer img.src if available
                  } else if (img.srcset && area > maxArea) {
                    const parsedSrc = parseSrcset(img.srcset);
                    if (parsedSrc) {
                      maxArea = area;
                      chosenImage = parsedSrc;
                    }
                  }
                });

                return chosenImage || null;
              },
              args: [currentUrl],
            },
            (results) => {
              const imageUrl = results[0]?.result;
              if (imageUrl) {
                console.log("Captured Image URL:", imageUrl);
                sendResponse({ imageUrl });
              } else {
                console.error("No valid image found.");
                sendResponse({ error: "No valid image found." });
              }
            }
          );
        } catch (error) {
          console.error("Error during script execution:", error);
        }
      }
    });

    // This is necessary to indicate that sendResponse will be called asynchronously
    return true;
  }
});

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

  if (message.action === "checkContent") {
    checkContent(message.url)
      .then((contentData) => sendResponse(contentData))
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
// ✅ Check if content exists in the database
const checkContent = async (url) => {
  console.log(`🔍 Checking content in DB for: ${url}`);

  try {
    const response = await fetch(`${BASE_URL}/api/check-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(
        `Check-content API failed with status: ${response.status}`
      );
    }

    const data = await response.json();
    console.log(`📖 Content check result:`, data);
    return data;
  } catch (error) {
    console.error(`❌ Error checking content for ${url}:`, error);
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
      .then((data) => sendResponse(data.id ? data.id : null))
      .catch((error) => {
        console.error("Error checking reference in DB:", error);
        sendResponse(null);
      });

    return true; // Keeps the message channel open for async response
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addContentRelation") {
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
  const { action, url, text } = request;

  switch (action) {
    case "extractText": {
      handleExtractText(url, sender.tab.url)
        .then((resp) => sendResponse({ success: true, pageText: resp }))
        .catch((err) => {
          console.error("Error extracting text:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Must return true for async
    }
    case "claimBuster": {
      // request.text is the text to analyze
      handleClaimBuster(text)
        .then((resp) => sendResponse({ success: true, claims: resp }))
        .catch((err) => {
          console.error("Error calling ClaimBuster:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    // ... other actions (like addContent, addAuthors, etc.)
    case "storeClaims": {
      const { contentId, claims } = data;
      storeClaimsOnServer(contentId, claims)
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
async function handleExtractText(url, currentPage) {
  let html = "";

  // ✅ If we are already on the page, extract text from the DOM
  if (currentPage.includes(url)) {
    console.log("✅ On the correct page, extracting HTML from DOM...");
    html = await extractHTMLFromPage();
  } else {
    console.log("🌍 Not on the page, will fetch HTML from the backend.");
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

// ✅ Extract full page HTML from the current tab
async function extractHTMLFromPage() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        reject(new Error("❌ No active tab found!"));
        return;
      }

      const tabId = tabs[0].id; // ✅ Get the active tabId

      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          func: () => document.documentElement.outerHTML,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                `❌ Chrome scripting error: ${chrome.runtime.lastError.message}`
              )
            );
            return;
          }
          resolve(results[0]?.result || "");
        }
      );
    });
  });
}

// 2) Call ClaimBuster (/api/claimbuster)
async function handleClaimBuster(text) {
  const response = await fetch(`${BASE_URL}/api/claimbuster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json();

  if (!data.success) {
    // You can throw or handle
    throw new Error(data.error || "No success from claimbuster");
  }

  // Here data.results should exist
  return data.results;
}

async function storeClaimsOnServer(contentId, claims) {
  // We'll call a new route /api/claims/add
  // The server will do the dedup & insert for us
  const response = await fetch(`${BASE_URL}/api/claims/add`, {
    content_id: contentId,
    claims, // array of { text, score, etc. } from ClaimBuster
  });
  if (!response.data.success) {
    throw new Error("Server responded with an error storing claims");
  }
  return;
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

// background.js (Manifest V3 service worker or background script)

async function analyzeContent(content) {
  // 1) Make the request
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4-turbo", // or "gpt-3.5-turbo"
      messages: [
        {
          role: "system",
          content: "You are a content analysis assistant.",
        },
        {
          role: "user",
          content: `
Identify the most general topic (at most two words) for this text, then provide a list of more specific topics that fall under this general topic, 
and also extract every distinct factual assertion or claim from the text (where a claim is a statement that can be tested or verified for truth).

Return your answer in valid JSON only, exactly in the format:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>", ...],
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

  // 2) Parse the JSON result
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No completion returned from OpenAI");
  }

  // GPT’s reply (hopefully a valid JSON string)
  const rawReply = data.choices[0].message.content.trim();

  // 3) Attempt to parse the JSON the model returned
  let parsed;
  try {
    parsed = JSON.parse(rawReply);
  } catch (err) {
    console.error("GPT did not return valid JSON:", rawReply);
    throw new Error("Invalid JSON from GPT");
  }

  // Expecting parsed to have keys: generalTopic, specificTopics, claims
  // Provide some defaults if GPT missed them
  const generalTopic = parsed.generalTopic || "Unknown";
  const specificTopics = Array.isArray(parsed.specificTopics)
    ? parsed.specificTopics
    : [];
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];

  return { generalTopic, specificTopics, claims };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    // We handle the call asynchronously
    callOpenAiAnalyze(request.content)
      .then((result) => {
        // 'result' should be { generalTopic, specificTopics, claims }
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
  console.log(claims, ":::CLAIMS");
  return { generalTopic, specificTopics, claims };
}

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
