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
} from "@chakra-ui/react";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { useTaskStore } from "../store/useTaskStore";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import { GraphNode, Link } from "../../../shared/entities/types";
import UnifiedHeader from "../components/UnifiedHeader";

const MoleculeMapPage = () => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const navigate = useNavigate();

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedTask) {
      navigate("/tasks", { state: { redirectTo: "/molecule" } });
      return;
    }

    const loadGraph = async () => {
      const taskNode: GraphNode = {
        id: selectedTask.content_id.toString(),
        label: selectedTask.content_name,
        type: "task",
        url: selectedTask.url,
        x: 0,
        y: 0,
        group: 2,
        content_id: selectedTask.content_id,
      };

      try {
        const { nodes, links } = await fetchNewGraphDataFromLegacyRoute(
          taskNode
        );
        setNodes(nodes);
        setLinks(links);
      } catch (err) {
        console.error("❌ Error loading graph data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadGraph();
  }, [selectedTask, navigate]);

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
      ) : nodes.length > 0 ? (
        <CytoscapeMolecule
          nodes={nodes}
          links={links}
          centerNodeId={selectedTask.content_id.toString()}
        />
      ) : (
        <Text>No graph data available for this task.</Text>
      )}
    </Box>
  );
};

export default MoleculeMapPage;
