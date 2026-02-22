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
  Select,
} from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { Task } from "../../../shared/entities/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const TaskPage: React.FC = () => {
  const assignedTasks = useTaskStore(useShallow((state) => state.assignedTasks));
  const fetchTasksForUser = useTaskStore((state) => state.fetchTasksForUser);
  const selectedTopic = useTaskStore((state) => state.selectedTopic);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const redirectTo = location.state?.redirectTo || "/dashboard";
  const fetchInitiated = useRef(false);
  const [showArchived, setShowArchived] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "assigned">("all");
  const [allTasks, setAllTasks] = useState<Task[]>([]);

  // Fetch all tasks (not filtered by user)
  const fetchAllTasks = async (includeArchived: boolean) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/all-tasks`, {
        params: { showInactive: includeArchived }
      });
      setAllTasks(response.data);
    } catch (error) {
      console.error("Error fetching all tasks:", error);
    }
  };

  useEffect(() => {
    if (!fetchInitiated.current && user?.user_id) {
      fetchInitiated.current = true;
      if (filterMode === "all") {
        fetchAllTasks(showArchived);
      } else {
        fetchTasksForUser(user.user_id, showArchived);
      }
    }
  }, [user?.user_id, fetchTasksForUser]);

  // Refetch when filters change
  useEffect(() => {
    if (user?.user_id) {
      if (filterMode === "all") {
        fetchAllTasks(showArchived);
      } else {
        fetchTasksForUser(user.user_id, showArchived);
      }
    }
  }, [showArchived, filterMode, user?.user_id, fetchTasksForUser]);

  const baseTasks = filterMode === "all" ? allTasks : assignedTasks;
  const tasksToDisplay = selectedTopic
    ? baseTasks.filter((t) => t.topic === selectedTopic)
    : baseTasks;

  return (
    <Box p={{ base: 2, md: 6 }} maxW="100%">
      <VStack align="center" spacing={4} w="100%">
        <HStack w="100%" justify="space-between" align="center" px={{ base: 2, md: 0 }} wrap="wrap" gap={4}>
          <Heading size="lg" color="teal.300" className="tasks-page-header">
            Tasks
          </Heading>

          <HStack spacing={4} wrap="wrap">
            {/* Filter: All vs Assigned */}
            <FormControl display="flex" alignItems="center" w="auto">
              <FormLabel htmlFor="filter-mode" mb="0" fontSize="sm" mr={2}>
                Show:
              </FormLabel>
              <Select
                id="filter-mode"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as "all" | "assigned")}
                w="140px"
                size="sm"
                className="tasks-filter"
              >
                <option value="all">All Tasks</option>
                <option value="assigned">Assigned to Me</option>
              </Select>
            </FormControl>

            {/* Archive Toggle */}
            <FormControl display="flex" alignItems="center" w="auto">
              <FormLabel htmlFor="show-archived" mb="0" fontSize="sm">
                Include Archived
              </FormLabel>
              <Switch
                id="show-archived"
                isChecked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                colorScheme="teal"
              />
            </FormControl>
          </HStack>
        </HStack>

        {tasksToDisplay.length === 0 ? (
          <Text>
            No {filterMode === "assigned" ? "assigned " : ""}tasks found
            {selectedTopic ? ` for topic "${selectedTopic}"` : ""}.
            {showArchived ? " Try unchecking 'Include Archived'." : " Try checking 'Include Archived' to see more."}
          </Text>
        ) : (
          <Box w="100%" px={{ base: 0, md: 4 }}>
            <TaskGrid content={tasksToDisplay} />
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default TaskPage;
