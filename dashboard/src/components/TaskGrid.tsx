import { SimpleGrid } from "@chakra-ui/react";
import React, { memo } from "react";
import TaskCard from "./TaskCard";

const TaskGrid: React.FC<{ content: any }> = memo(({ content }) => {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
      {content.map((task: any) => (
        <TaskCard key={task.content_id} task={task} />
      ))}
    </SimpleGrid>
  );
});

export default memo(TaskGrid);
