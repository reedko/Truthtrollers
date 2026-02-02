import React, { useEffect } from "react";
import { ChakraProvider, Box, Heading, Text, VStack, Image } from "@chakra-ui/react";
import TaskCard from "../components/TaskCard";
import theme from "../components/themes/VisionTheme";
import useTaskStore from "../store/useTaskStore";

const TaskCardDemo: React.FC = () => {
  const { setTask, setCurrentUrl } = useTaskStore();

  useEffect(() => {
    // Mock a completed task with all data
    setTask({
      content_id: 123,
      content_name: "Test Article: Is Climate Change Real?",
      thumbnail: "/assets/images/miniLogo.png",
      progress: "Completed",
      media_source: "Test Source",
      url: "https://example.com/test-article",
      assigned: "assigned",
      users: "test-user",
      details: "Test details",
      topic: "Climate",
      subtopic: "Science",
    });
    setCurrentUrl("https://example.com/test-article");
  }, [setTask, setCurrentUrl]);

  return (
    <ChakraProvider theme={theme}>
      <Box
        minH="100vh"
        position="relative"
        overflow="hidden"
      >
        {/* Colorful animated background */}
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

        {/* Content under TaskCard */}
        <Box
          position="relative"
          zIndex={1}
          p={8}
          maxW="800px"
          mx="auto"
        >
          <VStack spacing={6} align="start">
            <Heading
              size="2xl"
              color="white"
              textShadow="2px 2px 4px rgba(0,0,0,0.5)"
            >
              🌈 TaskCard Transparency Demo
            </Heading>

            <Text fontSize="xl" color="white" textShadow="2px 2px 4px rgba(0,0,0,0.5)">
              This colorful animated background helps you test if the TaskCard is transparent.
            </Text>

            <Box
              bg="rgba(255, 255, 255, 0.9)"
              p={6}
              borderRadius="lg"
              boxShadow="xl"
            >
              <Heading size="md" mb={3}>
                📝 How to Use
              </Heading>
              <VStack align="start" spacing={2} fontSize="sm">
                <Text>1. <strong>Edit</strong> src/components/TaskCard.tsx</Text>
                <Text>2. <strong>Save</strong> the file</Text>
                <Text>3. <strong>Refresh</strong> this page to see changes</Text>
                <Text mt={4} fontStyle="italic">
                  The TaskCard should float in the top-right corner with "Completed" status showing the verimeter and crowd meter.
                </Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(0, 0, 0, 0.7)"
              p={6}
              borderRadius="lg"
              color="white"
            >
              <Heading size="md" mb={3} color="#00a2ff">
                🎨 Test Pattern
              </Heading>
              <Text>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus lacinia
                odio vitae vestibulum. Cras sed felis eget velit aliquet sagittis id
                consectetur purus. Donec sollicitudin molestie malesuada.
              </Text>
            </Box>

            {/* Vertical stripes pattern */}
            <Box
              h="200px"
              w="100%"
              bgGradient="repeating-linear(90deg, #ff6b6b 0px, #ff6b6b 50px, #4ecdc4 50px, #4ecdc4 100px, #45b7d1 100px, #45b7d1 150px, #f9ca24 150px, #f9ca24 200px)"
              borderRadius="lg"
              boxShadow="xl"
            />

            {/* Checkered pattern */}
            <Box
              h="200px"
              w="100%"
              bgImage="repeating-conic-gradient(#ff6b6b 0% 25%, #4ecdc4 0% 50%)"
              bgSize="40px 40px"
              borderRadius="lg"
              boxShadow="xl"
            />
          </VStack>
        </Box>

        {/* TaskCard renders in fixed position via its own styling */}
        <TaskCard />
      </Box>
    </ChakraProvider>
  );
};

export default TaskCardDemo;
