import React, { useState } from "react";
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  Center,
  Tooltip,
} from "@chakra-ui/react";
import "./Popup.css";
import "../styles/minorityReport.css";
import UserConsensusBar from "./UserConsensusBar";
import resizeImage from "../services/image-url";
import TruthGauge from "./ModernArcGauge";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const TestCard: React.FC = () => {
  // Mock state for testing
  const [showCompleted, setShowCompleted] = useState(true);
  const [showWithImage, setShowWithImage] = useState(true);

  // Mock data
  const logo = "/assets/images/miniLogo.png";
  const imageUrl = showWithImage ? `${BASE_URL}/assets/images/meter3.png` : "";
  const task = {
    content_name: "Absolute Immunity - by Some Author",
    progress: showCompleted ? "Completed" : "Awaiting Evaluation",
    url: "https://example.com/test",
  };

  return (
    <Box
      className="popup-box"
      width="300px"
      position="relative"
      bgGradient="linear(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7))"
      sx={{
        backgroundImage: `
          linear-gradient(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7)),
          repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.08) 2px, rgba(0, 162, 255, 0.08) 4px)
        `,
      }}
      border="1px solid rgba(0, 162, 255, 0.6)"
      borderRadius="12px"
      boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)"
      overflow="hidden"
      p={3}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width="50px"
        height="100%"
        background="linear-gradient(90deg, rgba(0, 217, 255, 0.6) 0%, rgba(0, 217, 255, 0.4) 25%, rgba(0, 217, 255, 0.25) 50%, rgba(0, 217, 255, 0.1) 75%, transparent 100%)"
        pointerEvents="none"
      />
      <VStack
        spacing={2}
        align="start"
        position="relative"
        zIndex={1}
        style={{ background: "none" }}
        width="100%"
      >
        {/* Logo Box */}
        <Box
          className="logo-box"
          position="relative"
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          backdropFilter="blur(20px)"
          border="1px solid rgba(0, 162, 255, 0.4)"
          borderRadius="12px"
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          overflow="hidden"
          p={2}
          width="100%"
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="30px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
            pointerEvents="none"
          />
          <HStack
            spacing={2}
            position="relative"
            zIndex={1}
            justify="space-between"
            align="center"
          >
            <Box flexShrink={0}>{logo && resizeImage(40, logo)}</Box>
            <Text
              color="#00a2ff"
              fontWeight="400"
              letterSpacing="3px"
              textTransform="uppercase"
              fontSize="xl"
              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
              noOfLines={1}
              overflow="hidden"
              textOverflow="ellipsis"
            >
              TruthTrollers
            </Text>
          </HStack>
        </Box>

        {/* Meters Section - Only show if completed and has image */}
        {imageUrl && task?.progress === "Completed" ? (
          <HStack
            spacing={1}
            align="flex-start"
            width="100%"
            justify="space-between"
            mt={2}
            px={1}
          >
            <Box flexShrink={0}>
              <TruthGauge
                score={-0.72}
                label="VERIMETER"
                size={{ w: 170, h: 90 }}
                normalize={false}
              />
            </Box>
            <Box
              position="relative"
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              border="1px solid rgba(0, 162, 255, 0.5)"
              borderRadius="12px"
              boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
              overflow="hidden"
              flexShrink={0}
              width="70px"
              height="180px"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                width="15px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
                pointerEvents="none"
              />
              <Box
                position="relative"
                zIndex={1}
                transform="scale(0.85)"
                ml={-35}
                mr={-35}
              >
                <UserConsensusBar trueCount={21} falseCount={71} total={121} />
              </Box>
            </Box>
          </HStack>
        ) : (
          imageUrl && (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              width="100%"
            >
              {resizeImage(120, imageUrl)}
            </Box>
          )
        )}

        {/* Content Section */}
        {imageUrl ? (
          <Box width="280px">
            <Box width="100%" mb={2}>
              <Tooltip label={task?.content_name || "No title"} fontSize="sm">
                <Text
                  fontSize="lg"
                  fontWeight="bold"
                  isTruncated
                  whiteSpace="nowrap"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  color="white"
                  px={1}
                >
                  {task?.content_name || "Unknown Content"}
                </Text>
              </Tooltip>
            </Box>

            <Center mt={3}>
              <HStack spacing={3}>
                <button
                  className="mr-button"
                  onClick={() => alert("Discuss clicked")}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>
                    Discuss
                  </span>
                </button>
                <button
                  className="mr-button"
                  onClick={() => alert("Close clicked")}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>Close</span>
                </button>
              </HStack>
            </Center>
          </Box>
        ) : (
          <Box width="100%">
            <Box width="100%" mb={3}>
              <Tooltip
                label={task?.content_name || "Current Page"}
                fontSize="sm"
              >
                <Text
                  fontWeight="bold"
                  fontSize="md"
                  noOfLines={2}
                  color="#f1f5f9"
                >
                  {task?.content_name || "Current Page"}
                </Text>
              </Tooltip>
            </Box>
            <Box
              position="relative"
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              border="1px solid rgba(0, 162, 255, 0.4)"
              borderRadius="12px"
              boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
              overflow="hidden"
              p={4}
              mb={2}
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                width="30px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
                pointerEvents="none"
              />
              <VStack spacing={2} position="relative" zIndex={1}>
                <Text
                  fontSize="md"
                  align="center"
                  color="#f1f5f9"
                  fontWeight="500"
                >
                  Not in database
                </Text>
                <Text
                  fontSize="lg"
                  align="center"
                  color="#00a2ff"
                  fontWeight="600"
                >
                  Add to TruthTrollers?
                </Text>
              </VStack>
            </Box>
            <Center>
              <HStack spacing={3} mt={2}>
                <button
                  className="mr-button"
                  onClick={() => alert("Add clicked")}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>Add</span>
                </button>
                <button
                  className="mr-button"
                  onClick={() => alert("Close clicked")}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>Close</span>
                </button>
              </HStack>
            </Center>
          </Box>
        )}

        {/* Test Controls */}
        <Box width="100%" mt={4} p={3} bg="rgba(0,0,0,0.5)" borderRadius="md">
          <Text color="white" fontSize="sm" fontWeight="bold" mb={2}>
            Test Controls:
          </Text>
          <VStack spacing={2} align="stretch">
            <Button
              size="sm"
              onClick={() => setShowCompleted(!showCompleted)}
              colorScheme={showCompleted ? "green" : "gray"}
            >
              {showCompleted ? "Completed" : "Not Completed"}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowWithImage(!showWithImage)}
              colorScheme={showWithImage ? "blue" : "gray"}
            >
              {showWithImage ? "With Image" : "No Image"}
            </Button>
          </VStack>
        </Box>
      </VStack>
    </Box>
  );
};

export default TestCard;
