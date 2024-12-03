import React, { useState, useEffect } from "react";
import { Grid, GridItem, Show, Heading, Text } from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import TopicList from "../components/TopicList";
import axios from "axios";
import { Task } from "../entities/useTask";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const TaskPage: React.FC<{
  taskUsers: { [taskId: number]: string[] };
  setTaskUsers: React.Dispatch<
    React.SetStateAction<{ [taskId: number]: string[] }>
  >;
}> = ({ taskUsers, setTaskUsers }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(
    undefined
  );

  // Fetch tasks on load
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/tasks`);
        setTasks(response.data);
        setFilteredTasks(response.data);
      } catch (error) {
        console.error("Error fetching tasks:", error);
      }
    };

    fetchTasks();
  }, []);

  // Handle topic selection
  const handleTopicSelect = (topicName: string | undefined) => {
    setSelectedTopic(topicName);
    setFilteredTasks(
      topicName ? tasks.filter((task) => task.topic === topicName) : tasks
    );
  };

  // Fetch assigned users
  const fetchAssignedUsers = async (taskId: number): Promise<string[]> => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/get-users`
      );
      const usernames = response.data.map(
        (user: { user_id: number; username: string }) => user.username
      );
      setTaskUsers((prev) => ({
        ...prev,
        [taskId]: usernames, // Add or update the entry for this taskId
      }));
      return usernames;
    } catch (err) {
      console.error("Error fetching assigned users:", err);
      return [];
    }
  };

  // Fetch references
  const fetchReferences = async (taskId: number): Promise<string[]> => {
    try {
      console.log("Something");
      /*       const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/get-users`
      ); */
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/source-references`
      );
      return response.data;
    } catch (err) {
      console.error("Error fetching references:", err);
      return [];
    }
  };

  // Assign user to task
  const assignUserToTask = async (taskId: number, userId: number) => {
    try {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/assign`, {
        userId,
      });
    } catch (err) {
      console.error("Error assigning user:", err);
    }
  };

  return (
    <Grid
      templateAreas={{
        base: `"main"`,
        lg: `"aside main"`,
      }}
      templateColumns={{
        base: "2fr",
        lg: "200px 2fr",
      }}
      gap={4}
    >
      <Show above="lg">
        <GridItem area="aside" paddingX={5}>
          <TopicList
            selectedTopic={selectedTopic}
            onTopicSelect={handleTopicSelect}
          />
        </GridItem>
      </Show>
      <GridItem area="main" paddingLeft={20}>
        <Heading size="lg" textAlign="left" paddingBottom={14}>
          Active Tasks
        </Heading>
        {filteredTasks.length === 0 ? (
          <Text>No tasks match the selected criteria.</Text>
        ) : (
          <TaskGrid
            tasks={filteredTasks}
            taskUsers={taskUsers} // Pass current assigned users
            setTaskUsers={setTaskUsers} // Pass callback to update assigned users
            fetchAssignedUsers={fetchAssignedUsers}
            fetchReferences={fetchReferences}
            assignUserToTask={assignUserToTask}
          />
        )}
      </GridItem>
    </Grid>
  );
};

export default TaskPage;
