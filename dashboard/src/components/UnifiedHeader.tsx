// src/components/UnifiedHeader.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Flex,
  IconButton,
  Tooltip,
  Skeleton,
  SkeletonText,
  Text,
  useBreakpointValue,
  Button,
  HStack,
  useToast,
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
import { fetchContentScores } from "../services/useDashboardAPI";
import MicroHeaderRail from "./headers/MicroHeaderRail";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

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
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const verimeterScoreMap = useTaskStore((s) => s.verimeterScores || {});
  const user = useAuthStore((s) => s.user);
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);

  // Use global header visibility state
  const isHeaderVisible = useUIStore((s) => s.isHeaderVisible);

  // 🔧 Auto-pick variant by breakpoint unless explicitly provided
  const bpVariant = useBreakpointValue<Variant>({
    base: "micro",
    sm: "micro",
    md: "micro", // iPad-ish
    lg: "full",
  });

  const [localVariant, setLocalVariant] = useState<Variant>(
    variant ?? bpVariant ?? "full",
  );
  useEffect(() => {
    if (variant) setLocalVariant(variant);
    else if (bpVariant) setLocalVariant(bpVariant);
  }, [variant, bpVariant]);

  const isMicro = localVariant === "micro";
  const isCompact = localVariant === "compact";
  const isFull = localVariant === "full";

  // 🔧 Spread across on desktop, stay centered single-column on phones
  const justify = useBreakpointValue<
    "center" | "space-around" | "space-between" | "flex-start"
  >({
    base: "flex-start", // start for horizontal scroll
    sm: "center",
    md: "space-around",
    lg: "space-between",
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
  }, [resolvedPivotType, resolvedPivotId, selectedTask, fetchTasksByPivot]);

  useEffect(() => {
    const fetchScore = async () => {
      if (!pivotTask?.content_id) {
        setLiveVerimeter(null);
        return;
      }
      try {
        const result = await fetchContentScores(pivotTask.content_id, null);
        setLiveVerimeter(
          result && result.verimeterScore !== undefined
            ? result.verimeterScore
            : null,
        );
      } catch {
        setLiveVerimeter(null);
      }
    };
    fetchScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivotTask?.content_id, viewerId, refreshKey]);

  const contentId = pivotTask?.content_id ?? null;
  const storeScore =
    contentId != null ? (verimeterScoreMap[contentId] ?? null) : null;
  const finalScore = verimeterScore ?? storeScore ?? liveVerimeter;

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
        backdropFilter: "saturate(180%) blur(6px)",
      } as const)
    : {};

  const isLoading = !pivotTask;

  // Card wrapper—forces identical widths, kills stagger
  // On mobile (horizontal scroll), maintain minimum width
  const cardMinWidth = useBreakpointValue({
    base: "280px", // mobile: fixed width for scrolling
    md: "200px", // desktop: can be smaller with wrap
  });

  const handleMarkComplete = async () => {
    if (!user?.user_id) {
      toast({
        title: "Error",
        description: "You must be logged in to mark tasks complete",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    if (!pivotTask?.content_id) {
      toast({
        title: "Error",
        description: "No task selected",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/mark-task-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentId: pivotTask.content_id,
          userId: user.user_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to mark task complete");
      }

      toast({
        title: "Task marked complete!",
        description:
          "The extension will now show this task when you visit the URL",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      // Optionally refresh the task list
      if (user.user_id) {
        fetchTasksForUser(user.user_id, false);
      }
    } catch (error: any) {
      toast({
        title: "Error marking task complete",
        description: error.message || "An error occurred",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const cardWrapSx = {
    "--card-max": `${CARD_W}px`,

    // Mobile: fixed cards + horizontal scroll
    flex: {
      base: "0 0 280px",
      lg: "1 1 0", // Desktop: allow shrinking/growing
    },

    // Let the card width be responsive on desktop:
    // - can shrink down to ~180px
    // - prefers ~20vw
    // - never exceeds CARD_W
    width: {
      base: "280px",
      lg: "clamp(180px, 20vw, var(--card-max))",
    },

    maxWidth: {
      base: "280px",
      lg: "var(--card-max)",
    },

    minWidth: {
      base: "280px",
      lg: "180px",
    },

    "> *": {
      width: "100% !important",
      maxWidth: "100% !important",
      margin: "0 !important",
    },
  } as const;

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
              bg="rgba(0, 0, 0, 0.4)"
              backdropFilter="blur(12px)"
              borderRadius="0 12px 12px 0"
              p={2}
              border="1px solid rgba(139, 92, 246, 0.4)"
              borderLeft="none"
              boxShadow="0 2px 12px rgba(139, 92, 246, 0.3)"
              opacity={0.7}
            >
              <ChevronLeftIcon
                boxSize={5}
                color="#a78bfa"
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
              bg="rgba(0, 0, 0, 0.4)"
              backdropFilter="blur(12px)"
              borderRadius="12px 0 0 12px"
              p={2}
              border="1px solid rgba(139, 92, 246, 0.4)"
              borderRight="none"
              boxShadow="0 2px 12px rgba(139, 92, 246, 0.3)"
              opacity={0.7}
            >
              <ChevronRightIcon
                boxSize={5}
                color="#a78bfa"
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
        <Box w="100%">
          <Flex
            wrap={flexWrap}
            justify={justify} // ⬅️ spread on desktop, scrollable on phone
            align="stretch"
            columnGap={isMicro ? 2 : isCompact ? 2 : 3}
            rowGap={isMicro ? 2 : isCompact ? 2 : 3}
            mb={isMicro ? 2 : isCompact ? 3 : 6}
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
                background: "rgba(0, 0, 0, 0.1)",
              },
              "&::-webkit-scrollbar-thumb": {
                background: "rgba(139, 92, 246, 0.5)",
                borderRadius: "3px",
              },
              "&::-webkit-scrollbar-thumb:hover": {
                background: "rgba(139, 92, 246, 0.7)",
              },
            }}
          >
            {/* BoolCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "8px",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(139, 92, 246, 0.5) 0%, rgba(139, 92, 246, 0) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                },
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  backdropFilter: "blur(10px)",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(139, 92, 246, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Skeleton
                  borderRadius="lg"
                  height={isFull ? "405px" : isCompact ? "220px" : "160px"} // micro shortest
                />
              ) : (
                <BoolCard
                  verimeterScore={finalScore}
                  trollmeterScore={isFull ? trollmeterScore : undefined}
                  pro={isFull ? pro : undefined}
                  con={isFull ? con : undefined}
                  contentId={contentId ?? undefined}
                  size={isFull ? "md" : "sm"} // micro/compact => sm
                  dense={!isFull} // micro/compact => dense
                />
              )}
            </Box>

            {/* TaskCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "8px",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(0, 162, 255, 0.5) 0%, rgba(0, 162, 255, 0) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                },
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  backdropFilter: "blur(10px)",
                  transition: "all 0.2s ease",
                },
                "&:hover > *": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 0 30px rgba(0, 162, 255, 0.4)",
                },
              }}
            >
              {isLoading ? (
                <Box p={3} borderRadius="lg" bg="stat2Gradient">
                  <Skeleton height={isFull ? "18px" : "14px"} mb={3} />
                  {isFull && <Skeleton height="150px" mb={2} />}
                  {isFull && <SkeletonText noOfLines={3} spacing="2" />}
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
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "8px",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(6, 182, 212, 0.5) 0%, rgba(6, 182, 212, 0) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                },
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  backdropFilter: "blur(10px)",
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
                  height={isFull ? "180px" : "120px"}
                />
              ) : (
                <PubCard publishers={publishers} compact={!isFull} />
              )}
            </Box>

            {/* AuthCard */}
            <Box
              sx={{
                ...cardWrapSx,
                position: "relative",
                flexShrink: 0,
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "8px",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(251, 146, 60, 0.5) 0%, rgba(251, 146, 60, 0) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                },
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  backdropFilter: "blur(10px)",
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
                  height={isFull ? "180px" : "120px"}
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
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "8px",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(74, 222, 128, 0.5) 0%, rgba(74, 222, 128, 0) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                },
                "> *": {
                  ...cardWrapSx["> *"],
                  overflow: "hidden",
                  backdropFilter: "blur(10px)",
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
                  height={isFull ? "180px" : "160px"}
                />
              ) : (
                <ProgressCard
                  ProgressScore={0.2}
                  totalClaims={90}
                  verifiedClaims={27}
                  totalReferences={20}
                  verifiedReferences={10}
                />
              )}
            </Box>
          </Flex>

          {/* Action Buttons Row */}
          {pivotTask && (
            <Box w="100%" mt={4}>
              <HStack justify="center" spacing={4}>
                <Button
                  className="mr-button"
                  onClick={handleMarkComplete}
                  bg="var(--mr-green-border)"
                  color="var(--mr-green)"
                  _hover={{
                    bg: "var(--mr-green)",
                    color: "black",
                  }}
                  size="md"
                  leftIcon={<span>✓</span>}
                >
                  Mark Complete
                </Button>
              </HStack>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default UnifiedHeader;
