// src/components/UnifiedHeader.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Flex,
  IconButton,
  Tooltip,
  Skeleton,
  SkeletonText,
  useBreakpointValue, // ⬅️ NEW
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import { useTaskStore } from "../store/useTaskStore";
import { useUIStore } from "../store/useUIStore";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";
import { Author, Publisher, Task } from "../../../shared/entities/types";
import { ensureArray } from "../utils/normalize";
import { fetchContentScores } from "../services/useDashboardAPI";
import MicroHeaderRail from "./headers/MicroHeaderRail";

type Variant = "full" | "compact" | "micro"; // ⬅️ reintroduce micro

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
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const verimeterScoreMap = useTaskStore((s) => s.verimeterScores || {});

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);

  // Use global header visibility state
  const isHeaderVisible = useUIStore((s) => s.isHeaderVisible);

  // 🔧 Auto-pick variant by breakpoint unless explicitly provided
  const bpVariant = useBreakpointValue<Variant>({
    base: "micro", // phones
    sm: "compact", // small tablets
    md: "full", // desktop+
  });
  const [localVariant, setLocalVariant] = useState<Variant>(
    variant ?? bpVariant ?? "full"
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
    "center" | "space-around" | "space-between"
  >({
    base: "center",
    sm: "center",
    md: "space-around",
    lg: "space-between",
  });

  const resolvedPivotType =
    (pivotType === "reference" ? "task" : pivotType) || "task";
  const resolvedPivotId =
    pivotId !== undefined ? pivotId : selectedTask?.content_id ?? undefined;

  useEffect(() => {
    const load = async () => {
      if (resolvedPivotId !== undefined) {
        const results = await fetchTasksByPivot(
          resolvedPivotType,
          resolvedPivotId
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
            : null
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
    contentId != null ? verimeterScoreMap[contentId] ?? null : null;
  const finalScore = verimeterScore ?? storeScore ?? liveVerimeter;

  const authors = useMemo(
    () => ensureArray<Author>(pivotTask?.authors),
    [pivotTask]
  );
  const publishers = useMemo(
    () => ensureArray<Publisher>(pivotTask?.publishers),
    [pivotTask]
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
  const cardWrapSx = {
    "--card-w": `${CARD_W}px`,
    flex: "0 0 var(--card-w)",
    width: "min(100%, var(--card-w))",
    maxWidth: "var(--card-w)",
    minWidth: "200px",
    "> *": {
      width: "100% !important",
      maxWidth: "100% !important",
      margin: "0 !important",
    },
  } as const;

  return (
    <Box position="relative" w="100%" px={0}>
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
                v === "full" ? "compact" : v === "compact" ? "micro" : "full"
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
        <Flex
          wrap="wrap"
          justify={justify} // ⬅️ spread on desktop, centered on phone
          align="stretch"
          columnGap={isMicro ? 2 : isCompact ? 3 : 4}
          rowGap={isMicro ? 2 : isCompact ? 3 : 4}
          mb={isMicro ? 2 : isCompact ? 3 : 6}
          w="100%"
          px={0}
          mx={0}
          sx={containerStyles}
        >
          {/* BoolCard */}
          <Box sx={cardWrapSx}>
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
          <Box sx={cardWrapSx}>
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
          <Box sx={cardWrapSx}>
            {isLoading ? (
              <Skeleton borderRadius="lg" height={isFull ? "180px" : "120px"} />
            ) : (
              <PubCard publishers={publishers} compact={!isFull} />
            )}
          </Box>

          {/* AuthCard */}
          <Box sx={cardWrapSx}>
            {isLoading ? (
              <Skeleton borderRadius="lg" height={isFull ? "180px" : "120px"} />
            ) : (
              <AuthCard
                authors={authors}
                compact={!isFull}
                contentId={contentId ?? undefined}
              />
            )}
          </Box>

          {/* ProgressCard — always show */}
          <Box sx={cardWrapSx}>
            {isLoading ? (
              <Skeleton borderRadius="lg" height={isFull ? "180px" : "160px"} />
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
      )}
    </Box>
  );
};

export default UnifiedHeader;
