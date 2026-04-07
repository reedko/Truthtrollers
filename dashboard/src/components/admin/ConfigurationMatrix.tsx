import React, { useState, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  useToast,
  Divider,
  Grid,
  Input,
  Button,
  Select,
} from "@chakra-ui/react";
import { FiSave, FiRefreshCw } from "react-icons/fi";
import { api } from "../../services/api";

interface LLMPrompt {
  prompt_id: number;
  prompt_name: string;
  prompt_type: string;
  max_claims?: number;
  min_sources?: number;
  max_sources?: number;
  version: number;
  is_active: boolean;
}

interface EvidenceMode {
  name?: string;
  description: string;
  queriesPerClaim: number;
  maxEvidenceCandidates: number;
  enableFringeSearch?: boolean;
  enableBalancedSearch?: boolean;
  supportQueries?: number;
  refuteQueries?: number;
  nuanceQueries?: number;
  targetSupport?: number;
  targetRefute?: number;
  targetNuance?: number;
  fringeTrigger?: string;
  fringeConfidenceThreshold?: number;
  topKFringeQueries?: number;
  maxFringeEvidenceCandidates?: number;
}

interface ModeConfig {
  high_quality_only: EvidenceMode;
  fringe_on_support: EvidenceMode;
  balanced_all_claims: EvidenceMode;
}

export default function ConfigurationMatrix() {
  const [prompts, setPrompts] = useState<LLMPrompt[]>([]);
  const [evidenceConfig, setEvidenceConfig] = useState<ModeConfig | null>(null);
  const [currentMode, setCurrentMode] = useState<string>("fringe_on_support");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Custom mode builder state
  const [customMode, setCustomMode] = useState({
    extractionMode: "ranked",
    maxClaims: 12,
    minSources: 2,
    maxSources: 4,
    queriesPerClaim: 4,
    maxEvidenceCandidates: 3,
  });

  useEffect(() => {
    loadAllConfig();
  }, []);

  const loadAllConfig = async () => {
    try {
      setLoading(true);
      const [promptsRes, evidenceRes] = await Promise.all([
        api.get("/api/llm-prompts"),
        api.get("/api/evidence-config"),
      ]);

      console.log("Evidence config response:", evidenceRes.data);

      setPrompts(promptsRes.data.prompts || []);
      setCurrentMode(evidenceRes.data.currentMode || "fringe_on_support");

      // Use availableModes from the response
      if (evidenceRes.data.availableModes) {
        console.log("Available modes:", evidenceRes.data.availableModes);
        setEvidenceConfig(evidenceRes.data.availableModes);
      }
    } catch (error) {
      console.error("Failed to load config:", error);
      toast({
        title: "Failed to load configuration",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const getPromptByName = (name: string) => {
    return prompts.find(p => p.prompt_name === name);
  };

  const getModeColor = (modeName: string) => {
    if (modeName === currentMode) return "cyan";
    return "gray";
  };

  const getExtractionModeForEvidence = (evidenceModeName: string) => {
    // All current modes use "ranked" extraction
    return "ranked";
  };

  const getPromptNameForMode = (evidenceModeName: string, extractionMode: string) => {
    // Currently all modes use ranked extraction with no topics
    return "claim_extraction_ranked_no_topics";
  };

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner color="cyan.400" size="xl" />
      </Box>
    );
  }

  return (
    <VStack spacing={6} align="stretch">
      {/* Header */}
      <HStack justify="space-between">
        <VStack align="start" spacing={1}>
          <Text fontSize="xl" fontWeight="bold" color="cyan.300">
            Configuration Matrix
          </Text>
          <Text fontSize="sm" color="gray.400">
            How evidence search modes map to LLM prompts and limits
          </Text>
        </VStack>
        <Button
          leftIcon={<FiRefreshCw />}
          size="sm"
          variant="ghost"
          colorScheme="cyan"
          onClick={loadAllConfig}
        >
          Refresh
        </Button>
      </HStack>

      <Divider borderColor="cyan.700" opacity={0.3} />

      {/* Pipeline Overview */}
      <Box
        bg="linear-gradient(135deg, rgba(0, 162, 255, 0.15), rgba(139, 92, 246, 0.15))"
        borderWidth="2px"
        borderColor="rgba(0, 162, 255, 0.5)"
        borderRadius="lg"
        p={5}
      >
        <VStack spacing={3} align="stretch">
          <HStack>
            <Badge colorScheme="cyan" fontSize="md" px={3} py={1}>
              FACT-CHECKING PIPELINE
            </Badge>
            <Text fontSize="xs" color="gray.400">
              All prompts now database-driven
            </Text>
          </HStack>

          <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={3}>
            <Box
              bg="rgba(239, 68, 68, 0.1)"
              borderWidth="1px"
              borderColor="rgba(239, 68, 68, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="red" fontSize="xs">STEP 1</Badge>
                <Text fontSize="sm" color="red.300" fontWeight="bold">Claim Extraction</Text>
                <Text fontSize="xs" color="gray.400">claim_extraction_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(244, 114, 182, 0.1)"
              borderWidth="1px"
              borderColor="rgba(244, 114, 182, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="pink" fontSize="xs">STEP 2</Badge>
                <Text fontSize="sm" color="pink.300" fontWeight="bold">Claim Properties</Text>
                <Text fontSize="xs" color="gray.400">claim_properties_evaluation_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(234, 179, 8, 0.1)"
              borderWidth="1px"
              borderColor="rgba(234, 179, 8, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="yellow" fontSize="xs">STEP 3</Badge>
                <Text fontSize="sm" color="yellow.300" fontWeight="bold">Query Generation</Text>
                <Text fontSize="xs" color="gray.400">evidence_query_generation_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(16, 185, 129, 0.1)"
              borderWidth="1px"
              borderColor="rgba(16, 185, 129, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="green" fontSize="xs">STEP 4</Badge>
                <Text fontSize="sm" color="green.300" fontWeight="bold">Source Quality</Text>
                <Text fontSize="xs" color="gray.400">source_quality_evaluation_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(168, 85, 247, 0.1)"
              borderWidth="1px"
              borderColor="rgba(168, 85, 247, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="purple" fontSize="xs">STEP 5</Badge>
                <Text fontSize="sm" color="purple.300" fontWeight="bold">Claim Matching</Text>
                <Text fontSize="xs" color="gray.400">claim_matching_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(59, 130, 246, 0.1)"
              borderWidth="1px"
              borderColor="rgba(59, 130, 246, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="blue" fontSize="xs">STEP 6</Badge>
                <Text fontSize="sm" color="blue.300" fontWeight="bold">Relevance Check</Text>
                <Text fontSize="xs" color="gray.400">claim_relevance_assessment_*</Text>
              </VStack>
            </Box>

            <Box
              bg="rgba(251, 146, 60, 0.1)"
              borderWidth="1px"
              borderColor="rgba(251, 146, 60, 0.3)"
              borderRadius="md"
              p={3}
            >
              <VStack align="start" spacing={1}>
                <Badge colorScheme="orange" fontSize="xs">STEP 7</Badge>
                <Text fontSize="sm" color="orange.300" fontWeight="bold">Claim Triage</Text>
                <Text fontSize="xs" color="gray.400">claim_triage_*</Text>
              </VStack>
            </Box>
          </Grid>

          <Divider borderColor="cyan.700" opacity={0.3} />

          <HStack justify="space-between" fontSize="xs" color="gray.400">
            <Text>Total prompts in database: {prompts.length}</Text>
            <Text>Current mode: <Badge colorScheme="cyan" fontSize="xs">{currentMode.replace(/_/g, " ")}</Badge></Text>
          </HStack>
        </VStack>
      </Box>

      {/* Claim Extraction Configuration */}
      <Box
        bg="rgba(139, 92, 246, 0.05)"
        borderWidth="1px"
        borderColor="rgba(139, 92, 246, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(139, 92, 246, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(139, 92, 246, 0.3)"
        >
          <Text fontWeight="bold" color="purple.300" fontSize="lg">
            1. Claim Extraction (Same for All Modes)
          </Text>
        </Box>

        <Box p={4}>
          <Grid templateColumns="repeat(4, 1fr)" gap={4}>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Prompt Used</Text>
              <Text fontSize="xs" fontFamily="monospace" color="purple.300" fontWeight="bold">
                claim_extraction_ranked_no_topics
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Max Claims</Text>
              <Text color="purple.300" fontWeight="bold">
                {prompts.find(p => p.prompt_name === 'claim_extraction_ranked_no_topics')?.max_claims ?? 12}
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Min Sources</Text>
              <Text color="purple.300" fontWeight="bold">
                {prompts.find(p => p.prompt_name === 'claim_extraction_ranked_no_topics')?.min_sources ?? 2}
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Max Sources</Text>
              <Text color="purple.300" fontWeight="bold">
                {prompts.find(p => p.prompt_name === 'claim_extraction_ranked_no_topics')?.max_sources ?? 4}
              </Text>
            </Box>
          </Grid>
        </Box>
      </Box>

      {/* Evidence Query Generation */}
      <Box
        bg="rgba(234, 179, 8, 0.05)"
        borderWidth="1px"
        borderColor="rgba(234, 179, 8, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(234, 179, 8, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(234, 179, 8, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="yellow.300" fontSize="lg">
              2. Evidence Query Generation Prompts (All in Database)
            </Text>
            <Badge colorScheme="green" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="200px">System Prompt (All Modes):</Text>
              <Text fontSize="xs" fontFamily="monospace" color="yellow.300" fontWeight="bold">
                evidence_query_generation_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'evidence_query_generation_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="yellow.700" opacity={0.3} />
            <VStack align="stretch" spacing={2}>
              <Text fontSize="xs" color="yellow.200" fontWeight="bold">User Prompts by Mode:</Text>
              <HStack pl={4}>
                <Badge colorScheme="green" fontSize="xs" minW="150px">High Quality Only</Badge>
                <Text fontSize="xs" fontFamily="monospace" color="yellow.300">
                  evidence_query_generation_user
                </Text>
                {!prompts.find(p => p.prompt_name === 'evidence_query_generation_user') && (
                  <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
                )}
              </HStack>
              <HStack pl={4}>
                <Badge colorScheme="cyan" fontSize="xs" minW="150px">Fringe on Support</Badge>
                <Text fontSize="xs" fontFamily="monospace" color="yellow.300">
                  evidence_query_generation_user
                </Text>
              </HStack>
              <HStack pl={4}>
                <Badge colorScheme="purple" fontSize="xs" minW="150px">Balanced All Claims</Badge>
                <Text fontSize="xs" fontFamily="monospace" color="yellow.300" fontWeight="bold">
                  evidence_query_generation_user_balanced
                </Text>
                {!prompts.find(p => p.prompt_name === 'evidence_query_generation_user_balanced') && (
                  <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
                )}
              </HStack>
            </VStack>
          </VStack>
        </Box>
      </Box>

      {/* Source Quality Evaluation Prompts */}
      <Box
        bg="rgba(16, 185, 129, 0.05)"
        borderWidth="1px"
        borderColor="rgba(16, 185, 129, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(16, 185, 129, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(16, 185, 129, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="green.300" fontSize="lg">
              3. Source Quality Evaluation Prompts
            </Text>
            <Badge colorScheme="green" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="xs" color="gray.400" mb={2}>
              Used by: sourceQualityScorer.js (evaluates evidence source quality 0-10 scale)
            </Text>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">System Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="green.300" fontWeight="bold">
                source_quality_evaluation_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'source_quality_evaluation_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">User Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="green.300" fontWeight="bold">
                source_quality_evaluation_user
              </Text>
              {!prompts.find(p => p.prompt_name === 'source_quality_evaluation_user') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="green.700" opacity={0.3} />
            <Text fontSize="xs" color="gray.400">
              Evaluates 8 dimensions: author_transparency, publisher_transparency, evidence_density,
              claim_specificity, correction_behavior, original_reporting, sensationalism_score, monetization_pressure
            </Text>
          </VStack>
        </Box>
      </Box>

      {/* Claim Properties Evaluation Prompts */}
      <Box
        bg="rgba(244, 114, 182, 0.05)"
        borderWidth="1px"
        borderColor="rgba(244, 114, 182, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(244, 114, 182, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(244, 114, 182, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="pink.300" fontSize="lg">
              4. Claim Properties Evaluation Prompts
            </Text>
            <Badge colorScheme="pink" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="xs" color="gray.400" mb={2}>
              Used by: claimEvaluationClassifier.js (scores claim characteristics 0.00-1.00)
            </Text>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">System Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="pink.300" fontWeight="bold">
                claim_properties_evaluation_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_properties_evaluation_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">User Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="pink.300" fontWeight="bold">
                claim_properties_evaluation_user
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_properties_evaluation_user') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="pink.700" opacity={0.3} />
            <Text fontSize="xs" color="gray.400">
              Evaluates 5 dimensions: claim_centrality, claim_specificity, claim_consequence,
              claim_contestability, claim_novelty
            </Text>
          </VStack>
        </Box>
      </Box>

      {/* Claim Triage Prompts */}
      <Box
        bg="rgba(251, 146, 60, 0.05)"
        borderWidth="1px"
        borderColor="rgba(251, 146, 60, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(251, 146, 60, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(251, 146, 60, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="orange.300" fontSize="lg">
              5. Claim Triage Prompts
            </Text>
            <Badge colorScheme="orange" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="xs" color="gray.400" mb={2}>
              Used by: claimTriageEngine.js (determines if claim is worth evaluating)
            </Text>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">System Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="orange.300" fontWeight="bold">
                claim_triage_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_triage_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">User Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="orange.300" fontWeight="bold">
                claim_triage_user
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_triage_user') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="orange.700" opacity={0.3} />
            <Text fontSize="xs" color="gray.400">
              Triage options: ACTIVE_EVALUATION, BACKGROUND_CLAIM, INSUFFICIENT_RELEVANT_SOURCES,
              NEEDS_REWRITE_FOR_RETRIEVAL, NOVEL_BUT_IMPORTANT, LOW_PRIORITY
            </Text>
          </VStack>
        </Box>
      </Box>

      {/* Claim Matching Prompts */}
      <Box
        bg="rgba(168, 85, 247, 0.05)"
        borderWidth="1px"
        borderColor="rgba(168, 85, 247, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(168, 85, 247, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(168, 85, 247, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="purple.300" fontSize="lg">
              6. Claim Matching Prompts
            </Text>
            <Badge colorScheme="purple" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="xs" color="gray.400" mb={2}>
              Used by: matchClaims.js (matches reference claims to task claims)
            </Text>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">System Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="purple.300" fontWeight="bold">
                claim_matching_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_matching_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">User Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="purple.300" fontWeight="bold">
                claim_matching_user
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_matching_user') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="purple.700" opacity={0.3} />
            <Text fontSize="xs" color="gray.400">
              Returns: stance (support/refute/nuance/insufficient), veracity (0-1), confidence (0.15-0.98),
              support_level (-1.2 to +1.2)
            </Text>
          </VStack>
        </Box>
      </Box>

      {/* Claim Relevance Assessment Prompts */}
      <Box
        bg="rgba(59, 130, 246, 0.05)"
        borderWidth="1px"
        borderColor="rgba(59, 130, 246, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(59, 130, 246, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(59, 130, 246, 0.3)"
        >
          <HStack justify="space-between">
            <Text fontWeight="bold" color="blue.300" fontSize="lg">
              7. Claim Relevance Assessment Prompts
            </Text>
            <Badge colorScheme="blue" fontSize="xs">
              Database-Driven
            </Badge>
          </HStack>
        </Box>

        <Box p={4}>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="xs" color="gray.400" mb={2}>
              Used by: assessClaimRelevance.js (lightweight relevance check)
            </Text>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">System Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="blue.300" fontWeight="bold">
                claim_relevance_assessment_system
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_relevance_assessment_system') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <HStack>
              <Text fontSize="xs" color="gray.400" minW="120px">User Prompt:</Text>
              <Text fontSize="xs" fontFamily="monospace" color="blue.300" fontWeight="bold">
                claim_relevance_assessment_user
              </Text>
              {!prompts.find(p => p.prompt_name === 'claim_relevance_assessment_user') && (
                <Badge colorScheme="red" fontSize="xs">MISSING IN DB</Badge>
              )}
            </HStack>
            <Divider borderColor="blue.700" opacity={0.3} />
            <Text fontSize="xs" color="gray.400">
              Returns: stance (support/refute/nuance/insufficient), confidence (0-1), quality (0-1.2),
              rationale
            </Text>
          </VStack>
        </Box>
      </Box>

      {/* Evidence Search Modes - Detailed Breakdown */}
      <Box
        bg="rgba(0, 162, 255, 0.05)"
        borderWidth="1px"
        borderColor="rgba(0, 162, 255, 0.3)"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          bg="rgba(0, 162, 255, 0.1)"
          px={4}
          py={2}
          borderBottom="1px solid"
          borderColor="rgba(0, 162, 255, 0.3)"
        >
          <Text fontWeight="bold" color="cyan.300" fontSize="lg">
            8. Evidence Search Mode Configurations
          </Text>
        </Box>

        <Box
          className="mr-card mr-card-blue"
          position="relative"
          overflow="hidden"
          overflowX="auto"
        >
          <div className="mr-glow-bar mr-glow-bar-blue" />
          <div className="mr-scanlines" />
          <Table variant="simple" size="sm">
            <Thead>
              <Tr bg="rgba(0, 162, 255, 0.08)">
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Mode</Th>
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Query Strategy</Th>
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Queries/Claim</Th>
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Max Evidence</Th>
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Fringe Search</Th>
                <Th color="cyan.400" borderColor="rgba(0, 162, 255, 0.2)">Search Engines</Th>
              </Tr>
            </Thead>
            <Tbody>
              {!evidenceConfig ? (
                <Tr>
                  <Td colSpan={6} textAlign="center" py={8} color="gray.500">
                    No evidence mode configuration found
                  </Td>
                </Tr>
              ) : Object.entries(evidenceConfig).length === 0 ? (
                <Tr>
                  <Td colSpan={6} textAlign="center" py={8} color="gray.500">
                    Evidence config is empty
                  </Td>
                </Tr>
              ) : (
                Object.entries(evidenceConfig).map(([modeName, modeSettings]) => {
                  const isActive = modeName === currentMode;

                  return (
                    <Tr
                      key={modeName}
                      bg={isActive ? "rgba(0, 162, 255, 0.08)" : "transparent"}
                      _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}
                      borderColor="rgba(0, 162, 255, 0.1)"
                    >
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        <VStack align="start" spacing={1}>
                          <HStack>
                            <Badge colorScheme={getModeColor(modeName)} fontSize="xs">
                              {modeName.replace(/_/g, " ")}
                            </Badge>
                            {isActive && (
                              <Badge colorScheme="green" fontSize="xs">ACTIVE</Badge>
                            )}
                          </HStack>
                        </VStack>
                      </Td>
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        <VStack align="start" spacing={1}>
                          {modeSettings.enableBalancedSearch ? (
                            <>
                              <Text fontSize="xs" color="green.300" fontWeight="bold">BALANCED</Text>
                              <Text fontSize="xs" color="gray.400">
                                {modeSettings.supportQueries || 0} support, {modeSettings.refuteQueries || 0} refute, {modeSettings.nuanceQueries || 0} nuance
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text fontSize="xs" color="cyan.300" fontWeight="bold">STANDARD</Text>
                              <Text fontSize="xs" color="gray.400">
                                ≥2 support, ≥2 refute, ≥1 nuance
                              </Text>
                            </>
                          )}
                        </VStack>
                      </Td>
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        <Text color="cyan.300" fontWeight="bold">{modeSettings.queriesPerClaim ?? "N/A"}</Text>
                      </Td>
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        <Text color="cyan.300" fontWeight="bold">{modeSettings.maxEvidenceCandidates ?? "N/A"}</Text>
                      </Td>
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        {modeSettings.enableFringeSearch ? (
                          <VStack align="start" spacing={1}>
                            <Badge colorScheme="orange" fontSize="xs">ENABLED</Badge>
                            <Text fontSize="xs" color="gray.400">
                              Trigger: {modeSettings.fringeTrigger || 'support'} &gt; {(modeSettings.fringeConfidenceThreshold || 0.7) * 100}%
                            </Text>
                            <Text fontSize="xs" color="gray.400">
                              +{modeSettings.topKFringeQueries || 3} queries, {modeSettings.maxFringeEvidenceCandidates || 2} sources
                            </Text>
                          </VStack>
                        ) : (
                          <Badge colorScheme="gray" fontSize="xs">DISABLED</Badge>
                        )}
                      </Td>
                      <Td borderColor="rgba(0, 162, 255, 0.1)">
                        <VStack align="start" spacing={1}>
                          <Text fontSize="xs" color="green.300">Tavily + Bing</Text>
                          {modeSettings.enableFringeSearch && (
                            <Text fontSize="xs" color="orange.300">+ DuckDuckGo (fringe)</Text>
                          )}
                        </VStack>
                      </Td>
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>
        </Box>
      </Box>

      {/* Custom Mode Builder */}
      <Box
        bg="linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1))"
        borderWidth="1px"
        borderColor="rgba(139, 92, 246, 0.4)"
        borderRadius="md"
        p={5}
      >
        <VStack spacing={4} align="stretch">
          <HStack justify="space-between">
            <VStack align="start" spacing={1}>
              <Text fontSize="lg" fontWeight="bold" color="purple.300">
                Custom Mode Builder
              </Text>
              <Text fontSize="xs" color="gray.400">
                Configure a one-time scrape with custom parameters (not saved)
              </Text>
            </VStack>
            <Badge colorScheme="purple" fontSize="sm" px={3} py={1}>
              Coming Soon
            </Badge>
          </HStack>

          <Grid templateColumns="repeat(3, 1fr)" gap={4}>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Extraction Mode</Text>
              <Select
                value={customMode.extractionMode}
                onChange={(e) => setCustomMode({ ...customMode, extractionMode: e.target.value })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              >
                <option value="ranked">Ranked (Top Quality)</option>
                <option value="comprehensive">Comprehensive (All Claims)</option>
              </Select>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Max Claims</Text>
              <Input
                type="number"
                value={customMode.maxClaims}
                onChange={(e) => setCustomMode({ ...customMode, maxClaims: parseInt(e.target.value) })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              />
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Queries Per Claim</Text>
              <Input
                type="number"
                value={customMode.queriesPerClaim}
                onChange={(e) => setCustomMode({ ...customMode, queriesPerClaim: parseInt(e.target.value) })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              />
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Min Sources</Text>
              <Input
                type="number"
                value={customMode.minSources}
                onChange={(e) => setCustomMode({ ...customMode, minSources: parseInt(e.target.value) })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              />
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Max Sources</Text>
              <Input
                type="number"
                value={customMode.maxSources}
                onChange={(e) => setCustomMode({ ...customMode, maxSources: parseInt(e.target.value) })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              />
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Max Evidence Candidates</Text>
              <Input
                type="number"
                value={customMode.maxEvidenceCandidates}
                onChange={(e) => setCustomMode({ ...customMode, maxEvidenceCandidates: parseInt(e.target.value) })}
                size="sm"
                bg="rgba(0, 0, 0, 0.3)"
                borderColor="purple.600"
                isDisabled
              />
            </Box>
          </Grid>

          <HStack justify="flex-end">
            <Button
              size="sm"
              colorScheme="purple"
              leftIcon={<FiSave />}
              isDisabled
            >
              Apply to Next Scrape
            </Button>
          </HStack>

          <Text fontSize="xs" color="gray.500" fontStyle="italic">
            Note: Custom mode will allow you to override all parameters for a single scrape operation.
            This feature requires backend API updates to accept per-request configuration.
          </Text>
        </VStack>
      </Box>

      {/* Legend */}
      <Box
        p={4}
        bg="rgba(0, 0, 0, 0.2)"
        borderRadius="md"
        borderWidth="1px"
        borderColor="gray.700"
      >
        <Text fontSize="sm" fontWeight="bold" color="gray.300" mb={2}>
          Configuration Flow:
        </Text>
        <VStack align="start" spacing={1} fontSize="xs" color="gray.400">
          <Text>1. <strong>Evidence Mode</strong> is selected in tab 1 (determines search strategy)</Text>
          <Text>2. <strong>Extraction Mode</strong> determines which prompt set to use (ranked vs comprehensive)</Text>
          <Text>3. <strong>Prompt</strong> contains max_claims, min_sources, max_sources for claim extraction</Text>
          <Text>4. <strong>Queries/Claim & Max Evidence</strong> from evidence mode config control how many sources to fetch</Text>
          <Text>5. All parameters combine to control scraping behavior</Text>
        </VStack>
      </Box>
    </VStack>
  );
}
