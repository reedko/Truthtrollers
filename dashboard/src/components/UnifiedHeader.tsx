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

interface UnifiedHeaderProps {
  pivotType?: "task" | "author" | "publisher" | "reference";
  pivotId?: number;
}

const UnifiedHeader: React.FC<UnifiedHeaderProps> = ({
  pivotType,
  pivotId,
}) => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const fetchTasksByPivot = useTaskStore((s) => s.fetchTasksByPivot);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pivotTask, setPivotTask] = useState<Task | null>(null);

  // 🔁 If no pivotId is passed, default to selectedTask
  const resolvedPivotType =
    pivotType === "reference" ? "task" : pivotType || "task";

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
      }
    };
    load();
  }, [resolvedPivotType, resolvedPivotId, selectedTask]);

  if (!pivotTask) return null;

  const authors = ensureArray<Author>(pivotTask.authors);
  const publishers = ensureArray<Publisher>(pivotTask.publishers);

  return (
    <Flex wrap="wrap" gap={4} mb={6} justify="space-between">
      <Box
        flex={{ base: "1 1 100%", sm: "1 1 48%", md: "1 1 30%", lg: "1 1 18%" }}
        minW="240px"
      >
        <BoolCard
          verimeterScore={-0.6}
          trollmeterScore={0.2}
          pro={27}
          con={94}
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
