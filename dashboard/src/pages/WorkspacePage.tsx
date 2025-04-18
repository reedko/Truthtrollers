import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Card, CardBody, Heading } from "@chakra-ui/react";
import Workspace from "../components/Workspace";
import UnifiedHeader from "../components/UnifiedHeader";
import { useTaskStore } from "../store/useTaskStore";

const WorkspacePage = () => {
  const navigate = useNavigate();
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);
  const [hydrated, setHydrated] = useState(useTaskStore.persist.hasHydrated());

  useEffect(() => {
    if (!hydrated) {
      const unsub = useTaskStore.persist.onFinishHydration(() =>
        setHydrated(true)
      );
      return unsub;
    }
  }, [hydrated]);

  useEffect(() => {
    if (hydrated && taskId && !task) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === taskId);
      if (match) {
        setSelectedTask(match);
      }
    }
  }, [hydrated, taskId, task, setSelectedTask]);

  useEffect(() => {
    if (hydrated && !taskId) {
      if (!selectedRedirect) setRedirect("/workspace"); // ✅ only set if missing
      navigate("/tasks");
    }
  }, [hydrated, taskId, navigate, setRedirect, selectedRedirect]);

  if (!hydrated || !taskId || !task) return null;

  return (
    <Box p={4}>
      <Card mb={6} mt={2}>
        <CardBody>
          <UnifiedHeader />
        </CardBody>
      </Card>
      <Heading size="md" mb={4}>
        Workspace
      </Heading>
      <Workspace contentId={taskId} />
    </Box>
  );
};

export default WorkspacePage;
