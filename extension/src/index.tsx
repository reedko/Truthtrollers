import React from "react";
import ReactDOM from "react-dom/client"; // Use createRoot for React 18
import Popup from "./components/Popup";
import "./components/Popup.css"; // Ensure CSS is loaded

// Function to render the Popup component when the root element is present
const renderPopup = () => {
  const rootElement = document.getElementById("popup-root");
  if (rootElement) {
    // Apply styles directly to force the root div to have size
    rootElement.style.position = "relative";
    rootElement.style.top = "0";
    rootElement.style.right = "0";

    rootElement.style.zIndex = "9999";
    rootElement.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    console.log("Rendering React Popup..."); // Debugging message
    rootElement.style.position = "relative";
    rootElement.style.top = "0";
    rootElement.style.right = "0";
    rootElement.style.minWidth = "300px";
    rootElement.style.minHeight = "306px";
    rootElement.style.zIndex = "99999";
    rootElement.style.backgroundColor = "transparent";
    const root = ReactDOM.createRoot(rootElement); // Use createRoot for React 18
    root.render(<Popup />);
  } else {
    console.log("Popup root not found!"); // This will tell us if the root element is missing
  }
};

// MutationObserver to check for the addition of the #popup-root element
const observer = new MutationObserver(() => {
  const rootElement = document.getElementById("popup-root");
  if (rootElement) {
    observer.disconnect(); // Stop observing once the root is found
    renderPopup();
  }
});

// Start observing for changes in the document to detect #popup-root
observer.observe(document.body, { childList: true, subtree: true });

// In case #popup-root is already present (just to cover all bases)
renderPopup();
