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
  /* 1️⃣  Get the ID from the route if present */
  const { contentId } = useParams<{ contentId?: string }>();
  const routeId = contentId ? Number(contentId) : undefined;

  /* 2️⃣  Task state from the global store */
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const navigate = useNavigate();

  /* 3️⃣  Local “loading” flag for deep-link fetch */
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // A. Deep-link case: we have a route ID but no task in the store yet
    if (routeId && !selectedTask && !loading) {
      setLoading(true);
      fetchTaskById(routeId)
        .then((task) => {
          if (task) setSelectedTask(task);
          else navigate("/tasks"); // invalid ID – bounce out
        })
        .finally(() => setLoading(false));
      return;
    }

    // B. No route ID AND no selected task → redirect to task list
    if (!routeId && !selectedTask) {
      navigate("/tasks", { state: { redirectTo: "/discussion" } });
    }
  }, [routeId, selectedTask, navigate, setSelectedTask, loading]);

  // While fetching the deep-link task
  if (loading) {
    return (
      <Center h="60vh">
        <Spinner size="lg" />
      </Center>
    );
  }

  /* Decide which ID the board should use */
  const discussionId = selectedTask?.content_id ?? routeId ?? null;

  if (discussionId === null) return null; // should never hit, but type-safe

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

      <DiscussionBoard contentId={discussionId} />
    </Box>
  );
};

export default DiscussionPage;
