import popupCss from "./Popup.css?inline";
import minorityReportCss from "../styles/minorityReport.css?inline";
import consensusCss from "./UserConsensusBar.css?inline";
import { ChakraProvider, ColorModeContext } from "@chakra-ui/react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import React, { useEffect, useState } from "react";
import TaskCard from "./TaskCard";
import TaskBar from "./TaskBar";
import ReactDOM from "react-dom/client";
import VisionTheme from "../components/themes/VisionTheme";
import browser from "webextension-polyfill";

// Create an Emotion cache that injects styles into our popup container
// This prevents styles from being added to the page's <head>
const createEmotionCache = (container: Node) => {
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
  const [popupStyle, setPopupStyle] = useState<'card' | 'bar'>('card');

  useEffect(() => {
    // Read popup_style from storage (written by background when settings are fetched)
    browser.storage.local.get('popup_style').then((result: { popup_style?: string }) => {
      if (result.popup_style === 'bar') setPopupStyle('bar');
    });

    // Live-update if admin changes the setting while the page is open
    const onChange = (changes: { [key: string]: browser.Storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.popup_style) {
        const val = changes.popup_style.newValue;
        if (val === 'card' || val === 'bar') setPopupStyle(val);
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  return (
    <CacheProvider value={emotionCache}>
      <ColorModeContext.Provider value={noopColorModeContext}>
        <ChakraProvider theme={VisionTheme} cssVarsRoot="#tt-popup-root" colorModeManager={undefined as any}>
          <div data-theme="dark" className="chakra-ui-dark">
            {popupStyle === 'bar' ? <TaskBar /> : <TaskCard />}
          </div>
        </ChakraProvider>
      </ColorModeContext.Provider>
    </CacheProvider>
  );
};

function initPopup() {
  let popupHost = document.getElementById("tt-popup-host");
  if (!popupHost) {
    popupHost = document.createElement("div");
    popupHost.id = "tt-popup-host";
    popupHost.style.all = "initial";
    popupHost.style.position = "fixed";
    popupHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(popupHost);
  }

  const shadowRoot = popupHost.shadowRoot || popupHost.attachShadow({ mode: "open" });
  let popupRoot = shadowRoot.getElementById("tt-popup-root") as HTMLElement | null;
  if (!popupRoot) {
    const styles = document.createElement("style");
    styles.textContent = `:host { all: initial; }\n${popupCss}\n${minorityReportCss}\n${consensusCss}`;
    shadowRoot.appendChild(styles);
    popupRoot = document.createElement("div");
    popupRoot.id = "tt-popup-root";
    shadowRoot.appendChild(popupRoot);
  }

  // Style the root based on current popup_style.
  // TaskCard needs a fixed-size anchored container; TaskBar positions itself via CSS.
  browser.storage.local.get('popup_style').then((result: { popup_style?: string }) => {
    if (!popupRoot || !popupHost) return;
    if (result.popup_style === 'bar') {
      // Bar handles its own position — root is transparent/zero-size
      popupHost.style.top = '0';
      popupHost.style.left = '0';
      popupHost.style.width = '0';
      popupHost.style.height = '0';
      popupHost.style.right = 'auto';
    } else {
      popupHost.style.top = '10px';
      popupHost.style.right = '20px';
      popupHost.style.left = 'auto';
      popupHost.style.width = '320px';
      popupHost.style.height = 'auto';
    }
  });

  // Create emotion cache that will inject styles INTO the popup container
  // instead of into the page's <head> - this prevents CSS bleeding
  const emotionCache = createEmotionCache(shadowRoot);

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
