import React, { useEffect, useState } from "react";
import { Box, Grid, Heading, Text, Link, Divider } from "@chakra-ui/react";
import TaskCard from "../components/TaskCard";
import { useParams, useLocation } from "react-router-dom";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const TaskDetail: React.FC<{
  taskUsers: { [taskId: number]: string[] };
  setTaskUsers: React.Dispatch<
    React.SetStateAction<{ [taskId: number]: string[] }>
  >;
}> = ({ taskUsers, setTaskUsers }) => {
  const location = useLocation();
  const { taskId } = useParams();
  const task = location.state?.task;
  if (!taskId) return <div>Error: Task ID not provided</div>;
  if (!task) return <Text>Task not found</Text>;

  const [references, setReferences] = useState<any[]>([]); // Source references
  const [iframeUrl, setIframeUrl] = useState<string | null>(null); // URL for iframe preview
  const [users, setUsers] = useState<string[]>([]); // Assigned users

  // Fetch references for the task
  const fetchReferences = async (taskId: number): Promise<any[]> => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/source-references`
      );
      return response.data;
    } catch (err) {
      console.error("Error fetching references:", err);
      return [];
    }
  };

  // Fetch assigned users
  const fetchAssignedUsers = async (taskId: number): Promise<string[]> => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/get-users`
      );
      return response.data;
    } catch (err) {
      console.error("Error fetching assigned users:", err);
      return [];
    }
  };

  // Assign user to the task
  const assignUserToTask = async (taskId: number, userId: number) => {
    try {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/assign`, {
        userId,
      });
      const updatedUsers = await fetchAssignedUsers(taskId);
      setUsers(updatedUsers); // Update users list after assignment
    } catch (err) {
      console.error("Error assigning user:", err);
    }
  };

  useEffect(() => {
    // Fetch references and assigned users when the component mounts
    const loadData = async () => {
      const refs = await fetchReferences(task.task_id);
      setReferences(refs);

      const assignedUsers = await fetchAssignedUsers(task.task_id);
      setUsers(assignedUsers);
    };

    loadData();
  }, [task.task_id]);

  return (
    <>
      <Grid templateColumns={{ base: "1fr", md: "1fr 2fr" }} gap={4}>
        {/* Task Details */}
        <Box>
          <Heading size="lg">{task.task_name}</Heading>
          <TaskCard
            key={task.task_id}
            task={task}
            taskUsers={taskUsers}
            assignedUsers={taskUsers[task.task_id] || []}
            setTaskUsers={setTaskUsers} // Pass setTaskUsers to TaskCard
            onFetchAssignedUsers={() => fetchAssignedUsers(task.task_id)}
            onFetchReferences={fetchReferences}
            onAssignUserToTask={assignUserToTask}
          />
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
            {references.map((ref, index) => (
              <Box key={index} borderWidth="1px" borderRadius="lg" p={4}>
                <Text fontWeight="bold">
                  <Link href={ref.lit_reference_link} target="_blank">
                    {ref.lit_reference_link}
                  </Link>
                </Text>
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
    </>
  );
};

export default TaskDetail;
