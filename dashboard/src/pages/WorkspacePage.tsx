import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Box,
  Card,
  CardBody,
  Heading,
  Spinner,
  Center,
  Select,
  Text,
  useColorMode,
} from "@chakra-ui/react";
import Workspace from "../components/Workspace";
import UnifiedHeader from "../components/UnifiedHeader";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import { ViewerScopeBadge } from "../components/ViewerScopeBadge";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [linkFilter, setLinkFilter] = useState<'all' | 'user' | 'ai'>('all');
  const navigate = useNavigate();
  const { colorMode } = useColorMode();
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

        {/* Control Bar */}
        <Box
          mb={4}
          display="flex"
          gap={6}
          alignItems="center"
          justifyContent="space-between"
          p={4}
          borderRadius="12px"
          bg={colorMode === "dark"
            ? "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            : "linear-gradient(135deg, rgba(100, 116, 139, 0.25) 0%, rgba(148, 163, 184, 0.3) 50%, rgba(71, 85, 105, 0.25) 100%)"}
          backdropFilter="blur(20px)"
          border="1px solid"
          borderColor={colorMode === "dark" ? "rgba(0, 162, 255, 0.4)" : "rgba(71, 85, 105, 0.4)"}
          boxShadow={colorMode === "dark"
            ? "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
            : "0 4px 16px rgba(71, 85, 105, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.4)"}
          position="relative"
          zIndex={100}
        >
          {/* Workspace Label Box */}
          <Box
            bg={colorMode === "dark" ? "whiteAlpha.100" : "blackAlpha.50"}
            px={3}
            py={2}
            borderRadius="md"
            backdropFilter="blur(8px)"
            border="1px solid"
            borderColor={colorMode === "dark" ? "whiteAlpha.200" : "blackAlpha.200"}
          >
            <Heading size="md">Workspace</Heading>
          </Box>

          {/* Link Filter */}
          <Box display="flex" alignItems="center" gap={2}>
            <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"} textTransform="uppercase" letterSpacing="1px" whiteSpace="nowrap">
              Link Filter
            </Text>
            <Select
              size="sm"
              width="150px"
              value={linkFilter}
              onChange={(e) => setLinkFilter(e.target.value as 'all' | 'user' | 'ai')}
              bg={colorMode === "dark" ? "gray.700" : "white"}
            >
              <option value="all">All Links</option>
              <option value="user">User Links</option>
              <option value="ai">AI Links</option>
            </Select>
          </Box>

          {/* Viewer Scope Badge */}
          <ViewerScopeBadge />
        </Box>

        <Workspace contentId={taskId} viewerId={viewerId} linkFilter={linkFilter} />
      </Box>
    </Box>
  );
};

export default WorkspacePage;
