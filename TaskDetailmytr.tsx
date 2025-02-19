import React, { useEffect, useState } from "react";
import { Box, Grid, Heading, Text, Link, Divider } from "@chakra-ui/react";
import TaskCard from "../components/TaskCard";
import { useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const task = useTaskStore((state) =>
    state.content.find((t) => t.content_id === Number(taskId))
  );
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const fetchReferences = useTaskStore((state) => state.fetchReferences);
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const references = useTaskStore(
    (state) => state.references[Number(taskId)] || []
  );
  const assignedUsers = useTaskStore(
    (state) => state.assignedUsers[Number(taskId)] || []
  );
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

  useEffect(() => {
    console.log("Task ID:", taskId);
    console.log("Task:", task);
    if (!task) {
      fetchTasks(); // Fetch content if not already in the store
    }
    if (taskId) {
      fetchReferences(Number(taskId));
      fetchAssignedUsers(Number(taskId));
    }
  }, [taskId, task, fetchTasks, fetchReferences, fetchAssignedUsers]);

  if (!task) {
    return <Text>Loading task details or task not found.</Text>;
  }

  return (
    <>
      <Grid templateColumns={{ base: "1fr", md: "1fr 2fr" }} gap={4}>
        {/* Task Details */}
        <Box>
          <Heading size="lg">{task.content_name}</Heading>
          <TaskCard task={task} />
        </Box>

        {/* Iframe for URL preview */}
        <Box>
          {iframeUrl ? (
            <iframe
              src={iframeUrl}
              title="Content Preview"
              style={{
                width: "100%",
                height: "400px",
                border: "1px solid gray",
              }}
            />
          ) : (
            <Text>Select a link to preview content here.</Text>
          )}
        </Box>
      </Grid>

      <Divider my={4} />

      {/* Source References */}
      <Box mt={4}>
        <Heading size="md" mb={2}>
          Source References
        </Heading>
        {references.length > 0 ? (
          <Grid templateColumns="repeat(3, 1fr)" gap={4}>
            {references.map((ref) => (
              <Box
                key={ref.reference_content_id}
                borderWidth="1px"
                borderRadius="lg"
                p={4}
              >
                <Text fontWeight="bold">{`Reference ${ref.reference_content_id}`}</Text>
                <Link
                  href={ref.url}
                  isExternal
                  onClick={(e) => {
                    e.preventDefault();
                    setIframeUrl(ref.url); // Load URL into iframe
                  }}
                >
                  {ref.url}
                </Link>
              </Box>
            ))}
          </Grid>
        ) : (
          <Text>No references found for this task.</Text>
        )}
      </Box>

      <Divider my={4} />

      {/* Assigned Users */}
      <Box mt={4}>
        <Heading size="md" mb={2}>
          Assigned Users
        </Heading>
        {assignedUsers.length > 0 ? (
          <Text>{assignedUsers.map((user) => user.username).join(", ")}</Text>
        ) : (
          <Text>No users assigned to this task.</Text>
        )}
      </Box>
    </>
  );
};

export default TaskDetail;
