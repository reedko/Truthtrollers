import "./Popup.css";
import "../styles/minorityReport.css";
import { ChakraProvider, ColorModeContext } from "@chakra-ui/react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import React from "react";
import TaskCard from "./TaskCard";
import ReactDOM from "react-dom/client";
import VisionTheme from "../components/themes/VisionTheme";

// Create an Emotion cache that injects styles into our popup container
// This prevents styles from being added to the page's <head>
const createEmotionCache = (container: HTMLElement) => {
  return createCache({
    key: 'tt-popup',
    container: container,
    prepend: true,
  });
};

// Dummy color mode context that prevents Chakra from touching the document
const noopColorModeContext = {
  colorMode: 'dark' as const,
  toggleColorMode: () => {},
  setColorMode: () => {},
  forced: false,
};

const Popup: React.FC<{ emotionCache: ReturnType<typeof createCache> }> = ({ emotionCache }) => {
  // Prevent Chakra from modifying document on mount
  React.useEffect(() => {
    // Remove any attributes Chakra added to <html>
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    // Remove any classes Chakra added to <body>
    document.body.classList.remove('chakra-ui-dark', 'chakra-ui-light');
  }, []);

  return (
    <CacheProvider value={emotionCache}>
      <ColorModeContext.Provider value={noopColorModeContext}>
        <ChakraProvider theme={VisionTheme} cssVarsRoot="#tt-popup-root" colorModeManager={undefined as any}>
          <div data-theme="dark" className="chakra-ui-dark">
            <TaskCard />
          </div>
        </ChakraProvider>
      </ColorModeContext.Provider>
    </CacheProvider>
  );
};

// No shadow DOM - just create popup in regular DOM
function initPopup() {
  let popupRoot = document.getElementById("tt-popup-root");

  if (!popupRoot) {
    popupRoot = document.createElement("div");
    popupRoot.id = "tt-popup-root";
    popupRoot.style.position = "fixed";
    popupRoot.style.top = "10px";
    popupRoot.style.right = "20px";
    popupRoot.style.zIndex = "2147483647";
    popupRoot.style.width = "320px";
    document.body.appendChild(popupRoot);
  }

  // Create emotion cache that will inject styles INTO the popup container
  // instead of into the page's <head> - this prevents CSS bleeding
  const emotionCache = createEmotionCache(popupRoot);

  const root = ReactDOM.createRoot(popupRoot);
  root.render(<Popup emotionCache={emotionCache} />);
}

// Try immediately, or wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}

export default Popup;
