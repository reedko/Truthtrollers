import React, { useEffect, useState, useRef } from "react";
import { Box, Button, Grid, Heading, Text } from "@chakra-ui/react";
import {
  Task,
  User,
  LitReference,
  GraphNode,
  Link,
} from "../../../shared/entities/types";
import TaskCard from "../components/TaskCard";
import PubCard from "../components/PubCard";
import AuthCard from "../components/AuthCard";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import Workspace from "../components/Workspace";
import { useTaskStore } from "../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";

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
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const { fetchAuthors, fetchPublishers } = useTaskStore.getState();
  const authors = useTaskStore(
    useShallow((state) => state.authors?.[task.content_id] || [])
  );
  const publishers = useTaskStore(
    useShallow((state) => state.publishers?.[task.content_id] || [])
  );

  useEffect(() => {
    const loadInitialGraph = async () => {
      try {
        const taskNode: GraphNode = {
          id: task.content_id.toString(),
          label: task.content_name,
          type: "task",
          url: task.url,
          x: 0,
          y: 0,
          group: 2,
          content_id: task.content_id,
        };
        const initialGraph = await fetchNewGraphDataFromLegacyRoute(taskNode);
        setGraphData(initialGraph);
        // Load authors and publishers from Zustand
        const { fetchAuthors, fetchPublishers } = useTaskStore.getState();
        await Promise.all([
          fetchAuthors(task.content_id),
          fetchPublishers(task.content_id),
        ]);
      } catch (err) {
        console.error("Error fetching graph:", err);
      }
    };

    if (task?.content_id) loadInitialGraph();
  }, [task?.content_id]);

  const handleNodeClick = (node: GraphNode) => setSelectedNode(node);

  const handleReframeClick = async () => {
    if (!selectedNode) return;
    try {
      const newGraph = await fetchNewGraphDataFromLegacyRoute(selectedNode);
      setGraphData(newGraph);
    } catch (err) {
      console.error("Error reframing graph:", err);
    }
  };

  return (
    <Box w="calc(100vw - 20px)" mx="10px" p={4} overflow="auto">
      <Grid
        templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }}
        gap={4}
        gridTemplateAreas={{
          base: `"taskCard" "pubCard" "authCard" "workspace" "relationFlow" "references" "users"`,
          md: `"taskCard pubCard authCard" "workspace workspace workspace" "relationFlow relationFlow relationFlow" "references references references" "users users users"`,
        }}
      >
        <Box gridArea="taskCard">
          <TaskCard key={task.content_id} task={task} useStore={false} />
        </Box>

        <Box gridArea="pubCard">
          <PubCard publishers={publishers} />
        </Box>

        <Box gridArea="authCard">
          <AuthCard authors={authors} />
        </Box>

        <Box gridArea="workspace" borderWidth="1px" borderRadius="lg" p={4}>
          <Heading size="sm" mb={2}>
            WorkSpace
          </Heading>
          <Workspace contentId={task.content_id} />
        </Box>

        <Box gridArea="relationFlow" borderWidth="1px" borderRadius="lg" p={4}>
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
