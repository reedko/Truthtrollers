import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Grid,
  Heading,
  Input,
  Text,
  Tooltip,
  Button,
} from "@chakra-ui/react";
import {
  Task,
  User,
  GraphNode,
  Link,
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
import { transformData } from "../services/dataTransform";
import { fetchNewGraphData } from "../services/api"; // API call for reframe
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
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({
    nodes: [],
    links: [],
  });
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Close the node card when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cardRef.current && !(event.target as HTMLElement).closest(".node")) {
        setSelectedNode(null); // Hide the node card
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Transform stored data into graph nodes/links
  useEffect(() => {
    const { nodes, links } = transformData(
      {
        authors,
        publishers,
        tasks: [task],
        lit_references,
        task_authors,
        task_references,
        auth_references,
      },
      task.task_id
    );
    console.log("🔗 Initial Graph Data:", { nodes, links });
    setGraphData({ nodes, links });
  }, [
    task,
    authors,
    publishers,
    lit_references,
    task_authors,
    task_references,
    auth_references,
  ]);

  // Handle node click (show details & reframe option)
  const handleNodeClick = async (node: GraphNode) => {
    console.log("🔵 Node Clicked:", node);
    setSelectedNode(null); // Force re-render
    setTimeout(() => {
      setSelectedNode(node);
    }, 0);
    setSelectedNode({
      ...node,
      url: node.url ?? undefined, // Ensure URL persists
      group: node.group,
    });
  };

  // Fetch new graph data when "Reframe" is clicked
  const handleReframeClick = async () => {
    if (!selectedNode) return;
    console.log("📡 Fetching new graph data for:", selectedNode);

    const newGraphData = await fetchNewGraphData(selectedNode);
    console.log("🔄 Updated Graph Data:", newGraphData);
    setGraphData(newGraphData);
  };

  return (
    <Box w="100%" p={4} overflow="auto">
      <Grid
        templateColumns={{ base: "1fr", md: "1fr 2fr" }}
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
          <TaskCard key={task.task_id} task={task} />
        </Box>

        {/* Content Viewer */}
        <Box gridArea="frameA" borderWidth="1px" borderRadius="lg" p={2}>
          <Heading size="sm" mb={2}>
            Content Viewer
          </Heading>
          <iframe
            src={iframeUrl}
            title="Content Viewer"
            style={{ width: "100%", height: "95%", border: "none" }}
          />
          <Input
            mt={2}
            placeholder="Paste a link here..."
            value={iframeUrl}
            onChange={(e) => setIframeUrl(e.target.value)}
          />
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
          position="relative"
        >
          <Heading size="sm" mb={2}>
            Relationship Map
          </Heading>
          <NetworkGraph
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeClick={handleNodeClick}
          />

          {/* Selected Node Card - Position Below the Graph */}
          {selectedNode && (
            <Box
              position="absolute"
              top="100%" // Places below the graph
              left="50%"
              transform="translateX(-50%)"
              bg="teal"
              border="1px solid gray"
              borderRadius="lg"
              p={4}
              mt={2}
              boxShadow="lg"
              zIndex="10"
              width="250px"
              textAlign="center"
            >
              <Text fontWeight="bold" textDecoration="underline">
                {selectedNode.type}
              </Text>
              <Text fontWeight="bold">{selectedNode.label}</Text>
              {selectedNode.url && selectedNode ? (
                <Text fontSize="sm">
                  <a
                    href={selectedNode.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Link 🔗
                  </a>
                </Text>
              ) : null}
              <Button mt={2} colorScheme="blue" onClick={handleReframeClick}>
                Reframe Graph
              </Button>
            </Box>
          )}
        </Box>

        {/* References */}
        <Box gridArea="references" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="md" mb={2}>
            Source References
          </Heading>
          {references.map((ref) => (
            <Text key={ref.lit_reference_id}>{ref.lit_reference_title}</Text>
          ))}
        </Box>

        {/* Assigned Users */}
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

export default TaskDetailLayout;
