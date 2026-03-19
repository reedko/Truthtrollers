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
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
  Tooltip,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { fetchReferenceClaimTaskLinks } from "../services/referenceClaimRelevance";
import VerimeterMeter from "../components/VerimeterMeter";

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

export const FoxCasePage: React.FC = () => {
  const { selectedTask } = useTaskStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  // State variables - matching ClaimDuel exactly
  const [focusClaim, setFocusClaim] = useState<FocusClaim | null>(null);
  const [candidates, setCandidates] = useState<CandidateClaim[]>([]);
  const [currentCandidateIndex, setCurrentCandidateIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [availableCaseClaims, setAvailableCaseClaims] = useState<any[]>([]);

  // Load available case claims when case changes
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
      console.log("📡 Case claims response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Failed to load case claims:", errorText);
        throw new Error("Failed to load case claims");
      }

      const data = await response.json();
      console.log("✅ Case claims data:", data);
      console.log("📊 Found", data.caseClaims?.length || 0, "case claims");

      setAvailableCaseClaims(data.caseClaims || []);

      // Auto-load first claim if available
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
      // Get existing linked claims
      const linkedResponse = await fetch(
        `${API_BASE_URL}/api/linked-claims-for-claim/${claimId}`,
      );
      const linkedClaims = linkedResponse.ok ? await linkedResponse.json() : [];

      // Calculate stance distribution
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

      // Find the claim in available claims to get text
      const claimData = availableCaseClaims.find((c) => c.claim_id === claimId);

      const focus: FocusClaim = {
        claim_id: claimId,
        claim_text: claimData?.label || "Loading...",
        claim_type: "case",
        verimeter_score: 50, // Default
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

    console.log("🎯 Loading candidates for claim:", focusClaimId);

    try {
      // DEEP SCAN: Get ALL reference claims from ALL sources for this case (same as ClaimDuel)
      const refsResponse = await fetch(
        `${API_BASE_URL}/api/content/${selectedTask.content_id}/references-with-claims?viewerId=${user.user_id}`,
      );

      if (!refsResponse.ok) {
        throw new Error("Failed to load references");
      }

      const references = await refsResponse.json();
      console.log("📚 Found", references.length, "references with claims");

      // Get existing AI links for INDIVIDUAL CLAIMS
      const existingLinks = await fetchReferenceClaimTaskLinks(focusClaimId);
      console.log("🔗 Existing claim-to-claim links:", existingLinks.length);

      // Flatten all reference claims into candidates
      const allCandidates: CandidateClaim[] = [];

      for (const ref of references) {
        const refClaims = Array.isArray(ref.claims)
          ? ref.claims
          : typeof ref.claims === "string"
            ? JSON.parse(ref.claims)
            : [];

        for (const claim of refClaims) {
          // Check if THIS SPECIFIC CLAIM is already linked
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

      console.log("📊 Total candidates from deep scan:", allCandidates.length);

      // FILTER TO ONLY RELEVANT CLAIMS: Show only AI-suggested OR already linked
      const filteredCandidates = allCandidates.filter(
        (c) => c.relevance_score > 0,
      );

      console.log(
        "🔍 Filtered to relevant candidates:",
        filteredCandidates.length,
      );

      // Sort by relevance score
      const relevantCandidates = filteredCandidates.sort(
        (a, b) => b.relevance_score - a.relevance_score,
      );

      setCandidates(relevantCandidates);
      setCurrentCandidateIndex(0);
    } catch (error) {
      console.error("Error loading candidates:", error);
      toast({
        title: "Error loading evidence",
        description: "Failed to load source claims",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleNextCandidate = () => {
    if (currentCandidateIndex < candidates.length - 1) {
      setCurrentCandidateIndex(currentCandidateIndex + 1);
    }
  };

  const handlePreviousCandidate = () => {
    if (currentCandidateIndex > 0) {
      setCurrentCandidateIndex(currentCandidateIndex - 1);
    }
  };

  const handleSelectClaim = (claimId: number) => {
    loadFocusClaim(claimId);
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

  const currentCandidate = candidates[currentCandidateIndex];

  return (
    <Box
      minH="100vh"
      bgGradient="linear(to-br, #041018, #071520, #0a1a25, #0d2330)"
      position="relative"
      overflow="hidden"
    >
      {/* Grid Overlay */}
      <Box
        position="fixed"
        inset="0"
        bgImage="linear-gradient(rgba(130, 195, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(130, 195, 255, 0.05) 1px, transparent 1px)"
        bgSize="40px 40px"
        opacity="0.32"
        pointerEvents="none"
        style={{
          maskImage:
            "radial-gradient(circle at center, black 50%, transparent 95%)",
        }}
      />

      {/* Radial Glow Effects */}
      <Box
        position="fixed"
        inset="0"
        bgGradient="radial-gradient(circle at 85% 85%, rgba(97, 239, 184, 0.22), transparent 22%)"
        pointerEvents="none"
      />
      <Box
        position="fixed"
        inset="0"
        bgGradient="radial-gradient(circle at 78% 88%, rgba(113, 219, 255, 0.18), transparent 34%)"
        pointerEvents="none"
      />

      {/* Main Content */}
      <VStack spacing={6} p={8} position="relative" zIndex={1}>

        {/* Main Workspace - 3 columns */}
        <Grid
          templateColumns="450px minmax(500px, 560px) 340px"
          gap={6}
          w="full"
          alignItems="start"
        >
          {/* Left: Case Claim Focus */}
          <Box
            bg="linear-gradient(180deg, rgba(15, 28, 46, 0.68), rgba(8, 16, 27, 0.62))"
            borderRadius="28px"
            border="1px solid"
            borderColor="rgba(126, 207, 255, 0.22)"
            boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
            backdropFilter="blur(18px)"
            p={6}
            position="relative"
            overflow="hidden"
          >
            <Box
              position="absolute"
              inset="0"
              bgGradient="linear(135deg, rgba(255, 255, 255, 0.07), transparent 26%)"
              pointerEvents="none"
            />
            <Box
              position="absolute"
              left="-10px"
              top="18px"
              bottom="18px"
              w="22px"
              borderRadius="18px"
              bgGradient="linear(180deg, rgba(113, 219, 255, 0.23), rgba(167, 150, 255, 0.18) 46%, rgba(97, 239, 184, 0.18))"
              boxShadow="0 0 18px rgba(113, 219, 255, 0.12)"
              pointerEvents="none"
            />

            <VStack align="stretch" spacing={4} position="relative">
              {/* Case Claim Title Button */}
              <HStack justify="space-between" align="center" h="32px">
                <Button
                  fontSize="11px"
                  fontWeight="600"
                  textTransform="uppercase"
                  letterSpacing="0.09em"
                  borderRadius="8px"
                  border="1px solid"
                  borderColor="rgba(126, 207, 255, 0.22)"
                  bg="rgba(255, 255, 255, 0.035)"
                  color="#89a9bf"
                  _hover={{
                    borderColor: "rgba(148, 221, 255, 0.46)",
                    color: "#e4f4ff",
                  }}
                  onClick={onOpen}
                  size="sm"
                  justifyContent="flex-start"
                  h="32px"
                  px={3}
                >
                  Case Claim (change)
                </Button>
                <Badge
                  px={4}
                  py={2}
                  borderRadius="999px"
                  border="1px solid"
                  borderColor="rgba(97, 239, 184, 0.3)"
                  bg="rgba(97, 239, 184, 0.08)"
                  boxShadow="0 0 20px rgba(97, 239, 184, 0.15)"
                  fontSize="13px"
                  fontWeight="700"
                  color="#61efb8"
                >
                  64%
                </Badge>
              </HStack>

              {/* Verimeter Bar */}
              {focusClaim && focusClaim.verimeter_score !== undefined && (
                <Box py={3}>
                  <VerimeterMeter
                    score={focusClaim.verimeter_score / 100}
                    width="100%"
                    showInterpretation={false}
                  />
                </Box>
              )}

              {/* Case Card with Arrow */}
              <Box
                bg="linear-gradient(180deg, rgba(10, 21, 35, 0.78), rgba(10, 18, 29, 0.68))"
                borderRadius="24px"
                border="1px solid"
                borderColor="rgba(113, 219, 255, 0.22)"
                boxShadow="inset 0 0 0 1px rgba(255, 255, 255, 0.03)"
                p={6}
                minH="520px"
                position="relative"
              >
                {/* Arrow Indicator */}
                <Box
                  position="absolute"
                  right="16px"
                  top="50%"
                  transform="translateY(-50%)"
                  w="0"
                  h="0"
                  borderTop="12px solid transparent"
                  borderBottom="12px solid transparent"
                  borderLeft="16px solid rgba(113, 219, 255, 0.35)"
                  filter="drop-shadow(0 0 8px rgba(113, 219, 255, 0.18))"
                  opacity="0.9"
                />

                {/* Case Title Box */}
                <Tooltip
                  label={availableCaseClaims.find((c) => c.claim_id === focusClaim?.claim_id)?.label || "Case claim"}
                  placement="top"
                  hasArrow
                >
                  <Box
                    mb={4}
                    p={4}
                    borderRadius="16px"
                    border="1px solid"
                    borderColor="rgba(113, 219, 255, 0.3)"
                    bg="rgba(113, 219, 255, 0.08)"
                    boxShadow="0 0 20px rgba(113, 219, 255, 0.15)"
                    cursor="help"
                  >
                    <Text
                      fontSize="13px"
                      fontWeight="700"
                      textTransform="uppercase"
                      letterSpacing="0.1em"
                      color="#71dbff"
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                    >
                      {availableCaseClaims.find((c) => c.claim_id === focusClaim?.claim_id)?.label || "Case claim"}
                    </Text>
                  </Box>
                </Tooltip>

                {/* Claim Text */}
                <Text
                  fontSize="24px"
                  lineHeight="1.3"
                  fontWeight="690"
                  color="#e4f4ff"
                  mb={6}
                >
                  {focusClaim.claim_text}
                </Text>

                {/* Stats Grid - 3 columns */}
                <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                  <Box
                    bgGradient="linear(180deg, rgba(255, 108, 136, 0.13), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(255, 108, 136, 0.2)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#ff6c88"
                    >
                      REFUTES
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#ff6c88">
                      {focusClaim.refute_count || 0}
                    </Text>
                  </Box>

                  <Box
                    bgGradient="linear(180deg, rgba(120, 168, 255, 0.14), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(120, 168, 255, 0.22)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#78a8ff"
                    >
                      NUANCE
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#78a8ff">
                      {focusClaim.context_count || 0}
                    </Text>
                  </Box>

                  <Box
                    bgGradient="linear(180deg, rgba(97, 239, 184, 0.13), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(97, 239, 184, 0.2)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#61efb8"
                    >
                      SUPPORTS
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#61efb8">
                      {focusClaim.support_count || 0}
                    </Text>
                  </Box>
                </Grid>

                {/* Evidence Summary Box */}
                <Box
                  mt={4}
                  p={4}
                  borderRadius="16px"
                  border="1px solid"
                  borderColor="rgba(255, 255, 255, 0.06)"
                  bg="rgba(255, 255, 255, 0.035)"
                >
                  <Text
                    fontSize="11px"
                    textTransform="uppercase"
                    letterSpacing="0.09em"
                    color="#89a9bf"
                    mb={2}
                  >
                    EVIDENCE SUMMARY
                  </Text>
                  <Text fontSize="14px" lineHeight="1.45" color="#d4e9ff">
                    {focusClaim.evidence_count || 0} total evidence claims linked.{" "}
                    {focusClaim.support_count || 0} supporting,{" "}
                    {focusClaim.refute_count || 0} refuting,{" "}
                    {focusClaim.context_count || 0} providing nuance.
                  </Text>
                </Box>
              </Box>
            </VStack>
          </Box>

          {/* Center: Source Claim Stream (Scrolling Evidence) */}
          <Box
            bg="linear-gradient(180deg, rgba(15, 28, 46, 0.68), rgba(8, 16, 27, 0.62))"
            borderRadius="28px"
            border="1px solid"
            borderColor="rgba(126, 207, 255, 0.22)"
            boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
            backdropFilter="blur(18px)"
            p={6}
            minH="760px"
            position="relative"
            overflow="hidden"
          >
            <Box
              position="absolute"
              inset="0"
              bgGradient="linear(135deg, rgba(255, 255, 255, 0.07), transparent 26%)"
              pointerEvents="none"
            />
            <Box
              position="absolute"
              left="-10px"
              top="18px"
              bottom="18px"
              w="22px"
              borderRadius="18px"
              bgGradient="linear(180deg, rgba(113, 219, 255, 0.23), rgba(167, 150, 255, 0.18) 46%, rgba(97, 239, 184, 0.18))"
              boxShadow="0 0 18px rgba(113, 219, 255, 0.12)"
              pointerEvents="none"
            />

            <VStack align="stretch" spacing={4} position="relative" h="full">
              <HStack justify="space-between" align="center" h="32px">
                <Text
                  fontSize="11px"
                  textTransform="uppercase"
                  letterSpacing="0.09em"
                  fontWeight="600"
                  color="#89a9bf"
                >
                  SOURCE CLAIM STREAM
                </Text>
                <Badge
                  px={3}
                  py={1}
                  borderRadius="999px"
                  border="1px solid"
                  borderColor="rgba(148, 221, 255, 0.46)"
                  bg="rgba(255, 255, 255, 0.035)"
                  fontSize="11px"
                  color="#e4f4ff"
                  h="fit-content"
                >
                  Horizontal rail
                </Badge>
              </HStack>

              {/* Progress Bar */}
              <HStack
                spacing={3}
                px={4}
                py={3}
                borderRadius="18px"
                border="1px solid"
                borderColor="rgba(113, 219, 255, 0.22)"
                bg="rgba(255, 255, 255, 0.035)"
              >
                <Text fontSize="11px" textTransform="uppercase" color="#71dbff">
                  PROGRESS
                </Text>
                <Box
                  flex="1"
                  h="10px"
                  borderRadius="999px"
                  bg="rgba(255, 255, 255, 0.05)"
                  border="1px solid"
                  borderColor="rgba(255, 255, 255, 0.06)"
                  overflow="hidden"
                >
                  <Box
                    h="full"
                    w={`${candidates.length > 0 ? ((currentCandidateIndex + 1) / candidates.length) * 100 : 0}%`}
                    bgGradient="linear(90deg, #71dbff, #78a8ff)"
                    boxShadow="0 0 18px rgba(113, 219, 255, 0.2)"
                  />
                </Box>
                <Text fontSize="13px" color="#89a9bf">
                  {currentCandidateIndex + 1} of {candidates.length}
                </Text>
              </HStack>

              {/* Scrolling Source Claims */}
              <Box
                flex="1"
                overflowX="auto"
                overflowY="hidden"
                css={{
                  "&::-webkit-scrollbar": {
                    height: "8px",
                  },
                  "&::-webkit-scrollbar-track": {
                    background: "transparent",
                  },
                  "&::-webkit-scrollbar-thumb": {
                    background: "rgba(113, 219, 255, 0.35)",
                    borderRadius: "999px",
                  },
                }}
              >
                <HStack spacing={4} align="stretch" pb={2}>
                  {candidates.slice(currentCandidateIndex, currentCandidateIndex + 1).map((candidate, idx) => (
                    <Box
                      key={idx}
                      bg="linear-gradient(180deg, rgba(14, 24, 40, 0.82), rgba(9, 16, 29, 0.72))"
                      borderRadius="24px"
                      border="1px solid"
                      borderColor="rgba(113, 219, 255, 0.18)"
                      boxShadow="inset 0 0 0 1px rgba(255, 255, 255, 0.03)"
                      p={6}
                      pl={8}
                      minH="240px"
                      w="440px"
                      minW="440px"
                      maxW="440px"
                      position="relative"
                    >
                      {/* Curved edge on source cards too */}
                      <Box
                        position="absolute"
                        left="-10px"
                        top="18px"
                        bottom="18px"
                        w="22px"
                        borderRadius="18px"
                        bgGradient="linear(180deg, rgba(113, 219, 255, 0.23), rgba(167, 150, 255, 0.18) 46%, rgba(97, 239, 184, 0.18))"
                        boxShadow="0 0 18px rgba(113, 219, 255, 0.12)"
                        filter="blur(0.1px)"
                        pointerEvents="none"
                      />

                      <VStack align="stretch" spacing={3}>
                        <Flex justify="space-between" align="center" mb={3} gap={2}>
                          <Tooltip
                            label={candidate.source_name || "Source claim"}
                            placement="top"
                            hasArrow
                          >
                            <Box
                              p={3}
                              borderRadius="16px"
                              border="1px solid"
                              borderColor="rgba(113, 219, 255, 0.3)"
                              bg="rgba(113, 219, 255, 0.08)"
                              boxShadow="0 0 20px rgba(113, 219, 255, 0.15)"
                              cursor="help"
                              maxW="calc(100% - 90px)"
                            >
                              <Text
                                fontSize="13px"
                                fontWeight="700"
                                textTransform="uppercase"
                                letterSpacing="0.1em"
                                color="#71dbff"
                                whiteSpace="nowrap"
                                overflow="hidden"
                                textOverflow="ellipsis"
                              >
                                {candidate.source_name?.toUpperCase() || "SOURCE CLAIM"}
                              </Text>
                            </Box>
                          </Tooltip>
                          <Badge
                            px={2}
                            py={1}
                            borderRadius="999px"
                            fontSize="11px"
                            bg="rgba(255, 255, 255, 0.035)"
                            color="#71dbff"
                          >
                            {currentCandidateIndex === 0
                              ? "Best fit"
                              : currentCandidateIndex === 1
                                ? "Alternative"
                                : "Next"}
                          </Badge>
                        </Flex>

                        {/* Source Claim Text */}
                        <Text
                          fontSize="24px"
                          lineHeight="1.3"
                          fontWeight="690"
                          color="#e4f4ff"
                          mb={2}
                        >
                          {candidate.claim_text}
                        </Text>

                        {/* Micro badges */}
                        <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                          <Box
                            bgGradient="linear(180deg, rgba(255, 108, 136, 0.13), rgba(255, 255, 255, 0.03))"
                            borderRadius="16px"
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.07)"
                            p={3}
                            minH="72px"
                          >
                            <Text
                              fontSize="10px"
                              textTransform="uppercase"
                              letterSpacing="0.08em"
                              color="rgba(228, 244, 255, 0.8)"
                              mb={1}
                            >
                              RELEVANCE
                            </Text>
                            <Text
                              fontSize="18px"
                              fontWeight="800"
                              color="#ff6c88"
                            >
                              {Math.round(candidate.relevance_score || 0)}
                            </Text>
                          </Box>

                          <Box
                            bgGradient="linear(180deg, rgba(120, 168, 255, 0.14), rgba(255, 255, 255, 0.03))"
                            borderRadius="16px"
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.07)"
                            p={3}
                            minH="72px"
                          >
                            <Text
                              fontSize="10px"
                              textTransform="uppercase"
                              letterSpacing="0.08em"
                              color="rgba(228, 244, 255, 0.8)"
                              mb={1}
                            >
                              CONFIDENCE
                            </Text>
                            <Text
                              fontSize="18px"
                              fontWeight="800"
                              color="#78a8ff"
                            >
                              {Math.round((candidate.ai_confidence || 0) * 100)}
                            </Text>
                          </Box>

                          <Box
                            bgGradient="linear(180deg, rgba(97, 239, 184, 0.13), rgba(255, 255, 255, 0.03))"
                            borderRadius="16px"
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.07)"
                            p={3}
                            minH="72px"
                          >
                            <Text
                              fontSize="10px"
                              textTransform="uppercase"
                              letterSpacing="0.08em"
                              color="rgba(228, 244, 255, 0.8)"
                              mb={1}
                            >
                              SUPPORT
                            </Text>
                            <Text
                              fontSize="18px"
                              fontWeight="800"
                              color="#61efb8"
                            >
                              {candidate.ai_support_level
                                ? (candidate.ai_support_level > 0 ? "+" : "") +
                                  candidate.ai_support_level.toFixed(2)
                                : "N/A"}
                            </Text>
                          </Box>
                        </Grid>

                        {/* AI Rationale */}
                        <Box
                          p={4}
                          borderRadius="16px"
                          border="1px solid"
                          borderColor="rgba(255, 255, 255, 0.06)"
                          bg="rgba(255, 255, 255, 0.035)"
                        >
                          <Text
                            fontSize="11px"
                            textTransform="uppercase"
                            letterSpacing="0.09em"
                            color="#89a9bf"
                            mb={2}
                          >
                            AI RATIONALE
                          </Text>
                          <Text fontSize="14px" lineHeight="1.45" color="#d4e9ff">
                            {candidate.ai_rationale ||
                              "No AI analysis available for this claim."}
                          </Text>
                        </Box>

                        {/* Refute/Nuance/Support Badges */}
                        <Grid templateColumns="repeat(3, 1fr)" gap={2} mt={3}>
                          <Button
                            bgGradient="linear(180deg, rgba(255, 108, 136, 0.13), rgba(255, 255, 255, 0.03))"
                            borderRadius="14px"
                            border="1px solid"
                            borderColor="rgba(255, 108, 136, 0.2)"
                            color="#ff6c88"
                            fontSize="11px"
                            fontWeight="600"
                            textTransform="uppercase"
                            h="36px"
                            _hover={{
                              borderColor: "rgba(255, 108, 136, 0.4)",
                              bg: "rgba(255, 108, 136, 0.18)",
                            }}
                          >
                            Refute
                          </Button>
                          <Button
                            bgGradient="linear(180deg, rgba(120, 168, 255, 0.14), rgba(255, 255, 255, 0.03))"
                            borderRadius="14px"
                            border="1px solid"
                            borderColor="rgba(120, 168, 255, 0.22)"
                            color="#78a8ff"
                            fontSize="11px"
                            fontWeight="600"
                            textTransform="uppercase"
                            h="36px"
                            _hover={{
                              borderColor: "rgba(120, 168, 255, 0.4)",
                              bg: "rgba(120, 168, 255, 0.18)",
                            }}
                          >
                            Nuance
                          </Button>
                          <Button
                            bgGradient="linear(180deg, rgba(97, 239, 184, 0.13), rgba(255, 255, 255, 0.03))"
                            borderRadius="14px"
                            border="1px solid"
                            borderColor="rgba(97, 239, 184, 0.2)"
                            color="#61efb8"
                            fontSize="11px"
                            fontWeight="600"
                            textTransform="uppercase"
                            h="36px"
                            _hover={{
                              borderColor: "rgba(97, 239, 184, 0.4)",
                              bg: "rgba(97, 239, 184, 0.18)",
                            }}
                          >
                            Support
                          </Button>
                        </Grid>
                      </VStack>
                    </Box>
                  ))}

                  {candidates.length === 0 && (
                    <Flex align="center" justify="center" minH="240px" w="full">
                      <Text color="#89a9bf">No source claims available</Text>
                    </Flex>
                  )}
                </HStack>
              </Box>

              {/* Navigation Buttons */}
              <HStack spacing={3} pt={4}>
                <Button
                  flex="1"
                  borderRadius="14px"
                  border="1px solid"
                  borderColor="rgba(113, 219, 255, 0.24)"
                  bg="rgba(255, 255, 255, 0.035)"
                  color="#71dbff"
                  fontSize="11px"
                  fontWeight="600"
                  textTransform="uppercase"
                  _hover={{
                    borderColor: "rgba(148, 221, 255, 0.46)",
                    bg: "rgba(113, 219, 255, 0.08)",
                  }}
                  onClick={() => {
                    if (currentCandidateIndex > 0) {
                      setCurrentCandidateIndex(currentCandidateIndex - 1);
                    }
                  }}
                  isDisabled={currentCandidateIndex === 0}
                >
                  Prev
                </Button>
                <Button
                  flex="1"
                  borderRadius="14px"
                  border="1px solid"
                  borderColor="rgba(120, 168, 255, 0.24)"
                  bg="rgba(255, 255, 255, 0.035)"
                  color="#78a8ff"
                  fontSize="11px"
                  fontWeight="600"
                  textTransform="uppercase"
                  _hover={{
                    borderColor: "rgba(120, 168, 255, 0.46)",
                    bg: "rgba(120, 168, 255, 0.08)",
                  }}
                  onClick={handleNextCandidate}
                >
                  Skip
                </Button>
                <Button
                  flex="1"
                  borderRadius="14px"
                  border="1px solid"
                  borderColor="rgba(113, 219, 255, 0.24)"
                  bg="rgba(255, 255, 255, 0.035)"
                  color="#71dbff"
                  fontSize="11px"
                  fontWeight="600"
                  textTransform="uppercase"
                  _hover={{
                    borderColor: "rgba(148, 221, 255, 0.46)",
                    bg: "rgba(113, 219, 255, 0.08)",
                  }}
                  onClick={handleNextCandidate}
                  isDisabled={currentCandidateIndex >= candidates.length - 1}
                >
                  Next
                </Button>
              </HStack>
            </VStack>
          </Box>

          {/* Right: Impact & Meta */}
          <VStack spacing={4}>
            {/* Source Claim Card */}
            <Box
              bg="linear-gradient(180deg, rgba(15, 28, 46, 0.68), rgba(8, 16, 27, 0.62))"
              borderRadius="28px"
              border="1px solid"
              borderColor="rgba(126, 207, 255, 0.22)"
              boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
              backdropFilter="blur(18px)"
              p={6}
              position="relative"
              overflow="hidden"
            >
              <Box
                position="absolute"
                inset="0"
                bgGradient="linear(135deg, rgba(255, 255, 255, 0.07), transparent 26%)"
                pointerEvents="none"
              />
              <Box
                position="absolute"
                left="-10px"
                top="18px"
                bottom="18px"
                w="22px"
                borderRadius="18px"
                bgGradient="linear(180deg, rgba(113, 219, 255, 0.23), rgba(167, 150, 255, 0.18) 46%, rgba(97, 239, 184, 0.18))"
                boxShadow="0 0 18px rgba(113, 219, 255, 0.12)"
                pointerEvents="none"
              />

              <VStack align="stretch" spacing={4} position="relative">
                {/* Badges Grid */}
                <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                  <Box
                    bgGradient="linear(180deg, rgba(113, 219, 255, 0.12), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(113, 219, 255, 0.22)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="rgba(228, 244, 255, 0.8)"
                    >
                      RELEVANCE
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#71dbff">
                      {candidates[currentCandidateIndex]?.relevance_score ? Math.round(candidates[currentCandidateIndex].relevance_score * 100) : 0}
                    </Text>
                  </Box>

                  <Box
                    bgGradient="linear(180deg, rgba(120, 168, 255, 0.14), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(120, 168, 255, 0.22)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#78a8ff"
                    >
                      CONFIDENCE
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#78a8ff">
                      {candidates[currentCandidateIndex]?.ai_confidence ? Math.round(candidates[currentCandidateIndex].ai_confidence * 100) : 0}
                    </Text>
                  </Box>

                  <Box
                    bgGradient="linear(180deg, rgba(97, 239, 184, 0.13), rgba(255, 255, 255, 0.03))"
                    borderRadius="18px"
                    border="1px solid"
                    borderColor="rgba(97, 239, 184, 0.2)"
                    p={4}
                    minH="78px"
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#61efb8"
                    >
                      SUPPORT
                    </Text>
                    <Text fontSize="22px" fontWeight="820" color="#61efb8">
                      {candidates[currentCandidateIndex]?.ai_support_level !== undefined
                        ? Math.round(candidates[currentCandidateIndex].ai_support_level * 100)
                        : 0}
                    </Text>
                  </Box>
                </Grid>
              </VStack>
            </Box>

            {/* AI Rationale */}
            <Box
              bg="linear-gradient(180deg, rgba(15, 28, 46, 0.68), rgba(8, 16, 27, 0.62))"
              borderRadius="28px"
              border="1px solid"
              borderColor="rgba(126, 207, 255, 0.22)"
              boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
              backdropFilter="blur(18px)"
              p={6}
              position="relative"
              overflow="hidden"
            >
              <Box
                position="absolute"
                inset="0"
                bgGradient="linear(135deg, rgba(255, 255, 255, 0.07), transparent 26%)"
                pointerEvents="none"
              />
              <Box
                position="absolute"
                left="-10px"
                top="18px"
                bottom="18px"
                w="22px"
                borderRadius="18px"
                bgGradient="linear(180deg, rgba(113, 219, 255, 0.23), rgba(167, 150, 255, 0.18) 46%, rgba(97, 239, 184, 0.18))"
                boxShadow="0 0 18px rgba(113, 219, 255, 0.12)"
                pointerEvents="none"
              />

              <VStack align="stretch" spacing={4} position="relative">
                <Text
                  fontSize="11px"
                  textTransform="uppercase"
                  letterSpacing="0.09em"
                  color="#89a9bf"
                >
                  AI RATIONALE
                </Text>

                <Text fontSize="14px" lineHeight="1.45" color="#d4e9ff">
                  {candidates[currentCandidateIndex]?.ai_rationale ||
                    "Select a claim to see AI analysis of its relevance to the case claim."}
                </Text>
              </VStack>
            </Box>
          </VStack>
        </Grid>
      </VStack>

      {/* Case Claim Selection Drawer */}
      <Drawer isOpen={isOpen} placement="right" onClose={onClose} size="md">
        <DrawerOverlay />
        <DrawerContent
          bg="linear-gradient(180deg, rgba(15, 28, 46, 0.95), rgba(8, 16, 27, 0.95))"
          backdropFilter="blur(30px)"
        >
          <DrawerCloseButton color="#e4f4ff" />
          <DrawerHeader
            borderBottomWidth="1px"
            borderColor="rgba(126, 207, 255, 0.22)"
            color="#e4f4ff"
          >
            <Text fontSize="20px" fontWeight="760">
              Select Case Claim
            </Text>
            <Text fontSize="13px" fontWeight="normal" color="#89a9bf" mt={1}>
              Choose a claim to analyze
            </Text>
          </DrawerHeader>

          <DrawerBody p={4}>
            <VStack spacing={3} align="stretch">
              {availableCaseClaims.map((claim, idx) => (
                <Box
                  key={claim.claim_id}
                  p={4}
                  borderRadius="16px"
                  border="1px solid"
                  borderColor={
                    claim.claim_id === focusClaim?.claim_id
                      ? "rgba(113, 219, 255, 0.5)"
                      : "rgba(126, 207, 255, 0.22)"
                  }
                  bg={
                    claim.claim_id === focusClaim?.claim_id
                      ? "rgba(113, 219, 255, 0.1)"
                      : "rgba(255, 255, 255, 0.035)"
                  }
                  cursor="pointer"
                  _hover={{
                    borderColor: "rgba(148, 221, 255, 0.46)",
                    transform: "translateY(-1px)",
                  }}
                  transition="all 180ms ease"
                  onClick={() => {
                    handleSelectClaim(claim.claim_id);
                    onClose();
                  }}
                >
                  <Flex justify="space-between" align="start" mb={2}>
                    <Badge
                      colorScheme="cyan"
                      fontSize="10px"
                      px={2}
                      py={1}
                      borderRadius="full"
                    >
                      Claim {idx + 1} of {availableCaseClaims.length}
                    </Badge>
                    {claim.claim_id === focusClaim?.claim_id && (
                      <Badge
                        colorScheme="green"
                        fontSize="10px"
                        px={2}
                        py={1}
                        borderRadius="full"
                      >
                        Current
                      </Badge>
                    )}
                  </Flex>
                  <Text fontSize="16px" lineHeight="1.4" color="#e4f4ff">
                    {claim.label}
                  </Text>
                </Box>
              ))}

              {availableCaseClaims.length === 0 && (
                <Text color="#89a9bf" textAlign="center" py={8}>
                  No case claims available
                </Text>
              )}
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Box>
  );
};
