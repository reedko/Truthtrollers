// src/components/UnifiedHeader.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Flex,
  IconButton,
  Tooltip,
  Skeleton,
  SkeletonText,
  Text,
  useBreakpointValue,
  useColorMode,
} from "@chakra-ui/react";
import {
  ViewIcon,
  ViewOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@chakra-ui/icons";
import { keyframes } from "@emotion/react";
import { useTaskStore } from "../store/useTaskStore";
import { useUIStore } from "../store/useUIStore";
import { useAuthStore } from "../store/useAuthStore";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";
import { Author, Publisher, Task } from "../../../shared/entities/types";
import { ensureArray } from "../utils/normalize";
import {
  fetchContentScores,
  fetchLinkedClaimsForTask,
  fetchClaimsForTask,
  fetchReferencesForTask,
  fetchAIEvidenceLinks,
} from "../services/useDashboardAPI";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";
import MicroHeaderRail from "./headers/MicroHeaderRail";

type Variant = "full" | "compact" | "micro"; // ⬅️ reintroduce micro

// Animation for scroll hint
const pulseAnimation = keyframes`
  0%, 100% { opacity: 0.4; transform: translateX(0); }
  50% { opacity: 1; transform: translateX(4px); }
`;

const pulseAnimationLeft = keyframes`
  0%, 100% { opacity: 0.4; transform: translateX(0); }
  50% { opacity: 1; transform: translateX(-4px); }
`;

interface UnifiedHeaderProps {
  pivotType?: "task" | "author" | "publisher" | "reference";
  pivotId?: number;
  verimeterScore?: number;
  trollmeterScore?: number;
  pro?: number;
  con?: number;
  refreshKey?: number | string;
  variant?: Variant; // optional; auto if omitted
  sticky?: boolean;
  allowToggle?: boolean;
}

const CARD_W = 250; // single source of truth

const cardWrapSx = {
  "--card-max": `${CARD_W}px`,

  flex: {
    base: "0 0 280px",
    sm: "0 0 280px",
    md: "0 0 140px",
    lg: "0 0 160px",
    xl: "1 1 0",
  },

  width: {
    base: "280px",
    sm: "280px",
    md: "140px",
    lg: "160px",
    xl: "clamp(180px, 20vw, var(--card-max))",
  },

  maxWidth: {
    base: "280px",
    sm: "280px",
    md: "140px",
    lg: "160px",
    xl: "var(--card-max)",
  },

  minWidth: {
    base: "280px",
    sm: "280px",
    md: "140px",
    lg: "160px",
    xl: "180px",
  },

  "> *": {
    width: "100% !important",
    maxWidth: "100% !important",
    margin: "0 !important",
  },
} as const;

// Helper function to get verdict info based on verimeter score
const getVerdictInfo = (
  score: number | null,
): {
  color: string;
  word: string;
  interpretation: string;
} => {
  if (score === null || score === 0) {
    return {
      color: "gray.400",
      word: "UNKNOWN",
      interpretation: "No evidence assessment available yet",
    };
  }

  // Convert to percentage (-100 to 100)
  const percentage = (score - 0.5) * 200;

  if (percentage <= -50) {
    return {
      color: "red.400",
      word: "FALSE",
      interpretation: "Evidence strongly suggests this is false",
    };
  } else if (percentage <= -15) {
    return {
      color: "red.300",
      word: "FALSE",
      interpretation: "Evidence nominally suggests this is false",
    };
  } else if (percentage < 15) {
    return {
      color: "yellow.400",
      word: "NUANCED",
      interpretation: "Evidence is inconclusive",
    };
  } else if (percentage < 50) {
    return {
      color: "green.300",
      word: "TRUE",
      interpretation: "Evidence nominally suggests this is true",
    };
  } else {
    return {
      color: "green.400",
      word: "TRUE",
      interpretation: "Evidence strongly suggests this is true",
    };
  }
};

const UnifiedHeader: React.FC<UnifiedHeaderProps> = ({
  pivotType,
  pivotId,
  verimeterScore,
  trollmeterScore,
  pro,
  con,
  refreshKey,
  variant, // ⬅️ if provided, we respect it; otherwise auto
  sticky = false,
  allowToggle = false,
}) => {
  const { colorMode } = useColorMode();
  const { mode, aiWeight } = useVerimeterMode();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const verimeterScoreMap = useTaskStore((s) => s.verimeterScores);
  const user = useAuthStore((s) => s.user);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);
  const [claimStats, setClaimStats] = useState({
    totalClaimLinks: 0,
    totalClaims: 0,
    totalReferences: 0,
    supportingLinks: 0,
    refutingLinks: 0,
    nuancedLinks: 0,
  });
  const [aiLinkStats, setAILinkStats] = useState({
    totalClaimLinks: 0,
    supportingLinks: 0,
    refutingLinks: 0,
    nuancedLinks: 0,
  });

  // Use global header visibility state
  const isHeaderVisible = useUIStore((s) => s.isHeaderVisible);

  // 🔧 Auto-pick variant by breakpoint unless explicitly provided
  const bpVariant = useBreakpointValue<Variant>({
    base: "micro",
    sm: "micro",
    md: "compact",
    lg: "compact",
    xl: "full",
  });

  // Read window.innerWidth synchronously so the very first paint is correct.
  // Chakra's bpVariant starts as "micro" (base) and corrects later — bypassing it
  // for initial state prevents the flash of wrong-size cards.
  const [localVariant, setLocalVariant] = useState<Variant>(() => {
    if (variant) return variant;
    if (typeof window === "undefined") return "full";
    const w = window.innerWidth;
    return w >= 1280 ? "full" : w >= 768 ? "compact" : "micro";
  });
  // Ref prevents the first useEffect run from overwriting the correct initial state
  // with Chakra's still-stale "micro" value.
  const hasMountedVariant = useRef(false);
  useEffect(() => {
    if (!hasMountedVariant.current) {
      hasMountedVariant.current = true;
      return;
    }
    if (variant) setLocalVariant(variant);
  }, [variant]);
  // Handle genuine window resize without going through Chakra's deferred evaluation
  useEffect(() => {
    if (variant) return;
    const update = () => {
      const w = window.innerWidth;
      setLocalVariant(w >= 1280 ? "full" : w >= 768 ? "compact" : "micro");
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [variant]);

  const isMicro = localVariant === "micro";
  const isCompact = localVariant === "compact";
  const isFull = localVariant === "full";

  // 🔧 Spread across on desktop, stay centered single-column on phones
  const justify = useBreakpointValue<
    "center" | "space-around" | "space-between" | "flex-start"
  >({
    base: "flex-start", // start for horizontal scroll
    sm: "center",
    md: "center",       // center for 800x600
    lg: "center",       // center for 1024
    xl: "space-between", // spread for full res
  });

  // 🔧 Enable horizontal scrolling on mobile
  const flexWrap = useBreakpointValue<"wrap" | "nowrap">({
    base: "nowrap", // no wrap on mobile = horizontal scroll
    md: "nowrap", // wrap on desktop
  });

  const overflowX = useBreakpointValue<"auto" | "visible">({
    base: "auto",
    lg: "visible",
  });

  const resolvedPivotType =
    (pivotType === "reference" ? "task" : pivotType) || "task";
  const resolvedPivotId =
    pivotId !== undefined ? pivotId : (selectedTask?.content_id ?? undefined);

  useEffect(() => {
    const load = async () => {
      if (resolvedPivotId !== undefined) {
        const results = await fetchTasksByPivot(
          resolvedPivotType,
          resolvedPivotId,
        );
        setTasks(results);
        setPivotTask(results[0] || null);
      } else if (selectedTask) {
        setTasks([selectedTask]);
        setPivotTask(selectedTask);
      } else {
        setTasks([]);
        setPivotTask(null);
      }
    };
    load();
    // 🔧 PERF: Removed fetchTasksByPivot from deps to prevent loop
  }, [resolvedPivotType, resolvedPivotId, selectedTask]);

  useEffect(() => {
    // 🔧 PERF: Debounce score fetching to prevent rapid API calls
    const timeoutId = setTimeout(async () => {
      if (!pivotTask?.content_id) {
        setLiveVerimeter(null);
        return;
      }
      try {
        const result = await fetchContentScores(pivotTask.content_id, viewerId ?? null, mode, aiWeight);
        setLiveVerimeter(
          result && result.verimeterScore !== undefined
            ? result.verimeterScore
            : null,
        );
      } catch {
        setLiveVerimeter(null);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivotTask?.content_id, viewerId, refreshKey, mode, aiWeight]);

  // Fetch claim statistics for ProgressCard
  useEffect(() => {
    // 🔧 PERF: Debounce and batch API calls to reduce load
    const timeoutId = setTimeout(async () => {
      if (!pivotTask?.content_id) {
        setClaimStats({
          totalClaimLinks: 0,
          totalClaims: 0,
          totalReferences: 0,
          supportingLinks: 0,
          refutingLinks: 0,
          nuancedLinks: 0,
        });
        return;
      }

      try {
        // 🔧 PERF: Fetch all data in parallel instead of sequentially
        const [linkedClaims, claims, refs] = await Promise.all([
          fetchLinkedClaimsForTask(pivotTask.content_id, viewerId),
          fetchClaimsForTask(pivotTask.content_id, viewerId),
          fetchReferencesForTask(pivotTask.content_id),
        ]);

        // Count supporting, refuting, and nuanced links
        const supportingLinks = linkedClaims.filter(
          (link) => link.relationship === "supports",
        ).length;
        const refutingLinks = linkedClaims.filter(
          (link) => link.relationship === "refutes",
        ).length;
        const nuancedLinks = linkedClaims.filter(
          (link) => link.relationship === "related",
        ).length;

        setClaimStats({
          totalClaimLinks: linkedClaims.length,
          totalClaims: claims.length,
          totalReferences: refs.length,
          supportingLinks,
          refutingLinks,
          nuancedLinks,
        });
      } catch (error) {
        console.error("Error fetching claim stats:", error);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [pivotTask?.content_id, viewerId, refreshKey]);

  // Fetch AI evidence link stats when in ai/combined mode
  useEffect(() => {
    if (!pivotTask?.content_id || mode === 'user') {
      setAILinkStats({ totalClaimLinks: 0, supportingLinks: 0, refutingLinks: 0, nuancedLinks: 0 });
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const links = await fetchAIEvidenceLinks(pivotTask.content_id);
        const supporting = links.filter(l => l.stance === 'support').length;
        const refuting   = links.filter(l => l.stance === 'refute').length;
        const nuanced    = links.filter(l => l.stance === 'nuance').length;
        setAILinkStats({
          totalClaimLinks: links.length,
          supportingLinks: supporting,
          refutingLinks: refuting,
          nuancedLinks: nuanced,
        });
      } catch {
        setAILinkStats({ totalClaimLinks: 0, supportingLinks: 0, refutingLinks: 0, nuancedLinks: 0 });
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [pivotTask?.content_id, mode, refreshKey]);

  // Choose which stats + label to show based on verimeter mode
  const displayStats = (() => {
    if (mode === 'ai') {
      return {
        stats: {
          totalClaims: claimStats.totalClaims,
          totalReferences: claimStats.totalReferences,
          ...aiLinkStats,
        },
        label: "AI Suggested",
      };
    }
    if (mode === 'combined') {
      return {
        stats: {
          totalClaims: claimStats.totalClaims,
          totalReferences: claimStats.totalReferences,
          totalClaimLinks: claimStats.totalClaimLinks + aiLinkStats.totalClaimLinks,
          supportingLinks: claimStats.supportingLinks + aiLinkStats.supportingLinks,
          refutingLinks: claimStats.refutingLinks + aiLinkStats.refutingLinks,
          nuancedLinks: claimStats.nuancedLinks + aiLinkStats.nuancedLinks,
        },
        label: "Combined Links",
      };
    }
    return { stats: claimStats, label: "User Links" };
  })();

  const contentId = pivotTask?.content_id ?? null;
  const storeScore =
    contentId != null ? (verimeterScoreMap?.[contentId] ?? null) : null;
  const finalScore = verimeterScore ?? liveVerimeter ?? storeScore;

  const authors = useMemo(
    () => ensureArray<Author>(pivotTask?.authors),
    [pivotTask],
  );
  const publishers = useMemo(
    () => ensureArray<Publisher>(pivotTask?.publishers),
    [pivotTask],
  );

  const containerStyles = sticky
    ? ({
        position: "sticky",
        top: 0,
        zIndex: 40,
      } as const)
    : {};

  const isLoading = !pivotTask;

  return (
    <Box position="relative" w="100%" px={0}>
      {/* Scroll Direction Arrows - ON THE SIDES (semi-transparent) */}
      {isHeaderVisible && (
        <>
          {/* Left Arrow */}
          <Box
            position="absolute"
            left={0}
            top="50%"
            transform="translateY(-50%)"
            zIndex={100}
            display={{ base: "block", lg: "none" }}
            pointerEvents="none"
          >
            <Box
              bg={
                colorMode === "dark"
                  ? "rgba(0, 0, 0, 0.4)"
                  : "rgba(255, 255, 255, 0.7)"
              }
              borderRadius="0 12px 12px 0"
              p={2}
              border="1px solid"
              borderColor={
                colorMode === "dark"
                  ? "rgba(100, 116, 139, 0.5)"
                  : "rgba(71, 85, 105, 0.4)"
              }
              borderLeft="none"
              boxShadow={
                colorMode === "dark"
                  ? "0 2px 12px rgba(100, 116, 139, 0.3)"
                  : "0 2px 12px rgba(71, 85, 105, 0.2)"
              }
              opacity={0.8}
            >
              <ChevronLeftIcon
                boxSize={5}
                color={colorMode === "dark" ? "#94a3b8" : "#475569"}
                animation={`${pulseAnimationLeft} 2s ease-in-out infinite`}
              />
            </Box>
          </Box>

          {/* Right Arrow */}
          <Box
            position="absolute"
            right={0}
            top="50%"
            transform="translateY(-50%)"
            zIndex={100}
            display={{ base: "block", lg: "none" }}
            pointerEvents="none"
          >
            <Box
              bg={
                colorMode === "dark"
                  ? "rgba(0, 0, 0, 0.4)"
                  : "rgba(255, 255, 255, 0.7)"
              }
              borderRadius="12px 0 0 12px"
              p={2}
              border="1px solid"
              borderColor={
                colorMode === "dark"
                  ? "rgba(100, 116, 139, 0.5)"
                  : "rgba(71, 85, 105, 0.4)"
              }
              borderRight="none"
              boxShadow={
                colorMode === "dark"
                  ? "0 2px 12px rgba(100, 116, 139, 0.3)"
                  : "0 2px 12px rgba(71, 85, 105, 0.2)"
              }
              opacity={0.8}
            >
              <ChevronRightIcon
                boxSize={5}
                color={colorMode === "dark" ? "#94a3b8" : "#475569"}
                animation={`${pulseAnimation} 2s ease-in-out infinite`}
              />
            </Box>
          </Box>
        </>
      )}

      {/* View Density Toggle - Only visible when header is shown */}
      {allowToggle && isHeaderVisible && (
        <Tooltip
          label={isFull ? "Switch to compact/micro" : "Switch to full header"}
          hasArrow
          placement="left"
        >
          <IconButton
            aria-label="Toggle header density"
            icon={isFull ? <ViewOffIcon /> : <ViewIcon />}
            size="sm"
            variant="ghost"
            position="absolute"
            right="4"
            top="2"
            zIndex={45}
            onClick={() =>
              setLocalVariant((v) =>
                v === "full" ? "compact" : v === "compact" ? "micro" : "full",
              )
            }
          />
        </Tooltip>
      )}

      {/* Render header only if visible */}
      {!isHeaderVisible ? null : isMicro ? (
        // 📱 Micro: swipeable rail + sheet details
        <MicroHeaderRail
          score={finalScore}
          tasks={tasks}
          pivotTask={pivotTask}
          authors={authors}
          publishers={publishers}
          onSelectTask={setPivotTask}
        />
      ) : (
        <Box
          w="100%"
          p={{ base: 2, md: 2, lg: 2, xl: 4 }}
          borderRadius={{ base: "lg", md: "md", lg: "md", xl: "xl" }}
          bg={
            colorMode === "dark"
              ? "radial-gradient(circle at top left, rgba(71, 85, 105, 0.15), rgba(30, 41, 59, 0.2))"
              : "linear-gradient(135deg, rgba(100, 116, 139, 0.35) 0%, rgba(148, 163, 184, 0.45) 50%, rgba(71, 85, 105, 0.35) 100%)"
          }
          border="1px solid"
          borderColor={colorMode === "dark" ? "gray.700" : "gray.400"}
          boxShadow={
            colorMode === "dark"
              ? "0 4px 16px rgba(0, 0, 0, 0.3)"
              : "0 4px 16px rgba(71, 85, 105, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.5)"
          }
        >
          <Flex
            wrap={flexWrap}
            justify={justify} // ⬅️ spread on desktop, scrollable on phone
            align="stretch"
            columnGap={{ base: 2, md: 1, lg: 1, xl: 3 }}
            rowGap={{ base: 2, md: 1, lg: 1, xl: 3 }}
            mb={{ base: 2, md: 1, lg: 1, xl: 6 }}
            w="100%"
            px={0}
            mx={0}
            overflowX={overflowX}
            overflowY="visible"
            sx={{
              ...containerStyles,
              // Mobile scroll indicators
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "thin",
              "&::-webkit-scrollbar": {
                height: "6px",
              },
              "&::-webkit-scrollbar-track": {
                background:
                  colorMode === "dark"
                    ? "rgba(0, 0, 0, 0.1)"
                    : "rgba(203, 213, 225, 0.3)",
              },
              "&::-webkit-scrollbar-thumb": {
                background:
                  colorMode === "dark"
                    ? "rgba(100, 116, 139, 0.5)"
                    : "rgba(71, 85, 105, 0.6)",
                borderRadius: "3px",
              },
              "&::-webkit-scrollbar-thumb:hover": {
                background:
                  colorMode === "dark"
                    ? "rgba(100, 116, 139, 0.7)"
                    : "rgba(71, 85, 105, 0.8)",
              },
            }}
          >
            {/* BoolCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow:
                    colorMode === "dark"
                      ? "0 0 30px rgba(100, 116, 139, 0.4)"
                      : "0 0 30px rgba(71, 85, 105, 0.3)",
                },
              }}
            >
              {isLoading ? (
                <Skeleton
                  borderRadius="lg"
                  height={{ base: "160px", md: "130px", lg: "130px", xl: "405px" }}
                />
              ) : (
                <BoolCard
                  verimeterScore={finalScore}
                  trollmeterScore={isFull ? trollmeterScore : undefined}
                  pro={isFull ? pro : undefined}
                  con={isFull ? con : undefined}
                  contentId={contentId ?? undefined}
                  size={isFull ? "md" : "xs"} // full(xl) => md, compact(md/lg) => xs
                  dense={!isFull} // compact => dense (shows only verimeter)
                />
              )}
            </Box>

            {/* TaskCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(0, 162, 255, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Box p={{ base: 3, md: 1, lg: 1, xl: 3 }} borderRadius="lg" bg="stat2Gradient">
                  <Skeleton height={{ base: "14px", md: "8px", lg: "8px", xl: "18px" }} mb={{ base: 3, md: 1, lg: 1, xl: 3 }} />
                  <Skeleton height={{ base: "0", md: "0", lg: "0", xl: "150px" }} mb={2} display={{ base: "none", md: "none", lg: "none", xl: "block" }} />
                  <SkeletonText noOfLines={3} spacing="2" display={{ base: "none", md: "none", lg: "none", xl: "block" }} />
                </Box>
              ) : (
                <TaskCard
                  task={tasks}
                  useStore={false}
                  onSelect={setPivotTask}
                  compact={!isFull} // compact + micro
                  hideMeta={!isFull} // hide image/meta in micro & compact
                />
              )}
            </Box>

            {/* PubCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(6, 182, 212, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Skeleton
                  borderRadius="lg"
                  height={{ base: "120px", md: "130px", lg: "130px", xl: "180px" }}
                />
              ) : (
                <PubCard publishers={publishers} compact={!isFull} contentId={contentId ?? undefined} />
              )}
            </Box>

            {/* AuthCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(251, 146, 60, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Skeleton
                  borderRadius="lg"
                  height={{ base: "120px", md: "130px", lg: "130px", xl: "180px" }}
                />
              ) : (
                <AuthCard
                  authors={authors}
                  compact={!isFull}
                  contentId={contentId ?? undefined}
                />
              )}
            </Box>

            {/* ProgressCard — always show */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(74, 222, 128, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Skeleton
                  borderRadius="lg"
                  height={{ base: "160px", md: "130px", lg: "130px", xl: "180px" }}
                />
              ) : (
                <ProgressCard
                  ProgressScore={
                    displayStats.stats.totalClaimLinks /
                    Math.max(
                      claimStats.totalClaims * claimStats.totalReferences,
                      1,
                    )
                  }
                  totalClaims={claimStats.totalClaims}
                  verifiedClaims={displayStats.stats.supportingLinks}
                  totalReferences={claimStats.totalReferences}
                  verifiedReferences={displayStats.stats.refutingLinks}
                  totalClaimLinks={displayStats.stats.totalClaimLinks}
                  nuancedLinks={displayStats.stats.nuancedLinks}
                  compact={!isFull}
                  sourceLabel={displayStats.label}
                />
              )}
            </Box>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default UnifiedHeader;
