import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  GridItem,
  Progress,
  Card,
  CardBody,
  CardHeader,
  Text,
  Grid,
  VStack,
  HStack,
  Spacer,
  Center,
} from "@chakra-ui/react";
import "./Popup.css";
import UserConsensusBar from "./UserConsensusBar";
import useTaskStore from "../store/useTaskStore";
import resizeImage from "../services/image-url";
import { useTaskScraper } from "../hooks/useTaskScraper";
import TruthGauge from "./ModernArcGauge";
import { Stat } from "@chakra-ui/react";
import { Tooltip } from "@chakra-ui/react";

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
    <Box className="popup-box" width="300px" bg="stat5Gradient">
      <VStack spacing={3} align="start">
        <Box bg="cardGradient" className="logo-box" position="relative">
          <HStack spacing="130">
            <Box>{resizeImage(40, logo)}</Box>
            <Text color="white">TruthTrollers</Text>
          </HStack>
        </Box>
        {imageUrl && task?.progress === "Completed" ? (
          <VStack spacing={3} align="center" width="100%">
            <Card
              width="100%"
              borderRadius="2xl"
              overflow="hidden"
              boxShadow="xl"
              bg="cardGradient"
              position="relative"
              minW={{ base: "100%", md: "300px" }}
            >
              <CardHeader>
                <VStack spacing={1} align="center" mb={1} mt={1}>
                  <Spacer />

                  <TruthGauge
                    score={-0.73}
                    label="VERIMETER"
                    size={{ w: 220, h: 140 }}
                    normalize={false}
                  />
                </VStack>
              </CardHeader>

              <CardBody>
                <VStack spacing={1}>
                  <Box w="100%" p={1}>
                    <UserConsensusBar
                      trueCount={21}
                      falseCount={71}
                      total={121}
                    />
                  </Box>
                </VStack>
              </CardBody>
            </Card>
          </VStack>
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
                <Button variant="surface" bg="cardGradient" color="white">
                  <a
                    href={task?.details || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div>Argue</div>
                  </a>
                </Button>
                <Button
                  variant="solid"
                  bg="cardGradient"
                  color="white"
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
          <Box>
            <Box width="280px">
              <Tooltip label={task?.content_name} fontSize="sm">
                <Text
                  fontWeight="bold"
                  fontSize="md"
                  isTruncated
                  whiteSpace="nowrap"
                  overflow="hidden"
                  textOverflow="ellipsis"
                >
                  {task?.content_name}
                </Text>
              </Tooltip>
            </Box>
            <Text fontWeight="bold" fontSize="l" wrap="yes">
              {task?.content_name}
            </Text>
            <Stat
              p={2}
              px={3}
              py={1}
              borderRadius="2xl"
              shadow="md"
              color="white"
              bg="cardGradient"
              w="full"
            >
              <Text color="white" fontSize="md" align="center">
                This document has not been added to Truthtrollers.
              </Text>
              <Text mt={4} color="white" fontSize="lg" align="center">
                Would you like to Add?
              </Text>
            </Stat>
            <Center>
              <HStack spacing={5} mt={2}>
                <Button
                  variant="surface"
                  bg="cardGradient"
                  color="white"
                  onClick={handleAddTask}
                  disabled={loading}
                >
                  <div>Add</div>
                </Button>
                <Button
                  variant="solid"
                  bg="cardGradient"
                  color="white"
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
