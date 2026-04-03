// src/components/admin/ExtensionSettingsPanel.tsx
import React, { useEffect } from "react";
import {
  Box,
  VStack,
  Heading,
  Text,
  Card,
  CardBody,
  CardHeader,
  Divider,
  useToast,
  Button,
  HStack,
} from "@chakra-ui/react";
import { VerimeterModeToggle } from "../VerimeterModeToggle";
import { useVerimeterMode } from "../../contexts/VerimeterModeContext";
import { api } from "../../services/api";

export default function ExtensionSettingsPanel() {
  const { mode, aiWeight, setMode, setAIWeight } = useVerimeterMode();
  const toast = useToast();

  // Load extension settings from backend on mount
  useEffect(() => {
    loadExtensionSettings();
  }, []);

  const loadExtensionSettings = async () => {
    try {
      const response = await api.get("/api/extension-settings");
      const settings = response.data.settings;

      if (settings.verimeter_mode) {
        setMode(settings.verimeter_mode as 'ai' | 'user' | 'combined');
      }
      if (settings.verimeter_ai_weight) {
        setAIWeight(parseFloat(settings.verimeter_ai_weight));
      }
    } catch (error) {
      console.error("Failed to load extension settings:", error);
    }
  };

  const saveExtensionSettings = async () => {
    try {
      await api.post("/api/extension-settings/bulk-update", {
        settings: {
          verimeter_mode: mode,
          verimeter_ai_weight: aiWeight.toString(),
        },
      });

      toast({
        title: "Settings saved",
        description: "Extension verimeter settings have been updated globally.",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Failed to save extension settings:", error);
      toast({
        title: "Failed to save",
        description: "Could not update extension settings.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Box>
      <VStack spacing={6} align="stretch">
        {/* Extension Verimeter Settings */}
        <Card
          bg="rgba(15, 23, 42, 0.6)"
          backdropFilter="blur(10px)"
          borderWidth="1px"
          borderColor="rgba(0, 162, 255, 0.3)"
          boxShadow="0 4px 20px rgba(0, 0, 0, 0.3)"
        >
          <CardHeader>
            <Heading
              size="md"
              color="cyan.300"
              textShadow="0 0 10px rgba(0, 162, 255, 0.5)"
            >
              Extension Verimeter Mode
            </Heading>
            <Text fontSize="sm" color="gray.400" mt={2}>
              Configure the default verimeter scoring mode for the browser extension.
              This setting controls whether extension users see AI-only, user-only, or combined scores.
            </Text>
          </CardHeader>
          <Divider borderColor="rgba(0, 162, 255, 0.2)" />
          <CardBody>
            <VStack spacing={4} align="stretch">
              <VerimeterModeToggle />

              <HStack justify="flex-end">
                <Button
                  onClick={loadExtensionSettings}
                  variant="outline"
                  colorScheme="cyan"
                  size="sm"
                >
                  Reset to Saved
                </Button>
                <Button
                  onClick={saveExtensionSettings}
                  colorScheme="cyan"
                  size="md"
                  boxShadow="0 0 15px rgba(0, 162, 255, 0.4)"
                >
                  Save Extension Settings
                </Button>
              </HStack>

              <Text fontSize="xs" color="gray.500">
                These settings will be used by the browser extension for all users.
                Changes take effect immediately after saving.
              </Text>
            </VStack>
          </CardBody>
        </Card>

        {/* Information Card */}
        <Card
          bg="rgba(15, 23, 42, 0.6)"
          backdropFilter="blur(10px)"
          borderWidth="1px"
          borderColor="rgba(139, 92, 246, 0.3)"
          boxShadow="0 4px 20px rgba(0, 0, 0, 0.3)"
        >
          <CardHeader>
            <Heading
              size="md"
              color="purple.300"
              textShadow="0 0 10px rgba(139, 92, 246, 0.5)"
            >
              About Verimeter Modes
            </Heading>
          </CardHeader>
          <Divider borderColor="rgba(139, 92, 246, 0.2)" />
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Heading size="sm" color="purple.200" mb={2}>
                  AI Mode
                </Heading>
                <Text fontSize="sm" color="gray.300">
                  Scores are calculated exclusively from AI-generated evidence links.
                  The AI analyzes scraped sources and automatically creates evidence
                  relationships with support_level ratings.
                </Text>
              </Box>

              <Box>
                <Heading size="sm" color="blue.200" mb={2}>
                  User Mode
                </Heading>
                <Text fontSize="sm" color="gray.300">
                  Scores are calculated only from human user evaluations and evidence
                  links. This represents the crowd-sourced verification efforts of the
                  TruthTrollers community.
                </Text>
              </Box>

              <Box>
                <Heading size="sm" color="teal.200" mb={2}>
                  Combined Mode (AI + User)
                </Heading>
                <Text fontSize="sm" color="gray.300">
                  Scores blend both AI and user ratings using a weighted average.
                  Adjust the AI weight slider to control how much influence AI has
                  versus human users (50/50 by default).
                </Text>
              </Box>

              <Divider borderColor="rgba(139, 92, 246, 0.2)" />

              <Box>
                <Heading size="sm" color="cyan.200" mb={2}>
                  Technical Details
                </Heading>
                <Text fontSize="sm" color="gray.400">
                  • AI ratings are stored in <code style={{ color: "#60A5FA" }}>claim_links</code> with{" "}
                  <code style={{ color: "#60A5FA" }}>created_by_ai = 1</code>
                  <br />
                  • User ratings have <code style={{ color: "#60A5FA" }}>created_by_ai = 0</code>
                  <br />
                  • Support levels range from -1 (refute) to +1 (support)
                  <br />
                  • Scores are computed server-side via dedicated API endpoints
                </Text>
              </Box>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </Box>
  );
}
