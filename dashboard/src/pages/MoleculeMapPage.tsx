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
  Hide,
} from "@chakra-ui/react";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { useTaskStore } from "../store/useTaskStore";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import { GraphNode, Link } from "../../../shared/entities/types";
import UnifiedHeader from "../components/UnifiedHeader";
import GraphLegend from "../components/GraphLegend";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

const MoleculeMapPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({ nodes: [], links: [] });
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);

  const handleVerimeterRefresh = async (contentId: number) => {
    await updateScoresForContent(contentId, viewerId);
    const scores = await fetchContentScores(contentId, null);
    setVerimeterScore(scores?.verimeterScore ?? null);
  };
  // 🧠 Restore selectedTask from ID if necessary
  useEffect(() => {
    if (selectedTaskId && !selectedTask) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === selectedTaskId);
      if (match) {
        console.log("🧠 Rehydrating selectedTask from ID");
        setSelectedTask(match);
      }
    }
  }, [selectedTaskId, selectedTask, setSelectedTask]);

  // 🌐 Load graph data for selected task
  useEffect(() => {
    const loadGraph = async () => {
      if (!selectedTask) return;

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
        console.log("🧬 Fetching graph for task:", taskNode);
        const result = await fetchNewGraphDataFromLegacyRoute(taskNode);
        // ─── ADD THESE LOGS ───────────────────────────────────────────────────
        console.log(
          "🔍 [DEBUG] ALL NODES:",
          result.nodes.map((n) => `${n.id} (type=${n.type})`)
        );
        console.log(
          "🔍 [DEBUG] ALL LINKS:",
          result.links.map((l) => `${l.id}: ${l.source}→${l.target}`)
        );
        console.log(
          "🔍 [DEBUG] CLAIM NODES:",
          result.nodes.filter(
            (n) => n.type === "refClaim" || n.type === "taskClaim"
          )
        );
        console.log(
          "🔍 [DEBUG] CLAIM LINKS:",
          result.links.filter(
            (l) =>
              l.source.startsWith("refClaim") ||
              l.source.startsWith("taskClaim") ||
              l.target.startsWith("refClaim") ||
              l.target.startsWith("taskClaim")
          )
        );
        // ─────────────────────────────────────────────────────────────────────

        console.log("✅ Graph data loaded:", result);
        setGraphData(result);
      } catch (err) {
        console.error("🔥 Error loading graph data:", err);
      } finally {
        setLoading(false);
      }
    };

    if (!selectedTask) {
      console.warn("❌ No selected task — redirecting.");
      setLoading(false);
      navigate("/tasks", { state: { redirectTo: "/molecule" } });
      return;
    }

    loadGraph();
  }, [selectedTask, navigate]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleReframeClick = async () => {
    if (!selectedNode) return;

    const pivotType = selectedNode.type as "task" | "author" | "publisher";
    const pivotId =
      selectedNode.content_id ??
      selectedNode.author_id ??
      selectedNode.publisher_id ??
      null;

    try {
      const result = await fetchNewGraphDataFromLegacyRoute(selectedNode);
      setGraphData(result);

      if (pivotType && pivotId !== null) {
        await useTaskStore.getState().fetchTasksByPivot(pivotType, pivotId);
      }
    } catch (err) {
      console.error("❌ Error reframing graph:", err);
    }
  };

  if (!selectedTask || loading) {
    console.log("[🧪 MoleculeMapPage] Not ready:", {
      selectedTaskId,
      selectedTask,
      viewerId,
      loading,
    });
    return (
      <Center h="80vh">
        <Spinner size="xl" color="teal.400" />
      </Center>
    );
  }
  console.log("🔗 Links in graphData:", graphData.links);
  console.log("🧠 Nodes in graphData:", graphData.nodes);
  return (
    <Box p={4}>
      <Card mb={6} mt={2}>
        <CardBody>
          <UnifiedHeader
            pivotType={
              (selectedNode?.type as "task" | "author" | "publisher") || "task"
            }
            pivotId={
              selectedNode?.content_id ??
              selectedNode?.author_id ??
              selectedNode?.publisher_id ??
              selectedTask.content_id
            }
          />
        </CardBody>
      </Card>

      <Heading size="md" mb={4}>
        Relationship Graph
      </Heading>

      {graphData.nodes.length > 0 ? (
        <Box position="relative" height="78vh">
          {/*           <Hide below="md">
            <GraphLegend />
          </Hide> */}
          <CytoscapeMolecule
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeClick={handleNodeClick}
            centerNodeId={
              selectedNode?.id ||
              graphData.nodes.find((n) => n.type === "task")?.id
            }
          />

          {/* {selectedNode && (
            <Hide below="md">
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
            </Hide>
          )} */}
        </Box>
      ) : (
        <Text>No graph data available for this task.</Text>
      )}
    </Box>
  );
};

export default MoleculeMapPage;
