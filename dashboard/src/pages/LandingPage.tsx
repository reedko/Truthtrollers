import React, { useEffect } from "react";
import {
  Box,
  Container,
  Heading,
  Text,
  Button,
  VStack,
  HStack,
  Image,
  SimpleGrid,
  Icon,
  useColorMode,
  Link,
  Flex,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { FiSearch, FiUsers, FiTrendingUp, FiShield } from "react-icons/fi";
import ColorModeSwitch from "../components/ColorModeSwitch";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

const LandingPage: React.FC = () => {
  const { colorMode } = useColorMode();

  // Track landing page visit
  useEffect(() => {
    const trackVisit = async () => {
      try {
        const visitData = {
          page: 'landing',
          timestamp: new Date().toISOString(),
          referrer: document.referrer || 'direct',
          userAgent: navigator.userAgent,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          language: navigator.language,
        };

        // Log to backend
        await fetch(`${API_BASE_URL}/api/track-visit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(visitData),
        });

        // Also log to console for analytics
        console.log('📊 Landing page visit tracked:', visitData);
      } catch (error) {
        console.error('Failed to track visit:', error);
      }
    };

    trackVisit();
  }, []);

  return (
    <Box minH="100vh" w="100%">
      {/* Navigation Bar */}
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
                to="/about"
                fontSize="md"
                fontWeight="medium"
                color={colorMode === "dark" ? "gray.300" : "gray.700"}
                _hover={{
                  color: colorMode === "dark" ? "cyan.400" : "blue.500",
                }}
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
              <Link
                href="/#features"
                fontSize="md"
                fontWeight="medium"
                color={colorMode === "dark" ? "gray.300" : "gray.700"}
                _hover={{
                  color: colorMode === "dark" ? "cyan.400" : "blue.500",
                }}
              >
                Features
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

      {/* Hero Section */}
      <Box
        pt="160px"
        pb="80px"
        bgGradient={
          colorMode === "dark"
            ? "linear(to-br, gray.900, blue.900, purple.900)"
            : "linear(to-br, blue.50, purple.50, pink.50)"
        }
        position="relative"
        overflow="hidden"
      >
        {/* Animated background */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          opacity={0.1}
          bgImage={`${API_BASE_URL}/assets/nebula2.png`}
          bgSize="cover"
          bgPosition="center"
          filter="blur(8px)"
        />

        <Container maxW="1400px" position="relative" zIndex={1}>
          <SimpleGrid
            columns={{ base: 1, lg: 2 }}
            spacing={12}
            alignItems="center"
          >
            {/* Left: Hero Content */}
            <VStack align="flex-start" spacing={8}>
              <Heading
                size="3xl"
                lineHeight="1.2"
                bgGradient="linear(to-r, cyan.400, blue.500, purple.500)"
                bgClip="text"
              >
                Community-powered truth for the Misinformation Age
              </Heading>
              <Text
                fontSize="xl"
                color={colorMode === "dark" ? "gray.300" : "gray.600"}
              >
                TruthTrollers is a collaborative platform for investigating
                claims, analyzing evidence, and building a shared understanding
                of reality.
              </Text>
              <HStack spacing={4}>
                <Button
                  as={RouterLink}
                  to="/login"
                  size="lg"
                  colorScheme="cyan"
                  fontWeight="bold"
                  px={8}
                >
                  Get Started
                </Button>
                <Button
                  as="a"
                  href="#about"
                  size="lg"
                  variant="outline"
                  colorScheme="cyan"
                  fontWeight="bold"
                  px={8}
                >
                  Learn More
                </Button>
              </HStack>
            </VStack>

            {/* Right: Featured Image */}
            <Box>
              <Image
                src={`${API_BASE_URL}/assets/nebula.png`}
                alt="TruthTrollers Platform"
                borderRadius="2xl"
                boxShadow="2xl"
              />
            </Box>
          </SimpleGrid>
        </Container>
      </Box>

      {/* Features Section */}
      <Box
        id="features"
        py="80px"
        bg={colorMode === "dark" ? "gray.900" : "white"}
      >
        <Container maxW="1400px">
          <VStack spacing={12}>
            <VStack spacing={4} textAlign="center">
              <Heading size="2xl">Powerful Tools for Truth Seekers</Heading>
              <Text
                fontSize="lg"
                color={colorMode === "dark" ? "gray.400" : "gray.600"}
                maxW="600px"
              >
                Investigate claims, analyze evidence, and collaborate with a
                community dedicated to understanding the truth.
              </Text>
            </VStack>

            <SimpleGrid
              columns={{ base: 1, md: 2, lg: 4 }}
              spacing={8}
              w="100%"
            >
              {/* Feature 1 */}
              <VStack
                p={8}
                bg={colorMode === "dark" ? "gray.800" : "gray.50"}
                borderRadius="xl"
                spacing={4}
                align="flex-start"
                border="1px solid"
                borderColor={colorMode === "dark" ? "gray.700" : "gray.200"}
                _hover={{
                  transform: "translateY(-4px)",
                  boxShadow: "xl",
                  borderColor: "cyan.400",
                }}
                transition="all 0.3s"
              >
                <Icon as={FiSearch} boxSize={10} color="cyan.400" />
                <Heading size="md">Evidence Analysis</Heading>
                <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                  Deep dive into claims with comprehensive evidence tracking and
                  credibility scoring.
                </Text>
              </VStack>

              {/* Feature 2 */}
              <VStack
                p={8}
                bg={colorMode === "dark" ? "gray.800" : "gray.50"}
                borderRadius="xl"
                spacing={4}
                align="flex-start"
                border="1px solid"
                borderColor={colorMode === "dark" ? "gray.700" : "gray.200"}
                _hover={{
                  transform: "translateY(-4px)",
                  boxShadow: "xl",
                  borderColor: "blue.400",
                }}
                transition="all 0.3s"
              >
                <Icon as={FiUsers} boxSize={10} color="blue.400" />
                <Heading size="md">Collaborative Research</Heading>
                <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                  Work together with researchers worldwide to investigate
                  complex topics.
                </Text>
              </VStack>

              {/* Feature 3 */}
              <VStack
                p={8}
                bg={colorMode === "dark" ? "gray.800" : "gray.50"}
                borderRadius="xl"
                spacing={4}
                align="flex-start"
                border="1px solid"
                borderColor={colorMode === "dark" ? "gray.700" : "gray.200"}
                _hover={{
                  transform: "translateY(-4px)",
                  boxShadow: "xl",
                  borderColor: "purple.400",
                }}
                transition="all 0.3s"
              >
                <Icon as={FiTrendingUp} boxSize={10} color="purple.400" />
                <Heading size="md">Knowledge Graphs</Heading>
                <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                  Visualize complex relationships between claims, evidence, and
                  sources.
                </Text>
              </VStack>

              {/* Feature 4 */}
              <VStack
                p={8}
                bg={colorMode === "dark" ? "gray.800" : "gray.50"}
                borderRadius="xl"
                spacing={4}
                align="flex-start"
                border="1px solid"
                borderColor={colorMode === "dark" ? "gray.700" : "gray.200"}
                _hover={{
                  transform: "translateY(-4px)",
                  boxShadow: "xl",
                  borderColor: "pink.400",
                }}
                transition="all 0.3s"
              >
                <Icon as={FiShield} boxSize={10} color="pink.400" />
                <Heading size="md">Credibility Scores</Heading>
                <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                  AI-powered credibility assessment for authors, publishers, and
                  claims.
                </Text>
              </VStack>
            </SimpleGrid>
          </VStack>
        </Container>
      </Box>

      {/* About Section */}
      <Box
        id="about"
        py="80px"
        bg={colorMode === "dark" ? "gray.800" : "gray.50"}
      >
        <Container maxW="1400px">
          <VStack align="flex-start" spacing={6} maxW="800px" mx="auto">
              <Heading size="2xl">About TruthTrollers</Heading>
              <Text
                fontSize="lg"
                color={colorMode === "dark" ? "gray.300" : "gray.600"}
              >
                In an age of information overload and misinformation,
                TruthTrollers provides the tools and community you need to
                navigate complex topics and uncover the truth.
              </Text>
              <Text
                fontSize="lg"
                color={colorMode === "dark" ? "gray.300" : "gray.600"}
              >
                Our platform combines AI-powered analysis with human
                collaboration to help you investigate claims, evaluate evidence,
                and build a deeper understanding of the world around you.
              </Text>
              <VStack align="flex-start" spacing={3} w="100%">
                <HStack>
                  <Icon as={FiSearch} color="cyan.400" boxSize={5} />
                  <Text fontWeight="bold">
                    Comprehensive Investigation Tools
                  </Text>
                </HStack>
                <HStack>
                  <Icon as={FiUsers} color="blue.400" boxSize={5} />
                  <Text fontWeight="bold">Active Community of Researchers</Text>
                </HStack>
                <HStack>
                  <Icon as={FiTrendingUp} color="purple.400" boxSize={5} />
                  <Text fontWeight="bold">Real-time Trending Topics</Text>
                </HStack>
                <HStack>
                  <Icon as={FiShield} color="pink.400" boxSize={5} />
                  <Text fontWeight="bold">AI-Powered Credibility Analysis</Text>
                </HStack>
              </VStack>
          </VStack>
        </Container>
      </Box>

      {/* Vision Section */}
      <Box
        id="vision"
        py="80px"
        bg={colorMode === "dark" ? "gray.900" : "white"}
      >
        <Container maxW="1400px">
          <VStack spacing={8} textAlign="center">
            <Heading size="2xl">Our Vision</Heading>
            <Text
              fontSize="xl"
              color={colorMode === "dark" ? "gray.300" : "gray.600"}
              maxW="800px"
            >
              We envision a world where truth is accessible, verifiable, and
              collaborative. Where anyone can investigate claims, contribute
              evidence, and participate in the collective pursuit of
              understanding.
            </Text>
            <Text
              fontSize="xl"
              color={colorMode === "dark" ? "gray.300" : "gray.600"}
              maxW="800px"
            >
              TruthTrollers is more than a platform—it's a movement towards a
              more informed, critical-thinking society.
            </Text>
            <Button
              as={RouterLink}
              to="/login"
              size="lg"
              colorScheme="cyan"
              fontWeight="bold"
              px={12}
              mt={4}
            >
              Join the Movement
            </Button>
          </VStack>
        </Container>
      </Box>

      {/* Footer */}
      <Box
        py={8}
        bg={colorMode === "dark" ? "gray.950" : "gray.100"}
        borderTop="1px solid"
        borderColor={colorMode === "dark" ? "gray.800" : "gray.200"}
      >
        <Container maxW="1400px">
          <Flex
            direction={{ base: "column", md: "row" }}
            justify="space-between"
            align="center"
            gap={4}
          >
            <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>
              © 2026 TruthTrollers. All rights reserved.
            </Text>
            <HStack spacing={6}>
              <Link
                as={RouterLink}
                to="/about"
                color={colorMode === "dark" ? "gray.400" : "gray.600"}
                _hover={{ color: "cyan.400" }}
              >
                About
              </Link>
              <Link
                href="#vision"
                color={colorMode === "dark" ? "gray.400" : "gray.600"}
                _hover={{ color: "cyan.400" }}
              >
                Vision
              </Link>
              <Link
                as={RouterLink}
                to="/login"
                color={colorMode === "dark" ? "gray.400" : "gray.600"}
                _hover={{ color: "cyan.400" }}
              >
                Login
              </Link>
            </HStack>
          </Flex>
        </Container>
      </Box>
    </Box>
  );
};

export default LandingPage;
