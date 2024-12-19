import React, { useEffect, useRef } from "react";
import { Grid, GridItem, Show, Heading, Text } from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import TopicList from "../components/TopicList";
import { useShallow } from "zustand/react/shallow";

import { useTaskStore } from "../store/useTaskStore";

export const TaskPage: React.FC = () => {
  const tasks = useTaskStore(
    useShallow(
      (state) => state.filteredTasks // Zustand's shallow comparison utility
    )
  );
  const fetchTasks = useTaskStore(useShallow((state) => state.fetchTasks));

  // Fetch tasks on component mount
  const fetchInitiated = useRef(false);

  useEffect(() => {
    if (fetchInitiated.current) return;
    fetchInitiated.current = true;
    if (tasks.length === 0) {
      fetchTasks();
    }
  }, [tasks.length, fetchTasks]);

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
          <TopicList />
        </GridItem>
      </Show>
      <GridItem area="main" paddingLeft={20}>
        <Heading size="lg" textAlign="left" paddingBottom={14}>
          Active Tasks
        </Heading>
        {tasks.length === 0 ? (
          <Text>No tasks match the selected criteria.</Text>
        ) : (
          <TaskGrid tasks={tasks} />
        )}
      </GridItem>
    </Grid>
  );
};

export default TaskPage;
