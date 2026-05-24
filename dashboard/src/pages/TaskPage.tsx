// src/pages/TaskPage.tsx
import React, { useEffect, useState } from "react";
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
  Spinner,
} from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import axios from "axios";
import { Task } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const TaskPage: React.FC = () => {
  const assignedTasks = useTaskStore(
    useShallow((state) => state.assignedTasks),
  );
  const fetchTasksForUser = useTaskStore((state) => state.fetchTasksForUser);
  const selectedTopic = useTaskStore((state) => state.selectedTopic);
  const user = useAuthStore((s) => s.user);
  const [showArchived, setShowArchived] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "assigned">("all");
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.user_id) return;
    setLoading(true);
    if (filterMode === "all") {
      axios
        .get(`${API_BASE_URL}/api/all-tasks`, { params: { showInactive: showArchived } })
        .then((r) => setAllTasks(r.data))
        .catch((e) => console.error("Error fetching all tasks:", e))
        .finally(() => setLoading(false));
    } else {
      fetchTasksForUser(user.user_id, showArchived).finally(() => setLoading(false));
    }
  }, [showArchived, filterMode, user?.user_id]);

  const baseTasks = filterMode === "all" ? allTasks : assignedTasks;
  const tasksToDisplay = selectedTopic
    ? baseTasks.filter((t) => t.topic === selectedTopic)
    : baseTasks;

  return (
    <Box p={{ base: 2, md: 6 }} maxW="100%">
      <VStack align="center" spacing={4} w="100%">
        <HStack
          w="100%"
          justify="space-between"
          align="center"
          px={{ base: 2, md: 0 }}
          wrap="wrap"
          gap={4}
        >
          <Heading size="lg" color="teal.300" className="tasks-page-header">
            Cases
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
                onChange={(e) =>
                  setFilterMode(e.target.value as "all" | "assigned")
                }
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

        {loading ? (
          <Spinner size="xl" color="teal.300" mt={8} />
        ) : tasksToDisplay.length === 0 ? (
          <Text>
            No {filterMode === "assigned" ? "assigned " : ""}tasks found
            {selectedTopic ? ` for topic "${selectedTopic}"` : ""}.
            {showArchived
              ? " Try unchecking 'Include Archived'."
              : " Try checking 'Include Archived' to see more."}
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
