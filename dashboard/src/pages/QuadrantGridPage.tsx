import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Spinner,
  Center,
  useToast,
} from "@chakra-ui/react";
import QuadrantGrid from "../components/QuadrantGrid";
import { useTaskStore } from "../store/useTaskStore";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import { GraphNode, Link } from "../../../shared/entities/types";
import UnifiedHeader from "../components/UnifiedHeader";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

const QuadrantGridPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);

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

  // Restore selectedTask from ID if necessary
  useEffect(() => {
    if (selectedTaskId && !selectedTask) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === selectedTaskId);
      if (match) {
        console.log("🔁 Restoring task from content list", match);
        setSelectedTask(match);
      }
    }
  }, [selectedTaskId, selectedTask, setSelectedTask]);

  // Redirect if no taskId
  useEffect(() => {
    if (!selectedTaskId) {
      console.warn("⛔ No taskId — redirecting to /tasks");
      if (!selectedRedirect) setRedirect("/quadrantgrid");
      navigate("/tasks");
    }
  }, [selectedTaskId, navigate, setRedirect, selectedRedirect]);

  // Fetch graph data
  useEffect(() => {
    const loadData = async () => {
      if (!selectedTaskId || !selectedTask || viewerId === null) return;

      setLoading(true);
      try {
        // Create a GraphNode from the selected task
        const taskNode = new GraphNode(
          `conte-${selectedTaskId}`,
          selectedTask.content_name || "Task",
          "task",
          0,
          0,
          selectedTask.url,
          selectedTaskId
        );

        const data = await fetchNewGraphDataFromLegacyRoute(taskNode);
        setGraphData(data);

        // Fetch verimeterScore
        const scores = await fetchContentScores(selectedTaskId, null);
        setVerimeterScore(scores?.verimeterScore ?? null);
      } catch (err) {
        console.error("Error fetching graph data:", err);
        toast({
          title: "Error loading graph",
          description: "Could not load graph data",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedTaskId, selectedTask, viewerId, toast]);

  const isReady = selectedTaskId != null && selectedTask != null && viewerId != null;

  if (!isReady || loading) {
    return (
      <Center h="100vh" bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))">
        <Box textAlign="center">
          <Spinner
            size="xl"
            color="#a5b4fc"
            thickness="4px"
            speed="0.8s"
            emptyColor="rgba(99, 102, 241, 0.2)"
            mb={4}
          />
          <Box
            color="#a5b4fc"
            fontSize="18px"
            fontWeight="500"
            textShadow="0 0 10px rgba(165, 180, 252, 0.6)"
          >
            Loading Quadrant Grid...
          </Box>
        </Box>
      </Center>
    );
  }

  return (
    <Box>
      {/* UnifiedHeader */}
      <Box className="mr-card mr-card-blue" mb={6} p={4} position="relative">
        <div className="mr-glow-bar mr-glow-bar-blue" />
        <div className="mr-scanlines" />
        <UnifiedHeader
          verimeterScore={verimeterScore ?? undefined}
          refreshKey={selectedTaskId}
        />
      </Box>

      {/* QuadrantGrid */}
      <QuadrantGrid
        nodes={graphData.nodes}
        links={graphData.links}
        onNodeClick={(node) => {
          setSelectedNode(node);
          console.log("Selected node:", node);
        }}
      />
    </Box>
  );
};

export default QuadrantGridPage;
