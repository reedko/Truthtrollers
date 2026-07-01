import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, Box, Heading, Text, VStack, HStack } from "@chakra-ui/react";
import TaskCard from "./components/TaskCard";
import theme from "./components/themes/VisionTheme";
import useTaskStore from "./store/useTaskStore";
import "./components/Popup.css";
import "./styles/minorityReport.css";

const Demo: React.FC = () => {
  const { setTask, setCurrentUrl } = useTaskStore();
  const [detectedColors, setDetectedColors] = useState<Record<string, string>>({});
  const [showCompleted, setShowCompleted] = useState(true);

  // Update task whenever showCompleted changes
  useEffect(() => {
    // Mock a completed task with verimeter and claim_pairs data
    const mockTask: any = {
      content_id: 14894,
      content_name: "Test Article: Climate Change Evidence Analysis",
      thumbnail: "/assets/images/content/content_id_14894.png",
      progress: showCompleted ? "Completed" : "Awaiting Evaluation",
      media_source: "Test Source",
      url: "https://example.com/test-article",
      assigned: "assigned",
      users: "test-user",
      details: "Test details",
      topic: "Climate",
      subtopic: "Evidence",
      verimeter_score: 0.75,
    };

    // Add claim_pairs data if completed
    if (showCompleted) {
      mockTask.claim_pairs = {
        overall_verimeter: 0.75,
        claim_pairs: [
          {
            caseClaim: {
              claim_id: 1,
              claim_text: "Global temperatures have risen by 1.1°C since pre-industrial times",
              publisher: "nasa.gov",
              url: "https://nasa.gov/climate",
            },
            sourceClaim: {
              claim_id: 2,
              claim_text: "Multiple studies confirm warming trend across all continents",
              publisher: "ipcc.ch",
              url: "https://ipcc.ch/report",
              relationship: "supports",
            },
            verimeter_score: 0.85,
            support_level: 0.9,
            rationale: "Multiple independent temperature records show consistent warming patterns across different measurement systems.",
          },
          {
            caseClaim: {
              claim_id: 3,
              claim_text: "Arctic sea ice is declining at unprecedented rates",
              publisher: "noaa.gov",
              url: "https://noaa.gov/arctic",
            },
            sourceClaim: {
              claim_id: 4,
              claim_text: "Satellite observations show 13% decline per decade since 1979",
              publisher: "nsidc.org",
              url: "https://nsidc.org/data",
              relationship: "supports",
            },
            verimeter_score: 0.78,
            support_level: 0.85,
            rationale: "Satellite data provides direct measurement of ice extent showing consistent decline.",
          },
          {
            caseClaim: {
              claim_id: 5,
              claim_text: "CO2 levels are at highest point in 800,000 years",
              publisher: "climate.gov",
              url: "https://climate.gov/co2",
            },
            sourceClaim: {
              claim_id: 6,
              claim_text: "Ice core data shows current levels exceed natural variation",
              publisher: "nature.com",
              url: "https://nature.com/articles/climate",
              relationship: "supports",
            },
            verimeter_score: 0.92,
            support_level: 0.95,
            rationale: "Ice core samples provide historical CO2 records showing unprecedented modern levels.",
          },
        ],
      };
    }

    setTask(mockTask);
    setCurrentUrl("https://example.com/test-article");

    // Override TaskCard positioning for demo - STATIC (not fixed)
    const style = document.createElement('style');
    style.textContent = `
      .popup-box {
        position: static !important;
        transform: none !important;
      }
    `;
    document.head.appendChild(style);

    // Detect actual browser chrome colors
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    document.body.appendChild(tempDiv);

    const systemColors = [
      'ActiveBorder', 'ActiveCaption', 'InactiveCaption',
      'InactiveBorder', 'InactiveCaptionText', 'Window',
      'WindowFrame', 'WindowText', 'Canvas', 'CanvasText',
      'LinkText', 'VisitedText', 'ActiveText', 'ButtonFace',
      'ButtonText', 'ButtonBorder', 'Field', 'FieldText',
      'Highlight', 'HighlightText', 'Mark', 'MarkText',
      'GrayText', 'AccentColor', 'AccentColorText'
    ];

    const colors: Record<string, string> = {};
    systemColors.forEach(colorName => {
      tempDiv.style.backgroundColor = colorName;
      const computed = window.getComputedStyle(tempDiv).backgroundColor;
      colors[colorName] = computed;
    });

    document.body.removeChild(tempDiv);
    setDetectedColors(colors);

    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
    };
  }, [setTask, setCurrentUrl, showCompleted]); // Re-run when showCompleted changes

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
              🌈 TaskCard Sandbox - Test Your Changes
            </Heading>

            <Text
              fontSize="xl"
              color="white"
              textShadow="2px 2px 4px rgba(0,0,0,0.7)"
              fontWeight="bold"
            >
              Test TaskCard & ClaimPairsDetail with mock data - No extension deployment needed!
            </Text>

            <Box bg="rgba(0,0,0,0.7)" p={4} borderRadius="lg" mt={2}>
              <HStack spacing={4}>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  style={{
                    padding: "10px 20px",
                    background: showCompleted ? "#22c55e" : "#ef4444",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  {showCompleted ? "✓ Completed Task" : "⏳ Awaiting Task"}
                </button>
                <Text color="white" fontSize="sm">
                  Click to toggle between completed (with ClaimPairs) and awaiting states
                </Text>
              </HStack>
            </Box>

            <Box bg="rgba(255,255,255,0.9)" p={6} borderRadius="lg" boxShadow="2xl" width="100%">
              <Heading size="md" mb={3} color="gray.800">
                📝 How to Use This Sandbox
              </Heading>
              <VStack align="start" spacing={2} fontSize="sm" color="gray.700">
                <Text>
                  <strong>1.</strong> Edit components live - changes auto-refresh:
                </Text>
                <Text pl={4}>
                  • <code style={{background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px'}}>src/components/TaskCard.tsx</code> - Main card
                </Text>
                <Text pl={4}>
                  • <code style={{background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px'}}>src/components/ClaimPairsDetail.tsx</code> - Expandable claims
                </Text>
                <Text>
                  <strong>2.</strong> Toggle between states using the button above
                </Text>
                <Text>
                  <strong>3.</strong> Test with mock data - no backend or extension deployment needed
                </Text>
                <Text mt={2} fontStyle="italic" color="blue.600">
                  Look at the cards in the top-right corner ➡️
                </Text>
              </VStack>
            </Box>

            {/* Colorful vertical stripes */}
            <Box
              h="150px"
              w="100%"
              bgGradient="repeating-linear(90deg, #ff6b6b 0px, #ff6b6b 40px, #4ecdc4 40px, #4ecdc4 80px, #45b7d1 80px, #45b7d1 120px, #f9ca24 120px, #f9ca24 160px)"
              borderRadius="lg"
              boxShadow="2xl"
            />

            {/* Checkered pattern */}
            <Box
              h="150px"
              w="100%"
              bgImage="repeating-conic-gradient(#ff6b6b 0% 25%, #4ecdc4 0% 50%)"
              bgSize="50px 50px"
              borderRadius="lg"
              boxShadow="2xl"
            />

            <Text
              fontSize="6xl"
              fontWeight="bold"
              color="white"
              textShadow="4px 4px 8px rgba(0,0,0,0.8)"
            >
              TASKCARD IS CENTERED ⬆️
            </Text>

            <Box
              bg="rgba(0,0,0,0.8)"
              p={6}
              borderRadius="lg"
              color="white"
              width="100%"
            >
              <Text fontSize="lg">
                If you can see this colorful background through the TaskCard (top-right),
                then it's transparent! If it's opaque/white, the background is blocking the view.
              </Text>
            </Box>

            {/* Browser System Color Palette */}
            <Box
              bg="rgba(255,255,255,0.95)"
              p={6}
              borderRadius="lg"
              boxShadow="2xl"
              width="100%"
            >
              <Heading size="md" mb={4} color="gray.800">
                🎨 Browser System Colors (Computed Values)
              </Heading>
              <Text fontSize="xs" color="gray.600" mb={4}>
                These are the actual RGB values your browser resolves from CSS system color keywords:
              </Text>
              <Box display="grid" gridTemplateColumns="repeat(2, 1fr)" gap={3}>
                {[
                  // Browser chrome colors
                  'ActiveBorder', 'ActiveCaption', 'InactiveCaption',
                  'InactiveBorder', 'InactiveCaptionText', 'Window',
                  'WindowFrame', 'WindowText',
                  // Content colors
                  'Canvas', 'CanvasText', 'LinkText', 'VisitedText',
                  'ActiveText', 'ButtonFace', 'ButtonText', 'ButtonBorder',
                  'Field', 'FieldText', 'Highlight', 'HighlightText',
                  'Mark', 'MarkText', 'GrayText', 'AccentColor',
                  'AccentColorText'
                ].map(colorName => {
                  const computedColor = detectedColors[colorName] || 'rgb(0,0,0)';
                  return (
                    <Box
                      key={colorName}
                      display="flex"
                      alignItems="center"
                      gap={2}
                      p={2}
                      border="1px solid"
                      borderColor="gray.300"
                      borderRadius="md"
                      bg="white"
                    >
                      <Box
                        width="40px"
                        height="40px"
                        bg={computedColor}
                        border="1px solid"
                        borderColor="gray.400"
                        borderRadius="md"
                        flexShrink={0}
                      />
                      <Box flex={1}>
                        <Text fontSize="xs" fontWeight="bold" color="gray.800">
                          {colorName}
                        </Text>
                        <Text fontSize="2xs" color="gray.600" fontFamily="monospace">
                          {computedColor}
                        </Text>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </VStack>
        </Box>

        {/* TaskCard Only - Centered */}
        <Box
          position="fixed"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          zIndex={1000}
        >
          <TaskCard />
        </Box>
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
} else {
  console.error("Root element not found");
}
