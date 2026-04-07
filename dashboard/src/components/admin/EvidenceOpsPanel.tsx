import React, { useState, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Select,
  Spinner,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
} from "@chakra-ui/react";
import { api } from "../../services/api";
import LLMPromptsEditor from "./LLMPromptsEditor";
import ConfigurationMatrix from "./ConfigurationMatrix";
import AdvancedPromptEditor from "./AdvancedPromptEditor";

export default function EvidenceOpsPanel() {
  const [evidenceMode, setEvidenceMode] = useState<string>("fringe_on_support");
  const [evidenceModeLoading, setEvidenceModeLoading] = useState(false);
  const [extractionMode, setExtractionMode] = useState<string>("edge");
  const [extractionModeLoading, setExtractionModeLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadEvidenceConfig();
    loadExtractionConfig();
  }, []);

  const loadEvidenceConfig = async () => {
    try {
      const response = await api.get("/api/evidence-config");
      const mode = response.data.currentMode || "fringe_on_support";
      setEvidenceMode(mode);
    } catch (error) {
      console.error("Failed to load evidence config:", error);
    }
  };

  const loadExtractionConfig = async () => {
    try {
      const response = await api.get("/api/extraction-mode/default");
      const mode = response.data.defaultMode || "edge";
      setExtractionMode(mode);
    } catch (error) {
      console.error("Failed to load extraction config:", error);
    }
  };

  const handleEvidenceModeChange = async (newMode: string) => {
    try {
      setEvidenceModeLoading(true);
      const response = await api.put("/api/evidence-config/mode", { mode: newMode });
      const confirmedMode = response.data.mode || newMode;
      setEvidenceMode(confirmedMode);

      toast({
        title: "Evidence Search Mode Updated",
        description: `Mode changed to: ${newMode.replace(/_/g, ' ')}`,
        status: "success",
        duration: 3000,
      });
    } catch (error: any) {
      console.error("Failed to update evidence mode:", error);
      await loadEvidenceConfig();

      toast({
        title: "Failed to update mode",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 5000,
      });
    } finally {
      setEvidenceModeLoading(false);
    }
  };

  const handleExtractionModeChange = async (newMode: string) => {
    try {
      setExtractionModeLoading(true);
      const response = await api.put("/api/extraction-mode/default", { extractionMode: newMode });
      const confirmedMode = response.data.defaultMode || newMode;
      setExtractionMode(confirmedMode);

      toast({
        title: "Claim Extraction Mode Updated",
        description: `Mode changed to: ${newMode}`,
        status: "success",
        duration: 3000,
      });
    } catch (error: any) {
      console.error("Failed to update extraction mode:", error);
      await loadExtractionConfig();

      toast({
        title: "Failed to update mode",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 5000,
      });
    } finally {
      setExtractionModeLoading(false);
    }
  };

  return (
    <Box
      bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
      backdropFilter="blur(20px)"
      borderWidth="1px"
      borderColor="rgba(0, 162, 255, 0.4)"
      borderRadius="12px"
      p={6}
      position="relative"
      overflow="hidden"
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.2)"
    >
      {/* Scanline overlay */}
      <Box
        position="absolute"
        inset="0"
        bgImage="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        zIndex={0}
      />

      <VStack spacing={6} align="stretch" position="relative" zIndex={1}>
        {/* Header */}
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <Text fontSize="2xl" fontWeight="bold" color="cyan.300" textShadow="0 0 10px rgba(0, 162, 255, 0.5)">
              Evidence Operations
            </Text>
            <Text fontSize="sm" color="gray.400">
              Configure evidence search modes and LLM prompts
            </Text>
          </VStack>
        </HStack>

        <Divider borderColor="cyan.700" opacity={0.3} />

        {/* Tabs for Evidence Config and LLM Prompts */}
        <Tabs variant="soft-rounded" colorScheme="cyan">
          <TabList>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }}>
              Evidence Search Modes
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }}>
              Prompt Editor
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }}>
              Configuration Matrix
            </Tab>
          </TabList>

          <TabPanels>
            {/* Evidence Search Modes Tab */}
            <TabPanel px={0}>
              <VStack spacing={6} align="stretch">
                {/* Mode Selector */}
                <Box>
                  <Text fontWeight="bold" mb={3} color="cyan.300">
                    Current Search Mode:
                  </Text>
                  <Select
                    value={evidenceMode}
                    onChange={(e) => handleEvidenceModeChange(e.target.value)}
                    isDisabled={evidenceModeLoading}
                    bg="rgba(0, 0, 0, 0.4)"
                    borderColor="cyan.500"
                    size="lg"
                    color="gray.100"
                    _hover={{ borderColor: "cyan.400" }}
                    _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
                  >
                    <option value="high_quality_only" style={{ background: "#1a202c" }}>
                      Mode 1: High Quality Only (Fastest)
                    </option>
                    <option value="fringe_on_support" style={{ background: "#1a202c" }}>
                      Mode 2: Fringe on Support (Balanced - Default)
                    </option>
                    <option value="balanced_all_claims" style={{ background: "#1a202c" }}>
                      Mode 3: Balanced All Claims (Most Thorough)
                    </option>
                  </Select>
                </Box>

                {/* Mode Descriptions */}
                <Box
                  p={5}
                  bg="rgba(0, 162, 255, 0.05)"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="rgba(0, 162, 255, 0.3)"
                >
                  <VStack align="start" spacing={5}>
                    <Text fontWeight="bold" color="cyan.300" fontSize="lg">Mode Details:</Text>

                    <Box
                      pl={4}
                      borderLeft="3px solid"
                      borderColor="green.500"
                      bg="rgba(74, 222, 128, 0.05)"
                      p={3}
                      borderRadius="md"
                    >
                      <Text fontWeight="semibold" color="green.300" mb={2}>Mode 1: High Quality Only</Text>
                      <Text fontSize="sm" color="gray.300" mb={2}>
                        <strong>Best for:</strong> Fast, reliable fact-checking from authoritative sources
                      </Text>
                      <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                        <Text>• <strong>Sources:</strong> Tavily + Bing only (curated high-quality)</Text>
                        <Text>• <strong>Queries:</strong> 4 per claim</Text>
                        <Text>• <strong>Max sources:</strong> 3 evidence candidates per claim</Text>
                        <Text>• <strong>Speed:</strong> Fastest mode</Text>
                        <Text>• <strong>Use case:</strong> Quick verification from mainstream/authoritative sources</Text>
                      </VStack>
                    </Box>

                    <Box
                      pl={4}
                      borderLeft="3px solid"
                      borderColor="cyan.500"
                      bg="rgba(0, 162, 255, 0.05)"
                      p={3}
                      borderRadius="md"
                    >
                      <Text fontWeight="semibold" color="cyan.300" mb={2}>Mode 2: Fringe on Support (Default)</Text>
                      <Text fontSize="sm" color="gray.300" mb={2}>
                        <strong>Best for:</strong> Finding counter-evidence when mainstream sources agree
                      </Text>
                      <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                        <Text>• <strong>Sources:</strong> Tavily + Bing, then alternative sources when triggered</Text>
                        <Text>• <strong>Queries:</strong> 4 per claim (+ 2 fringe if triggered)</Text>
                        <Text>• <strong>Max sources:</strong> 3 high-quality (+ 2 fringe if triggered)</Text>
                        <Text>• <strong>Trigger:</strong> When support confidence {">"} 70%, search fringe sources</Text>
                        <Text>• <strong>Speed:</strong> Medium</Text>
                        <Text>• <strong>Use case:</strong> Balance speed with finding dissenting opinions</Text>
                      </VStack>
                    </Box>

                    <Box
                      pl={4}
                      borderLeft="3px solid"
                      borderColor="purple.500"
                      bg="rgba(167, 139, 250, 0.05)"
                      p={3}
                      borderRadius="md"
                    >
                      <Text fontWeight="semibold" color="purple.300" mb={2}>Mode 3: Balanced All Claims</Text>
                      <Text fontSize="sm" color="gray.300" mb={2}>
                        <strong>Best for:</strong> Deep investigation with diverse perspectives
                      </Text>
                      <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                        <Text>• <strong>Sources:</strong> Tavily + Bing with balanced query strategies</Text>
                        <Text>• <strong>Queries:</strong> 6 per claim (2 support + 2 refute + 2 nuance)</Text>
                        <Text>• <strong>Max sources:</strong> 6 evidence candidates per claim</Text>
                        <Text>• <strong>Balance:</strong> Actively seeks supporting, refuting, and contextual evidence</Text>
                        <Text>• <strong>Speed:</strong> Slowest, most comprehensive</Text>
                        <Text>• <strong>Use case:</strong> Thorough fact-checking requiring multiple viewpoints</Text>
                      </VStack>
                    </Box>
                  </VStack>
                </Box>

                {/* Performance Note */}
                <Box
                  p={4}
                  bg="rgba(251, 191, 36, 0.1)"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="yellow.700"
                >
                  <Text fontSize="sm" color="yellow.200">
                    <strong>Performance Note:</strong> More queries = slower scraping but better evidence coverage.
                    Adjust based on your priorities: speed vs. thoroughness.
                  </Text>
                </Box>

                {evidenceModeLoading && (
                  <Box textAlign="center">
                    <Spinner color="cyan.400" />
                  </Box>
                )}

                <Divider borderColor="cyan.700" opacity={0.3} my={6} />

                {/* Claim Extraction Mode Section */}
                <Box>
                  <Text fontSize="xl" fontWeight="bold" mb={4} color="cyan.300" textShadow="0 0 10px rgba(0, 162, 255, 0.5)">
                    Claim Extraction Mode
                  </Text>
                  <Text fontSize="sm" color="gray.400" mb={4}>
                    Controls how claims are extracted from content and evidence sources
                  </Text>

                  {/* Extraction Mode Selector */}
                  <Box mb={6}>
                    <Text fontWeight="bold" mb={3} color="cyan.300">
                      Current Extraction Mode:
                    </Text>
                    <Select
                      value={extractionMode}
                      onChange={(e) => handleExtractionModeChange(e.target.value)}
                      isDisabled={extractionModeLoading}
                      bg="rgba(0, 0, 0, 0.4)"
                      borderColor="cyan.500"
                      size="lg"
                      color="gray.100"
                      _hover={{ borderColor: "cyan.400" }}
                      _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
                    >
                      <option value="edge" style={{ background: "#1a202c" }}>
                        Edge: Thematic Extraction (Default - Recommended)
                      </option>
                      <option value="ranked" style={{ background: "#1a202c" }}>
                        Ranked: Material-First Extraction
                      </option>
                      <option value="comprehensive" style={{ background: "#1a202c" }}>
                        Comprehensive: Cast Wide Net
                      </option>
                    </Select>
                  </Box>

                  {/* Extraction Mode Descriptions */}
                  <Box
                    p={5}
                    bg="rgba(0, 162, 255, 0.05)"
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor="rgba(0, 162, 255, 0.3)"
                  >
                    <VStack align="start" spacing={5}>
                      <Text fontWeight="bold" color="cyan.300" fontSize="lg">Extraction Mode Details:</Text>

                      <Box
                        pl={4}
                        borderLeft="3px solid"
                        borderColor="cyan.500"
                        bg="rgba(0, 162, 255, 0.05)"
                        p={3}
                        borderRadius="md"
                      >
                        <Text fontWeight="semibold" color="cyan.300" mb={2}>Edge: Thematic Extraction (Default)</Text>
                        <Text fontSize="sm" color="gray.300" mb={2}>
                          <strong>Best for:</strong> Extracting claims central to articles and matching source claim language to case claims
                        </Text>
                        <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                          <Text>• <strong>For Case Claims:</strong> Identifies core thesis, extracts thematically central claims only</Text>
                          <Text>• <strong>For Source Claims:</strong> Mirrors case claim language, ensures instant relationship clarity</Text>
                          <Text>• <strong>Ranking:</strong> Thematic centrality → Controversy → Specificity</Text>
                          <Text>• <strong>Quality:</strong> Highest - filters out tangential claims</Text>
                          <Text>• <strong>Context-Aware:</strong> Source extraction receives case claim for better matching</Text>
                          <Text>• <strong>Use case:</strong> When you want claims "halfway to the rationale" - instantly recognizable relationships</Text>
                        </VStack>
                      </Box>

                      <Box
                        pl={4}
                        borderLeft="3px solid"
                        borderColor="purple.500"
                        bg="rgba(167, 139, 250, 0.05)"
                        p={3}
                        borderRadius="md"
                      >
                        <Text fontWeight="semibold" color="purple.300" mb={2}>Ranked: Material-First Extraction</Text>
                        <Text fontSize="sm" color="gray.300" mb={2}>
                          <strong>Best for:</strong> Traditional fact-checking prioritizing importance
                        </Text>
                        <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                          <Text>• <strong>Ranking:</strong> Materiality → Controversy → Specificity</Text>
                          <Text>• <strong>Quality:</strong> High - focuses on central and controversial claims</Text>
                          <Text>• <strong>Claims:</strong> 3-9 claims, atomic extraction</Text>
                          <Text>• <strong>Use case:</strong> Standard fact-checking without thematic filtering</Text>
                        </VStack>
                      </Box>

                      <Box
                        pl={4}
                        borderLeft="3px solid"
                        borderColor="green.500"
                        bg="rgba(74, 222, 128, 0.05)"
                        p={3}
                        borderRadius="md"
                      >
                        <Text fontWeight="semibold" color="green.300" mb={2}>Comprehensive: Cast Wide Net</Text>
                        <Text fontSize="sm" color="gray.300" mb={2}>
                          <strong>Best for:</strong> Research mode - extract everything verifiable
                        </Text>
                        <VStack align="start" fontSize="xs" color="gray.400" spacing={1}>
                          <Text>• <strong>Claims:</strong> 5-12 claims, maximum extraction</Text>
                          <Text>• <strong>Quality:</strong> Medium - includes more background claims</Text>
                          <Text>• <strong>Filtering:</strong> Minimal - extracts all falsifiable claims</Text>
                          <Text>• <strong>Use case:</strong> When you need comprehensive claim coverage</Text>
                        </VStack>
                      </Box>
                    </VStack>
                  </Box>

                  {/* Extraction Mode Note */}
                  <Box
                    p={4}
                    mt={4}
                    bg="rgba(34, 197, 94, 0.1)"
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor="green.700"
                  >
                    <Text fontSize="sm" color="green.200">
                      <strong>💡 Recommendation:</strong> Use <strong>Edge mode</strong> for the best claim quality.
                      It extracts thematically central claims and ensures source claims match case claim terminology,
                      making relationships instantly clear.
                    </Text>
                  </Box>

                  {extractionModeLoading && (
                    <Box textAlign="center" mt={4}>
                      <Spinner color="cyan.400" />
                    </Box>
                  )}
                </Box>
              </VStack>
            </TabPanel>

            {/* Advanced Prompt Editor Tab */}
            <TabPanel px={0}>
              <AdvancedPromptEditor />
            </TabPanel>

            {/* Configuration Matrix Tab */}
            <TabPanel px={0}>
              <ConfigurationMatrix />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </VStack>
    </Box>
  );
}
