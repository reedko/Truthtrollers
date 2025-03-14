// Listener for toggle messages to control the visibility of the overlay
console.log("Content script loaded and ready to receive messages!");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "toggleTaskCard") {
    const taskCard = document.getElementById("popup-root");
    if (taskCard) {
      console.log("Toggling visibility of the popup");
      taskCard.classList.toggle("task-card-visible");
      taskCard.classList.toggle("task-card-hidden");
    }
  }
  sendResponse({ received: true });
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "testMessage") {
    console.log("✅ Test message received in content.js:", message);
    sendResponse({ success: true, received: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "triggerCheckContent") {
    console.log(
      "🔄 Content script received triggerCheckContent message:",
      message
    );
    const { forceVisible } = message;
    chrome.runtime.sendMessage({
      action: "checkContent",
      forceVisible: forceVisible,
    });
  }
  sendResponse({ received: true });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ status: "alive" });
  }
});

console.log("🔍 Monitoring for popups...");

// Function to detect and remove popups
const handlePopupDetection = () => {
  const popup = document.querySelector(
    ".paywall, .popup, .modal, .adblock-popup"
  );
  if (popup) {
    console.warn("⚠️ Popup detected! Attempting to remove...");
    popup.style.display = "none"; // Hide it
    document.querySelector(".popup button.close")?.click(); // Try to close
  }
};

// Set up the observer to watch for new popups
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (document.querySelector(".paywall, .popup, .modal, .adblock-popup")) {
      handlePopupDetection();
    }
  });
});

// Start observing changes in the DOM
observer.observe(document.body, { childList: true, subtree: true });

// Run the function immediately in case popup is already present
handlePopupDetection();

/* chrome.webNavigation.onCompleted.addListener(
  function (details) {
    // Send a message to the content script to execute checkContent
    chrome.tabs.sendMessage(details.tabId, {
      action: "checkContent",
      forceVisible: false,
    });
  },
  { url: [{ hostContains: "" }] }
); */

/* window.onload = function () {
  console.log("Page loaded, running checkContent...");
  chrome.runtime.sendMessage({ action: "checkContent", forceVisible: false });
}; */
/* setTimeout(() => {
  chrome.runtime.sendMessage({ action: "checkContent", forceVisible: false });
}, 5000); */
