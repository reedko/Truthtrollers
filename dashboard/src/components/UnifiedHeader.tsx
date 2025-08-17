import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex, IconButton, Tooltip } from "@chakra-ui/react";
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
  /** NEW: Compact vs Full layout */
  variant?: "full" | "compact";
  /** NEW: Make header sticky at top */
  sticky?: boolean;
  /** NEW: Show a tiny toggle button to switch variants at runtime */
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
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const verimeterScoreMap = useTaskStore((s) => s.verimeterScores || {});

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);

  // Local toggle state (falls back to prop default)
  const [localVariant, setLocalVariant] = useState<"full" | "compact">(variant);
  useEffect(() => setLocalVariant(variant), [variant]);

  const isCompact = localVariant === "compact";

  const resolvedPivotType =
    pivotType === "reference" ? "task" : pivotType || "task";

  const resolvedPivotId =
    pivotId !== undefined ? pivotId : selectedTask?.content_id ?? undefined;

  // Load pivot task(s)
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
      }
    };
    load();
  }, [resolvedPivotType, resolvedPivotId, selectedTask, fetchTasksByPivot]);

  // Fetch live Verimeter score (aggregate) as a fallback
  useEffect(() => {
    const fetchScore = async () => {
      if (!pivotTask?.content_id) return;
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
  }, [pivotTask?.content_id, viewerId, refreshKey]);

  if (!pivotTask) return null;

  const contentId = pivotTask.content_id;
  const storeScore =
    contentId != null ? verimeterScoreMap[contentId] ?? null : null;
  const finalScore = verimeterScore ?? storeScore ?? liveVerimeter;

  const authors = useMemo(
    () => ensureArray<Author>(pivotTask.authors),
    [pivotTask.authors]
  );
  const publishers = useMemo(
    () => ensureArray<Publisher>(pivotTask.publishers),
    [pivotTask.publishers]
  );

  // Sticky container styling
  const containerStyles = sticky
    ? {
        position: "sticky" as const,
        top: 0,
        zIndex: 40,
        backdropFilter: "saturate(180%) blur(6px)",
      }
    : {};

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
        {/* Verimeter / BoolCard */}
        <Box
          flex={{
            base: "1 1 100%",
            sm: isCompact ? "1 1 45%" : "1 1 48%",
            md: isCompact ? "1 1 24%" : "1 1 30%",
            lg: "1 1 18%",
          }}
          minW="220px"
        >
          <BoolCard
            verimeterScore={finalScore}
            trollmeterScore={isCompact ? undefined : trollmeterScore}
            pro={isCompact ? undefined : pro}
            con={isCompact ? undefined : con}
            contentId={contentId}
            // Optional props your BoolCard can ignore if not implemented
            size={isCompact ? "sm" : "md"}
            dense={isCompact as any}
          />
        </Box>

        {/* Task title / quick selector */}
        <Box
          flex={{
            base: "1 1 100%",
            sm: isCompact ? "1 1 45%" : "1 1 48%",
            md: isCompact ? "1 1 30%" : "1 1 30%",
            lg: "1 1 18%",
          }}
          minW="240px"
        >
          <TaskCard
            task={tasks}
            useStore={false}
            onSelect={setPivotTask}
            // Optional compact prop for a slimmer render
            compact={isCompact as any}
            hideMeta={isCompact as any}
          />
        </Box>

        {/* Right-side cards: tiny chips when compact; full cards otherwise */}
        {isCompact ? (
          <>
            <Box flex={{ base: "1 1 49%", md: "1 1 18%" }} minW="200px">
              <PubCard publishers={publishers.slice(0, 1)} compact />
            </Box>
            <Box flex={{ base: "1 1 49%", md: "1 1 18%" }} minW="200px">
              <AuthCard authors={authors.slice(0, 1)} compact />
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
              <PubCard publishers={publishers} />
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
              <AuthCard authors={authors} />
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
              <ProgressCard
                ProgressScore={0.2}
                totalClaims={90}
                verifiedClaims={27}
                totalReferences={20}
                verifiedReferences={10}
              />
            </Box>
          </>
        )}
      </Flex>
    </Box>
  );
};

export default UnifiedHeader;
