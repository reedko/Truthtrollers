import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ChakraProvider, Box } from "@chakra-ui/react";

createRoot(document.getElementById("root")!).render(
  <ChakraProvider>
    <Box
      width="100%"
      minHeight="100vh"
      display="flex"
      justifyContent="center"
      alignItems="flex-start"
    >
      <Box width="100%" maxWidth="1200px">
        <App />
      </Box>
    </Box>
  </ChakraProvider>
);
