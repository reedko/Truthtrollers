// src/components/TaskGrid.tsx
import React, { memo } from "react";
import { Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import TaskCard from "./TaskCard";
import { Task } from "../../../shared/entities/types";

const CARD_W = 250; // keep in sync with UnifiedHeader

interface TaskGridProps {
  content: Task[];
  redirectTo?: string;
}

const TaskGrid: React.FC<TaskGridProps> = memo(({ content }) => {
  // match UnifiedHeader’s fixed card width wrapper
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

  // compact cards on phone/tablet (like UnifiedHeader)
  const compact = useBreakpointValue({ base: true, md: false });

  return (
    <Flex
      wrap="wrap"
      justify="center" // ✅ center the grid
      align="stretch"
      columnGap={{ base: 3, md: 4 }} // ✅ horizontal gap
      rowGap={{ base: 3, md: 4 }} // ✅ vertical gap
      w="100%"
    >
      {content.map((task) => (
        <Box key={task.content_id} sx={cardWrapSx}>
          <TaskCard task={task} useStore={false} compact={!!compact} />
        </Box>
      ))}
    </Flex>
  );
});

export default memo(TaskGrid);
