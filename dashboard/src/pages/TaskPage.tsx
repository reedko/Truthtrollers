// src/pages/TaskPage.tsx
import React, { useEffect, useRef } from "react";
import { Grid, GridItem, Show, Heading, Text, Button } from "@chakra-ui/react";
import TaskGrid from "../components/TaskGrid";
import TopicList from "../components/TopicList";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "../store/useTaskStore";

export const TaskPage: React.FC = () => {
  const content = useTaskStore(useShallow((state) => state.filteredTasks));
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const loadMoreTasks = useTaskStore((state) => state.loadMoreTasks);

  const fetchInitiated = useRef(false);

  useEffect(() => {
    if (!fetchInitiated.current) {
      fetchInitiated.current = true;
      if (content.length === 0) {
        fetchTasks();
      }
    }
  }, [content.length, fetchTasks]);

  useEffect(() => {
    console.log("🧠 Zustand filteredTasks in TaskPage:", content);
    console.log("📦 Number of tasks loaded:", content.length);
  }, [content]);

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
        {content.length === 0 ? (
          <Text>No content match the selected criteria.</Text>
        ) : (
          <>
            {/* Pass target redirect path here */}
            <TaskGrid content={content} redirectTo="/dashboard" />

            <Button mt={4} onClick={() => loadMoreTasks()}>
              Load More Tasks
            </Button>
          </>
        )}
      </GridItem>
    </Grid>
  );
};

export default TaskPage;
