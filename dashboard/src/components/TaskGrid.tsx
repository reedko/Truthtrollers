import { SimpleGrid } from "@chakra-ui/react";
import React, { memo } from "react";
import TaskCard from "./TaskCard";

const TaskGrid: React.FC<{ tasks: any }> = memo(({ tasks }) => {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
      {tasks.map((task: any) => (
        <TaskCard key={task.task_id} task={task} />
      ))}
    </SimpleGrid>
  );
});

export default memo(TaskGrid);
