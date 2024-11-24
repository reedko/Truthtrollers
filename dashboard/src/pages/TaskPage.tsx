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
import useTopics from "../hooks/useTopics";
import { useState } from "react";
import useTaskManagement from "../hooks/useTaskManagement";

export const TaskPage = () => {
  const {
    data: allTasks,
    loading,
    error,
  } = useFetchTasks("http://localhost:5001/api/tasks") as {
    data: Task[];
    loading: boolean;
    error: string | null;
  };
  const currentUserId = "reedko@gmail.com"; // Placeholder value for currentUserId
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]); // Track selected task IDs
  const { topics, subtopics } = useTopics(allTasks); // Use the custom hook

  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(
    undefined
  );
  const [selectedSubtopic, setSelectedSubtopic] = useState<string | undefined>(
    undefined
  );

  const filteredTasks = useTaskManagement(
    allTasks,
    selectedTopic,
    selectedSubtopic
  ); // Use the new hook

  const handleCheckboxChange = (taskId: number) => {
    setSelectedTasks((prev) => {
      if (prev.includes(taskId)) {
        return prev.filter((id) => id !== taskId); // Unselect
      } else {
        return [...prev, taskId]; // Select
      }
    });
  };

  const unassignedTasks = filteredTasks.filter(
    (task: Task) =>
      task.assigned === "unassigned" || !task.users.includes(currentUserId)
  );

  const userTasks = filteredTasks.filter(
    (task: Task) =>
      task.assigned === "assigned" && task.users.includes(currentUserId)
  );

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
          <TopicList
            topics={topics}
            subtopics={subtopics}
            onTopicSelect={(topic, subtopic) => {
              setSelectedTopic(topic);
              setSelectedSubtopic(subtopic);
            }}
          />
        </GridItem>
      </Show>

      <GridItem area="main">
        <Box paddingLeft={2}>
          <Flex marginBottom={5}>
            <Box marginRight={5}></Box>
          </Flex>
        </Box>
        <Heading size="lg" textAlign="left">
          Unassigned or Other Users' Tasks
        </Heading>
        {loading && <Text>Loading...</Text>}
        {error && <Text color="red.500">{error}</Text>}
        {!loading && !error && (
          <TaskGrid
            tasks={unassignedTasks}
            selectedTasks={selectedTasks}
            onCheckboxChange={handleCheckboxChange}
          />
        )}
        <Heading size="lg" textAlign="left">
          Your Assigned Tasks
        </Heading>
        <TaskGrid
          tasks={userTasks}
          selectedTasks={selectedTasks}
          onCheckboxChange={handleCheckboxChange}
        />
      </GridItem>
    </Grid>
  );
};

export default TaskPage;
