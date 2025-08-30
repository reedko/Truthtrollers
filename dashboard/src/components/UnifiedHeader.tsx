import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Flex,
  IconButton,
  Tooltip,
  Skeleton,
  SkeletonText,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import { useTaskStore } from "../store/useTaskStore";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";
import { Author, Publisher, Task } from "../../../shared/entities/types";
import { ensureArray } from "../utils/normalize";
import { fetchContentScores } from "../services/useDashboardAPI";

interface UnifiedHeaderProps {
  pivotType?: "task" | "author" | "publisher" | "reference";
  pivotId?: number;
  verimeterScore?: number;
  trollmeterScore?: number;
  pro?: number;
  con?: number;
  refreshKey?: number | string;
  variant?: "full" | "compact";
  sticky?: boolean;
  allowToggle?: boolean;
}

const UnifiedHeader: React.FC<UnifiedHeaderProps> = ({
  pivotType,
  pivotId,
  verimeterScore,
  trollmeterScore,
  pro,
  con,
  refreshKey,
  variant = "full",
  sticky = false,
  allowToggle = false,
}) => {
  // Zustand selectors (these are hooks too!)
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const verimeterScoreMap = useTaskStore((s) => s.verimeterScores || {});

  // Local state hooks (must always be called)
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);
  const [localVariant, setLocalVariant] = useState<"full" | "compact">(variant);

  // Keep localVariant in sync with prop
  useEffect(() => setLocalVariant(variant), [variant]);

  const isCompact = localVariant === "compact";
  const resolvedPivotType =
    pivotType === "reference" ? "task" : pivotType || "task";
  const resolvedPivotId =
    pivotId !== undefined ? pivotId : selectedTask?.content_id ?? undefined;

  // fetch tasks by pivot (always run)
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

  // fetch live verimeter (always run; guarded inside)
  useEffect(() => {
    const fetchScore = async () => {
      if (!pivotTask?.content_id) {
        setLiveVerimeter(null);
        return;
      }
      try {
        const result = await fetchContentScores(pivotTask.content_id, null);
        if (result && result.verimeterScore !== undefined) {
          setLiveVerimeter(result.verimeterScore);
        } else {
          setLiveVerimeter(null);
        }
      } catch (err) {
        console.error("Error fetching live verimeter score:", err);
        setLiveVerimeter(null);
      }
    };
    fetchScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivotTask?.content_id, viewerId, refreshKey]);

  // SAFETY: compute derived values with fallbacks; do not early return before hooks
  const contentId = pivotTask?.content_id ?? null;
  const storeScore =
    contentId != null ? verimeterScoreMap[contentId] ?? null : null;
  const finalScore = verimeterScore ?? storeScore ?? liveVerimeter;

  // Always call these hooks; if pivotTask is null, fall back to []
  const authors = useMemo(
    () => ensureArray<Author>(pivotTask?.authors),
    [pivotTask]
  );
  const publishers = useMemo(
    () => ensureArray<Publisher>(pivotTask?.publishers),
    [pivotTask]
  );

  // Sticky container styling (no hooks here)
  const containerStyles = sticky
    ? ({
        position: "sticky",
        top: 0,
        zIndex: 40,
        backdropFilter: "saturate(180%) blur(6px)",
      } as const)
    : {};

  // When we have no pivotTask yet, render a lightweight skeleton—BUT after all hooks have run
  const isLoading = !pivotTask;

  return (
    <Box position="relative">
      {allowToggle && (
        <Tooltip
          label={
            isCompact ? "Switch to full header" : "Switch to compact header"
          }
          hasArrow
          placement="left"
        >
          <IconButton
            aria-label="Toggle header density"
            icon={isCompact ? <ViewIcon /> : <ViewOffIcon />}
            size="sm"
            variant="ghost"
            position="absolute"
            right="4"
            top="-2"
            zIndex={45}
            onClick={() =>
              setLocalVariant((v) => (v === "compact" ? "full" : "compact"))
            }
          />
        </Tooltip>
      )}

      <Flex
        wrap="wrap"
        gap={isCompact ? 3 : 4}
        mb={isCompact ? 3 : 6}
        justify="space-between"
        sx={containerStyles}
      >
        {/* BoolCard */}
        <Box
          flex={{
            base: "1 1 100%",
            sm: isCompact ? "1 1 45%" : "1 1 48%",
            md: isCompact ? "1 1 24%" : "1 1 30%",
            lg: "1 1 18%",
          }}
          minW="220px"
        >
          {isLoading ? (
            <Skeleton
              borderRadius="lg"
              height={isCompact ? "220px" : "405px"}
            />
          ) : (
            <BoolCard
              verimeterScore={finalScore}
              trollmeterScore={isCompact ? undefined : trollmeterScore}
              pro={isCompact ? undefined : pro}
              con={isCompact ? undefined : con}
              contentId={contentId ?? undefined}
              size={isCompact ? "sm" : "md"}
              dense={isCompact}
            />
          )}
        </Box>

        {/* TaskCard */}
        <Box
          flex={{
            base: "1 1 100%",
            sm: isCompact ? "1 1 45%" : "1 1 48%",
            md: isCompact ? "1 1 30%" : "1 1 30%",
            lg: "1 1 18%",
          }}
          minW="240px"
        >
          {isLoading ? (
            <Box p={3} borderRadius="lg" bg="stat2Gradient">
              <Skeleton height="18px" mb={3} />
              <Skeleton height="150px" mb={2} />
              <SkeletonText noOfLines={3} spacing="2" />
            </Box>
          ) : (
            <TaskCard
              task={tasks}
              useStore={false}
              onSelect={setPivotTask}
              compact={isCompact}
              hideMeta={isCompact}
            />
          )}
        </Box>

        {/* Right-side cards */}
        {isCompact ? (
          <>
            <Box flex={{ base: "1 1 49%", md: "1 1 18%" }} minW="200px">
              {isLoading ? (
                <Skeleton borderRadius="lg" height="120px" />
              ) : (
                <PubCard publishers={publishers.slice(0, 1)} compact />
              )}
            </Box>
            <Box flex={{ base: "1 1 49%", md: "1 1 18%" }} minW="200px">
              {isLoading ? (
                <Skeleton borderRadius="lg" height="120px" />
              ) : (
                <AuthCard authors={authors.slice(0, 1)} compact />
              )}
            </Box>
          </>
        ) : (
          <>
            <Box
              flex={{
                base: "1 1 100%",
                sm: "1 1 48%",
                md: "1 1 30%",
                lg: "1 1 18%",
              }}
              minW="240px"
            >
              {isLoading ? (
                <Skeleton borderRadius="lg" height="180px" />
              ) : (
                <PubCard publishers={publishers} />
              )}
            </Box>
            <Box
              flex={{
                base: "1 1 100%",
                sm: "1 1 48%",
                md: "1 1 30%",
                lg: "1 1 18%",
              }}
              minW="240px"
            >
              {isLoading ? (
                <Skeleton borderRadius="lg" height="180px" />
              ) : (
                <AuthCard authors={authors} />
              )}
            </Box>
            <Box
              flex={{
                base: "1 1 100%",
                sm: "1 1 48%",
                md: "1 1 30%",
                lg: "1 1 18%",
              }}
              minW="240px"
            >
              {isLoading ? (
                <Skeleton borderRadius="lg" height="180px" />
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
          </>
        )}
      </Flex>
    </Box>
  );
};

export default UnifiedHeader;
