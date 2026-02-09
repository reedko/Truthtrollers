// src/pages/TaskPage.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Grid,
  GridItem,
  Heading,
  Text,
  Button,
  Box,
  VStack,
  HStack,
  Switch,
  FormControl,
  FormLabel,
} from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { useLocation } from "react-router-dom";

export const TaskPage: React.FC = () => {
  const assignedTasks = useTaskStore(useShallow((state) => state.assignedTasks));
  const fetchTasksForUser = useTaskStore((state) => state.fetchTasksForUser);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const redirectTo = location.state?.redirectTo || "/dashboard";
  const fetchInitiated = useRef(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!fetchInitiated.current && user?.user_id) {
      fetchInitiated.current = true;
      fetchTasksForUser(user.user_id, showArchived);
    }
  }, [user?.user_id, fetchTasksForUser]);

  // Refetch when showArchived changes
  useEffect(() => {
    if (user?.user_id) {
      fetchTasksForUser(user.user_id, showArchived);
    }
  }, [showArchived, user?.user_id, fetchTasksForUser]);

  return (
    <Box p={4}>
      <VStack align="center" spacing={4} w="100%">
        <HStack w="100%" justify="space-between" align="center">
          <Heading size="lg" color="teal.300">
            My Tasks
          </Heading>

          <FormControl display="flex" alignItems="center" w="auto">
            <FormLabel htmlFor="show-archived" mb="0" fontSize="sm">
              Show Archived
            </FormLabel>
            <Switch
              id="show-archived"
              isChecked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              colorScheme="teal"
            />
          </FormControl>
        </HStack>

        {assignedTasks.length === 0 ? (
          <Text>No tasks found. {showArchived ? "Try unchecking 'Show Archived'." : ""}</Text>
        ) : (
          <TaskGrid content={assignedTasks} />
        )}
      </VStack>
    </Box>
  );
};

export default TaskPage;
