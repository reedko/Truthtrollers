// src/pages/TaskPage.tsx
import React, { useEffect, useRef } from "react";
import {
  Grid,
  GridItem,
  Heading,
  Text,
  Button,
  Box,
  VStack,
} from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "../store/useTaskStore";
import { useLocation } from "react-router-dom";

export const TaskPage: React.FC = () => {
  const content = useTaskStore(useShallow((state) => state.filteredTasks));
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const loadMoreTasks = useTaskStore((state) => state.loadMoreTasks);
  const location = useLocation();
  const redirectTo = location.state?.redirectTo || "/dashboard";
  const fetchInitiated = useRef(false);

  useEffect(() => {
    if (!fetchInitiated.current) {
      fetchInitiated.current = true;
      if (content.length === 0) {
        fetchTasks();
      }
    }
  }, [content.length, fetchTasks]);

  return (
    <Box p={4}>
      <VStack align="start" spacing={4}>
        <Heading size="lg" color="teal.300">
          Active Tasks
        </Heading>

        {content.length === 0 ? (
          <Text>No content matches the selected criteria.</Text>
        ) : (
          <>
            <TaskGrid content={content} />
            <Button mt={4} onClick={() => loadMoreTasks()} colorScheme="teal">
              Load More Tasks
            </Button>
          </>
        )}
      </VStack>
    </Box>
  );
};

export default TaskPage;
