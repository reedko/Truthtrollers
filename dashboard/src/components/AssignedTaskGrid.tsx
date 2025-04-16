// src/components/AssignedTaskGrid.tsx
import { Box, Grid, Wrap, WrapItem } from "@chakra-ui/react";
import MicroTaskCard from "./MicroTaskCard";
import { Task } from "../../../shared/entities/types";
import { useTaskStore } from "../store/useTaskStore";

interface Props {
  tasks: Task[];
}

const AssignedTaskGrid: React.FC<Props> = ({ tasks }) => {
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

  return (
    <Box maxH="425px" overflowY="auto" pr={1}>
      <Grid
        templateColumns="repeat(2, 1fr)" // 2 columns
        gap={3}
        justifyItems="center"
      >
        {tasks.map((task) => (
          <MicroTaskCard
            key={task.content_id}
            task={task}
            onSelect={setSelectedTask}
          />
        ))}
      </Grid>
    </Box>
  );
};

export default AssignedTaskGrid;
