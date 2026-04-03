import React, { useState, useEffect, useRef, useMemo } from "react";
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
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Progress,
  IconButton,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@chakra-ui/icons";
import { keyframes } from "@emotion/react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { fetchReferenceClaimTaskLinks } from "../services/referenceClaimRelevance";
import {
  fetchClaimScoresForTask,
  getClaimLinkScore,
} from "../services/useDashboardAPI";
import VerimeterMeter from "../components/VerimeterMeter";
import ClaimLinkOverlay from "../components/overlays/ClaimLinkOverlay";

// Holographic scan line animation
const scanLine = keyframes`
  0% { transform: translateY(-100%); opacity: 0; }
  50% { opacity: 0.3; }
  100% { transform: translateY(200%); opacity: 0; }
`;

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

export const CaseFocusPage: React.FC = () => {
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
  const [currentCaseClaimIndex, setCurrentCaseClaimIndex] = useState(0);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(
    null,
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [modalSupportLevel, setModalSupportLevel] = useState(0);
  const [styleMode, setStyleMode] = useState<"mr1" | "mr2">("mr1"); // MR1 = 3D glass, MR2 = dark sunken
  const [userScore, setUserScore] = useState(0); // Game score (points earned from links)
  const [hiddenSources, setHiddenSources] = useState<number[]>(() => {
    // Load hidden sources from localStorage on mount
    if (user?.user_id) {
      const stored = localStorage.getItem(
        `hidden_sources_user_${user.user_id}`,
      );
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });

  // Touch/drag state for swipe navigation
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Linked claims modal state
  const {
    isOpen: isLinkedClaimsModalOpen,
    onOpen: onOpenLinkedClaimsModal,
    onClose: onCloseLinkedClaimsModal,
  } = useDisclosure();
  const [linkedClaims, setLinkedClaims] = useState<any[]>([]);
  const [linkedClaimsFilter, setLinkedClaimsFilter] = useState<
    Set<"support" | "refute" | "nuance">
  >(new Set(["support", "refute", "nuance"]));

  // Memoize linked claims categorization to avoid re-filtering on every render
  const linkedClaimsCategorized = useMemo(() => {
    const support = linkedClaims.filter(
      (lc) => lc.relation === "support" || lc.relationship === "supports",
    );
    const refute = linkedClaims.filter(
      (lc) => lc.relation === "refute" || lc.relationship === "refutes",
    );
    const nuance = linkedClaims.filter(
      (lc) =>
        lc.relation === "nuance" ||
        lc.relation === "context" ||
        lc.relationship === "related",
    );

    return { support, refute, nuance };
  }, [linkedClaims]);

  // Memoize filtered claims based on selected filters
  const filteredLinkedClaims = useMemo(() => {
    const result: any[] = [];
    if (linkedClaimsFilter.has("support"))
      result.push(...linkedClaimsCategorized.support);
    if (linkedClaimsFilter.has("refute"))
      result.push(...linkedClaimsCategorized.refute);
    if (linkedClaimsFilter.has("nuance"))
      result.push(...linkedClaimsCategorized.nuance);
    return result;
  }, [linkedClaimsFilter, linkedClaimsCategorized]);

  // Style helper functions
  const getPanelBackground = () =>
    styleMode === "mr1"
      ? {} // Transparent for MR1, showing weave pattern
      : {
          bg: "linear-gradient(180deg, rgba(15, 28, 46, 0.45), rgba(8, 16, 27, 0.40))",
        };

  const getPanelBorder = () =>
    styleMode === "mr1"
      ? {
          border: "1px solid",
          borderColor: "rgba(113, 219, 255, 0.3)",
        }
      : {
          border: "1px solid",
          borderColor: "rgba(126, 207, 255, 0.22)",
          clipPath:
            "polygon(42px 0, calc(100% - 42px) 0, 100% 42px, 100% calc(100% - 42px), calc(100% - 42px) 100%, 42px 100%, 0 calc(100% - 42px), 0 42px)",
          boxShadow:
            "0 30px 60px rgba(0, 0, 0, 0.52), 0 10px 0 rgba(3, 6, 8, 1), 0 20px 0 rgba(2, 4, 5, 1), inset 0 2px 0 rgba(255, 255, 255, 0.14), inset 0 -10px 18px rgba(0, 0, 0, 0.75)",
        };

  const getCardBackground = () =>
    styleMode === "mr1"
      ? {
          bg: "linear-gradient(180deg, rgba(15, 28, 46, 0.35), rgba(8, 16, 27, 0.30))",
          border: "1px solid",
          borderColor: "rgba(126, 207, 255, 0.22)",
          boxShadow: "0 22px 70px rgba(0, 0, 0, 0.4)",
        }
      : {
          bg: "linear-gradient(180deg, rgba(10, 21, 35, 0.78), rgba(10, 18, 29, 0.68))",
          border: "1px solid",
          borderColor: "rgba(113, 219, 255, 0.22)",
          boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.03)",
        };

  const getBoxStyle = (color: string) => {
    const colorMap: Record<string, any> = {
      red: { rgb: "255, 108, 136", hex: "#ff6c88" },
      blue: { rgb: "120, 168, 255", hex: "#78a8ff" },
      green: { rgb: "97, 239, 184", hex: "#61efb8" },
      cyan: { rgb: "113, 219, 255", hex: "#71dbff" },
      purple: { rgb: "167, 139, 250", hex: "#a78bfa" },
      gray: { rgb: "138, 169, 191", hex: "#89a9bf" },
    };

    const c = colorMap[color];

    if (styleMode === "mr1") {
      // 3D raised glass effect
      return {
        bgGradient: `linear(180deg, rgba(${c.rgb}, 0.12), rgba(255, 255, 255, 0.04))`,
        border: "2px solid",
        borderColor: `rgba(${c.rgb}, 0.3)`,
        boxShadow: `0 6px 20px rgba(0, 0, 0, 0.4), 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 20px rgba(${c.rgb}, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        _hover: {
          transform: "translateY(-2px) translateZ(0)",
          boxShadow: `0 8px 28px rgba(0, 0, 0, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 30px rgba(${c.rgb}, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.15)`,
        },
      };
    } else {
      // MR2: SUNKEN inset boxes with dark backgrounds
      return {
        bg: `linear-gradient(180deg, rgba(${c.rgb}, 0.18), rgba(${c.rgb}, 0.08))`,
        border: "1px solid",
        borderColor: `rgba(${c.rgb}, 0.3)`,
        boxShadow: `inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)`,
        _hover: {
          bg: `linear-gradient(180deg, rgba(${c.rgb}, 0.22), rgba(${c.rgb}, 0.12))`,
        },
      };
    }
  };

  const getCurvedEdge = (color: string) => {
    const colorMap: Record<string, string> = {
      red: "255, 108, 136",
      blue: "120, 168, 255",
      green: "97, 239, 184",
      cyan: "113, 219, 255",
      purple: "167, 139, 250",
      gray: "138, 169, 191",
    };

    return styleMode === "mr1" ? (
      <Box
        position="absolute"
        left={0}
        top={0}
        width="16px"
        height="100%"
        background={`linear-gradient(90deg, rgba(${colorMap[color]}, 0.4) 0%, transparent 100%)`}
        borderLeftRadius="18px"
        pointerEvents="none"
        zIndex={0}
      />
    ) : null;
  };

  const getButtonStyle = (color: string) => {
    const colorMap: Record<string, any> = {
      red: { rgb: "255, 108, 136", hex: "#ff6c88" },
      blue: { rgb: "120, 168, 255", hex: "#78a8ff" },
      green: { rgb: "97, 239, 184", hex: "#61efb8" },
      cyan: { rgb: "113, 219, 255", hex: "#71dbff" },
    };

    const c = colorMap[color];

    if (styleMode === "mr1") {
      return {
        bgGradient: `linear(180deg, rgba(${c.rgb}, 0.18), rgba(${c.rgb}, 0.08))`,
        border: "2px solid",
        borderColor: `rgba(${c.rgb}, 0.35)`,
        boxShadow: `0 6px 20px rgba(0, 0, 0, 0.4), 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 20px rgba(${c.rgb}, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        _hover: {
          borderColor: `rgba(${c.rgb}, 0.5)`,
          bg: `rgba(${c.rgb}, 0.28)`,
          transform: "translateY(-2px) translateZ(0)",
          boxShadow: `0 8px 28px rgba(0, 0, 0, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 30px rgba(${c.rgb}, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.15)`,
        },
      };
    } else {
      // MR2: Darker buttons with subtle sunken effect
      return {
        bg: `linear-gradient(180deg, rgba(${c.rgb}, 0.15), rgba(${c.rgb}, 0.08))`,
        border: "1px solid",
        borderColor: `rgba(${c.rgb}, 0.35)`,
        boxShadow: `inset 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)`,
        _hover: {
          bg: `linear-gradient(180deg, rgba(${c.rgb}, 0.22), rgba(${c.rgb}, 0.12))`,
          boxShadow: `inset 0 2px 4px rgba(0, 0, 0, 0.4), inset 0 -1px 2px rgba(255, 255, 255, 0.08)`,
        },
      };
    }
  };

  // Helper to render rugged angular spaceship panel edges for MR2 mode
  const getSquaredBeveledEdges = () => {
    if (styleMode !== "mr2") return null;

    return (
      <>
        {/* Corner bolts/rivets */}
        <Box
          position="absolute"
          left="8px"
          top="8px"
          w="6px"
          h="6px"
          borderRadius="50%"
          bg="linear-gradient(135deg, rgba(113, 219, 255, 0.6), rgba(50, 120, 180, 0.3))"
          boxShadow="inset -1px -1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(113, 219, 255, 0.4)"
          pointerEvents="none"
          zIndex={11}
        />
        <Box
          position="absolute"
          right="8px"
          top="8px"
          w="6px"
          h="6px"
          borderRadius="50%"
          bg="linear-gradient(135deg, rgba(113, 219, 255, 0.6), rgba(50, 120, 180, 0.3))"
          boxShadow="inset -1px -1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(113, 219, 255, 0.4)"
          pointerEvents="none"
          zIndex={11}
        />
        <Box
          position="absolute"
          left="8px"
          bottom="8px"
          w="6px"
          h="6px"
          borderRadius="50%"
          bg="linear-gradient(135deg, rgba(97, 239, 184, 0.6), rgba(50, 180, 120, 0.3))"
          boxShadow="inset -1px -1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(97, 239, 184, 0.4)"
          pointerEvents="none"
          zIndex={11}
        />
        <Box
          position="absolute"
          right="8px"
          bottom="8px"
          w="6px"
          h="6px"
          borderRadius="50%"
          bg="linear-gradient(135deg, rgba(97, 239, 184, 0.6), rgba(50, 180, 120, 0.3))"
          boxShadow="inset -1px -1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(97, 239, 184, 0.4)"
          pointerEvents="none"
          zIndex={11}
        />

        {/* Left edge - angular chamfer with subtle texture */}
        <Box
          position="absolute"
          left="-8px"
          top="20px"
          bottom="20px"
          w="18px"
          bg="linear-gradient(90deg, rgba(113, 219, 255, 0.35), rgba(113, 219, 255, 0.12))"
          clipPath="polygon(0 0, 100% 12%, 100% 88%, 0 100%)"
          boxShadow="inset 2px 0 4px rgba(255, 255, 255, 0.4), inset -1px 0 6px rgba(0, 0, 0, 0.7)"
          pointerEvents="none"
          zIndex={10}
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 6px, rgba(0, 0, 0, 0.06) 6px, rgba(0, 0, 0, 0.06) 7px)",
          }}
        />

        {/* Top edge - angular chamfer with panel lines */}
        <Box
          position="absolute"
          top="-5px"
          left="20px"
          right="20px"
          h="12px"
          bg="linear-gradient(180deg, rgba(113, 219, 255, 0.35), rgba(113, 219, 255, 0.12))"
          clipPath="polygon(0 0, 100% 0, 88% 100%, 12% 100%)"
          boxShadow="inset 0 2px 4px rgba(255, 255, 255, 0.4), inset 0 -1px 6px rgba(0, 0, 0, 0.7)"
          pointerEvents="none"
          zIndex={10}
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(0, 0, 0, 0.08) 20px, rgba(0, 0, 0, 0.08) 21px)",
          }}
        />

        {/* Right edge - angular chamfer darker side */}
        <Box
          position="absolute"
          right="-8px"
          top="20px"
          bottom="20px"
          w="18px"
          bg="linear-gradient(90deg, rgba(97, 239, 184, 0.12), rgba(97, 239, 184, 0.35))"
          clipPath="polygon(0 12%, 100% 0, 100% 100%, 0 88%)"
          boxShadow="inset -2px 0 4px rgba(255, 255, 255, 0.4), inset 1px 0 6px rgba(0, 0, 0, 0.7)"
          pointerEvents="none"
          zIndex={10}
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 6px, rgba(0, 0, 0, 0.06) 6px, rgba(0, 0, 0, 0.06) 7px)",
          }}
        />

        {/* Bottom edge - angular chamfer darker side */}
        <Box
          position="absolute"
          bottom="-5px"
          left="20px"
          right="20px"
          h="12px"
          bg="linear-gradient(180deg, rgba(97, 239, 184, 0.12), rgba(97, 239, 184, 0.35))"
          clipPath="polygon(12% 0, 88% 0, 100% 100%, 0 100%)"
          boxShadow="inset 0 -2px 4px rgba(255, 255, 255, 0.4), inset 0 1px 6px rgba(0, 0, 0, 0.7)"
          pointerEvents="none"
          zIndex={10}
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(0, 0, 0, 0.08) 20px, rgba(0, 0, 0, 0.08) 21px)",
          }}
        />
      </>
    );
  };
  const leftRailViewportRef = useRef<HTMLDivElement | null>(null);
  const leftRailFlexRef = useRef<HTMLDivElement | null>(null);
  const [leftCardMeasurements, setLeftCardMeasurements] = useState({
    viewportWidth: 0,
    cardWidth: 0,
    cardGap: 0,
  });

  const rightRailViewportRef = useRef<HTMLDivElement | null>(null);
  const rightRailFlexRef = useRef<HTMLDivElement | null>(null);
  const [rightCardMeasurements, setRightCardMeasurements] = useState({
    viewportWidth: 0,
    cardWidth: 0,
    cardGap: 0,
  });

  // Left rail measurements
  useEffect(() => {
    // Wait for refs to be available
    const checkAndMeasure = () => {
      const viewportEl = leftRailViewportRef.current;
      const flexEl = leftRailFlexRef.current;

      if (!viewportEl || !flexEl) {
        // Refs not ready yet, try again soon
        setTimeout(checkAndMeasure, 10);
        return;
      }

      const update = () => {
        const firstCard = flexEl.children[0] as HTMLElement;
        if (!firstCard) return;

        const cardWidth = firstCard.offsetWidth;
        const cardStyle = window.getComputedStyle(firstCard);
        const cardGap = parseFloat(cardStyle.marginRight) || 0;
        const viewportWidth = viewportEl.clientWidth;

        if (cardWidth > 0 && viewportWidth > 0) {
          setLeftCardMeasurements({ viewportWidth, cardWidth, cardGap });
        }
      };

      const observer = new ResizeObserver(() => update());

      // Initial measurement and setup observer
      update();
      observer.observe(viewportEl);
      observer.observe(flexEl);

      // Cleanup
      return () => {
        observer.disconnect();
      };
    };

    const cleanup = checkAndMeasure();
    return cleanup;
  }, [availableCaseClaims, focusClaim]);

  // Right rail measurements
  useEffect(() => {
    const viewportEl = rightRailViewportRef.current;
    const flexEl = rightRailFlexRef.current;
    if (!viewportEl || !flexEl) return;

    const update = () => {
      const firstCard = flexEl.children[0] as HTMLElement;
      if (!firstCard) return;

      const cardWidth = firstCard.offsetWidth;
      const cardStyle = window.getComputedStyle(firstCard);
      const cardGap = parseFloat(cardStyle.marginRight) || 0;
      const viewportWidth = viewportEl.clientWidth;

      setRightCardMeasurements({ viewportWidth, cardWidth, cardGap });
    };

    const observer = new ResizeObserver(() => update());

    // Initial measurement and setup observer
    update();
    observer.observe(viewportEl);
    observer.observe(flexEl);

    // Also measure on window resize
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [candidates]);

  const leftRailTranslate =
    leftCardMeasurements.viewportWidth / 2 -
    leftCardMeasurements.cardWidth / 2 -
    currentCaseClaimIndex *
      (leftCardMeasurements.cardWidth + leftCardMeasurements.cardGap);

  const rightRailTranslate =
    rightCardMeasurements.viewportWidth / 2 -
    rightCardMeasurements.cardWidth / 2 -
    currentCandidateIndex *
      (rightCardMeasurements.cardWidth + rightCardMeasurements.cardGap);

  // Load available case claims when case changes
  useEffect(() => {
    if (selectedTask?.content_id) {
      loadAvailableCaseClaims();
    }
  }, [selectedTask?.content_id]);

  // Load user game score when case changes
  useEffect(() => {
    const loadScore = async () => {
      if (!selectedTask?.content_id || !user?.user_id) return;

      try {
        console.log(
          `🎮 Loading game score for case ${selectedTask.content_id}, user ${user.user_id}`,
        );
        const totalScore = await getClaimLinkScore(
          selectedTask.content_id,
          user.user_id,
        );
        console.log(`🎮 Loaded game score: ${totalScore}`);
        setUserScore(totalScore);
      } catch (error) {
        console.error("❌ Error loading game score:", error);
      }
    };

    loadScore();
  }, [selectedTask?.content_id, user?.user_id]);

  // Don't auto-open drawer - user will click from main list
  // useEffect(() => {
  //   if (!focusClaim && availableCaseClaims.length > 0 && !isLoading) {
  //     onOpen();
  //   }
  // }, [focusClaim, availableCaseClaims.length, isLoading, onOpen]);

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

      // Don't auto-load - let user select from the list
      // This prevents the expensive deep scan from running on page load
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

  const loadFocusClaim = async (claimId: number, skipLoadingState = false) => {
    if (!selectedTask?.content_id) return;

    if (!skipLoadingState) {
      setIsLoading(true);
    }
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

      // Fetch the user's normalized running score for this claim
      console.log(
        "🎯 Fetching user normalized score for claim:",
        claimId,
        "user:",
        user?.user_id,
      );
      const claimScores = await fetchClaimScoresForTask(
        selectedTask.content_id,
        user?.user_id || null,
      );
      const normalizedScore = claimScores[claimId] ?? null;
      console.log("📊 User normalized score for claim:", normalizedScore);

      const focus: FocusClaim = {
        claim_id: claimId,
        claim_text: claimData?.label || "Loading...",
        claim_type: "case",
        verimeter_score:
          normalizedScore !== null ? Math.round(normalizedScore) : 50, // Use normalized score or default
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
      if (!skipLoadingState) {
        setIsLoading(false);
      }
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
        (c) =>
          c.relevance_score > 0 &&
          !hiddenSources.includes(c.reference_content_id),
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

  // Touch/swipe handlers for mobile navigation
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      handleNextCandidate();
    } else if (isRightSwipe) {
      handlePreviousCandidate();
    }
  };

  // Mouse drag handlers for desktop
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    const distance = dragStartX - e.clientX;
    const isLeftDrag = distance > minSwipeDistance;
    const isRightDrag = distance < -minSwipeDistance;
    if (isLeftDrag) {
      handleNextCandidate();
    } else if (isRightDrag) {
      handlePreviousCandidate();
    }
  };

  const onMouseLeave = () => {
    setIsDragging(false);
  };

  const handleRelationshipClick = (
    relationshipType: "supports" | "refutes" | "context",
  ) => {
    if (!candidates[currentCandidateIndex]) return;

    const currentCandidate = candidates[currentCandidateIndex];

    // Calculate support level based on relationship and AI confidence
    let supportLevel = 0;
    if (relationshipType === "supports") {
      supportLevel = currentCandidate.ai_confidence || 1.0;
    } else if (relationshipType === "refutes") {
      supportLevel = -(currentCandidate.ai_confidence || 1.0);
    } else if (relationshipType === "context") {
      supportLevel = currentCandidate.ai_confidence
        ? currentCandidate.ai_confidence * 0.5
        : 0.5;
    }

    setModalSupportLevel(supportLevel);
    setIsLinkModalOpen(true);
  };

  const handleLinkCreated = async () => {
    // Reload focus claim to update verimeter score
    if (focusClaim?.claim_id) {
      await loadFocusClaim(focusClaim.claim_id);
    }

    // Reload game score after creating link
    if (selectedTask?.content_id && user?.user_id) {
      try {
        const totalScore = await getClaimLinkScore(
          selectedTask.content_id,
          user.user_id,
        );
        setUserScore(totalScore);
        console.log(`🎮 Updated game score: ${totalScore}`);
      } catch (error) {
        console.error("❌ Error reloading game score:", error);
      }
    }

    // Move to next candidate
    handleNextCandidate();
    setIsLinkModalOpen(false);
  };

  const handleHideSource = () => {
    if (!user?.user_id || !candidates[currentCandidateIndex]) return;

    const currentCandidate = candidates[currentCandidateIndex];
    const contentId = currentCandidate.reference_content_id;

    // Add to hidden sources
    const newHiddenSources = [...hiddenSources, contentId];
    setHiddenSources(newHiddenSources);

    // Save to localStorage
    localStorage.setItem(
      `hidden_sources_user_${user.user_id}`,
      JSON.stringify(newHiddenSources),
    );

    // Remove from candidates list
    const updatedCandidates = candidates.filter(
      (c) => c.reference_content_id !== contentId,
    );
    setCandidates(updatedCandidates);

    // Adjust current index if needed
    if (
      currentCandidateIndex >= updatedCandidates.length &&
      updatedCandidates.length > 0
    ) {
      setCurrentCandidateIndex(updatedCandidates.length - 1);
    }

    toast({
      title: "Source hidden",
      description: "This source will no longer appear in your feed",
      status: "info",
      duration: 3000,
    });
  };

  const handleResetEvaluation = async () => {
    if (!focusClaim || !selectedTask?.content_id || !user?.user_id) return;

    if (
      !confirm(
        `Reset your evaluation for this claim? This will delete all your evaluations and reset the score to 50%.`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reset-claim-evaluation/${selectedTask.content_id}/${focusClaim.claim_id}/${user.user_id}`,
        { method: "DELETE", credentials: "include" },
      );

      if (!response.ok) throw new Error("Failed to reset evaluation");

      toast({
        title: "Evaluation Reset",
        description: "Your evaluation has been reset. Score is now 50%.",
        status: "success",
        duration: 3000,
      });

      await loadFocusClaim(focusClaim.claim_id);
    } catch (error) {
      console.error("Error resetting evaluation:", error);
      toast({
        title: "Reset Failed",
        description: "Could not reset evaluation",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleSelectClaim = (claimId: number, isNavigating = false) => {
    loadFocusClaim(claimId, isNavigating);
    // Update current index when claim is selected
    const index = availableCaseClaims.findIndex((c) => c.claim_id === claimId);
    if (index !== -1) {
      setCurrentCaseClaimIndex(index);
    }
  };

  // Navigation functions for case claims with smooth transitions
  const goToNextCaseClaim = async () => {
    if (
      currentCaseClaimIndex < availableCaseClaims.length - 1 &&
      !isTransitioning
    ) {
      setIsTransitioning(true);
      setSlideDirection("left"); // Next slides from right to left

      // Small delay for slide-out animation
      setTimeout(() => {
        const newIndex = currentCaseClaimIndex + 1;
        setCurrentCaseClaimIndex(newIndex);
        handleSelectClaim(availableCaseClaims[newIndex].claim_id, true); // Skip loading state

        // Reset animation state after content loads
        setTimeout(() => {
          setSlideDirection(null);
          setIsTransitioning(false);
        }, 50);
      }, 200);
    }
  };

  const goToPreviousCaseClaim = async () => {
    if (currentCaseClaimIndex > 0 && !isTransitioning) {
      setIsTransitioning(true);
      setSlideDirection("right"); // Previous slides from left to right

      // Small delay for slide-out animation
      setTimeout(() => {
        const newIndex = currentCaseClaimIndex - 1;
        setCurrentCaseClaimIndex(newIndex);
        handleSelectClaim(availableCaseClaims[newIndex].claim_id, true); // Skip loading state

        // Reset animation state after content loads
        setTimeout(() => {
          setSlideDirection(null);
          setIsTransitioning(false);
        }, 50);
      }, 200);
    }
  };

  const loadLinkedClaims = async () => {
    if (!focusClaim) return;
    try {
      const links = await fetchReferenceClaimTaskLinks(focusClaim.claim_id);
      setLinkedClaims(links || []);
    } catch (error) {
      console.error("Error loading linked claims:", error);
      setLinkedClaims([]);
    }
  };

  const handleOpenLinkedClaimsModal = async () => {
    await loadLinkedClaims();
    onOpenLinkedClaimsModal();
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

  if (!focusClaim && availableCaseClaims.length === 0 && !isLoading) {
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
        <Flex
          h="100vh"
          align="center"
          justify="center"
          position="relative"
          zIndex={1}
        >
          <VStack spacing={6}>
            <Text
              color="#71dbff"
              fontSize="2xl"
              fontWeight="700"
              textShadow="0 0 20px rgba(113, 219, 255, 0.5)"
            >
              No Claims Found
            </Text>
            <Text color="#89a9bf" fontSize="md" maxW="400px" textAlign="center">
              This case doesn't have any claims yet. Add some claims in the
              workspace first.
            </Text>
            <Button
              onClick={() => navigate("/workspace")}
              bg="rgba(113, 219, 255, 0.15)"
              borderRadius="12px"
              border="1px solid"
              borderColor="rgba(113, 219, 255, 0.3)"
              color="#71dbff"
              _hover={{
                bg: "rgba(113, 219, 255, 0.25)",
                borderColor: "rgba(113, 219, 255, 0.5)",
              }}
            >
              Go to Workspace
            </Button>
          </VStack>
        </Flex>
      </Box>
    );
  }

  // When no claim is selected but claims are available, show a prompt
  // The drawer will auto-open via useEffect above
  if (!focusClaim && availableCaseClaims.length > 0) {
    // Render the main layout with the drawer (drawer will auto-open)
    // Don't return early - fall through to main render
  }

  const currentCandidate = candidates[currentCandidateIndex];

  // Helper function to render claim button with actual text
  const renderClaimButton = (link: any, idx: number) => {
    const stanceColors = {
      supports: {
        border: "rgba(97, 239, 184, 0.4)",
        badge: "#61efb8",
        badgeBg: "rgba(97, 239, 184, 0.2)",
      },
      refutes: {
        border: "rgba(255, 108, 136, 0.4)",
        badge: "#ff6c88",
        badgeBg: "rgba(255, 108, 136, 0.2)",
      },
      context: {
        border: "rgba(120, 168, 255, 0.4)",
        badge: "#78a8ff",
        badgeBg: "rgba(120, 168, 255, 0.2)",
      },
    };

    const stance = link.relationship_type || link.stance || "supports";
    const colors =
      stanceColors[stance as keyof typeof stanceColors] ||
      stanceColors.supports;

    return (
      <Button
        key={`claim-${idx}`}
        h="auto"
        py={4}
        px={6}
        bg={colors.badgeBg}
        backdropFilter="blur(10px)"
        borderRadius="24px"
        border="2px solid"
        borderColor={colors.border}
        boxShadow={`0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px ${colors.border}, inset 0 2px 0 rgba(255, 255, 255, 0.15)`}
        justifyContent="flex-start"
        textAlign="left"
        whiteSpace="normal"
        position="relative"
        overflow="visible"
        _hover={{
          transform: "translateY(-2px) translateZ(0)",
          boxShadow: `0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px ${colors.border}, inset 0 3px 0 rgba(255, 255, 255, 0.2)`,
        }}
      >
        {/* Curved left edge for MR1 */}
        {styleMode === "mr1" && (
          <Box
            position="absolute"
            left={0}
            top={0}
            width="28px"
            height="100%"
            background={`linear-gradient(90deg, ${colors.border} 0%, transparent 100%)`}
            borderLeftRadius="24px"
            pointerEvents="none"
            zIndex={0}
          />
        )}

        {/* MR2: Squared beveled edges */}
        {getSquaredBeveledEdges()}

        <VStack
          align="flex-start"
          spacing={2}
          w="100%"
          position="relative"
          zIndex={1}
        >
          <Badge
            fontSize="10px"
            px={3}
            py={1}
            borderRadius="999px"
            bg={colors.badgeBg}
            color={colors.badge}
            border="1px solid"
            borderColor={colors.border}
            textTransform="uppercase"
          >
            {stance}
          </Badge>
          <Text
            fontSize="14px"
            color="#d4e9ff"
            lineHeight="1.4"
            fontWeight="500"
          >
            {link.claim_text ||
              link.evidence_text ||
              "Claim text not available"}
          </Text>
        </VStack>
      </Button>
    );
  };

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
      <VStack spacing={2} p={6} pt={2} position="relative" zIndex={1}>
        {/* Claim Selector - Vertical Grid */}
        {!focusClaim && availableCaseClaims.length > 0 && (
          <Box w="full" mb={4}>
            <VStack spacing={6} align="stretch">
              <Text
                fontSize="14px"
                fontWeight="700"
                textTransform="uppercase"
                letterSpacing="0.12em"
                color="#71dbff"
                textShadow="0 0 20px rgba(113, 219, 255, 0.5)"
                textAlign="center"
              >
                Select Case Claim to Analyze
              </Text>

              <VStack spacing={4} py={4} px={2}>
                {availableCaseClaims.map((claim, idx) => (
                  <Box
                    key={claim.claim_id}
                    w="full"
                    bg="linear-gradient(180deg, rgba(15, 28, 46, 0.85), rgba(8, 16, 27, 0.75))"
                    backdropFilter="blur(20px)"
                    borderRadius="20px"
                    border="2px solid"
                    borderColor="rgba(113, 219, 255, 0.35)"
                    boxShadow="0 8px 28px rgba(0, 0, 0, 0.5), 0 0 30px rgba(113, 219, 255, 0.25), inset 0 2px 0 rgba(255, 255, 255, 0.12)"
                    px={6}
                    py={4}
                    cursor="pointer"
                    position="relative"
                    overflow="visible"
                    transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                    transform="translateY(0) translateZ(0)"
                    _hover={{
                      transform: "translateY(-4px) translateZ(0)",
                      borderColor: "rgba(148, 221, 255, 0.5)",
                      boxShadow:
                        "0 12px 40px rgba(0, 0, 0, 0.6), 0 0 40px rgba(113, 219, 255, 0.35), inset 0 3px 0 rgba(255, 255, 255, 0.18)",
                    }}
                    onClick={() => handleSelectClaim(claim.claim_id)}
                  >
                    {/* Curved left edge gradient */}
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      width="24px"
                      height="100%"
                      background="linear-gradient(90deg, rgba(113, 219, 255, 0.5) 0%, transparent 100%)"
                      borderLeftRadius="20px"
                      pointerEvents="none"
                      zIndex={0}
                    />

                    {/* Holographic scan line effect */}
                    <Box
                      position="absolute"
                      top={0}
                      left={0}
                      right={0}
                      height="2px"
                      bgGradient="linear(90deg, transparent, rgba(113, 219, 255, 0.8), transparent)"
                      animation={`${scanLine} 3s infinite`}
                      opacity={0.3}
                      pointerEvents="none"
                      zIndex={1}
                    />

                    <VStack
                      align="stretch"
                      spacing={3}
                      position="relative"
                      zIndex={2}
                      w="full"
                    >
                      {/* Top row: Claim number, title, and sources count */}
                      <HStack
                        spacing={3}
                        justify="space-between"
                        flexWrap="wrap"
                      >
                        <HStack spacing={3}>
                          <Badge
                            px={3}
                            py={1}
                            borderRadius="999px"
                            bg="rgba(113, 219, 255, 0.15)"
                            border="1px solid"
                            borderColor="rgba(113, 219, 255, 0.4)"
                            fontSize="11px"
                            fontWeight="700"
                            color="#71dbff"
                            textTransform="uppercase"
                            letterSpacing="0.08em"
                            whiteSpace="nowrap"
                          >
                            Claim {idx + 1} of {availableCaseClaims.length}
                          </Badge>
                          <Badge
                            px={3}
                            py={1}
                            borderRadius="999px"
                            bg="rgba(97, 239, 184, 0.15)"
                            border="1px solid"
                            borderColor="rgba(97, 239, 184, 0.4)"
                            fontSize="11px"
                            fontWeight="600"
                            color="#61efb8"
                            maxW="400px"
                            overflow="hidden"
                            textOverflow="ellipsis"
                            whiteSpace="nowrap"
                          >
                            {selectedTask?.content_name || "Case"}
                          </Badge>
                        </HStack>
                        <Badge
                          px={3}
                          py={1}
                          borderRadius="999px"
                          bg="rgba(167, 139, 250, 0.15)"
                          border="1px solid"
                          borderColor="rgba(167, 139, 250, 0.4)"
                          fontSize="10px"
                          color="#a78bfa"
                          whiteSpace="nowrap"
                        >
                          {claim.linkedSourceCount} sources
                        </Badge>
                      </HStack>

                      {/* Claim text */}
                      <Text
                        fontSize="16px"
                        lineHeight="1.3"
                        fontWeight="600"
                        color="#e4f4ff"
                        textShadow="0 1px 2px rgba(0, 0, 0, 0.5)"
                      >
                        {claim.label}
                      </Text>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            </VStack>
          </Box>
        )}

        {/* Main Workspace - 3 columns */}
        {focusClaim && (
          <Box position="relative" w="full">
            <Grid
              templateColumns={{
                base: "minmax(0, 1fr)",
                lg: "minmax(0, 1fr) minmax(0, 1fr)",
                xl: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
              }}
              gap={8}
              w="full"
              maxW={{ base: "100%", xl: "none" }}
              alignItems="start"
              mt="8px"
            >
              {/* Left: Case Claim Focus */}
              <Box
                minW={0}
                w="full"
                borderRadius={styleMode === "mr1" ? "28px" : "0"}
                {...getPanelBorder()}
                {...getPanelBackground()}
                backdropFilter={styleMode === "mr1" ? "blur(18px)" : "none"}
                p={6}
                pt={4}
                minH="820px"
                position="relative"
                overflow="hidden"
                _before={
                  styleMode === "mr2"
                    ? {
                        content: '""',
                        position: "absolute",
                        inset: "8px",
                        background: "linear-gradient(180deg, #1c262f, #0b1015)",
                        clipPath:
                          "polygon(38px 0, calc(100% - 38px) 0, 100% 38px, 100% calc(100% - 38px), calc(100% - 38px) 100%, 38px 100%, 0 calc(100% - 38px), 0 38px)",
                        boxShadow:
                          "inset 0 2px 0 rgba(255, 255, 255, 0.06), inset 0 -12px 20px rgba(0, 0, 0, 0.72), inset 0 14px 20px rgba(255, 255, 255, 0.02)",
                        zIndex: 0,
                      }
                    : undefined
                }
                _after={
                  styleMode === "mr2"
                    ? {
                        content: '""',
                        position: "absolute",
                        inset: "18px",
                        background: "linear-gradient(180deg, #121920, #090d11)",
                        clipPath:
                          "polygon(30px 0, calc(100% - 30px) 0, 100% 30px, 100% calc(100% - 30px), calc(100% - 30px) 100%, 30px 100%, 0 calc(100% - 30px), 0 30px)",
                        boxShadow:
                          "inset 0 2px 0 rgba(255, 255, 255, 0.03), inset 0 -8px 14px rgba(0, 0, 0, 0.82), inset 0 0 0 2px rgba(255, 255, 255, 0.015)",
                        zIndex: 0,
                      }
                    : undefined
                }
              >
                {/* MR1: Blue weave pattern */}
                {styleMode === "mr1" && (
                  <>
                    {/* Radiant glow from lower right corner */}
                    <Box
                      position="absolute"
                      inset="0"
                      bgGradient="radial-gradient(circle at bottom right, rgba(113, 219, 255, 0.28) 0%, rgba(50, 120, 180, 0.15) 35%, transparent 70%)"
                      pointerEvents="none"
                      zIndex={0}
                    />
                    {/* Tight scanline pattern like unified header cards */}
                    <Box
                      position="absolute"
                      inset="0"
                      bgImage="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
                      pointerEvents="none"
                      zIndex={0}
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
                      zIndex={1}
                    />
                  </>
                )}

                {/* MR2: Squared-off 3D beveled edges */}
                {getSquaredBeveledEdges()}

                <VStack
                  align="stretch"
                  spacing={3}
                  position="relative"
                  zIndex={1}
                >
                  {focusClaim && (
                    /* Claim Selected - Show Details */
                    <>
                      {/* Case Claim Title */}
                      <HStack
                        justify="space-between"
                        align="center"
                        h="24px"
                        mt={0}
                      >
                        <Text
                          fontSize="11px"
                          textTransform="uppercase"
                          letterSpacing="0.09em"
                          fontWeight="600"
                          color="#89a9bf"
                        >
                          CASE CLAIM
                        </Text>
                      </HStack>
                      {/*<HStack
                        justify="space-between"
                        align="center"
                        h="28px"
                        mt="0"
                      >
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
                          h="28px"
                          px={3}
                        >
                          Case Claim (change)
                        </Button>
                        <HStack spacing={1}>
                        </HStack>
                      </HStack>*/}

                      {/* Case Claim Navigation - Matching Source Claims Style */}
                      {availableCaseClaims.length > 1 && (
                        <HStack
                          spacing={3}
                          px={4}
                          py={3}
                          borderRadius="999px"
                          border="1px solid"
                          borderColor={
                            styleMode === "mr1"
                              ? "rgba(113, 219, 255, 0.22)"
                              : "rgba(113, 219, 255, 0.3)"
                          }
                          bg={
                            styleMode === "mr1"
                              ? "rgba(255, 255, 255, 0.035)"
                              : "linear-gradient(180deg, rgba(113, 219, 255, 0.12), rgba(113, 219, 255, 0.06))"
                          }
                          boxShadow={
                            styleMode === "mr1"
                              ? "0 6px 20px rgba(0, 0, 0, 0.3)"
                              : "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                          }
                        >
                          {/* Left Navigation Button */}
                          <Button
                            bg="linear-gradient(135deg, rgba(113, 219, 255, 0.3) 0%, rgba(70, 170, 220, 0.5) 100%)"
                            backdropFilter="blur(12px)"
                            border="2px solid rgba(113, 219, 255, 0.5)"
                            borderRadius="10px"
                            w="40px"
                            h="28px"
                            minW="40px"
                            p={0}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            boxShadow={`
                            0 6px 16px rgba(0, 0, 0, 0.6),
                            inset 0 2px 4px rgba(255, 255, 255, 0.2),
                            inset 0 -2px 4px rgba(0, 0, 0, 0.2)
                          `}
                            transition="all 0.2s ease"
                            _hover={{
                              bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)",
                              transform: "scale(1.05)",
                              boxShadow: `
                              0 8px 20px rgba(0, 0, 0, 0.7),
                              inset 0 2px 6px rgba(255, 255, 255, 0.25),
                              inset 0 -2px 6px rgba(0, 0, 0, 0.25)
                            `,
                            }}
                            _active={{
                              transform: "scale(0.97)",
                              boxShadow: `
                              0 4px 12px rgba(0, 0, 0, 0.5),
                              inset 0 1px 3px rgba(255, 255, 255, 0.15),
                              inset 0 -1px 3px rgba(0, 0, 0, 0.15)
                            `,
                            }}
                            _disabled={{
                              opacity: 0.3,
                              cursor: "not-allowed",
                            }}
                            onClick={goToPreviousCaseClaim}
                            isDisabled={currentCaseClaimIndex === 0}
                          >
                            <ChevronLeftIcon boxSize={5} />
                          </Button>

                          {/* Progress Bar with Centered Text */}
                          <Box
                            flex="1"
                            h="28px"
                            borderRadius="14px"
                            bg="rgba(255, 255, 255, 0.05)"
                            border="2px solid"
                            borderColor="rgba(255, 255, 255, 0.08)"
                            overflow="hidden"
                            boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.6)"
                            position="relative"
                          >
                            {/* Progress Fill */}
                            <Box
                              h="full"
                              w={`${availableCaseClaims.length > 0 ? ((currentCaseClaimIndex + 1) / availableCaseClaims.length) * 100 : 0}%`}
                              bgGradient="linear(90deg, #71dbff, #78a8ff)"
                              boxShadow="0 0 18px rgba(113, 219, 255, 0.2)"
                              transition="width 0.3s ease"
                            />
                            {/* Centered Progress Text */}
                            <Text
                              position="absolute"
                              top="50%"
                              left="50%"
                              transform="translate(-50%, -50%)"
                              fontSize="13px"
                              fontWeight="600"
                              color="#fff"
                              textShadow="0 1px 3px rgba(0, 0, 0, 0.8)"
                              pointerEvents="none"
                            >
                              {currentCaseClaimIndex + 1} of{" "}
                              {availableCaseClaims.length}
                            </Text>
                          </Box>

                          {/* Right Navigation Button */}
                          <Button
                            bg="linear-gradient(135deg, rgba(113, 219, 255, 0.3) 0%, rgba(70, 170, 220, 0.5) 100%)"
                            backdropFilter="blur(12px)"
                            border="2px solid rgba(113, 219, 255, 0.5)"
                            borderRadius="10px"
                            w="40px"
                            h="28px"
                            minW="40px"
                            p={0}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            boxShadow={`
                            0 6px 16px rgba(0, 0, 0, 0.6),
                            inset 0 2px 4px rgba(255, 255, 255, 0.2),
                            inset 0 -2px 4px rgba(0, 0, 0, 0.2)
                          `}
                            transition="all 0.2s ease"
                            _hover={{
                              bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)",
                              transform: "scale(1.05)",
                              boxShadow: `
                              0 8px 20px rgba(0, 0, 0, 0.7),
                              inset 0 2px 6px rgba(255, 255, 255, 0.25),
                              inset 0 -2px 6px rgba(0, 0, 0, 0.25)
                            `,
                            }}
                            _active={{
                              transform: "scale(0.97)",
                              boxShadow: `
                              0 4px 12px rgba(0, 0, 0, 0.5),
                              inset 0 1px 3px rgba(255, 255, 255, 0.15),
                              inset 0 -1px 3px rgba(0, 0, 0, 0.15)
                            `,
                            }}
                            _disabled={{
                              opacity: 0.3,
                              cursor: "not-allowed",
                            }}
                            onClick={goToNextCaseClaim}
                            isDisabled={
                              currentCaseClaimIndex ===
                              availableCaseClaims.length - 1
                            }
                          >
                            <ChevronRightIcon boxSize={5} />
                          </Button>
                        </HStack>
                      )}

                      {/* Scrolling Case Claims */}
                      <Box
                        ref={leftRailViewportRef}
                        flex="1"
                        overflowX="hidden"
                        overflowY="hidden"
                        position="relative"
                      >
                        <Flex
                          ref={leftRailFlexRef}
                          align="stretch"
                          pb={2}
                          position="relative"
                          transition="transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                          transform={`translateX(${leftRailTranslate}px)`}
                        >
                          {availableCaseClaims.map((claim, idx) => (
                            <Box
                              key={claim.claim_id}
                              bg="transparent"
                              backdropFilter="blur(10px)"
                              borderRadius="24px"
                              border="2px solid"
                              borderColor="rgba(113, 219, 255, 0.4)"
                              boxShadow="0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                              p={{ base: 2, lg: 4, xl: 6 }}
                              pl={{ base: 3, lg: 5, xl: 8 }}
                              pb={{ base: 20, xl: 24 }}
                              w={{ base: "90%", lg: "85%", xl: "90%" }}
                              maxW={{ base: "360px", lg: "420px", xl: "440px" }}
                              minH={{ base: "400px", xl: "600px" }}
                              position="relative"
                              flexShrink={0}
                              mr={{ base: 2, lg: 4, xl: 5 }}
                              opacity={idx === currentCaseClaimIndex ? 1 : 0.5}
                              transition="all 0.4s ease"
                              pointerEvents={
                                idx === currentCaseClaimIndex ? "auto" : "none"
                              }
                              transform="translateZ(0)"
                              _hover={
                                idx === currentCaseClaimIndex
                                  ? {
                                      transform:
                                        "translateY(-4px) translateZ(0)",
                                      boxShadow:
                                        "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(113, 219, 255, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)",
                                    }
                                  : {}
                              }
                            >
                              {/* Curved left edge - matching source claims */}
                              {styleMode === "mr1" && (
                                <Box
                                  position="absolute"
                                  left={0}
                                  top={0}
                                  width="28px"
                                  height="100%"
                                  background="linear-gradient(90deg, rgba(113, 219, 255, 0.5) 0%, transparent 100%)"
                                  borderLeftRadius="24px"
                                  pointerEvents="none"
                                  zIndex={0}
                                />
                              )}

                              {/* MR2: Squared-off 3D beveled edges */}
                              {getSquaredBeveledEdges()}

                              {/* Case Title Box */}
                              <Tooltip
                                label={
                                  availableCaseClaims.find(
                                    (c) => c.claim_id === focusClaim?.claim_id,
                                  )?.label || "Case claim"
                                }
                                placement="top"
                                hasArrow
                              >
                                <Box
                                  p={3}
                                  mb={3}
                                  borderRadius="18px"
                                  {...(styleMode === "mr1"
                                    ? {
                                        border: "2px solid",
                                        borderColor: "rgba(113, 219, 255, 0.4)",
                                        bg: "rgba(113, 219, 255, 0.15)",
                                        boxShadow:
                                          "0 6px 20px rgba(0, 0, 0, 0.4), 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 20px rgba(113, 219, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                                        _hover: {
                                          transform:
                                            "translateY(-2px) translateZ(0)",
                                          boxShadow:
                                            "0 8px 28px rgba(0, 0, 0, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 30px rgba(113, 219, 255, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.2)",
                                        },
                                      }
                                    : {
                                        border: "1px solid",
                                        borderColor: "rgba(113, 219, 255, 0.3)",
                                        bg: "linear-gradient(180deg, rgba(113, 219, 255, 0.18), rgba(113, 219, 255, 0.08))",
                                        boxShadow:
                                          "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)",
                                      })}
                                  cursor="help"
                                  position="relative"
                                  overflow="visible"
                                  transform="translateZ(0)"
                                  transition="all 0.3s ease"
                                >
                                  {styleMode === "mr1" && (
                                    <Box
                                      position="absolute"
                                      left={0}
                                      top={0}
                                      width="20px"
                                      height="100%"
                                      background="linear-gradient(90deg, rgba(113, 219, 255, 0.4) 0%, transparent 100%)"
                                      borderLeftRadius="18px"
                                      pointerEvents="none"
                                      zIndex={0}
                                    />
                                  )}
                                  <Text
                                    fontSize="13px"
                                    fontWeight="700"
                                    textTransform="uppercase"
                                    letterSpacing="0.1em"
                                    color="#71dbff"
                                    whiteSpace="nowrap"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    position="relative"
                                    zIndex={1}
                                  >
                                    {availableCaseClaims.find(
                                      (c) =>
                                        c.claim_id === focusClaim?.claim_id,
                                    )?.label || "Case claim"}
                                  </Text>
                                </Box>
                              </Tooltip>

                              {/* Claim Text Box */}
                              <Box
                                mb={6}
                                p={5}
                                borderRadius="18px"
                                {...(styleMode === "mr1"
                                  ? {
                                      border: "2px solid",
                                      borderColor: "rgba(113, 219, 255, 0.35)",
                                      bg: "rgba(113, 219, 255, 0.05)",
                                      boxShadow:
                                        "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 25px rgba(113, 219, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                                    }
                                  : {
                                      border: "1px solid",
                                      borderColor: "rgba(113, 219, 255, 0.3)",
                                      bg: "linear-gradient(180deg, rgba(113, 219, 255, 0.15), rgba(113, 219, 255, 0.08))",
                                      boxShadow:
                                        "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)",
                                    })}
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                              >
                                {getCurvedEdge("cyan")}
                                <Text
                                  fontSize={{ base: "14px", xl: "24px" }}
                                  lineHeight="1.3"
                                  fontWeight="690"
                                  color="#e4f4ff"
                                  position="relative"
                                  zIndex={1}
                                >
                                  {focusClaim.claim_text}
                                </Text>
                              </Box>

                              {/* Stats Grid - 3 columns */}
                              <Grid
                                templateColumns="repeat(3, 1fr)"
                                gap={{ base: 1, xl: 3 }}
                              >
                                <Box
                                  borderRadius="18px"
                                  {...getBoxStyle("red")}
                                  p={{ base: 2, xl: 3 }}
                                  minH={{ base: "50px", xl: "72px" }}
                                  position="relative"
                                  overflow="visible"
                                  transform="translateZ(0)"
                                  transition="all 0.3s ease"
                                >
                                  {getCurvedEdge("red")}
                                  <Text
                                    fontSize="10px"
                                    textTransform="uppercase"
                                    letterSpacing="0.08em"
                                    color="rgba(228, 244, 255, 0.8)"
                                    mb={1}
                                    position="relative"
                                    zIndex={1}
                                  >
                                    REFUTES
                                  </Text>
                                  <Text
                                    fontSize="18px"
                                    fontWeight="800"
                                    color="#ff6c88"
                                    position="relative"
                                    zIndex={1}
                                  >
                                    {focusClaim.refute_count || 0}
                                  </Text>
                                </Box>

                                <Box
                                  borderRadius="18px"
                                  {...getBoxStyle("blue")}
                                  p={{ base: 2, xl: 3 }}
                                  minH={{ base: "50px", xl: "72px" }}
                                  position="relative"
                                  overflow="visible"
                                  transform="translateZ(0)"
                                  transition="all 0.3s ease"
                                >
                                  {getCurvedEdge("blue")}
                                  <Text
                                    fontSize="10px"
                                    textTransform="uppercase"
                                    letterSpacing="0.08em"
                                    color="rgba(228, 244, 255, 0.8)"
                                    mb={1}
                                    position="relative"
                                    zIndex={1}
                                  >
                                    NUANCE
                                  </Text>
                                  <Text
                                    fontSize="18px"
                                    fontWeight="800"
                                    color="#78a8ff"
                                    position="relative"
                                    zIndex={1}
                                  >
                                    {focusClaim.context_count || 0}
                                  </Text>
                                </Box>

                                <Box
                                  borderRadius="18px"
                                  {...getBoxStyle("green")}
                                  p={{ base: 2, xl: 3 }}
                                  minH={{ base: "50px", xl: "72px" }}
                                  position="relative"
                                  overflow="visible"
                                  transform="translateZ(0)"
                                  transition="all 0.3s ease"
                                >
                                  {getCurvedEdge("green")}
                                  <Text
                                    fontSize="10px"
                                    textTransform="uppercase"
                                    letterSpacing="0.08em"
                                    color="rgba(228, 244, 255, 0.8)"
                                    mb={1}
                                    position="relative"
                                    zIndex={1}
                                  >
                                    SUPPORTS
                                  </Text>
                                  <Text
                                    fontSize="18px"
                                    fontWeight="800"
                                    color="#61efb8"
                                    position="relative"
                                    zIndex={1}
                                  >
                                    {focusClaim.support_count || 0}
                                  </Text>
                                </Box>
                              </Grid>

                              {/* Verimeter Bar */}
                              {focusClaim.verimeter_score !== undefined && (
                                <Box
                                  mt={4}
                                  py={3}
                                  px={4}
                                  borderRadius="999px"
                                  border="1px solid"
                                  borderColor={
                                    styleMode === "mr1"
                                      ? "rgba(113, 219, 255, 0.22)"
                                      : "rgba(113, 219, 255, 0.3)"
                                  }
                                  bg={
                                    styleMode === "mr1"
                                      ? "rgba(255, 255, 255, 0.035)"
                                      : "linear-gradient(180deg, rgba(113, 219, 255, 0.12), rgba(113, 219, 255, 0.06))"
                                  }
                                  boxShadow={
                                    styleMode === "mr1"
                                      ? "0 6px 20px rgba(0, 0, 0, 0.3)"
                                      : "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                                  }
                                >
                                  <VerimeterMeter
                                    score={focusClaim.verimeter_score / 100}
                                    width="100%"
                                    showInterpretation={false}
                                  />
                                </Box>
                              )}

                              {/* Claim Source Info */}
                              <Box
                                mt={4}
                                p={4}
                                borderRadius="16px"
                                border="1px solid"
                                borderColor="rgba(113, 219, 255, 0.25)"
                                bg={
                                  styleMode === "mr1"
                                    ? "rgba(113, 219, 255, 0.05)"
                                    : "linear-gradient(180deg, rgba(113, 219, 255, 0.08), rgba(113, 219, 255, 0.04))"
                                }
                              >
                                <Text
                                  fontSize="10px"
                                  textTransform="uppercase"
                                  letterSpacing="0.08em"
                                  color="rgba(228, 244, 255, 0.6)"
                                  mb={2}
                                >
                                  Claim Details
                                </Text>
                                <Text
                                  fontSize="12px"
                                  color="#d4e9ff"
                                  lineHeight="1.5"
                                  mb={2}
                                >
                                  {(focusClaim.refute_count || 0) +
                                    (focusClaim.support_count || 0) +
                                    (focusClaim.context_count || 0)}{" "}
                                  total linked claims
                                </Text>
                                <Text
                                  fontSize="12px"
                                  color="#d4e9ff"
                                  lineHeight="1.5"
                                >
                                  Verimeter:{" "}
                                  {focusClaim.verimeter_score !== undefined
                                    ? (
                                        focusClaim.verimeter_score / 100
                                      ).toFixed(2)
                                    : "N/A"}
                                </Text>
                              </Box>

                              {/* Bottom Action Buttons */}
                              <HStack mt={6} spacing={3} w="100%">
                                <Button
                                  flex="1"
                                  size="md"
                                  onClick={handleOpenLinkedClaimsModal}
                                  bg={
                                    styleMode === "mr1"
                                      ? "rgba(167, 139, 250, 0.12)"
                                      : "linear-gradient(180deg, rgba(167, 139, 250, 0.18), rgba(167, 139, 250, 0.08))"
                                  }
                                  border="1px solid"
                                  borderColor="rgba(167, 139, 250, 0.3)"
                                  color="#a78bfa"
                                  boxShadow={
                                    styleMode === "mr1"
                                      ? "0 6px 20px rgba(0, 0, 0, 0.3)"
                                      : "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                                  }
                                  _hover={{
                                    bg:
                                      styleMode === "mr1"
                                        ? "rgba(167, 139, 250, 0.18)"
                                        : "linear-gradient(180deg, rgba(167, 139, 250, 0.22), rgba(167, 139, 250, 0.12))",
                                    borderColor: "rgba(167, 139, 250, 0.5)",
                                  }}
                                >
                                  View Linked Claims
                                </Button>
                              </HStack>
                            </Box>
                          ))}
                        </Flex>
                      </Box>
                    </>
                  )}
                </VStack>
              </Box>

              {/* Center: Source Claim (Scrolling Evidence) */}
              <Box
                minW={0}
                w="full"
                borderRadius={styleMode === "mr1" ? "28px" : "0"}
                {...getPanelBorder()}
                {...getPanelBackground()}
                backdropFilter={styleMode === "mr1" ? "blur(18px)" : "none"}
                p={6}
                pt={4}
                minH="820px"
                position="relative"
                overflow="hidden"
                _before={
                  styleMode === "mr2"
                    ? {
                        content: '""',
                        position: "absolute",
                        inset: "8px",
                        background: "linear-gradient(180deg, #1c262f, #0b1015)",
                        clipPath:
                          "polygon(38px 0, calc(100% - 38px) 0, 100% 38px, 100% calc(100% - 38px), calc(100% - 38px) 100%, 38px 100%, 0 calc(100% - 38px), 0 38px)",
                        boxShadow:
                          "inset 0 2px 0 rgba(255, 255, 255, 0.06), inset 0 -12px 20px rgba(0, 0, 0, 0.72), inset 0 14px 20px rgba(255, 255, 255, 0.02)",
                        zIndex: 0,
                      }
                    : undefined
                }
                _after={
                  styleMode === "mr2"
                    ? {
                        content: '""',
                        position: "absolute",
                        inset: "18px",
                        background: "linear-gradient(180deg, #121920, #090d11)",
                        clipPath:
                          "polygon(30px 0, calc(100% - 30px) 0, 100% 30px, 100% calc(100% - 30px), calc(100% - 30px) 100%, 30px 100%, 0 calc(100% - 30px), 0 30px)",
                        boxShadow:
                          "inset 0 2px 0 rgba(255, 255, 255, 0.03), inset 0 -8px 14px rgba(0, 0, 0, 0.82), inset 0 0 0 2px rgba(255, 255, 255, 0.015)",
                        zIndex: 0,
                      }
                    : undefined
                }
              >
                {/* Previous Candidate Button - Chunky 3D Knuckle */}
                <Button
                  position="absolute"
                  left="0"
                  top="50%"
                  transform="translateY(-50%) translateX(-65%)"
                  bg="linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)"
                  backdropFilter="blur(15px)"
                  border="3px solid rgba(113, 219, 255, 0.6)"
                  borderRadius="16px"
                  w="65px"
                  h="100px"
                  minW="65px"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  boxShadow={`
                  0 12px 32px rgba(0, 0, 0, 0.7),
                  inset 0 4px 8px rgba(255, 255, 255, 0.25),
                  inset 0 -4px 8px rgba(0, 0, 0, 0.3),
                  -4px 0 16px rgba(113, 219, 255, 0.4)
                `}
                  transition="all 0.2s ease"
                  zIndex={10}
                  _hover={{
                    bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.5) 0%, rgba(70, 170, 220, 0.7) 100%)",
                    transform: "translateY(-50%) translateX(-68%) scale(1.05)",
                    boxShadow: `
                    0 16px 40px rgba(0, 0, 0, 0.8),
                    inset 0 4px 12px rgba(255, 255, 255, 0.3),
                    inset 0 -4px 12px rgba(0, 0, 0, 0.4),
                    -6px 0 20px rgba(113, 219, 255, 0.6)
                  `,
                  }}
                  _active={{
                    transform: "translateY(-50%) translateX(-66%) scale(0.98)",
                    boxShadow: `
                    0 8px 24px rgba(0, 0, 0, 0.6),
                    inset 0 2px 6px rgba(255, 255, 255, 0.2),
                    inset 0 -2px 6px rgba(0, 0, 0, 0.3)
                  `,
                  }}
                  _disabled={{
                    opacity: 0.2,
                    cursor: "not-allowed",
                    transform: "translateY(-50%) translateX(-65%)",
                  }}
                  onClick={handlePreviousCandidate}
                  isDisabled={currentCandidateIndex === 0}
                >
                  <ChevronLeftIcon boxSize={10} />
                </Button>

                {/* Next Candidate Button - Chunky 3D Knuckle */}
                <Button
                  position="absolute"
                  right="0"
                  top="50%"
                  transform="translateY(-50%) translateX(65%)"
                  bg="linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)"
                  backdropFilter="blur(15px)"
                  border="3px solid rgba(113, 219, 255, 0.6)"
                  borderRadius="16px"
                  w="65px"
                  h="100px"
                  minW="65px"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  boxShadow={`
                  0 12px 32px rgba(0, 0, 0, 0.7),
                  inset 0 4px 8px rgba(255, 255, 255, 0.25),
                  inset 0 -4px 8px rgba(0, 0, 0, 0.3),
                  4px 0 16px rgba(113, 219, 255, 0.4)
                `}
                  transition="all 0.2s ease"
                  zIndex={10}
                  _hover={{
                    bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.5) 0%, rgba(70, 170, 220, 0.7) 100%)",
                    transform: "translateY(-50%) translateX(68%) scale(1.05)",
                    boxShadow: `
                    0 16px 40px rgba(0, 0, 0, 0.8),
                    inset 0 4px 12px rgba(255, 255, 255, 0.3),
                    inset 0 -4px 12px rgba(0, 0, 0, 0.4),
                    6px 0 20px rgba(113, 219, 255, 0.6)
                  `,
                  }}
                  _active={{
                    transform: "translateY(-50%) translateX(66%) scale(0.98)",
                    boxShadow: `
                    0 8px 24px rgba(0, 0, 0, 0.6),
                    inset 0 2px 6px rgba(255, 255, 255, 0.2),
                    inset 0 -2px 6px rgba(0, 0, 0, 0.3)
                  `,
                  }}
                  _disabled={{
                    opacity: 0.2,
                    cursor: "not-allowed",
                    transform: "translateY(-50%) translateX(65%)",
                  }}
                  onClick={handleNextCandidate}
                  isDisabled={currentCandidateIndex === candidates.length - 1}
                >
                  <ChevronRightIcon boxSize={10} />
                </Button>

                {/* MR1: Blue weave pattern */}
                {styleMode === "mr1" && (
                  <>
                    {/* Radiant glow from lower right corner */}
                    <Box
                      position="absolute"
                      inset="0"
                      bgGradient="radial-gradient(circle at bottom right, rgba(113, 219, 255, 0.28) 0%, rgba(50, 120, 180, 0.15) 35%, transparent 70%)"
                      pointerEvents="none"
                      zIndex={0}
                    />
                    {/* Tight scanline pattern like unified header cards */}
                    <Box
                      position="absolute"
                      inset="0"
                      bgImage="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
                      pointerEvents="none"
                      zIndex={0}
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
                      zIndex={1}
                    />
                  </>
                )}

                {/* MR2: Squared-off 3D beveled edges */}
                {getSquaredBeveledEdges()}

                <VStack
                  align="stretch"
                  spacing={3}
                  position="relative"
                  h="full"
                  zIndex={1}
                >
                  <HStack
                    justify="space-between"
                    align="center"
                    h="24px"
                    mt={0}
                  >
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      fontWeight="600"
                      color="#89a9bf"
                    >
                      SOURCE CLAIM
                    </Text>
                  </HStack>

                  {/* Progress Bar */}
                  <HStack
                    spacing={3}
                    px={4}
                    py={3}
                    borderRadius="999px"
                    border="1px solid"
                    borderColor={
                      styleMode === "mr1"
                        ? "rgba(113, 219, 255, 0.22)"
                        : "rgba(113, 219, 255, 0.3)"
                    }
                    bg={
                      styleMode === "mr1"
                        ? "rgba(255, 255, 255, 0.035)"
                        : "linear-gradient(180deg, rgba(113, 219, 255, 0.12), rgba(113, 219, 255, 0.06))"
                    }
                    boxShadow={
                      styleMode === "mr1"
                        ? "0 6px 20px rgba(0, 0, 0, 0.3)"
                        : "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                    }
                  >
                    {/* Left Navigation Button */}
                    <Button
                      bg="linear-gradient(135deg, rgba(113, 219, 255, 0.3) 0%, rgba(70, 170, 220, 0.5) 100%)"
                      backdropFilter="blur(12px)"
                      border="2px solid rgba(113, 219, 255, 0.5)"
                      borderRadius="10px"
                      w="40px"
                      h="28px"
                      minW="40px"
                      p={0}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      boxShadow={`
                      0 6px 16px rgba(0, 0, 0, 0.6),
                      inset 0 2px 4px rgba(255, 255, 255, 0.2),
                      inset 0 -2px 4px rgba(0, 0, 0, 0.2)
                    `}
                      transition="all 0.2s ease"
                      _hover={{
                        bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)",
                        transform: "scale(1.05)",
                        boxShadow: `
                        0 8px 20px rgba(0, 0, 0, 0.7),
                        inset 0 2px 6px rgba(255, 255, 255, 0.25),
                        inset 0 -2px 6px rgba(0, 0, 0, 0.25)
                      `,
                      }}
                      _active={{
                        transform: "scale(0.97)",
                        boxShadow: `
                        0 4px 12px rgba(0, 0, 0, 0.5),
                        inset 0 1px 3px rgba(255, 255, 255, 0.15),
                        inset 0 -1px 3px rgba(0, 0, 0, 0.15)
                      `,
                      }}
                      _disabled={{
                        opacity: 0.3,
                        cursor: "not-allowed",
                      }}
                      onClick={handlePreviousCandidate}
                      isDisabled={currentCandidateIndex === 0}
                    >
                      <ChevronLeftIcon boxSize={5} />
                    </Button>

                    {/* Progress Bar with Centered Text */}
                    <Box
                      flex="1"
                      h="28px"
                      borderRadius="14px"
                      bg="rgba(255, 255, 255, 0.05)"
                      border="2px solid"
                      borderColor="rgba(255, 255, 255, 0.08)"
                      overflow="hidden"
                      boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.6)"
                      position="relative"
                    >
                      {/* Progress Fill */}
                      <Box
                        h="full"
                        w={`${candidates.length > 0 ? ((currentCandidateIndex + 1) / candidates.length) * 100 : 0}%`}
                        bgGradient="linear(90deg, #71dbff, #78a8ff)"
                        boxShadow="0 0 18px rgba(113, 219, 255, 0.2)"
                        transition="width 0.3s ease"
                      />
                      {/* Centered Progress Text */}
                      <Text
                        position="absolute"
                        top="50%"
                        left="50%"
                        transform="translate(-50%, -50%)"
                        fontSize="13px"
                        fontWeight="600"
                        color="#fff"
                        textShadow="0 1px 3px rgba(0, 0, 0, 0.8)"
                        pointerEvents="none"
                      >
                        {currentCandidateIndex + 1} of {candidates.length}
                      </Text>
                    </Box>

                    {/* Right Navigation Button */}
                    <Button
                      bg="linear-gradient(135deg, rgba(113, 219, 255, 0.3) 0%, rgba(70, 170, 220, 0.5) 100%)"
                      backdropFilter="blur(12px)"
                      border="2px solid rgba(113, 219, 255, 0.5)"
                      borderRadius="10px"
                      w="40px"
                      h="28px"
                      minW="40px"
                      p={0}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      boxShadow={`
                      0 6px 16px rgba(0, 0, 0, 0.6),
                      inset 0 2px 4px rgba(255, 255, 255, 0.2),
                      inset 0 -2px 4px rgba(0, 0, 0, 0.2)
                    `}
                      transition="all 0.2s ease"
                      _hover={{
                        bg: "linear-gradient(135deg, rgba(113, 219, 255, 0.4) 0%, rgba(70, 170, 220, 0.6) 100%)",
                        transform: "scale(1.05)",
                        boxShadow: `
                        0 8px 20px rgba(0, 0, 0, 0.7),
                        inset 0 2px 6px rgba(255, 255, 255, 0.25),
                        inset 0 -2px 6px rgba(0, 0, 0, 0.25)
                      `,
                      }}
                      _active={{
                        transform: "scale(0.97)",
                        boxShadow: `
                        0 4px 12px rgba(0, 0, 0, 0.5),
                        inset 0 1px 3px rgba(255, 255, 255, 0.15),
                        inset 0 -1px 3px rgba(0, 0, 0, 0.15)
                      `,
                      }}
                      _disabled={{
                        opacity: 0.3,
                        cursor: "not-allowed",
                      }}
                      onClick={handleNextCandidate}
                      isDisabled={
                        currentCandidateIndex === candidates.length - 1
                      }
                    >
                      <ChevronRightIcon boxSize={5} />
                    </Button>
                  </HStack>

                  {/* Scrolling Source Claims */}
                  <Box
                    ref={rightRailViewportRef}
                    flex="1"
                    overflowX="hidden"
                    overflowY="hidden"
                    position="relative"
                    cursor={isDragging ? "grabbing" : "grab"}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                    userSelect="none"
                  >
                    <Flex
                      ref={rightRailFlexRef}
                      align="stretch"
                      pb={2}
                      position="relative"
                      transition="transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                      transform={`translateX(${rightRailTranslate}px)`}
                    >
                      {candidates.map((candidate, idx) => (
                        <Box
                          key={idx}
                          bg="transparent"
                          backdropFilter="blur(10px)"
                          borderRadius="24px"
                          border="2px solid"
                          borderColor="rgba(97, 239, 184, 0.4)"
                          boxShadow="0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(97, 239, 184, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                          p={{ base: 2, lg: 4, xl: 6 }}
                          pl={{ base: 3, lg: 5, xl: 8 }}
                          w={{ base: "90%", lg: "85%", xl: "90%" }}
                          maxW={{ base: "360px", lg: "420px", xl: "440px" }}
                          minH={{ base: "400px", xl: "600px" }}
                          position="relative"
                          flexShrink={0}
                          mr={{ base: 2, lg: 4, xl: 5 }}
                          opacity={idx === currentCandidateIndex ? 1 : 0.5}
                          transition="all 0.4s ease"
                          pointerEvents={
                            idx === currentCandidateIndex ? "auto" : "none"
                          }
                          transform="translateZ(0)"
                          _hover={
                            idx === currentCandidateIndex
                              ? {
                                  transform: "translateY(-4px) translateZ(0)",
                                  boxShadow:
                                    "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(97, 239, 184, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)",
                                }
                              : {}
                          }
                        >
                          {/* MR1: Curved left edge */}
                          {styleMode === "mr1" && (
                            <Box
                              position="absolute"
                              left={0}
                              top={0}
                              width="28px"
                              height="100%"
                              background="linear-gradient(90deg, rgba(97, 239, 184, 0.5) 0%, transparent 100%)"
                              borderLeftRadius="24px"
                              pointerEvents="none"
                              zIndex={0}
                            />
                          )}

                          {/* MR2: Squared-off 3D beveled edges */}
                          {getSquaredBeveledEdges()}

                          <VStack align="stretch" spacing={3}>
                            <Tooltip
                              label={candidate.source_name || "Source claim"}
                              placement="top"
                              hasArrow
                            >
                              <Box
                                p={3}
                                mb={3}
                                borderRadius="18px"
                                {...(styleMode === "mr1"
                                  ? {
                                      border: "2px solid",
                                      borderColor: "rgba(113, 219, 255, 0.4)",
                                      bg: "rgba(113, 219, 255, 0.15)",
                                      boxShadow:
                                        "0 6px 20px rgba(0, 0, 0, 0.4), 0 3px 10px rgba(0, 0, 0, 0.3), 0 0 20px rgba(113, 219, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                                      _hover: {
                                        transform:
                                          "translateY(-2px) translateZ(0)",
                                        boxShadow:
                                          "0 8px 28px rgba(0, 0, 0, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 30px rgba(113, 219, 255, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.2)",
                                      },
                                    }
                                  : {
                                      border: "1px solid",
                                      borderColor: "rgba(113, 219, 255, 0.3)",
                                      bg: "linear-gradient(180deg, rgba(113, 219, 255, 0.18), rgba(113, 219, 255, 0.08))",
                                      boxShadow:
                                        "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)",
                                    })}
                                cursor="help"
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                              >
                                {/* Curved left edge - only in MR1 mode */}
                                {styleMode === "mr1" && (
                                  <Box
                                    position="absolute"
                                    left={0}
                                    top={0}
                                    width="20px"
                                    height="100%"
                                    background="linear-gradient(90deg, rgba(113, 219, 255, 0.4) 0%, transparent 100%)"
                                    borderLeftRadius="18px"
                                    pointerEvents="none"
                                    zIndex={0}
                                  />
                                )}
                                <Text
                                  fontSize="13px"
                                  fontWeight="700"
                                  textTransform="uppercase"
                                  letterSpacing="0.1em"
                                  color="#71dbff"
                                  whiteSpace="nowrap"
                                  overflow="hidden"
                                  textOverflow="ellipsis"
                                  position="relative"
                                  zIndex={1}
                                >
                                  {candidate.source_name?.toUpperCase() ||
                                    "SOURCE CLAIM"}
                                </Text>
                              </Box>
                            </Tooltip>

                            {/* Source Claim Text Box */}
                            <Box
                              mb={3}
                              p={5}
                              borderRadius="18px"
                              {...(styleMode === "mr1"
                                ? {
                                    border: "2px solid",
                                    borderColor: "rgba(113, 219, 255, 0.35)",
                                    bg: "rgba(113, 219, 255, 0.05)",
                                    boxShadow:
                                      "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 25px rgba(113, 219, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                                    _hover: {
                                      transform:
                                        "translateY(-2px) translateZ(0)",
                                      boxShadow:
                                        "0 10px 32px rgba(0, 0, 0, 0.5), 0 0 35px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)",
                                    },
                                  }
                                : {
                                    border: "1px solid",
                                    borderColor: "rgba(113, 219, 255, 0.3)",
                                    bg: "linear-gradient(180deg, rgba(113, 219, 255, 0.15), rgba(113, 219, 255, 0.08))",
                                    boxShadow:
                                      "inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)",
                                  })}
                              position="relative"
                              overflow="visible"
                              transform="translateZ(0)"
                              transition="all 0.3s ease"
                            >
                              {getCurvedEdge("cyan")}
                              <Text
                                fontSize={{ base: "14px", xl: "24px" }}
                                lineHeight="1.3"
                                fontWeight="690"
                                color="#e4f4ff"
                                position="relative"
                                zIndex={1}
                              >
                                {candidate.claim_text}
                              </Text>
                            </Box>

                            {/* Micro badges */}
                            <Grid
                              templateColumns="repeat(3, 1fr)"
                              gap={{ base: 1, xl: 3 }}
                            >
                              <Box
                                borderRadius="18px"
                                {...getBoxStyle("red")}
                                p={{ base: 2, xl: 3 }}
                                minH={{ base: "50px", xl: "72px" }}
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                              >
                                {getCurvedEdge("red")}
                                <Text
                                  fontSize="10px"
                                  textTransform="uppercase"
                                  letterSpacing="0.08em"
                                  color="rgba(228, 244, 255, 0.8)"
                                  mb={1}
                                  position="relative"
                                  zIndex={1}
                                >
                                  REL
                                </Text>
                                <Text
                                  fontSize="18px"
                                  fontWeight="800"
                                  color="#ff6c88"
                                  position="relative"
                                  zIndex={1}
                                >
                                  {Math.round(candidate.relevance_score || 0)}%
                                </Text>
                              </Box>

                              <Box
                                borderRadius="18px"
                                {...getBoxStyle("blue")}
                                p={{ base: 2, xl: 3 }}
                                minH={{ base: "50px", xl: "72px" }}
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                              >
                                {getCurvedEdge("blue")}
                                <Text
                                  fontSize="10px"
                                  textTransform="uppercase"
                                  letterSpacing="0.08em"
                                  color="rgba(228, 244, 255, 0.8)"
                                  mb={1}
                                  position="relative"
                                  zIndex={1}
                                >
                                  CONF
                                </Text>
                                <Text
                                  fontSize="18px"
                                  fontWeight="800"
                                  color="#78a8ff"
                                  position="relative"
                                  zIndex={1}
                                >
                                  {Math.round(
                                    (candidate.ai_confidence || 0) * 100,
                                  )}
                                </Text>
                              </Box>

                              <Box
                                borderRadius="18px"
                                {...getBoxStyle("green")}
                                p={{ base: 2, xl: 3 }}
                                minH={{ base: "50px", xl: "72px" }}
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                              >
                                {getCurvedEdge("green")}
                                <Text
                                  fontSize="10px"
                                  textTransform="uppercase"
                                  letterSpacing="0.08em"
                                  color="rgba(228, 244, 255, 0.8)"
                                  mb={1}
                                  position="relative"
                                  zIndex={1}
                                >
                                  SUPPORT
                                </Text>
                                <Text
                                  fontSize="18px"
                                  fontWeight="800"
                                  color="#61efb8"
                                  position="relative"
                                  zIndex={1}
                                >
                                  {candidate.ai_support_level
                                    ? (candidate.ai_support_level > 0
                                        ? "+"
                                        : "") +
                                      candidate.ai_support_level.toFixed(2)
                                    : "N/A"}
                                </Text>
                              </Box>
                            </Grid>

                            {/* AI Rationale */}
                            <Box
                              p={4}
                              borderRadius="18px"
                              {...getBoxStyle("gray")}
                              position="relative"
                              overflow="visible"
                              transform="translateZ(0)"
                              transition="all 0.3s ease"
                            >
                              {getCurvedEdge("gray")}
                              <Text
                                fontSize="11px"
                                textTransform="uppercase"
                                letterSpacing="0.09em"
                                color="#89a9bf"
                                mb={2}
                                position="relative"
                                zIndex={1}
                              >
                                AI RATIONALE
                              </Text>
                              <Text
                                fontSize="14px"
                                lineHeight="1.45"
                                color="#d4e9ff"
                                position="relative"
                                zIndex={1}
                              >
                                {candidate.ai_rationale ||
                                  "No AI analysis available for this claim."}
                              </Text>
                            </Box>

                            {/* Refute/Nuance/Support Badges */}
                            <Grid
                              templateColumns="repeat(3, 1fr)"
                              gap={2}
                              mt={3}
                            >
                              <Button
                                borderRadius="16px"
                                {...getButtonStyle("red")}
                                color="#ff6c88"
                                fontSize="11px"
                                fontWeight="600"
                                textTransform="uppercase"
                                h="40px"
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                                onClick={() =>
                                  handleRelationshipClick("refutes")
                                }
                              >
                                {getCurvedEdge("red")}
                                <Text as="span" position="relative" zIndex={1}>
                                  Refute
                                </Text>
                              </Button>
                              <Button
                                borderRadius="16px"
                                {...getButtonStyle("blue")}
                                color="#78a8ff"
                                fontSize="11px"
                                fontWeight="600"
                                textTransform="uppercase"
                                h="40px"
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                                onClick={() =>
                                  handleRelationshipClick("context")
                                }
                              >
                                {getCurvedEdge("blue")}
                                <Text as="span" position="relative" zIndex={1}>
                                  Nuance
                                </Text>
                              </Button>
                              <Button
                                borderRadius="16px"
                                {...getButtonStyle("green")}
                                color="#61efb8"
                                fontSize="11px"
                                fontWeight="600"
                                textTransform="uppercase"
                                h="40px"
                                position="relative"
                                overflow="visible"
                                transform="translateZ(0)"
                                transition="all 0.3s ease"
                                onClick={() =>
                                  handleRelationshipClick("supports")
                                }
                              >
                                {getCurvedEdge("green")}
                                <Text as="span" position="relative" zIndex={1}>
                                  Support
                                </Text>
                              </Button>
                            </Grid>

                            {/* Hide Source Button */}
                            <Button
                              borderRadius="12px"
                              bg="rgba(255, 100, 100, 0.1)"
                              border="1px solid rgba(255, 100, 100, 0.3)"
                              color="#ff8888"
                              fontSize="10px"
                              fontWeight="600"
                              textTransform="uppercase"
                              h="32px"
                              mt={2}
                              w="full"
                              _hover={{
                                bg: "rgba(255, 100, 100, 0.2)",
                                borderColor: "rgba(255, 100, 100, 0.5)",
                              }}
                              onClick={handleHideSource}
                            >
                              Hide Source
                            </Button>
                          </VStack>
                        </Box>
                      ))}

                      {candidates.length === 0 && (
                        <Flex
                          align="center"
                          justify="center"
                          minH="240px"
                          w="full"
                        >
                          <Text color="#89a9bf">
                            No source claims available
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                  </Box>
                </VStack>
              </Box>

              {/* Right: Impact & Meta */}
              <VStack spacing={4}>
                {/* Source Claim Card */}
                <Box
                  bg="linear-gradient(180deg, rgba(15, 28, 46, 0.25), rgba(8, 16, 27, 0.20))"
                  borderRadius="28px"
                  border="1px solid"
                  borderColor="rgba(126, 207, 255, 0.22)"
                  boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
                  backdropFilter={styleMode === "mr1" ? "blur(18px)" : "none"}
                  p={6}
                  position="relative"
                  overflow="hidden"
                  opacity={slideDirection ? 0 : 1}
                  transform={
                    slideDirection === "left"
                      ? "translateX(100px)"
                      : slideDirection === "right"
                        ? "translateX(-100px)"
                        : "translateX(0)"
                  }
                  transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                >
                  {/* MR1: Decorative gradient and curved edge */}
                  {styleMode === "mr1" && (
                    <>
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
                    </>
                  )}

                  {/* MR2: Squared-off 3D beveled edges */}
                  {getSquaredBeveledEdges()}

                  <VStack align="stretch" spacing={4} position="relative">
                    {/* Badges Grid */}
                    <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                      <Box
                        bgGradient="linear(180deg, rgba(113, 219, 255, 0.08), rgba(255, 255, 255, 0.02))"
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
                          {candidates[currentCandidateIndex]?.relevance_score
                            ? Math.round(
                                candidates[currentCandidateIndex]
                                  .relevance_score,
                              )
                            : 0}
                          %
                        </Text>
                      </Box>

                      <Box
                        bgGradient="linear(180deg, rgba(120, 168, 255, 0.08), rgba(255, 255, 255, 0.02))"
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
                          {candidates[currentCandidateIndex]?.ai_confidence
                            ? Math.round(
                                candidates[currentCandidateIndex]
                                  .ai_confidence * 100,
                              )
                            : 0}
                        </Text>
                      </Box>

                      <Box
                        bgGradient="linear(180deg, rgba(97, 239, 184, 0.08), rgba(255, 255, 255, 0.02))"
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
                          {candidates[currentCandidateIndex]
                            ?.ai_support_level !== undefined
                            ? Math.round(
                                candidates[currentCandidateIndex]
                                  .ai_support_level * 100,
                              )
                            : 0}
                        </Text>
                      </Box>
                    </Grid>
                  </VStack>
                </Box>

                {/* AI Rationale */}
                <Box
                  bg="linear-gradient(180deg, rgba(15, 28, 46, 0.25), rgba(8, 16, 27, 0.20))"
                  borderRadius="28px"
                  border="1px solid"
                  borderColor="rgba(126, 207, 255, 0.22)"
                  boxShadow="0 22px 70px rgba(0, 0, 0, 0.4)"
                  backdropFilter={styleMode === "mr1" ? "blur(18px)" : "none"}
                  p={6}
                  position="relative"
                  overflow="hidden"
                >
                  {/* MR1: Decorative gradient and curved edge */}
                  {styleMode === "mr1" && (
                    <>
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
                    </>
                  )}

                  {/* MR2: Squared-off 3D beveled edges */}
                  {getSquaredBeveledEdges()}

                  <VStack align="stretch" spacing={4} position="relative">
                    <Text
                      fontSize="11px"
                      textTransform="uppercase"
                      letterSpacing="0.09em"
                      color="#89a9bf"
                    >
                      AI RATIONALEx
                    </Text>

                    <Text fontSize="14px" lineHeight="1.45" color="#d4e9ff">
                      {candidates[currentCandidateIndex]?.ai_rationale ||
                        "Select a claim to see AI analysis of its relevance to the case claim."}
                    </Text>
                  </VStack>
                </Box>

                {/* Style Toggle - Right under AI RATIONALEx box */}
                <HStack spacing={2} justify="flex-end" mt={2}>
                  <Text
                    fontSize="11px"
                    color="#89a9bf"
                    textTransform="uppercase"
                    letterSpacing="0.1em"
                  >
                    Style:
                  </Text>
                  <Button
                    size="sm"
                    bg={
                      styleMode === "mr1"
                        ? "rgba(113, 219, 255, 0.2)"
                        : "rgba(255, 255, 255, 0.05)"
                    }
                    border="1px solid"
                    borderColor={
                      styleMode === "mr1"
                        ? "rgba(113, 219, 255, 0.4)"
                        : "rgba(255, 255, 255, 0.1)"
                    }
                    color={styleMode === "mr1" ? "#71dbff" : "#89a9bf"}
                    fontSize="10px"
                    px={3}
                    onClick={() => setStyleMode("mr1")}
                    _hover={{
                      bg: "rgba(113, 219, 255, 0.25)",
                      borderColor: "rgba(113, 219, 255, 0.5)",
                    }}
                  >
                    MR1
                  </Button>
                  <Button
                    size="sm"
                    bg={
                      styleMode === "mr2"
                        ? "rgba(113, 219, 255, 0.2)"
                        : "rgba(255, 255, 255, 0.05)"
                    }
                    border="1px solid"
                    borderColor={
                      styleMode === "mr2"
                        ? "rgba(113, 219, 255, 0.4)"
                        : "rgba(255, 255, 255, 0.1)"
                    }
                    color={styleMode === "mr2" ? "#71dbff" : "#89a9bf"}
                    fontSize="10px"
                    px={3}
                    onClick={() => setStyleMode("mr2")}
                    _hover={{
                      bg: "rgba(113, 219, 255, 0.25)",
                      borderColor: "rgba(113, 219, 255, 0.5)",
                    }}
                  >
                    MR2
                  </Button>
                </HStack>
              </VStack>
            </Grid>
          </Box>
        )}
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

      {/* Claim Link Modal */}
      {candidates[currentCandidateIndex] && focusClaim && (
        <ClaimLinkOverlay
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          sourceClaim={{
            claim_id: candidates[currentCandidateIndex].claim_id,
            claim_text: candidates[currentCandidateIndex].claim_text,
          }}
          targetClaim={{
            ...focusClaim,
            claim_id: focusClaim.claim_id,
            claim_text: focusClaim.claim_text,
            content_id: selectedTask?.content_id,
            veracity_score: focusClaim.verimeter_score || 0,
            confidence_level: 0,
            last_verified: new Date().toISOString(),
            references: [],
          }}
          onLinkCreated={handleLinkCreated}
          rationale={candidates[currentCandidateIndex].ai_rationale}
          aiSupportLevel={modalSupportLevel}
          sourceClaimVeracity={
            candidates[currentCandidateIndex].source_reliability || 0
          }
          onScoreAwarded={(points) => {
            console.log(`🎮 Score awarded: ${points}`);
            // Immediately update local score
            setUserScore((prevScore) => prevScore + points);
          }}
        />
      )}

      {/* Linked Claims Modal */}
      <Modal
        isOpen={isLinkedClaimsModalOpen}
        onClose={onCloseLinkedClaimsModal}
        size="6xl"
        motionPreset="slideInBottom"
      >
        <ModalOverlay bg="rgba(0, 0, 0, 0.85)" backdropFilter="blur(12px)" />
        <ModalContent
          bg={
            styleMode === "mr1"
              ? "transparent"
              : "linear-gradient(180deg, rgba(15, 28, 46, 0.68), rgba(8, 16, 27, 0.62))"
          }
          backdropFilter={styleMode === "mr1" ? "blur(10px)" : "none"}
          borderRadius={styleMode === "mr1" ? "24px" : "0"}
          border={styleMode === "mr1" ? "2px solid" : "1px solid"}
          borderColor={
            styleMode === "mr1"
              ? "rgba(113, 219, 255, 0.4)"
              : "rgba(126, 207, 255, 0.22)"
          }
          boxShadow={
            styleMode === "mr1"
              ? "0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
              : "0 30px 60px rgba(0, 0, 0, 0.52), 0 10px 0 rgba(3, 6, 8, 1), 0 20px 0 rgba(2, 4, 5, 1), inset 0 2px 0 rgba(255, 255, 255, 0.14), inset 0 -10px 18px rgba(0, 0, 0, 0.75)"
          }
          clipPath={
            styleMode === "mr2"
              ? "polygon(42px 0, calc(100% - 42px) 0, 100% 42px, 100% calc(100% - 42px), calc(100% - 42px) 100%, 42px 100%, 0 calc(100% - 42px), 0 42px)"
              : undefined
          }
          maxH="90vh"
          p={8}
          position="relative"
          overflow="hidden"
          _before={
            styleMode === "mr2"
              ? {
                  content: '""',
                  position: "absolute",
                  inset: "8px",
                  background: "linear-gradient(180deg, #1c262f, #0b1015)",
                  clipPath:
                    "polygon(38px 0, calc(100% - 38px) 0, 100% 38px, 100% calc(100% - 38px), calc(100% - 38px) 100%, 38px 100%, 0 calc(100% - 38px), 0 38px)",
                  boxShadow:
                    "inset 0 2px 0 rgba(255, 255, 255, 0.06), inset 0 -12px 20px rgba(0, 0, 0, 0.72), inset 0 14px 20px rgba(255, 255, 255, 0.02)",
                  zIndex: 0,
                }
              : undefined
          }
          _after={
            styleMode === "mr2"
              ? {
                  content: '""',
                  position: "absolute",
                  inset: "18px",
                  background: "linear-gradient(180deg, #121920, #090d11)",
                  clipPath:
                    "polygon(30px 0, calc(100% - 30px) 0, 100% 30px, 100% calc(100% - 30px), calc(100% - 30px) 100%, 30px 100%, 0 calc(100% - 30px), 0 30px)",
                  boxShadow:
                    "inset 0 2px 0 rgba(255, 255, 255, 0.03), inset 0 -8px 14px rgba(0, 0, 0, 0.82), inset 0 0 0 2px rgba(255, 255, 255, 0.015)",
                  zIndex: 0,
                }
              : undefined
          }
        >
          {/* Curved left edge - MR1 only */}
          {styleMode === "mr1" && (
            <Box
              position="absolute"
              left={0}
              top={0}
              width="28px"
              height="100%"
              background="linear-gradient(90deg, rgba(113, 219, 255, 0.5) 0%, transparent 100%)"
              borderLeftRadius="24px"
              pointerEvents="none"
              zIndex={0}
            />
          )}

          <ModalHeader pb={6} position="relative" zIndex={1}>
            <Text
              fontSize="20px"
              fontWeight="700"
              color="#71dbff"
              textTransform="uppercase"
              letterSpacing="0.1em"
              mb={2}
            >
              Linked Evidence Claims
            </Text>
            {/* Total count in inset oval */}
            <Box
              display="inline-block"
              px={4}
              py={2}
              borderRadius="999px"
              border="1px solid"
              borderColor="rgba(113, 219, 255, 0.3)"
              bg="linear-gradient(180deg, rgba(113, 219, 255, 0.12), rgba(113, 219, 255, 0.06))"
              boxShadow="inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
            >
              <Text fontSize="13px" color="#89a9bf" fontWeight="600">
                {focusClaim?.evidence_count || 0} total linked claims
              </Text>
            </Box>
          </ModalHeader>

          <ModalBody
            py={4}
            overflowY="auto"
            maxH="calc(90vh - 200px)"
            position="relative"
            zIndex={1}
          >
            <VStack align="stretch" spacing={6}>
              {/* Filter Tabs (Multi-select) */}
              <HStack spacing={2} mb={4}>
                <Button
                  fontSize="12px"
                  px={4}
                  py={2}
                  h="auto"
                  borderRadius="999px"
                  fontWeight="600"
                  bg={
                    linkedClaimsFilter.has("support")
                      ? "rgba(97, 239, 184, 0.2)"
                      : "transparent"
                  }
                  color={
                    linkedClaimsFilter.has("support") ? "#61efb8" : "#89a9bf"
                  }
                  border="1px solid"
                  borderColor={
                    linkedClaimsFilter.has("support")
                      ? "rgba(97, 239, 184, 0.4)"
                      : "rgba(113, 219, 255, 0.2)"
                  }
                  onClick={() => {
                    const newFilter = new Set(linkedClaimsFilter);
                    if (newFilter.has("support")) {
                      newFilter.delete("support");
                    } else {
                      newFilter.add("support");
                    }
                    setLinkedClaimsFilter(newFilter);
                  }}
                  _hover={{
                    bg: linkedClaimsFilter.has("support")
                      ? "rgba(97, 239, 184, 0.3)"
                      : "rgba(97, 239, 184, 0.1)",
                  }}
                >
                  Support ({linkedClaimsCategorized.support.length})
                </Button>
                <Button
                  fontSize="12px"
                  px={4}
                  py={2}
                  h="auto"
                  borderRadius="999px"
                  fontWeight="600"
                  bg={
                    linkedClaimsFilter.has("refute")
                      ? "rgba(255, 108, 136, 0.2)"
                      : "transparent"
                  }
                  color={
                    linkedClaimsFilter.has("refute") ? "#ff6c88" : "#89a9bf"
                  }
                  border="1px solid"
                  borderColor={
                    linkedClaimsFilter.has("refute")
                      ? "rgba(255, 108, 136, 0.4)"
                      : "rgba(113, 219, 255, 0.2)"
                  }
                  onClick={() => {
                    const newFilter = new Set(linkedClaimsFilter);
                    if (newFilter.has("refute")) {
                      newFilter.delete("refute");
                    } else {
                      newFilter.add("refute");
                    }
                    setLinkedClaimsFilter(newFilter);
                  }}
                  _hover={{
                    bg: linkedClaimsFilter.has("refute")
                      ? "rgba(255, 108, 136, 0.3)"
                      : "rgba(255, 108, 136, 0.1)",
                  }}
                >
                  Refute ({linkedClaimsCategorized.refute.length})
                </Button>
                <Button
                  fontSize="12px"
                  px={4}
                  py={2}
                  h="auto"
                  borderRadius="999px"
                  fontWeight="600"
                  bg={
                    linkedClaimsFilter.has("nuance")
                      ? "rgba(120, 168, 255, 0.2)"
                      : "transparent"
                  }
                  color={
                    linkedClaimsFilter.has("nuance") ? "#78a8ff" : "#89a9bf"
                  }
                  border="1px solid"
                  borderColor={
                    linkedClaimsFilter.has("nuance")
                      ? "rgba(120, 168, 255, 0.4)"
                      : "rgba(113, 219, 255, 0.2)"
                  }
                  onClick={() => {
                    const newFilter = new Set(linkedClaimsFilter);
                    if (newFilter.has("nuance")) {
                      newFilter.delete("nuance");
                    } else {
                      newFilter.add("nuance");
                    }
                    setLinkedClaimsFilter(newFilter);
                  }}
                  _hover={{
                    bg: linkedClaimsFilter.has("nuance")
                      ? "rgba(120, 168, 255, 0.3)"
                      : "rgba(120, 168, 255, 0.1)",
                  }}
                >
                  Nuance ({linkedClaimsCategorized.nuance.length})
                </Button>
              </HStack>

              {/* Human-Linked Claims Section */}
              {focusClaim && (
                <>
                  {/* Human-Linked Header with inset oval */}
                  <Box
                    px={5}
                    py={3}
                    borderRadius="999px"
                    border="1px solid"
                    borderColor="rgba(97, 239, 184, 0.3)"
                    bg="linear-gradient(180deg, rgba(97, 239, 184, 0.15), rgba(97, 239, 184, 0.08))"
                    boxShadow="inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                    mb={2}
                  >
                    <HStack spacing={3} justify="space-between">
                      <Text
                        fontSize="14px"
                        fontWeight="700"
                        color="#61efb8"
                        textTransform="uppercase"
                        letterSpacing="0.08em"
                      >
                        Human-Linked Claims
                      </Text>
                      <Text fontSize="13px" color="#89a9bf">
                        {filteredLinkedClaims.length} verified
                      </Text>
                    </HStack>
                  </Box>

                  {/* Human Claims as Buttons - FILTERED */}
                  <VStack align="stretch" spacing={3}>
                    {filteredLinkedClaims.length === 0 ? (
                      <Text
                        fontSize="13px"
                        color="#89a9bf"
                        fontStyle="italic"
                        textAlign="center"
                        py={8}
                      >
                        No claims match the selected filters
                      </Text>
                    ) : (
                      filteredLinkedClaims.map((linkedClaim, idx) => {
                        const isSupport =
                          linkedClaim.relation === "support" ||
                          linkedClaim.relationship === "supports";
                        const isRefute =
                          linkedClaim.relation === "refute" ||
                          linkedClaim.relationship === "refutes";
                        const isNuance =
                          linkedClaim.relation === "nuance" ||
                          linkedClaim.relation === "context" ||
                          linkedClaim.relationship === "related";

                        return (
                          <Button
                            key={`linked-${linkedClaim.link_id || idx}`}
                            h="auto"
                            py={4}
                            px={6}
                            bg="transparent"
                            backdropFilter="blur(10px)"
                            borderRadius="24px"
                            border="2px solid"
                            borderColor={
                              isSupport
                                ? "rgba(97, 239, 184, 0.4)"
                                : isRefute
                                  ? "rgba(255, 108, 136, 0.4)"
                                  : "rgba(120, 168, 255, 0.4)"
                            }
                            boxShadow={
                              isSupport
                                ? "0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(97, 239, 184, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                                : isRefute
                                  ? "0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(255, 108, 136, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                                  : "0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(120, 168, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                            }
                            justifyContent="flex-start"
                            textAlign="left"
                            whiteSpace="normal"
                            position="relative"
                            overflow="visible"
                            _hover={{
                              transform: "translateY(-2px) translateZ(0)",
                              boxShadow: isSupport
                                ? "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(97, 239, 184, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)"
                                : isRefute
                                  ? "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(255, 108, 136, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)"
                                  : "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(120, 168, 255, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)",
                            }}
                          >
                            <VStack align="flex-start" spacing={2} w="100%">
                              <Badge
                                fontSize="10px"
                                px={3}
                                py={1}
                                borderRadius="999px"
                                bg={
                                  isSupport
                                    ? "rgba(97, 239, 184, 0.2)"
                                    : isRefute
                                      ? "rgba(255, 108, 136, 0.2)"
                                      : "rgba(120, 168, 255, 0.2)"
                                }
                                color={
                                  isSupport
                                    ? "#61efb8"
                                    : isRefute
                                      ? "#ff6c88"
                                      : "#78a8ff"
                                }
                                border="1px solid"
                                borderColor={
                                  isSupport
                                    ? "rgba(97, 239, 184, 0.4)"
                                    : isRefute
                                      ? "rgba(255, 108, 136, 0.4)"
                                      : "rgba(120, 168, 255, 0.4)"
                                }
                              >
                                {isSupport
                                  ? "SUPPORTS"
                                  : isRefute
                                    ? "REFUTES"
                                    : "NUANCE"}
                              </Badge>
                              <Text
                                fontSize="14px"
                                color="#d4e9ff"
                                lineHeight="1.4"
                              >
                                {linkedClaim.reference_claim_text ||
                                  linkedClaim.claim_text ||
                                  "No claim text available"}
                              </Text>
                              {linkedClaim.source_name && (
                                <Text
                                  fontSize="11px"
                                  color="#89a9bf"
                                  fontStyle="italic"
                                >
                                  from {linkedClaim.source_name}
                                </Text>
                              )}
                            </VStack>
                          </Button>
                        );
                      })
                    )}
                  </VStack>

                  {/* AI-Suggested Claims Section */}
                  <Box mt={6}>
                    {/* AI-Suggested Header with inset oval */}
                    <Box
                      px={5}
                      py={3}
                      borderRadius="999px"
                      border="1px solid"
                      borderColor="rgba(167, 139, 250, 0.3)"
                      bg="linear-gradient(180deg, rgba(167, 139, 250, 0.15), rgba(167, 139, 250, 0.08))"
                      boxShadow="inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05)"
                      mb={3}
                    >
                      <HStack spacing={3} justify="space-between">
                        <Text
                          fontSize="14px"
                          fontWeight="700"
                          color="#a78bfa"
                          textTransform="uppercase"
                          letterSpacing="0.08em"
                        >
                          AI-Suggested Claims
                        </Text>
                        <Text fontSize="13px" color="#89a9bf">
                          {candidates.length} awaiting review
                        </Text>
                      </HStack>
                    </Box>

                    {/* AI Suggested Claims as Buttons */}
                    <VStack align="stretch" spacing={3}>
                      {candidates.length > 0 ? (
                        candidates.map((candidate, idx) => (
                          <Button
                            key={`ai-${idx}`}
                            h="auto"
                            py={4}
                            px={6}
                            bg="transparent"
                            backdropFilter="blur(10px)"
                            borderRadius="24px"
                            border="2px solid"
                            borderColor="rgba(167, 139, 250, 0.4)"
                            boxShadow="0 16px 48px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(167, 139, 250, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
                            justifyContent="flex-start"
                            textAlign="left"
                            whiteSpace="normal"
                            position="relative"
                            overflow="visible"
                            _hover={{
                              transform: "translateY(-2px) translateZ(0)",
                              boxShadow:
                                "0 20px 60px rgba(0, 0, 0, 0.7), 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 50px rgba(167, 139, 250, 0.4), inset 0 3px 0 rgba(255, 255, 255, 0.2)",
                            }}
                          >
                            <VStack align="flex-start" spacing={2} w="100%">
                              <HStack spacing={2}>
                                <Badge
                                  fontSize="10px"
                                  px={3}
                                  py={1}
                                  borderRadius="999px"
                                  bg="rgba(167, 139, 250, 0.2)"
                                  color="#a78bfa"
                                  border="1px solid"
                                  borderColor="rgba(167, 139, 250, 0.4)"
                                >
                                  {candidate.source_name}
                                </Badge>
                                {candidate.ai_confidence && (
                                  <Badge
                                    fontSize="10px"
                                    px={3}
                                    py={1}
                                    borderRadius="999px"
                                    bg="rgba(138, 169, 191, 0.15)"
                                    color="#89a9bf"
                                  >
                                    {Math.round(candidate.ai_confidence * 100)}%
                                  </Badge>
                                )}
                              </HStack>
                              <Text
                                fontSize="14px"
                                color="#d4e9ff"
                                lineHeight="1.4"
                              >
                                {candidate.claim_text}
                              </Text>
                            </VStack>
                          </Button>
                        ))
                      ) : (
                        <Text
                          fontSize="13px"
                          color="#89a9bf"
                          fontStyle="italic"
                          textAlign="center"
                          py={4}
                        >
                          No AI suggestions available
                        </Text>
                      )}
                    </VStack>
                  </Box>
                </>
              )}
            </VStack>
          </ModalBody>

          <ModalFooter pt={6} position="relative" zIndex={1}>
            <Button
              onClick={onCloseLinkedClaimsModal}
              bg="transparent"
              backdropFilter="blur(10px)"
              borderRadius="18px"
              border="2px solid"
              borderColor="rgba(113, 219, 255, 0.4)"
              color="#71dbff"
              px={8}
              boxShadow="0 6px 20px rgba(0, 0, 0, 0.4), 0 0 20px rgba(113, 219, 255, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
              _hover={{
                transform: "translateY(-2px)",
                boxShadow:
                  "0 8px 28px rgba(0, 0, 0, 0.5), 0 0 30px rgba(113, 219, 255, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.15)",
              }}
            >
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};
