import React, { useState, useEffect } from "react";
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  HStack,
  Flex,
  Container,
  Image,
  useColorMode,
  Link,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import ColorModeSwitch from "../components/ColorModeSwitch";
import TaskProjectsPanel from "../components/TaskProjectsPanel";
//import TestCard from "../../../extension/src/components/TestCard";
import Draggable from "react-draggable";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

const AboutPage: React.FC = () => {
  const { colorMode } = useColorMode();
  const [cardPosition, setCardPosition] = useState({ x: 0, y: 0 });

  // Track about page visit
  useEffect(() => {
    const trackVisit = async () => {
      try {
        const visitData = {
          page: "about",
          timestamp: new Date().toISOString(),
          referrer: document.referrer || "direct",
          userAgent: navigator.userAgent,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          language: navigator.language,
        };

        await fetch(`${API_BASE_URL}/api/track-visit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(visitData),
        });

        console.log("📊 About page visit tracked:", visitData);
      } catch (error) {
        console.error("Failed to track visit:", error);
      }
    };

    trackVisit();
  }, []);

  return (
    <Box minH="100vh" w="100%">
      {/* Navigation Bar - Same as Landing Page */}
      <Box
        as="nav"
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={1000}
        bg={
          colorMode === "dark"
            ? "rgba(15, 23, 42, 0.95)"
            : "rgba(255, 255, 255, 0.95)"
        }
        backdropFilter="blur(12px)"
        borderBottom="1px solid"
        borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
        boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
      >
        <Container maxW="1400px">
          <Flex h="80px" align="center" justify="space-between">
            {/* Logo */}
            <HStack spacing={4}>
              <Image
                src={`${API_BASE_URL}/assets/ttlogo11.png`}
                boxSize="120px"
                objectFit="contain"
              />
              <Heading
                size="3xl"
                bgGradient="linear(to-r, cyan.400, blue.500)"
                bgClip="text"
                fontWeight="extrabold"
              >
                TruthTrollers
              </Heading>
            </HStack>

            {/* Navigation Links */}
            <HStack spacing={8}>
              <Link
                as={RouterLink}
                to="/"
                fontSize="md"
                fontWeight="medium"
                color={colorMode === "dark" ? "gray.300" : "gray.700"}
                _hover={{
                  color: colorMode === "dark" ? "cyan.400" : "blue.500",
                }}
              >
                Home
              </Link>
              <Link
                href="/#about"
                fontSize="md"
                fontWeight="medium"
                color={colorMode === "dark" ? "cyan.400" : "blue.500"}
              >
                About
              </Link>
              <Link
                href="/#vision"
                fontSize="md"
                fontWeight="medium"
                color={colorMode === "dark" ? "gray.300" : "gray.700"}
                _hover={{
                  color: colorMode === "dark" ? "cyan.400" : "blue.500",
                }}
              >
                Vision
              </Link>
              <ColorModeSwitch />
              <Button
                as={RouterLink}
                to="/login"
                colorScheme="cyan"
                size="md"
                fontWeight="bold"
              >
                Login
              </Button>
            </HStack>
          </Flex>
        </Container>
      </Box>

      {/* Main Content */}
      <Box className="mr-container" p={6} minH="100vh">
        <div className="mr-content">
          <Container maxW="1400px">
            {/* Welcome Section */}
            <Flex gap={4} mb={6} wrap="wrap" w="100%" mt="120px">
              {/* Welcome Card - 1/3 width */}
              <Box flex={{ base: "1 1 100%", lg: "1 1 30%" }} minW="300px">
                <Box
                  className="mr-card mr-card-blue"
                  position="relative"
                  height="280px"
                  overflow="hidden"
                >
                  <div className="mr-glow-bar mr-glow-bar-blue" />
                  <div className="mr-scanlines" />

                  {/* Content - horizontal layout */}
                  <Flex
                    direction="row"
                    justify="space-between"
                    align="flex-start"
                    height="100%"
                    px={6}
                    pt={3}
                    pb={4}
                    gap={4}
                  >
                    {/* Text on left */}
                    <VStack align="flex-start" spacing={3}>
                      <VStack align="flex-start" spacing={0}>
                        <Heading size="xl" className="mr-heading">
                          Welcome,
                        </Heading>
                        <Heading size="xl" className="mr-heading" pl={4}>
                          Seeker
                        </Heading>
                      </VStack>
                      <VStack align="flex-start" spacing={1} pt={2}>
                        <Text className="mr-text-secondary" fontSize="lg">
                          › Verify claims
                        </Text>
                        <Text className="mr-text-secondary" fontSize="lg">
                          › Map evidence
                        </Text>
                        <Text className="mr-text-secondary" fontSize="lg">
                          › Uncover truth
                        </Text>
                      </VStack>
                    </VStack>

                    {/* Image on right - centered vertically */}
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      pr={4}
                    >
                      <Image
                        src={`${API_BASE_URL}/assets/images/textures/glucose.png`}
                        alt="Truth is Sweet"
                        height="300px"
                        width="300px"
                        objectFit="contain"
                      />
                    </Box>
                  </Flex>
                </Box>
              </Box>

              {/* Task Projects - 2/3 width */}
              <Box flex={{ base: "1 1 100%", lg: "1 1 65%" }} minW="300px">
                <Box height="280px">
                  <TaskProjectsPanel />
                </Box>
              </Box>
            </Flex>

            {/* Info Boxes - Minority Report Style */}
            <Flex gap={4} wrap="wrap" w="100%">
              {/* Mission */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-cyan"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-cyan" />
                  <div className="mr-scanlines" />
                  <Heading size="sm" className="mr-heading" mb={3}>
                    MISSION PARAMETERS
                  </Heading>
                  <VStack align="start" spacing={2}>
                    <Text className="mr-text-primary" fontSize="md">
                      › Truth-seeking infrastructure
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Collaborative verification
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › AI-augmented analysis
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Community intelligence
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Evidence-driven conclusions
                    </Text>
                  </VStack>
                </Box>
              </Box>

              {/* Core Values */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-purple"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-purple" />
                  <div className="mr-scanlines" />
                  <Heading size="sm" className="mr-heading" mb={3}>
                    CORE PROTOCOLS
                  </Heading>
                  <VStack align="start" spacing={2}>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Evidence verification
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Distributed validation
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Transparent methodology
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Quality enforcement
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Open accessibility
                    </Text>
                  </VStack>
                </Box>
              </Box>

              {/* Technology */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-red"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-red" />
                  <div className="mr-scanlines" />
                  <Heading size="sm" className="mr-heading" mb={3}>
                    SYSTEM CAPABILITIES
                  </Heading>
                  <VStack align="start" spacing={2}>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Neural credibility scoring
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Graph relationship mapping
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Real-time claim capture
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Multi-source verification
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Collaborative networks
                    </Text>
                  </VStack>
                </Box>
              </Box>

              {/* Stats */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-yellow"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-yellow" />
                  <div className="mr-scanlines" />
                  <Heading size="sm" className="mr-heading" mb={3}>
                    NETWORK STATUS
                  </Heading>
                  <VStack align="start" spacing={2}>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › 10K+ claims processed
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › 5K+ active analysts
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › 50K+ evidence nodes
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › 100K+ relationships mapped
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › 24/7 verification active
                    </Text>
                  </VStack>
                </Box>
              </Box>

              {/* How It Works */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-green"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-green" />
                  <div className="mr-scanlines" />
                  <Heading size="sm" className="mr-heading" mb={3}>
                    WORKFLOW SEQUENCE
                  </Heading>
                  <VStack align="start" spacing={2}>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Claim ingestion
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Evidence aggregation
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Credibility analysis
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Network validation
                    </Text>
                    <Text className="mr-text-secondary" fontSize="sm">
                      › Truth synthesis
                    </Text>
                  </VStack>
                </Box>
              </Box>

              {/* Call to Action */}
              <Box flex={{ base: "1 1 100%", md: "1 1 30%" }} minW="280px">
                <Box
                  className="mr-card mr-card-blue"
                  p={5}
                  position="relative"
                  height="280px"
                >
                  <div className="mr-glow-bar mr-glow-bar-blue" />
                  <div className="mr-scanlines" />
                  <VStack spacing={3} align="stretch" h="100%">
                    <Heading size="sm" className="mr-heading">
                      ACCESS PROTOCOL
                    </Heading>
                    <Text className="mr-text-secondary" fontSize="sm">
                      Initialize investigation interface
                    </Text>
                    <Button
                      as={RouterLink}
                      to="/login"
                      className="mr-button"
                      colorScheme="cyan"
                      width="100%"
                      mt="auto"
                    >
                      AUTHENTICATE
                    </Button>
                  </VStack>
                </Box>
              </Box>
            </Flex>
          </Container>

          {/* Draggable Task Card - Direct import from extension */}
          <Draggable
            position={cardPosition}
            onStop={(e, data) => setCardPosition({ x: data.x, y: data.y })}
          >
            <Box
              position="fixed"
              right="40px"
              top="200px"
              cursor="move"
              zIndex={1001}
            ></Box>
          </Draggable>
        </div>
      </Box>
    </Box>
  );
};

export default AboutPage;
