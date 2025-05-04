import browser from "webextension-polyfill";

console.log("📡 Content script loaded and ready to receive messages!");

// Single unified listener
browser.runtime.onMessage.addListener((message, sender) => {
  console.log("📩 Received message in content.js:", message);

  switch (message.action) {
    case "toggleTaskCard": {
      const taskCard = document.getElementById("popup-root");
      if (taskCard) {
        console.log("🔁 Toggling popup visibility");
        taskCard.classList.toggle("task-card-visible");
        taskCard.classList.toggle("task-card-hidden");
      }
      return Promise.resolve({ received: true });
    }

    case "testMessage": {
      console.log("✅ Test message received in content.js:", message);
      return Promise.resolve({ success: true, received: true });
    }

    case "updatePopup": {
      console.log("🛠 Updating popup visibility...");

      let popupRoot = document.getElementById("popup-root");
      if (!popupRoot) {
        popupRoot = document.createElement("div");
        popupRoot.id = "popup-root";
        document.body.appendChild(popupRoot);
      }

      popupRoot.className =
        message.isDetected || message.forceVisible
          ? "task-card-visible"
          : "task-card-hidden";

      console.log("✅ Popup updated in content.js");
      return Promise.resolve({ updated: true });
    }

    case "triggerCheckContent": {
      console.log("🔄 triggerCheckContent received:", message);
      const { forceVisible } = message;

      // Send message back to background
      browser.runtime.sendMessage({
        action: "checkContent",
        forceVisible,
      });

      return Promise.resolve({ received: true });
    }

    case "ping": {
      return Promise.resolve({ status: "alive" });
    }

    default:
      return Promise.resolve({ ignored: true });
  }
});
