import "./Popup.css";
import "../styles/minorityReport.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";

import TaskCard from "./TaskCard";
import VisionTheme from "../components/themes/VisionTheme";

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
