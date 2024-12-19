import React, { useEffect, useState } from "react";
import {
  Box,
  Grid,
  Heading,
  Text,
  Link,
  Divider,
  Input,
  Flex,
  Button,
} from "@chakra-ui/react";
import TaskCard from "../components/TaskCard";
import { useLocation, useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

const TaskDetail = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const { task } = location.state || {};
  // task is what was passed in navigate’s state if available
  // If you didn’t explicitly pass it, this may be undefined.

  // Now you can use taskId or task in this component
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
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!task) fetchTasks();
    if (taskId) {
      fetchReferences(Number(taskId));
      fetchAssignedUsers(Number(taskId));
    }
  }, []);

  if (!task) {
    return <Text>Loading task details or task not found.</Text>;
  }

  return (
    <Box maxW="1200px" mx="auto" p={4}>
      {/* Navbar */}
      <Flex
        justify="space-between"
        align="center"
        mb={4}
        bg="gray.100"
        p={4}
        borderRadius="md"
      >
        <Heading size="md">Your Logo</Heading>
        <Input placeholder="Search..." width="300px" />
        <Button colorScheme="blue">Search</Button>
      </Flex>

      <Grid
        templateColumns="250px 1fr 1fr"
        templateRows="auto auto auto"
        gap={4}
        gridTemplateAreas={{
          base: `
          "taskCard frameA"
          "frameB frameC"
          "references references"
          "users users"`,
          md: `
          "taskCard frameA frameB"
          "taskCard frameC frameC"
          "references references references"
          "users users users"`,
        }}
      >
        {/* Task Card */}
        <Box
          gridArea="taskCard"
          borderWidth="1px"
          borderRadius="lg"
          p={4}
          bg="gray.50"
        >
          <Heading size="md" mb={2}>
            Task Details
          </Heading>
          <TaskCard task={task} />
        </Box>

        {/* Frame A: Content Viewer */}
        <Box gridArea="frameA" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            Content Viewer
          </Heading>
          {iframeUrl ? (
            <iframe
              src={iframeUrl}
              title="Content Viewer"
              style={{ width: "100%", height: "300px", border: "none" }}
            />
          ) : (
            <Text>Select a link to preview content here.</Text>
          )}
        </Box>

        {/* Frame B: Editor */}
        <Box gridArea="frameB" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            Discussion/Editor
          </Heading>
          <Text>This is the editor section for the task.</Text>
          <Box mt={2} p={2} borderWidth="1px" borderRadius="md" bg="white">
            <Input placeholder="Edit your document here..." />
          </Box>
        </Box>

        {/* Frame C: Reference Viewer */}
        <Box gridArea="frameC" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            Reference Viewer
          </Heading>
          {referenceUrl ? (
            <iframe
              src={referenceUrl}
              title="Reference Viewer"
              style={{ width: "100%", height: "300px", border: "none" }}
            />
          ) : (
            <Text>Select a reference to view here.</Text>
          )}
        </Box>

        {/* References Section */}
        <Box gridArea="references" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            References
          </Heading>
          <Grid templateColumns="repeat(auto-fill, minmax(150px, 1fr))" gap={2}>
            {references.map((ref) => (
              <Box
                key={ref.lit_reference_id}
                p={2}
                borderWidth="1px"
                borderRadius="md"
                bg="gray.100"
                textAlign="center"
                cursor="pointer"
                onClick={() => setReferenceUrl(ref.lit_reference_link)}
              >
                <Link>{`Reference ${ref.lit_reference_id}`}</Link>
              </Box>
            ))}
          </Grid>
        </Box>

        {/* Users Section */}
        <Box gridArea="users" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            Assigned Users
          </Heading>
          {assignedUsers.length > 0 ? (
            <Text>{assignedUsers.map((user) => user.username).join(", ")}</Text>
          ) : (
            <Text>No users assigned to this task.</Text>
          )}
        </Box>
      </Grid>
    </Box>
  );
};

export default TaskDetail;
