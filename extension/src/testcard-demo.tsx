import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, Box } from "@chakra-ui/react";
import TestCard from "./components/TestCard";
import theme from "./components/themes/VisionTheme";
import "./components/Popup.css";
import "./styles/minorityReport.css";

const App = () => (
  <ChakraProvider theme={theme}>
    <Box
      minH="100vh"
      p={8}
      background="linear-gradient(45deg, #1a202c, #2d3748, #1a365d)"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <TestCard />
    </Box>
  </ChakraProvider>
);

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
