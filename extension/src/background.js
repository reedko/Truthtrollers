// Listen for messages from content.js
// background.js
import useTaskStore from "../src/store/useTaskStore";

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
        const response = await fetch(
          "http://localhost:5001/api/check-content",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          }
        );

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
          "Updated task in background:",
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
                console.log("test3");
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
