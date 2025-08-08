import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardBody,
  Heading,
  Spinner,
  Center,
} from "@chakra-ui/react";
import Workspace from "../components/Workspace";
import UnifiedHeader from "../components/UnifiedHeader";
import { useTaskStore } from "../store/useTaskStore";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";
import RefreshVerimeterButton from "../components/RefreshVerimeterButton";

const WorkspacePage = () => {
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);
  const viewerId = useTaskStore((s) => s.viewingUserId);

  useEffect(() => {
    if (taskId) {
      fetchContentScores(taskId, null).then((scores) => {
        setVerimeterScore(scores?.verimeterScore ?? null);
      });
    }
  }, [taskId]);

  // Try to restore selectedTask from content
  useEffect(() => {
    if (taskId && !task) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === taskId);
      if (match) {
        console.log("🔁 Restoring task from content list", match);
        setSelectedTask(match);
      }
    }
  }, [taskId, task, setSelectedTask]);

  // Redirect if no taskId
  useEffect(() => {
    if (!taskId) {
      console.warn("⛔ No taskId — redirecting to /tasks");
      if (!selectedRedirect) setRedirect("/workspace");
      navigate("/tasks");
    }
  }, [taskId, navigate, setRedirect, selectedRedirect]);

  const isReady = taskId != null && task != null && viewerId != null;

  if (!isReady) {
    console.log("⏳ Not ready:", { taskId, task, viewerId });
    return (
      <Center h="80vh">
        <Spinner size="xl" color="teal.400" />
      </Center>
    );
  }

  const handleVerimeterRefresh = async (contentId: number) => {
    console.log("⚙️ Calling updateScoresForContent for", contentId, viewerId);
    await updateScoresForContent(contentId, viewerId);
    const scores = await fetchContentScores(contentId, null);
    console.log("✅ New fetched score:", scores);
    setVerimeterScore(scores?.verimeterScore ?? null);
    setRefreshKey((prev) => prev + 1);
  };
  return (
    <Box p={4}>
      <Card mb={6} mt={2}>
        <CardBody>
          <Box mb={2}>
            <RefreshVerimeterButton
              targetClaimId={taskId}
              onUpdated={setVerimeterScore} // pass callback for instant update
              handleRefresh={handleVerimeterRefresh}
            />
          </Box>
          <UnifiedHeader refreshKey={refreshKey} />
        </CardBody>
      </Card>
      <Heading size="md" mb={4}>
        Workspace
      </Heading>
      <Workspace contentId={taskId} viewerId={viewerId} />
    </Box>
  );
};

export default WorkspacePage;
