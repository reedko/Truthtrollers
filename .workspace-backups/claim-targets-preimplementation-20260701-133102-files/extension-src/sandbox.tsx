import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, Box } from "@chakra-ui/react";
import theme from "./components/themes/VisionTheme"; // or wherever your theme lives
import TaskCard from "./components/TestCard"; // if you're reusing it

const App = () => {
  return (
    <ChakraProvider theme={theme}>
      <Box p={8} bg="gray.200" minHeight="100vh">
        <TaskCard />
      </Box>
    </ChakraProvider>
  );
};

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
