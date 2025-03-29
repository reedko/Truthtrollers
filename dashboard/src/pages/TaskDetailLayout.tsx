import React, { useEffect, useState, useRef } from "react";
import { Box, Grid, Heading, Input, Text, Button } from "@chakra-ui/react";
import {
  Task,
  User,
  LitReference,
  GraphNode,
  Link,
} from "../../../shared/entities/types";
import TaskCard from "../components/TaskCard";
import { EditorFrame } from "../components/EditorFrame";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api"; // typed to accept a GraphNode
import Workspace from "../components/Workspace";

interface TaskDetailLayoutProps {
  task: Task;
  assignedUsers: User[];
  content?: LitReference[];
}

const TaskDetailLayout: React.FC<TaskDetailLayoutProps> = ({
  task,
  assignedUsers,
  content = [],
}) => {
  // Local state for the graph
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({ nodes: [], links: [] });

  // For showing details of a selected node
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [debugMessage, setDebugMessage] = useState<string>("");
  // For the Content Viewer
  const [iframeUrl, setIframeUrl] = useState<string>(task.url || "");

  // Ref used to detect outside clicks and hide the node popup
  const cardRef = useRef<HTMLDivElement | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1) CREATE A MOCK “TASK NODE” FOR INITIAL LOAD
  //    We'll treat the entire Task as a "task" node in the graph.
  // ─────────────────────────────────────────────────────────────────────────────
  const buildTaskNode = (): GraphNode => {
    console.log("inmcoming urt:", task.url);

    return {
      // The 'id' might be something like "task-5" or just the numeric ID in string form
      id: task.content_id.toString(),
      label: task.content_name,
      type: "task", // Distinguish that this node is a task
      url: task.url,
      x: 0,
      y: 0,
      group: 2,
      content_id: task.content_id,
    };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 2) FETCH INITIAL GRAPH DATA ON MOUNT (OR WHEN THE TASK CHANGES)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadInitialGraph = async () => {
      try {
        // Build the "task" node
        const initialNode = buildTaskNode();
        // Pass it to the same fetch function we use for reframe
        const initialGraph = await fetchNewGraphDataFromLegacyRoute(
          initialNode
        );
        setGraphData(initialGraph);
      } catch (err) {
        console.error("Error fetching initial graph data:", err);
      }
    };

    if (task?.content_id) {
      loadInitialGraph();
    }
  }, [task?.content_id]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3) CLOSE THE NODE CARD IF CLICKING OUTSIDE
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        cardRef.current &&
        !cardRef.current.contains(event.target as Node) // <-- changed
      ) {
        setSelectedNode(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4) NODE CLICK HANDLER
  // ─────────────────────────────────────────────────────────────────────────────
  const handleNodeClick = (node: GraphNode) => {
    console.log("🔵 Node Clicked:", node);
    // Hide any old selection first, then show the new one
    setSelectedNode(node);
    console.log("Selected Node:", node);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 5) REFRAME: FETCH NEW GRAPH DATA BASED ON THE SELECTED NODE
  // ─────────────────────────────────────────────────────────────────────────────
  const handleReframeClick = async () => {
    if (!selectedNode) return;
    try {
      console.log("📡 Fetching new graph data for:", selectedNode);
      const newGraph = await fetchNewGraphDataFromLegacyRoute(selectedNode);
      console.log("Fetched Graph Data:", newGraph.nodes);

      setGraphData(newGraph);
    } catch (err) {
      console.error("Error reframing graph:", err);
    }
  };
  useEffect(() => {
    console.log("Graph Data Nodes:", graphData.nodes);
    console.log("Graph Data Links:", graphData.links);

    setDebugMessage(`
        Nodes: ${JSON.stringify(graphData.nodes, null, 2)}
        Links: ${JSON.stringify(graphData.links, null, 2)}
    `);
  }, [graphData]);
  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Box w="calc(100vw-20px)" mx="10px" p={4} overflow="auto">
      <Grid
        templateColumns={{ base: "1fr", md: "1fr 3fr" }}
        gap={4}
        gridTemplateAreas={{
          base: `
            "taskCard"
            "frameA"
            "workspace"
            "relationFlow"
            "references"
            "users"
          `,
          md: `
            "taskCard frameA"
            "workspace workspace"
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
          <TaskCard key={task.content_id} task={task} useStore={false} />
        </Box>

        {/* Content Viewer */}
        <Box gridArea="frameA" borderWidth="1px" borderRadius="lg" p={2}>
          <Heading size="md" mb={2}>
            Content Viewer
          </Heading>
          <iframe
            src={iframeUrl}
            title="Content Viewer"
            style={{ width: "100%", height: "83%", border: "none" }}
          />
          <Input
            mt={2}
            placeholder="Paste a link here..."
            value={iframeUrl}
            onChange={(e) => setIframeUrl(e.target.value)}
          />
        </Box>

        {/* Discussion Editor */}
        <Box gridArea="workspace" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            WorkSpace
          </Heading>
          <Workspace contentId={task.content_id} />
        </Box>

        {/* Relationship Map */}
        <Box
          gridArea="relationFlow"
          borderWidth="1px"
          borderRadius="lg"
          p={4}
          position="relative"
          width="100%"
        >
          <Heading size="sm" mb={2}>
            Relationship Map
          </Heading>

          <CytoscapeMolecule
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeClick={handleNodeClick}
            centerNodeId={selectedNode?.id || task.content_id.toString()}
          />

          {selectedNode && (
            <Box
              position="absolute"
              top="100%"
              left="50%"
              transform="translateX(-50%)"
              bg="white"
              border="2px solid #3182ce"
              borderRadius="xl"
              p={4}
              mt={2}
              boxShadow="2xl"
              zIndex="20"
              width="280px"
              textAlign="center"
              ref={cardRef}
            >
              <Text fontWeight="bold" fontSize="md" mb={1} color="gray.700">
                Node Type:{" "}
                <span style={{ textTransform: "capitalize" }}>
                  {selectedNode.type}
                </span>
              </Text>
              <Text fontWeight="semibold" fontSize="lg" color="teal.700">
                {selectedNode.label}
              </Text>

              {selectedNode.url && (
                <Text fontSize="sm" mt={1}>
                  <a
                    href={selectedNode.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#2b6cb0", textDecoration: "underline" }}
                  >
                    Open Link 🔗
                  </a>
                </Text>
              )}

              <Button
                mt={3}
                colorScheme="blue"
                size="sm"
                onClick={handleReframeClick}
                borderRadius="full"
              >
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
          {content.map((ref) => (
            <Text key={ref.reference_content_id}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                🔗 {ref.content_name}
              </a>
            </Text>
          ))}
        </Box>

        {/* Assigned Users */}
        <Box gridArea="users" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            Assigned Users
          </Heading>
          {assignedUsers.length > 0 ? (
            <Text>{assignedUsers.map((u) => u.username).join(", ")}</Text>
          ) : (
            <Text>No users assigned to this task.</Text>
          )}
        </Box>
      </Grid>
    </Box>
  );
};

export default TaskDetailLayout;
