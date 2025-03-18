import React, { useEffect, useState } from "react";
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
import "./Popup.css";
import useTaskStore from "../store/useTaskStore";
import resizeImage from "../services/image-url";
import { useTaskScraper } from "../hooks/useTaskScraper";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const getProgressColor = (progress: string | null) => {
  switch (progress) {
    case "Completed":
      return "green";
    case "Partially Complete":
      return "yellow";
    case "Awaiting Evaluation":
      return "blue";
    default:
      return "red";
  }
};

const TaskCard: React.FC = () => {
  const { task, currentUrl, setTask } = useTaskStore(); // Hook to access Zustand
  const { loading, error, scrapeTask } = useTaskScraper(); // Use scraper hook
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // ✅ Retrieve task data from local storage (sent from content.js)
    chrome.storage.local.get("task", (data) => {
      if (data.task) {
        setTask(data.task);
        setVisible(true);
      }
    });
  }, []);

  const handleAddTask = () => {
    if (currentUrl) {
      scrapeTask(currentUrl);
    } else {
      console.error("No URL provided.");
    }
  };

  const imageUrl =
    task && task.thumbnail ? `${BASE_URL}/${task.thumbnail}` : "";
  const meter = `${BASE_URL}/assets/images/meter3.png`;
  const logo = `${BASE_URL}/assets/images/miniLogo.png`;

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
                    setVisible(false);
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
                  disabled={loading}
                >
                  <div>Add</div>
                </Button>
                <Button
                  variant="solid"
                  bg="cyan.100"
                  color="black"
                  onClick={() => {
                    setVisible(false);
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
