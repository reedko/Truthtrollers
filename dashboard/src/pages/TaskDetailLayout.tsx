// src/pages/TaskDetailLayout.tsx

import React, { useEffect } from "react";
import { Box, Grid, Heading, Input, Text, Tooltip } from "@chakra-ui/react";
import { useState } from "react";
import {
  Task,
  User,
  Node,
  Reference,
  Author,
  Publisher,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
} from "../entities/useD3Nodes";
import { EditorFrame } from "../components/EditorFrame";
import NetworkGraph from "../components/NetworkGraph"; // Import the NetworkGraph component
import { transformData } from "../services/dataTransform"; // Import the data transformation function
import TaskCard from "../components/TaskCard";
interface TaskDetailLayoutProps {
  task: Task;
  references: Reference[];
  assignedUsers: User[];
  authors: Author[];
  publishers: Publisher[];
  lit_references?: LitReference[];
  task_authors: TaskAuthor[];
  task_references: TaskReference[];
  auth_references: AuthReference[];
  // Add other props if necessary
}

const TaskDetailLayout: React.FC<TaskDetailLayoutProps> = ({
  task,
  references,
  assignedUsers,
  authors,
  publishers,
  lit_references = [],
  task_authors = [],
  task_references = [],
  auth_references = [],
}) => {
  const [iframeUrl, setIframeUrl] = useState<string>(task.url || "");
  const [editorContent, setEditorContent] = useState("");

  // Prepare data for the network graph
  const { nodes, links } = transformData(
    {
      authors,
      publishers,
      tasks: [task], // Only the current task
      lit_references,
      task_authors,
      task_references,
      auth_references,
    },
    task.task_id
  );

  // Log nodes and links for debugging
  useEffect(() => {
    console.log("Transformed Nodes:", nodes);
    console.log("Transformed Links:", links);
  }, [nodes, links]);

  const handleNodeClick = (node: Node) => {
    // Implement logic for node click, e.g., open a modal with details
    alert(`Clicked on ${node.label}`);
  };

  return (
    <>
      <Box w="100%" p={4} overflow="auto">
        <Grid
          templateColumns={{ base: "1fr", md: "1fr 2fr" }}
          templateRows="auto auto auto auto auto"
          gap={2}
          gridTemplateAreas={{
            base: `
              "taskCard"
              "frameA"
              "editor"
              "relationFlow"
              "references"
              "users"
            `,
            md: `
              "taskCard frameA"
              "editor editor" 
              "relationFlow relationFlow"
              "references references"
              "users users"
            `,
          }}
          alignItems="stretch"
        >
          {/* Task Card */}
          <Box
            gridArea="taskCard"
            width="300px"
            borderWidth="1px"
            borderRadius="lg"
            p={4}
          >
            <Heading size="md" mb={2}>
              Task Details
            </Heading>
            {task ? (
              <TaskCard key={task.task_id} task={task} />
            ) : (
              <Text>Loading or Task Not Found</Text>
            )}
          </Box>

          {/* Frame A: Content Viewer */}
          <Box
            width="100%"
            gridArea="frameA"
            borderWidth="1px"
            borderRadius="lg"
            p={2}
          >
            <Heading size="sm" mb={2}>
              Content Viewer
            </Heading>

            {iframeUrl ? (
              <iframe
                src={iframeUrl}
                title="Content Viewer"
                style={{ width: "100%", height: "95%", border: "none" }}
              />
            ) : (
              <Text>Select a link to preview content here.</Text>
            )}
            <Box mt={4}>
              <Input
                placeholder="Paste a link here..."
                value={iframeUrl}
                onChange={(e) => setIframeUrl(e.target.value)}
              />
            </Box>
          </Box>

          {/* Editor (using Slate) */}
          <Box gridArea="editor" borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="sm" mb={2}>
              Editor (Discussion)
            </Heading>
            <EditorFrame />
          </Box>

          {/* Relation Flow: Network Graph */}
          <Box
            gridArea="relationFlow"
            borderWidth="1px"
            borderRadius="lg"
            p={4}
          >
            <Heading size="sm" mb={2}>
              Relationship Map
            </Heading>
            <NetworkGraph
              nodes={nodes}
              links={links}
              width={600}
              height={400}
              onNodeClick={handleNodeClick}
            />
          </Box>

          {/* References Section (3-column layout) */}
          <Box
            gridArea="references"
            borderWidth="1px"
            borderRadius="lg"
            p={4}
            overflowY="auto"
          >
            <Heading size="md" mb={2}>
              Source References
            </Heading>
            {references.length > 0 ? (
              <Grid templateColumns="repeat(3, 1fr)" gap={4}>
                {references.map((ref) => (
                  <Box
                    key={ref.lit_reference_id}
                    borderWidth="1px"
                    borderRadius="lg"
                    p={4}
                    overflow="hidden"
                  >
                    <Text fontWeight="bold" mb={1}>
                      {`Reference ${ref.lit_reference_id}`}
                    </Text>
                    <Tooltip label={ref.lit_reference_link}>
                      <Text
                        fontSize="sm"
                        noOfLines={1} // ensures truncation
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        cursor="pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          // Load URL into iframe or handle as needed
                          setIframeUrl(ref.lit_reference_link);
                        }}
                      >
                        {ref.lit_reference_link}
                      </Text>
                    </Tooltip>
                  </Box>
                ))}
              </Grid>
            ) : (
              <Text>No references found for this task.</Text>
            )}
          </Box>

          {/* Users Section */}
          <Box gridArea="users" borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="sm" mb={2}>
              Assigned Users
            </Heading>
            {assignedUsers && assignedUsers.length > 0 ? (
              <Text>
                {assignedUsers.map((user) => user.username).join(", ")}
              </Text>
            ) : (
              <Text>No users assigned to this task.</Text>
            )}
          </Box>
        </Grid>
      </Box>
    </>
  );
};

export default TaskDetailLayout;
