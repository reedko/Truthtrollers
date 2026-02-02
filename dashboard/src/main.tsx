import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, ColorModeScript } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import "./index.css";
import "./styles/minorityReport.css";
import { RouterProvider } from "react-router-dom";
import AppRouter from "./routes";
import theme from "./components/themes/VisionTheme";
console.log("🌟 main.tsx loaded, bootstrapping app…");
const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <ColorModeScript initialColorMode={"dark"} />
      <QueryClientProvider client={queryClient}>
        <AppRouter />

        <ReactQueryDevtools />
      </QueryClientProvider>
    </ChakraProvider>
  </React.StrictMode>
);
