import "./Popup.css";
import "../styles/minorityReport.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import browser from "webextension-polyfill";

import TaskCard from "./TaskCard";
import VisionTheme from "../components/themes/VisionTheme";

async function loadAndInjectCSS(shadow: ShadowRoot) {
  // Check if already injected
  if (shadow.querySelector('style[data-popup-css]')) {
    return;
  }

  try {
    // Fetch both CSS files
    const [popupCssResponse, mrCssResponse] = await Promise.all([
      fetch(browser.runtime.getURL('popup.css')),
      fetch(browser.runtime.getURL('styles/minorityReport.css'))
    ]);

    const popupCss = await popupCssResponse.text();
    const mrCss = await mrCssResponse.text();

    // Inject into shadow DOM
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-popup-css', 'true');
    styleEl.textContent = `${popupCss}\n${mrCss}`;
    shadow.insertBefore(styleEl, shadow.firstChild);

    console.log('✅ CSS injected into shadow DOM');
  } catch (error) {
    console.error('❌ Failed to load CSS:', error);
  }
}

function findShadowBits(): {
  mount: HTMLElement;
  emotionHost: HTMLElement;
  shadowRoot: ShadowRoot;
} | null {
  const host = document.getElementById("tt-popup-host") as HTMLElement | null;
  if (!host) return null;

  const shadow = host.shadowRoot;
  if (!shadow) return null;

  const emotionHost = shadow.getElementById("tt-emotion") as HTMLElement | null;
  const mount = shadow.getElementById("popup-root") as HTMLElement | null;

  if (!emotionHost || !mount) return null;

  // Load CSS asynchronously
  loadAndInjectCSS(shadow);

  return { mount, emotionHost, shadowRoot: shadow };
}

const PopupApp: React.FC<{ emotionHost: HTMLElement; shadowRoot: ShadowRoot }> = ({ emotionHost, shadowRoot }) => {
  const cache = React.useMemo(
    () =>
      createCache({
        key: "tt",
        container: emotionHost, // ✅ Emotion/Chakra styles go into shadow
      }),
    [emotionHost],
  );

  return (
    <CacheProvider value={cache}>
      <ChakraProvider
        theme={VisionTheme}
        portalConfig={{
          containerRef: {
            current: shadowRoot as unknown as HTMLElement
          }
        }}
      >
        <TaskCard />
      </ChakraProvider>
    </CacheProvider>
  );
};

const bits = findShadowBits();

if (!bits) {
  console.error(
    "Shadow mount not found (tt-popup-host -> shadowRoot -> #popup-root).",
  );
} else {
  console.log("✅ Found shadow mount, rendering Popup...");
  ReactDOM.createRoot(bits.mount).render(
    <PopupApp emotionHost={bits.emotionHost} shadowRoot={bits.shadowRoot} />,
  );
}

export default PopupApp;
