import { useEffect, useState, useRef } from "react";
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
  Switch,
  HStack,
} from "@chakra-ui/react";
import Workspace from "../components/Workspace";
import UnifiedHeader from "../components/UnifiedHeader";
import StickyTitleBar from "../components/StickyTitleBar";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import { ViewerScopeBadge } from "../components/ViewerScopeBadge";
import {
  updateScoresForContent,
  fetchContentScores,
  fetchAIEvidenceLinks,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [linkFilter, setLinkFilter] = useState<'all' | 'user' | 'ai'>('all');
  const [hasCheckedUserLinks, setHasCheckedUserLinks] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<boolean>(false);
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

  // Refs to prevent circular updates between URL params and store
  const isInitialMount = useRef(true);
  const isUpdatingFromUrl = useRef(false);
  const isUpdatingUrl = useRef(false);

  // 🎯 CONSOLIDATED: Initialize from route params and URL params on mount only
  useEffect(() => {
    if (!isInitialMount.current) return;

    isInitialMount.current = false;
    isUpdatingFromUrl.current = true;

    // 1. Set taskId from route param
    if (routeContentId) {
      const contentIdNum = parseInt(routeContentId, 10);
      if (!isNaN(contentIdNum)) {
        console.log("📍 Setting taskId from route param:", contentIdNum);
        setSelectedTask(contentIdNum);
      }
    }

    // 2. Set viewer and scope from URL params
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

    // Allow URL updates after this initial sync
    setTimeout(() => {
      isUpdatingFromUrl.current = false;
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // 🎯 CONSOLIDATED: Sync store state back to URL params (but prevent circular updates)
  useEffect(() => {
    // Don't update URL if we're still initializing from URL
    if (isUpdatingFromUrl.current || isUpdatingUrl.current) return;
    if (!taskId) return;

    isUpdatingUrl.current = true;

    // 🔧 PERF: Debounce URL updates to prevent excessive history changes
    const timeoutId = setTimeout(() => {
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

      isUpdatingUrl.current = false;
    }, 200); // Debounce 200ms

    return () => {
      clearTimeout(timeoutId);
      isUpdatingUrl.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, viewScope, taskId]);

  // Set redirect target on mount only
  useEffect(() => {
    setRedirect("/workspace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Fetch verimeter scores when taskId or viewerId changes
  useEffect(() => {
    if (taskId) {
      fetchContentScores(taskId, viewerId).then((scores) => {
        setVerimeterScore(scores?.verimeterScore ?? null);
      });
    }
  }, [taskId, viewerId]);

  // Check for user-created links and default filter to 'user' if they exist
  useEffect(() => {
    if (taskId && !hasCheckedUserLinks) {
      fetchAIEvidenceLinks(taskId).then((links) => {
        const hasUserLinks = links.some((link) => !link.created_by_ai);
        if (hasUserLinks) {
          setLinkFilter('user');
        }
        setHasCheckedUserLinks(true);
      });
    }
  }, [taskId, hasCheckedUserLinks]);

  // Try to restore selectedTask from content list if missing
  useEffect(() => {
    if (taskId && !task) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === taskId);
      if (match) {
        console.log("🔁 Restoring task from content list", match);
        setSelectedTask(match);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task]);

  // Redirect if no taskId (separate effect to avoid re-running unnecessarily)
  useEffect(() => {
    if (!taskId) {
      console.warn("⛔ No taskId — redirecting to /tasks");
      if (!selectedRedirect) setRedirect("/workspace");
      navigate("/tasks");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

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
      {/* Sticky Title Bar - Always visible initially */}
      <StickyTitleBar alwaysVisible={true} />

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

          {/* 3D Bubble Toggle */}
          <HStack spacing={2}>
            <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"} textTransform="uppercase" letterSpacing="1px" whiteSpace="nowrap">
              3D Bubble
            </Text>
            <Switch
              isChecked={bubbleStyle}
              onChange={(e) => setBubbleStyle(e.target.checked)}
              colorScheme="purple"
              size="sm"
            />
          </HStack>

          {/* Viewer Scope Badge */}
          <ViewerScopeBadge />
        </Box>

        <Workspace contentId={taskId} viewerId={viewerId} linkFilter={linkFilter} bubbleStyle={bubbleStyle} />
      </Box>
    </Box>
  );
};

export default WorkspacePage;
