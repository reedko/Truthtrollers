import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, Box, Heading, Text, VStack } from "@chakra-ui/react";
import TaskCard from "../src/components/TaskCard";
import theme from "../src/components/themes/VisionTheme";
import useTaskStore from "../src/store/useTaskStore";
import "../src/components/Popup.css";

const Demo: React.FC = () => {
  const { setTask, setCurrentUrl } = useTaskStore();

  useEffect(() => {
    // Mock a completed task
    setTask({
      task_id: 1,
      content_id: 123,
      content_name: "Test Article: Climate Change Evidence",
      thumbnail: "/assets/images/miniLogo.png",
      progress: "Completed",
      content_type: "article",
      url: "https://example.com/test",
      created_at: new Date(),
      updated_at: new Date(),
    });
    setCurrentUrl("https://example.com/test");
  }, [setTask, setCurrentUrl]);

  return (
    <ChakraProvider theme={theme}>
      <Box minH="100vh" position="relative" overflow="hidden">
        {/* Animated rainbow background */}
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bgGradient="linear(45deg, #ff6b6b, #4ecdc4, #45b7d1, #f9ca24)"
          bgSize="400% 400%"
          animation="gradient 15s ease infinite"
          zIndex={0}
        />

        <style>
          {`
            @keyframes gradient {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          `}
        </style>

        {/* Content */}
        <Box position="relative" zIndex={1} p={8} maxW="800px" mx="auto">
          <VStack spacing={6} align="start">
            <Heading
              size="2xl"
              color="white"
              textShadow="3px 3px 6px rgba(0,0,0,0.7)"
            >
              🌈 TaskCard Transparency Test
            </Heading>

            <Text
              fontSize="xl"
              color="white"
              textShadow="2px 2px 4px rgba(0,0,0,0.7)"
              fontWeight="bold"
            >
              Edit src/components/TaskCard.tsx and refresh to see changes!
            </Text>

            <Box bg="rgba(255,255,255,0.9)" p={6} borderRadius="lg" boxShadow="2xl">
              <Heading size="md" mb={3}>
                📝 Instructions
              </Heading>
              <VStack align="start" spacing={2} fontSize="sm">
                <Text>
                  1. Open <code>src/components/TaskCard.tsx</code>
                </Text>
                <Text>2. Find line ~189 (the main Box bgGradient)</Text>
                <Text>3. Try different background values</Text>
                <Text>4. Save and refresh this page</Text>
              </VStack>
            </Box>

            {/* Colorful patterns to see through */}
            <Box
              h="150px"
              w="100%"
              bgGradient="repeating-linear(90deg, #ff6b6b 0px, #ff6b6b 40px, #4ecdc4 40px, #4ecdc4 80px, #45b7d1 80px, #45b7d1 120px, #f9ca24 120px, #f9ca24 160px)"
              borderRadius="lg"
              boxShadow="xl"
            />

            <Box
              h="150px"
              w="100%"
              bgImage="repeating-conic-gradient(#ff6b6b 0% 25%, #4ecdc4 0% 50%)"
              bgSize="50px 50px"
              borderRadius="lg"
              boxShadow="xl"
            />

            <Text
              fontSize="4xl"
              fontWeight="bold"
              color="white"
              textShadow="3px 3px 6px rgba(0,0,0,0.7)"
            >
              Big Text Under TaskCard ➡️
            </Text>
          </VStack>
        </Box>

        {/* TaskCard floats in top-right */}
        <TaskCard />
      </Box>
    </ChakraProvider>
  );
};

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Demo />
    </React.StrictMode>
  );
}
