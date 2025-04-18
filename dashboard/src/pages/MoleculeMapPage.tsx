import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Heading,
  Text,
  Spinner,
  Center,
  Card,
  CardBody,
  Button,
  useToast,
} from "@chakra-ui/react";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { useTaskStore } from "../store/useTaskStore";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import { GraphNode, Link } from "../../../shared/entities/types";
import UnifiedHeader from "../components/UnifiedHeader";
import GraphLegend from "../components/GraphLegend";

const MoleculeMapPage = () => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const navigate = useNavigate();
  const toast = useToast();
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({
    nodes: [],
    links: [],
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);

  // 🧠 Load initial graph based on selectedTask
  useEffect(() => {
    if (!selectedTask) {
      navigate("/tasks", { state: { redirectTo: "/molecule" } });
      return;
    }

    const loadGraph = async () => {
      const taskNode: GraphNode = {
        id: `conte-${selectedTask.content_id}`,
        label: selectedTask.content_name,
        type: "task",
        url: selectedTask.url,
        group: 2,
        content_id: selectedTask.content_id,
        x: 0,
        y: 0,
      };

      try {
        const result = await fetchNewGraphDataFromLegacyRoute(taskNode);
        setGraphData(result);
      } catch (err) {
        console.error("❌ Error loading graph data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadGraph();
  }, [selectedTask, navigate]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleReframeClick = async () => {
    if (!selectedNode) return;

    try {
      const result = await fetchNewGraphDataFromLegacyRoute(selectedNode);
      setGraphData(result);
    } catch (err) {
      console.error("❌ Error reframing graph:", err);
    }
  };

  if (!selectedTask) return null;

  return (
    <Box p={4}>
      <Card mb={6} mt={2}>
        <CardBody>
          <UnifiedHeader />
        </CardBody>
      </Card>

      <Heading size="md" mb={4}>
        Relationship Graph
      </Heading>

      {loading ? (
        <Center>
          <Spinner size="xl" />
        </Center>
      ) : graphData.nodes.length > 0 ? (
        <Box position="relative" height="78vh">
          <CytoscapeMolecule
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeClick={handleNodeClick}
            centerNodeId={
              selectedNode?.id ||
              graphData.nodes.find((n) => n.type === "task")?.id
            }
          />

          {selectedNode && (
            <Box
              position="absolute"
              top="12px"
              right="12px"
              bg="stat2Gradient"
              border="2px solid #3182ce"
              borderRadius="xl"
              p={4}
              boxShadow="2xl"
              zIndex="20"
              width="280px"
              textAlign="center"
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
                <Text fontSize="sm" mt={2}>
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
              <Button
                mt={2}
                size="sm"
                variant="outline"
                colorScheme="gray"
                borderRadius="full"
                onClick={() => {
                  toast({
                    title: "Centered View",
                    description: `Zoomed to ${selectedNode.label}`,
                    status: "info",
                    duration: 2000,
                    isClosable: true,
                    position: "top",
                  });
                }}
              >
                Center Graph
              </Button>
            </Box>
          )}
          <GraphLegend />
        </Box>
      ) : (
        <Text>No graph data available for this task.</Text>
      )}
    </Box>
  );
};

export default MoleculeMapPage;
