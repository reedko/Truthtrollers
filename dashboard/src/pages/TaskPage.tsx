// ./src/pages/TaskPage.tsx
import {
  Grid,
  Show,
  GridItem,
  Box,
  Flex,
  Text,
  Heading,
} from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import TopicList from "../components/TopicList";
import { Task } from "../entities/useTask";
import useFetchTasks from "../hooks/useFetchTasks";
import { useTopicsStore } from "../store/useTopicStore";
import { useSearchStore } from "../store/useSearchStore"; // Import the search store

import { useEffect, useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const TaskPage = () => {
  const {
    data: allTasks,
    loading,
    error,
  } = useFetchTasks(`${API_BASE_URL}/api/tasks`) as {
    data: Task[];
    loading: boolean;
    error: string | null;
  };

  const {
    topics,
    subtopics,
    selectedTopic,
    selectedSubtopic,
    setSelectedTopic,
    setSelectedSubtopic,
    fetchTopics,
  } = useTopicsStore();

  const { searchQuery } = useSearchStore(); // Get the search query from the store

  const [selectedTasks, setSelectedTasks] = useState<number[]>([]); // Track selected task ID

  const handleCheckboxChange = (taskId: number) => {
    setSelectedTasks((prev) => {
      if (prev.includes(taskId)) {
        return prev.filter((id) => id !== taskId); // Unselect
      } else {
        return [...prev, taskId]; // Select
      }
    });
  };
  useEffect(() => {
    fetchTopics(); // Fetch topics and subtopics on mount
  }, [fetchTopics]);

  const filteredTasks = allTasks.filter((task) => {
    const matchesTopic = selectedTopic ? task.topic === selectedTopic : true;
    const matchesSubtopic = selectedSubtopic
      ? task.subtopic === selectedSubtopic
      : true;
    const matchesSearch =
      task.task_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.topic.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTopic && matchesSubtopic && matchesSearch;
  });

  return (
    <Grid
      templateAreas={{
        base: `"main"`,
        lg: `"aside main"`,
      }}
      templateColumns={{
        base: "2fr",
        lg: "150px 2fr",
      }}
    >
      <Show above="lg">
        <GridItem area="aside" paddingX={5}>
          <TopicList />
        </GridItem>
      </Show>

      <GridItem area="main">
        <Heading size="lg" textAlign="left">
          Active Tasks {selectedTopic ? "regarding: " + selectedTopic : ""}
        </Heading>
        {loading && <Text>Loading...</Text>}
        {error && <Text color="red.500">{error}</Text>}
        {!loading && !error && (
          <TaskGrid
            tasks={filteredTasks}
            selectedTasks={selectedTasks}
            onCheckboxChange={handleCheckboxChange}
          />
        )}
      </GridItem>
    </Grid>
  );
};

export default TaskPage;
