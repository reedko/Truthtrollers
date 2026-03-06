import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);

  // Phase 5: Read URL params on mount (viewer, scope)
  useEffect(() => {
    const viewerParam = searchParams.get('viewer');
    const scopeParam = searchParams.get('scope') as ViewScope | null;

    if (viewerParam) {
      const viewerNum = viewerParam === 'null' ? null : parseInt(viewerParam, 10);
      if (!isNaN(viewerNum as number) || viewerNum === null) {
        console.log("🔗 Setting viewerId from URL param:", viewerNum);
        setViewingUserId(viewerNum);
      }
    }

    if (scopeParam && (scopeParam === 'user' || scopeParam === 'all' || scopeParam === 'admin')) {
      console.log("🔗 Setting scope from URL param:", scopeParam);
      setViewScope(scopeParam);
    }
  }, []); // Only on mount

  // If contentId is in route params, set it in the store
  useEffect(() => {
    if (routeContentId) {
      const contentIdNum = parseInt(routeContentId, 10);
      if (!isNaN(contentIdNum) && contentIdNum !== taskId) {
        console.log("📍 Setting taskId from route param:", contentIdNum);
        setSelectedTask(contentIdNum);
      }
    }
  }, [routeContentId, taskId, setSelectedTask]);

  // Phase 5: Update URL params when viewer/scope changes
  useEffect(() => {
    if (!taskId) return;

    const newParams = new URLSearchParams();

    if (viewerId !== null && viewerId !== undefined) {
      newParams.set('viewer', viewerId.toString());
    }

    if (viewScope && viewScope !== 'user') {
      newParams.set('scope', viewScope);
    }

    // Update URL without navigation (replace history)
    const newSearch = newParams.toString();
    const currentSearch = searchParams.toString();

    if (newSearch !== currentSearch) {
      setSearchParams(newParams, { replace: true });
    }
  }, [viewerId, viewScope, taskId]);

  // Set this as the active redirect target when mounted
  useEffect(() => {
    setRedirect("/workspace");
  }, [setRedirect]);

  useEffect(() => {
    if (taskId) {
      fetchContentScores(taskId, viewerId).then((scores) => {
        setVerimeterScore(scores?.verimeterScore ?? null);
      });
    }
  }, [taskId, viewerId]);

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

  // viewerId can be null for "View All" mode
  const isReady = taskId != null && task != null;

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
    const scores = await fetchContentScores(contentId, viewerId);
    console.log("✅ New fetched score:", scores);
    setVerimeterScore(scores?.verimeterScore ?? null);
    setRefreshKey((prev) => prev + 1);
  };
  return (
    <Box p={4} w="100%">
      <Box maxW="1400px" w="100%" mx="auto">
        <Card mb={6} mt={2}>
          <CardBody>
            <UnifiedHeader refreshKey={refreshKey} />
          </CardBody>
        </Card>
        <Heading mb={4}>Workspace</Heading>
        <Workspace contentId={taskId} viewerId={viewerId} />
      </Box>
    </Box>
  );
};

export default WorkspacePage;
