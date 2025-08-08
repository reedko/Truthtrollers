import React, { useEffect, useState } from "react";
import { Grid, Box, Flex } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";
import { Author, Publisher, Task } from "../../../shared/entities/types";
import { ensureArray } from "../utils/normalize";
import {
  fetchVerimeterScore,
  fetchContentScores,
} from "../services/useDashboardAPI";
import { getDefaultResultOrder } from "dns";

interface UnifiedHeaderProps {
  pivotType?: "task" | "author" | "publisher" | "reference";
  pivotId?: number;
  verimeterScore?: number;
  trollmeterScore?: number;
  pro?: number;
  con?: number;
  refreshKey?: number | string;
}
const UnifiedHeader: React.FC<UnifiedHeaderProps> = ({
  pivotType,
  pivotId,
  verimeterScore,
  trollmeterScore,
  pro,
  con,
  refreshKey,
}) => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);
  const viewerId = useTaskStore((s) => s.viewingUserId);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);
  const [liveVerimeter, setLiveVerimeter] = useState<number | null>(null);

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
  }, [resolvedPivotType, resolvedPivotId, selectedTask]);

  // Fetch live Verimeter score
  useEffect(() => {
    const fetchScore = async () => {
      if (!pivotTask?.content_id || viewerId == null) return;
      try {
        const result = await fetchContentScores(pivotTask.content_id, null);
        if (result && result.verimeterScore !== undefined) {
          setLiveVerimeter(result.verimeterScore);
          console.log(result, "::::resulteds:::::", result.verimeterScore);
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

  const finalScore = verimeterScore != null ? verimeterScore : liveVerimeter;
  const authors = ensureArray<Author>(pivotTask.authors);
  const publishers = ensureArray<Publisher>(pivotTask.publishers);

  return (
    <Flex wrap="wrap" gap={4} mb={6} justify="space-between">
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
        minW="240px"
      >
        <BoolCard
          verimeterScore={finalScore}
          trollmeterScore={trollmeterScore}
          pro={pro}
          con={con}
          contentId={contentId}
        />
      </Box>
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
        minW="240px"
      >
        <TaskCard task={tasks} useStore={false} onSelect={setPivotTask} />
      </Box>
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
        minW="240px"
      >
        <PubCard publishers={publishers} />
      </Box>
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
        minW="240px"
      >
        <AuthCard authors={authors} />
      </Box>
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
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
    </Flex>
  );
};

export default UnifiedHeader;
