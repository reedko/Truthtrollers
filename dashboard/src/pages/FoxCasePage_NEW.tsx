import React, { useState, useEffect } from "react";
import {
  Box,
  Flex,
  Text,
  Button,
  VStack,
  HStack,
  Grid,
  Badge,
  useToast,
  Spinner,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { fetchReferenceClaimTaskLinks } from "../services/referenceClaimRelevance";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface FocusClaim {
  claim_id: number;
  claim_text: string;
  claim_type: "case" | "evidence";
  verimeter_score?: number;
  support_count: number;
  refute_count: number;
  context_count: number;
  evidence_count: number;
  stance_distribution: {
    support: number;
    refute: number;
    context: number;
  };
}

interface CandidateClaim {
  claim_id: number;
  claim_text: string;
  source_name: string;
  source_url?: string;
  relevance_score: number;
  claim_type: "evidence";
  reference_content_id: number;
  source_claim_id: number;
  source_reliability?: number;
  ai_confidence?: number;
  ai_stance?: string;
  ai_support_level?: number;
  ai_rationale?: string;
}

// Curved edge component
const CurvedEdge = () => (
  <Box
    position="absolute"
    left="-10px"
    top="18px"
    bottom="18px"
    w="22px"
    borderRadius="18px"
    bgGradient="linear(180deg, rgba(113, 219, 255, 0.35), rgba(167, 150, 255, 0.28) 46%, rgba(97, 239, 184, 0.28))"
    boxShadow="0 0 24px rgba(113, 219, 255, 0.22)"
    filter="blur(0.5px)"
    pointerEvents="none"
  />
);

export const FoxCasePage: React.FC = () => {
  const { selectedTask } = useTaskStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const toast = useToast();

  const [focusClaim, setFocusClaim] = useState<FocusClaim | null>(null);
  const [candidates, setCandidates] = useState<CandidateClaim[]>([]);
  const [currentCandidateIndex, setCurrentCandidateIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [availableCaseClaims, setAvailableCaseClaims] = useState<any[]>([]);

  useEffect(() => {
    if (selectedTask?.content_id) {
      loadAvailableCaseClaims();
    }
  }, [selectedTask?.content_id]);

  const loadAvailableCaseClaims = async () => {
    if (!selectedTask?.content_id) {
      console.log("⚠️ No case selected, cannot load claims");
      return;
    }

    console.log("📋 Loading case claims for case:", selectedTask.content_id);
    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/case-claim-expansion/${selectedTask.content_id}`,
      );

      if (!response.ok) {
        throw new Error("Failed to load case claims");
      }

      const data = await response.json();
      setAvailableCaseClaims(data.caseClaims || []);

      if (data.caseClaims && data.caseClaims.length > 0) {
        await loadFocusClaim(data.caseClaims[0].claim_id);
      }
    } catch (error) {
      console.error("❌ Error loading case claims:", error);
      toast({
        title: "Error loading claims",
        description: "Could not load case claims",
        status: "error",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadFocusClaim = async (claimId: number) => {
    if (!selectedTask?.content_id) return;

    setIsLoading(true);
    try {
      const linkedResponse = await fetch(
        `${API_BASE_URL}/api/linked-claims-for-claim/${claimId}`,
      );
      const linkedClaims = linkedResponse.ok ? await linkedResponse.json() : [];

      const supportCount = linkedClaims.filter(
        (lc: any) =>
          lc.relation === "support" || lc.relationship === "supports",
      ).length;
      const refuteCount = linkedClaims.filter(
        (lc: any) => lc.relation === "refute" || lc.relationship === "refutes",
      ).length;
      const contextCount = linkedClaims.filter(
        (lc: any) =>
          lc.relation === "nuance" ||
          lc.relation === "context" ||
          lc.relationship === "related",
      ).length;
      const total = supportCount + refuteCount + contextCount || 1;

      const claimData = availableCaseClaims.find((c) => c.claim_id === claimId);

      const focus: FocusClaim = {
        claim_id: claimId,
        claim_text: claimData?.label || "Loading...",
        claim_type: "case",
        verimeter_score: 50,
        support_count: supportCount,
        refute_count: refuteCount,
        context_count: contextCount,
        evidence_count: linkedClaims.length || 0,
        stance_distribution: {
          support: Math.round((supportCount / total) * 100),
          refute: Math.round((refuteCount / total) * 100),
          context: Math.round((contextCount / total) * 100),
        },
      };

      setFocusClaim(focus);
      await loadCandidates(claimId);
    } catch (error) {
      console.error("Error loading focus claim:", error);
      toast({
        title: "Error loading claim",
        description: "Failed to load claim details",
        status: "error",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadCandidates = async (focusClaimId: number) => {
    if (!selectedTask?.content_id || !user?.user_id) return;

    try {
      const refsResponse = await fetch(
        `${API_BASE_URL}/api/content/${selectedTask.content_id}/references-with-claims?viewerId=${user.user_id}`,
      );

      if (!refsResponse.ok) {
        throw new Error("Failed to load references");
      }

      const references = await refsResponse.json();
      const existingLinks = await fetchReferenceClaimTaskLinks(focusClaimId);

      const allCandidates: CandidateClaim[] = [];

      for (const ref of references) {
        const refClaims = Array.isArray(ref.claims)
          ? ref.claims
          : typeof ref.claims === "string"
            ? JSON.parse(ref.claims)
            : [];

        for (const claim of refClaims) {
          const existingLink = existingLinks.find(
            (link: any) => link.reference_claim_id === claim.claim_id,
          );

          allCandidates.push({
            claim_id: focusClaimId,
            claim_text: claim.claim_text,
            source_name: ref.content_name,
            source_url: ref.url,
            relevance_score: existingLink?.score || 0,
            claim_type: "evidence",
            reference_content_id: ref.reference_content_id,
            source_claim_id: claim.claim_id,
            ai_confidence: existingLink?.confidence,
            ai_stance: existingLink?.stance,
            ai_support_level: existingLink?.support_level,
            ai_rationale: existingLink?.rationale,
          });
        }
      }

      const filteredCandidates = allCandidates.filter(
        (c) => c.relevance_score > 0,
      );

      const relevantCandidates = filteredCandidates.sort(
        (a, b) => b.relevance_score - a.relevance_score,
      );

      setCandidates(relevantCandidates);
      setCurrentCandidateIndex(0);
    } catch (error) {
      console.error("Error loading candidates:", error);
    }
  };

  const handleNextClaim = () => {
    const currentIndex = availableCaseClaims.findIndex(
      (c) => c.claim_id === focusClaim?.claim_id,
    );
    if (currentIndex < availableCaseClaims.length - 1) {
      loadFocusClaim(availableCaseClaims[currentIndex + 1].claim_id);
    }
  };

  const handlePreviousClaim = () => {
    const currentIndex = availableCaseClaims.findIndex(
      (c) => c.claim_id === focusClaim?.claim_id,
    );
    if (currentIndex > 0) {
      loadFocusClaim(availableCaseClaims[currentIndex - 1].claim_id);
    }
  };

  if (isLoading) {
    return (
      <Flex h="100vh" align="center" justify="center">
        <Spinner size="xl" color="cyan.400" thickness="4px" />
      </Flex>
    );
  }

  if (!selectedTask) {
    return (
      <Flex
        h="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Text color="gray.400" fontSize="lg">
          No case selected
        </Text>
        <Button onClick={() => navigate("/tasks")} colorScheme="cyan">
          Select a Case
        </Button>
      </Flex>
    );
  }

  if (!focusClaim) {
    return (
      <Flex h="100vh" align="center" justify="center">
        <Text color="gray.400">No claim data available</Text>
      </Flex>
    );
  }

  const verimeterScore = focusClaim.verimeter_score || 50;

  return (
    <Box minH="100vh" position="relative" overflow="hidden">
      {/* Dramatic Radial Glow Background */}
      <Box
        position="fixed"
        inset="0"
        bgGradient="radial-gradient(circle at 30% 40%, rgba(113, 219, 255, 0.15), transparent 50%), radial-gradient(circle at 70% 60%, rgba(97, 239, 184, 0.12), transparent 45%), radial-gradient(circle at 50% 50%, rgba(167, 150, 255, 0.08), transparent 60%)"
        pointerEvents="none"
      />

      {/* Main Content */}
      <VStack spacing={8} p={8} position="relative" zIndex={1}>
        {/* Main Workspace - 3 columns */}
        <Grid
          templateColumns="420px 1fr 360px"
          gap={8}
          w="full"
          alignItems="start"
        >
          {/* Left: Case Claim Focus */}
          <Box position="relative">
            <CurvedEdge />
            <Box
              bg="rgba(15, 28, 46, 0.18)"
              borderRadius="28px"
              border="1px solid rgba(126, 207, 255, 0.18)"
              backdropFilter="blur(24px)"
              p={8}
              position="relative"
            >
              <VStack align="stretch" spacing={6}>
                {/* Header with Verimeter Progress Bar */}
                <Flex justify="space-between" align="center">
                  <Button
                    variant="ghost"
                    color="#e4f4ff"
                    fontSize="18px"
                    fontWeight="760"
                    onClick={handleNextClaim}
                    _hover={{ color: "#71dbff" }}
                  >
                    Case Claim Focus
                  </Button>

                  {/* Verimeter Score Progress */}
                  <HStack spacing={2}>
                    <Text fontSize="11px" color="#89a9bf">VERIMETER</Text>
                    <Box w="100px" h="6px" bg="rgba(255,255,255,0.05)" borderRadius="full" overflow="hidden">
                      <Box
                        h="full"
                        w={`${verimeterScore}%`}
                        bgGradient="linear(90deg, #61efb8, #71dbff)"
                        boxShadow="0 0 12px rgba(97, 239, 184, 0.3)"
                      />
                    </Box>
                    <Text fontSize="13px" fontWeight="bold" color="#61efb8">{verimeterScore}%</Text>
                  </HStack>
                </Flex>

                {/* Progress through claims */}
                <HStack spacing={2} fontSize="13px" color="#89a9bf">
                  <Text>
                    Claim {availableCaseClaims.findIndex((c) => c.claim_id === focusClaim?.claim_id) + 1} of {availableCaseClaims.length}
                  </Text>
                </HStack>

                {/* Claim Text */}
                <Text
                  fontSize="24px"
                  lineHeight="1.3"
                  fontWeight="690"
                  color="#e4f4ff"
                >
                  {focusClaim.claim_text}
                </Text>

                {/* Badges Row */}
                <HStack spacing={3}>
                  <Badge
                    px={4}
                    py={2}
                    borderRadius="12px"
                    bg="rgba(97, 239, 184, 0.08)"
                    border="1px solid rgba(97, 239, 184, 0.2)"
                    color="#61efb8"
                    fontSize="16px"
                    fontWeight="bold"
                  >
                    {focusClaim.support_count}
                  </Badge>
                  <Badge
                    px={4}
                    py={2}
                    borderRadius="12px"
                    bg="rgba(255, 108, 136, 0.08)"
                    border="1px solid rgba(255, 108, 136, 0.2)"
                    color="#ff6c88"
                    fontSize="16px"
                    fontWeight="bold"
                  >
                    {focusClaim.refute_count}
                  </Badge>
                  <Badge
                    px={4}
                    py={2}
                    borderRadius="12px"
                    bg="rgba(120, 168, 255, 0.08)"
                    border="1px solid rgba(120, 168, 255, 0.2)"
                    color="#78a8ff"
                    fontSize="16px"
                    fontWeight="bold"
                  >
                    {focusClaim.context_count}
                  </Badge>
                </HStack>

                {/* Evidence Count */}
                <Badge
                  px={4}
                  py={2}
                  borderRadius="12px"
                  bg="rgba(137, 169, 191, 0.08)"
                  border="1px solid rgba(137, 169, 191, 0.15)"
                  color="#89a9bf"
                  fontSize="14px"
                >
                  {focusClaim.evidence_count} Evidence
                </Badge>
              </VStack>
            </Box>
          </Box>

          {/* Center: Source Claims Stream */}
          <Box position="relative">
            <CurvedEdge />
            <Box
              bg="rgba(15, 28, 46, 0.18)"
              borderRadius="28px"
              border="1px solid rgba(126, 207, 255, 0.18)"
              backdropFilter="blur(24px)"
              p={8}
              position="relative"
            >
              <VStack align="stretch" spacing={6}>
                {/* Progress Bar over source claims */}
                <HStack spacing={3} px={4} py={3} borderRadius="18px" bg="rgba(97, 239, 184, 0.05)" border="1px solid rgba(97, 239, 184, 0.12)">
                  <Text fontSize="11px" textTransform="uppercase" color="#61efb8">PROGRESS</Text>
                  <Box flex="1" h="8px" borderRadius="full" bg="rgba(255,255,255,0.05)" overflow="hidden">
                    <Box
                      h="full"
                      w={`${((availableCaseClaims.findIndex((c) => c.claim_id === focusClaim?.claim_id) + 1) / availableCaseClaims.length) * 100}%`}
                      bgGradient="linear(90deg, #71dbff, #78a8ff)"
                      boxShadow="0 0 12px rgba(113, 219, 255, 0.2)"
                    />
                  </Box>
                  <Text fontSize="13px" color="#89a9bf">{availableCaseClaims.findIndex((c) => c.claim_id === focusClaim?.claim_id) + 1} / {availableCaseClaims.length}</Text>
                </HStack>

                {/* Source Claims Horizontal Scroll */}
                <Box overflowX="auto" css={{ "&::-webkit-scrollbar": { height: "8px" }, "&::-webkit-scrollbar-thumb": { background: "rgba(113, 219, 255, 0.35)", borderRadius: "999px" } }}>
                  <HStack spacing={4} align="stretch">
                    {candidates.slice(0, 5).map((candidate, idx) => (
                      <Box
                        key={idx}
                        bg="rgba(14, 24, 40, 0.35)"
                        borderRadius="24px"
                        border="1px solid rgba(113, 219, 255, 0.12)"
                        p={6}
                        minW="400px"
                        position="relative"
                      >
                        <VStack align="stretch" spacing={3}>
                          <Text fontSize="15px" fontWeight="760" color="#e4f4ff">
                            {candidate.source_name}
                          </Text>

                          {/* Source Claim Text - aligned with case claim */}
                          <Text fontSize="21px" lineHeight="1.36" fontWeight="670" color="#e4f4ff">
                            "{candidate.claim_text.slice(0, 150)}{candidate.claim_text.length > 150 ? "..." : ""}"
                          </Text>

                          {/* Badges Row - aligned with left panel */}
                          <HStack spacing={3}>
                            <Badge
                              px={4}
                              py={2}
                              borderRadius="12px"
                              bg="rgba(255, 108, 136, 0.08)"
                              border="1px solid rgba(255, 108, 136, 0.2)"
                              color="#ff6c88"
                              fontSize="14px"
                            >
                              {Math.round((candidate.relevance_score || 0) * 100)}
                            </Badge>
                            <Badge
                              px={4}
                              py={2}
                              borderRadius="12px"
                              bg="rgba(120, 168, 255, 0.08)"
                              border="1px solid rgba(120, 168, 255, 0.2)"
                              color="#78a8ff"
                              fontSize="14px"
                            >
                              {Math.round((candidate.ai_confidence || 0) * 100)}
                            </Badge>
                            <Badge
                              px={4}
                              py={2}
                              borderRadius="12px"
                              bg="rgba(97, 239, 184, 0.08)"
                              border="1px solid rgba(97, 239, 184, 0.2)"
                              color="#61efb8"
                              fontSize="14px"
                            >
                              {candidate.ai_support_level ? (candidate.ai_support_level > 0 ? "+" : "") + candidate.ai_support_level.toFixed(2) : "N/A"}
                            </Badge>
                          </HStack>
                        </VStack>
                      </Box>
                    ))}
                  </HStack>
                </Box>

                {/* Numeric Score Above Buttons */}
                <Text fontSize="48px" fontWeight="900" color="#61efb8" textAlign="center">
                  +{(focusClaim.support_count || 0) - (focusClaim.refute_count || 0)}
                </Text>

                {/* Action Buttons Between Panels */}
                <HStack spacing={3}>
                  <Button
                    flex="1"
                    borderRadius="14px"
                    bg="rgba(97, 239, 184, 0.08)"
                    border="1px solid rgba(97, 239, 184, 0.24)"
                    color="#61efb8"
                    _hover={{ bg: "rgba(97, 239, 184, 0.15)" }}
                  >
                    Support
                  </Button>
                  <Button
                    flex="1"
                    borderRadius="14px"
                    bg="rgba(255, 108, 136, 0.08)"
                    border="1px solid rgba(255, 108, 136, 0.24)"
                    color="#ff6c88"
                    _hover={{ bg: "rgba(255, 108, 136, 0.15)" }}
                  >
                    Refute
                  </Button>
                  <Button
                    flex="1"
                    borderRadius="14px"
                    bg="rgba(120, 168, 255, 0.08)"
                    border="1px solid rgba(120, 168, 255, 0.24)"
                    color="#78a8ff"
                    _hover={{ bg: "rgba(120, 168, 255, 0.15)" }}
                  >
                    Nuance
                  </Button>
                </HStack>
              </VStack>
            </Box>
          </Box>

          {/* Right: Meta Panel */}
          <Box position="relative">
            <CurvedEdge />
            <Box
              bg="rgba(15, 28, 46, 0.18)"
              borderRadius="28px"
              border="1px solid rgba(126, 207, 255, 0.18)"
              backdropFilter="blur(24px)"
              p={8}
              position="relative"
            >
              <VStack align="stretch" spacing={6}>
                {/* AI Rationale - moved from center */}
                {candidates[0]?.ai_rationale && (
                  <Box p={4} borderRadius="16px" bg="rgba(255, 255, 255, 0.035)" border="1px solid rgba(255, 255, 255, 0.06)">
                    <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.09em" color="#89a9bf" mb={2}>
                      AI ANALYSIS
                    </Text>
                    <Text fontSize="14px" lineHeight="1.45" color="#d4e9ff">
                      {candidates[0].ai_rationale}
                    </Text>
                  </Box>
                )}

                {/* Quick Actions */}
                <VStack spacing={2}>
                  <Button
                    w="full"
                    size="sm"
                    borderRadius="14px"
                    bg="rgba(255, 255, 255, 0.035)"
                    border="1px solid rgba(126, 207, 255, 0.18)"
                    color="#e4f4ff"
                    onClick={handlePreviousClaim}
                  >
                    ← Previous
                  </Button>
                  <Button
                    w="full"
                    size="sm"
                    borderRadius="14px"
                    bg="rgba(255, 255, 255, 0.035)"
                    border="1px solid rgba(126, 207, 255, 0.18)"
                    color="#e4f4ff"
                    onClick={handleNextClaim}
                  >
                    Next →
                  </Button>
                  <Button
                    w="full"
                    size="sm"
                    borderRadius="14px"
                    bg="rgba(255, 255, 255, 0.035)"
                    border="1px solid rgba(126, 207, 255, 0.18)"
                    color="#e4f4ff"
                    onClick={() => navigate("/claim-duel/" + selectedTask?.content_id)}
                  >
                    Switch to Claim Duel
                  </Button>
                </VStack>
              </VStack>
            </Box>
          </Box>
        </Grid>
      </VStack>
    </Box>
  );
};
