import React, { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardBody,
  Heading,
  Spinner,
  Center,
} from "@chakra-ui/react";
import { useNavigate, useParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { fetchTaskById } from "../services/useDashboardAPI";
import UnifiedHeader from "../components/UnifiedHeader";
import DiscussionBoard from "../components/DiscussionBoard";

const DiscussionPage: React.FC = () => {
  const { contentId } = useParams<{ contentId?: string }>();
  const routeId = contentId ? Number(contentId) : undefined;

  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!routeId) {
      navigate("/tasks", { state: { redirectTo: "/discussion" } });
      return;
    }
    setLoading(true);
    fetchTaskById(routeId)
      .then((task) => {
        if (task) {
          setTask(task); // Use local state for THIS page
          setSelectedTask(task); // (optional) update global store for dashboard
        } else {
          navigate("/tasks");
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line
  }, [routeId, navigate, setSelectedTask]);

  if (loading || !task) {
    return (
      <Center h="60vh">
        <Spinner size="lg" />
      </Center>
    );
  }

  return (
    <Box p={4}>
      <Card mt={2} mb={6}>
        <CardBody>
          <UnifiedHeader />
        </CardBody>
      </Card>

      <Heading size="md" mb={4}>
        Community Discussion
      </Heading>

      <DiscussionBoard contentId={task.content_id} />
    </Box>
  );
};

export default DiscussionPage;
