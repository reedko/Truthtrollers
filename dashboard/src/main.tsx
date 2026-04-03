import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, ColorModeScript } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import "./index.css";
import "./styles/minorityReport.css";
import "./styles/scroll-fix.css";
import { RouterProvider } from "react-router-dom";
import AppRouter from "./routes";
import theme from "./components/themes/VisionTheme";
import { VerimeterModeProvider } from "./contexts/VerimeterModeContext";
console.log("🌟 main.tsx loaded, bootstrapping app…");
const queryClient = new QueryClient();

// Register service worker for push notifications
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) =>
    console.warn("[sw] registration failed:", err)
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ColorModeScript initialColorMode="dark" />
    <ChakraProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <VerimeterModeProvider>
          <AppRouter />

          <ReactQueryDevtools />
        </VerimeterModeProvider>
      </QueryClientProvider>
    </ChakraProvider>
  </React.StrictMode>
);
