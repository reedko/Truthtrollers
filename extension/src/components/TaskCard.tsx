///Users/reedko/React/Truthtrollers demo/TruthTrollers_root/extension/src/components/TaskCard.tsx
import React from "react";
import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Center,
  GridItem,
  Progress,
  Grid,
} from "@chakra-ui/react";
// Import the Task interface if needed
import "./Popup.css";
import useTaskStore from "../store/useTaskStore"; // Import Zustand store
import resizeImage from "../services/image-url";
import { useTaskScraper } from "../hooks/useTaskScraper"; // Import useTask here

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";
const getProgressColor = (progress: string | null) => {
  switch (progress) {
    case "Completed":
      return "green";
    case "Partially Complete":
      return "yellow";
    case "Awaiting Evaluation":
      return "blue";
    default:
      return "red"; // For Assigned/Started states
  }
};

const TaskCard: React.FC = () => {
  const { task, currentUrl } = useTaskStore(); // Hook to access the store values
  const { loading, error, scrapeTask } = useTaskScraper(); // Use scraper hook

  console.log("Updated currentUrl:", currentUrl);
  console.log("URL:", `${BASE_URL}/${task?.thumbnail}`);
  const imageUrl =
    task && task.thumbnail ? `${BASE_URL}/${task.thumbnail}` : "";
  console.log("URL:", imageUrl);
  const meter = `${BASE_URL}/assets/images/meter3.png`;
  const logo = `${BASE_URL}/assets/images/miniLogo.png`;

  const handleAddTask = () => {
    if (currentUrl) {
      scrapeTask(currentUrl); // Trigger scraping with the current URL
    } else {
      console.error("No URL provided.");
    }
  };

  return (
    <Box className="popup-box" width="300px">
      <VStack spacing={3} align="start">
        <Box bg="cyan.100" className="logo-box" position="relative" left="2.5%">
          <HStack spacing="130">
            <Box>{resizeImage(40, logo)}</Box>
            <Text color="black">TruthTrollers</Text>
          </HStack>
        </Box>
        {imageUrl && task?.progress === "Completed" ? (
          <Box position="relative" left="25%">
            {resizeImage(120, meter)}
          </Box>
        ) : (
          imageUrl && (
            <Box position="relative" left="25%">
              {resizeImage(120, imageUrl)}
            </Box>
          )
        )}
        {imageUrl ? (
          <Box width="280px">
            <Text fontWeight="bold" fontSize="l" wrap="yes">
              {task?.content_name}
            </Text>
            <Grid templateRows="repeat(2, 1fr)">
              <GridItem>
                <Text color="gray.600" fontSize="sm">
                  Progress: {task?.progress}
                </Text>
              </GridItem>
              <GridItem>
                <Progress
                  value={
                    task?.progress === "Completed"
                      ? 100
                      : task?.progress === "Partially Complete"
                      ? 50
                      : 25
                  }
                  colorScheme={task ? getProgressColor(task.progress) : ""}
                  mt={2}
                />
              </GridItem>
            </Grid>
            <Text color="gray.600" fontSize="sm">
              Media Source: {task?.media_source}
            </Text>

            <Center>
              <HStack spacing={5}>
                <Button variant="surface" bg="cyan.100" color="black">
                  <a
                    href={task?.details || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div>Details</div>
                  </a>
                </Button>
                <Button
                  variant="solid"
                  bg="cyan.100"
                  color="black"
                  onClick={() => {
                    // Find the popupRoot element
                    const popupRoot = document.getElementById("popup-root");
                    if (popupRoot) {
                      popupRoot.classList.add("task-card-hidden");
                      popupRoot.classList.remove("task-card-visible");
                    }
                  }}
                >
                  <div>Close</div>
                </Button>
              </HStack>
            </Center>
          </Box>
        ) : (
          <Box width="280px">
            <Text fontWeight="bold" fontSize="l" wrap="yes">
              {task?.content_name}
            </Text>
            <Grid templateRows="repeat(2, 1fr)">
              <GridItem>
                <Text color="gray.600" fontSize="sm">
                  This document has not been added to Truthtrollers.
                </Text>
              </GridItem>
              <GridItem>
                <Text>Would you like to Add?</Text>
              </GridItem>
            </Grid>

            <Center>
              <HStack spacing={5}>
                <Button
                  variant="surface"
                  bg="cyan.100"
                  color="black"
                  onClick={handleAddTask}
                  disable={loading} // Use the handleAddClick here to call handleScrape
                >
                  <div>Add</div>
                </Button>
                <Button
                  variant="solid"
                  bg="cyan.100"
                  color="black"
                  onClick={() => {
                    // Find the popupRoot element
                    const popupRoot = document.getElementById("popup-root");
                    if (popupRoot) {
                      popupRoot.classList.add("task-card-hidden");
                      popupRoot.classList.remove("task-card-visible");
                    }
                  }}
                >
                  <div>Close</div>
                </Button>
              </HStack>
            </Center>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default TaskCard;
