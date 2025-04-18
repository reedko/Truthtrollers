// src/components/TaskGrid.tsx
import { SimpleGrid } from "@chakra-ui/react";
import React, { memo } from "react";
import TaskCard from "./TaskCard";

interface TaskGridProps {
  content: any[];
  redirectTo?: string; // optional, defaults to dashboard
}

const TaskGrid: React.FC<TaskGridProps> = memo(({ content, redirectTo }) => {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
      {content.map((task) => (
        <TaskCard key={task.content_id} task={task} useStore={false} />
      ))}
    </SimpleGrid>
  );
});

export default memo(TaskGrid);
