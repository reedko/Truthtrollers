import React, { useEffect, useState } from "react";
import { Grid, Box } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";
import { Author, Publisher, Task } from "../../../shared/entities/types";
import { ensureArray } from "../utils/normalize";

interface UnifiedHeaderProps {
  pivotType?: "task" | "author" | "publisher";
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

  useEffect(() => {
    const load = async () => {
      if (pivotType && pivotId !== undefined) {
        const results = await fetchTasksByPivot(pivotType, pivotId);
        setTasks(results);
        setPivotTask(results[0]);
      } else if (selectedTask) {
        setTasks([selectedTask]);
        setPivotTask(selectedTask);
      }
    };
    load();
  }, [pivotType, pivotId, selectedTask]);

  if (!pivotTask) return null;

  const authors = ensureArray<Author>(pivotTask.authors);
  const publishers = ensureArray<Publisher>(pivotTask.publishers);
  console.log(authors, "SDFDFDF");
  return (
    <Grid
      templateColumns={{ base: "1fr", md: "repeat(5, 1fr)" }}
      gap={4}
      mb={6}
    >
      <Box>
        <BoolCard
          verimeterScore={-0.6}
          trollmeterScore={0.2}
          pro={27}
          con={94}
        />
      </Box>
      <Box>
        <TaskCard task={tasks} useStore={false} onSelect={setPivotTask} />
      </Box>
      <Box>
        <PubCard publishers={publishers} />
      </Box>
      <Box>
        <AuthCard authors={authors} />
      </Box>
      <Box>
        <ProgressCard
          ProgressScore={0.2}
          totalClaims={90}
          verifiedClaims={27}
          totalReferences={20}
          verifiedReferences={10}
        />
      </Box>
    </Grid>
  );
};

export default UnifiedHeader;
