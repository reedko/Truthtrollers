// src/pages/TaskDetailLayout.tsx
import React, { useEffect, useState } from "react";
import { Box, Grid, Heading, Input, Text, Tooltip } from "@chakra-ui/react";
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
import NetworkGraph from "../components/NetworkGraph";
import { fetchNewGraphData } from "../services/api"; // New API call

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
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: Node[]; links: any[] }>({
    nodes: [],
    links: [],
  });

  useEffect(() => {
    if (selectedNode) {
      fetchNewGraphData(selectedNode).then(setGraphData);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (selectedNode) {
      console.log("📡 Fetching new graph data for:", selectedNode);
      fetchNewGraphData(selectedNode).then((data) => {
        console.log("🔗 Graph Data Received:", data);
        setGraphData(data);
      });
    }
  }, [selectedNode]);
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

          {/* Content Viewer */}
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

          {/* Discussion Editor */}
          <Box gridArea="editor" borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="sm" mb={2}>
              Editor (Discussion)
            </Heading>
            <EditorFrame />
          </Box>

          {/* Relationship Map */}
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
              nodes={graphData.nodes}
              links={graphData.links}
              width={600}
              height={400}
              onNodeClick={(node) => setSelectedNode(node)}
            />
          </Box>

          {/* References Section */}
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
                  >
                    <Text
                      fontWeight="bold"
                      mb={1}
                    >{`Reference ${ref.lit_reference_id}`}</Text>
                    <Tooltip label={ref.lit_reference_link}>
                      <Text
                        fontSize="sm"
                        noOfLines={1}
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        cursor="pointer"
                        onClick={() => setIframeUrl(ref.lit_reference_link)}
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

          {/* Assigned Users */}
          <Box gridArea="users" borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="sm" mb={2}>
              Assigned Users
            </Heading>
            {assignedUsers.length > 0 ? (
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
``;
