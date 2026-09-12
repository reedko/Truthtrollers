import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Box,
  Card,
  CardBody,
  Spinner,
  Center,
  Button,
  Icon,
  useDisclosure,
} from "@chakra-ui/react";
import { FiAward } from "react-icons/fi";
import Workspace from "../components/Workspace";
import UnifiedHeader from "../components/UnifiedHeader";
import StickyTitleBar from "../components/StickyTitleBar";
import SubmitRatingModal from "../components/SubmitRatingModal";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import { ViewerScopeBadge } from "../components/ViewerScopeBadge";
import { VerimeterModeToggle } from "../components/VerimeterModeToggle";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";
import GeneratePublicReviewButton from "../components/reviewArticles/GeneratePublicReviewButton";
import GraphControlBar, { GraphMetricPill } from "../components/GraphControlBar";
import {
  updateScoresForContent,
  fetchContentScores,
  fetchTask,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, aiWeight } = useVerimeterMode();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspaceStats, setWorkspaceStats] = useState<{
    totalClaimLinks: number;
    totalClaims: number;
    totalReferences: number;
    supportingLinks: number;
    refutingLinks: number;
    nuancedLinks: number;
    aiLinkStats: {
      totalClaimLinks: number;
      supportingLinks: number;
      refutingLinks: number;
      nuancedLinks: number;
    };
  } | null>(null);
  const navigate = useNavigate();
  const {
    isOpen: isSubmitRatingOpen,
    onOpen: onOpenSubmitRating,
    onClose: onCloseSubmitRating,
  } = useDisclosure();
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
  const linkFilter = useTaskStore((s) => s.graphLinkFilter);
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
        setSelectedTask(contentIdNum);
      }
    }

    // 2. Set viewer and scope from URL params
    const viewerParam = searchParams.get("viewer");
    const scopeParam = searchParams.get("scope") as ViewScope | null;

    if (viewerParam) {
      const viewerNum =
        viewerParam === "null" ? null : parseInt(viewerParam, 10);
      if (!isNaN(viewerNum as number) || viewerNum === null) {
        setViewingUserId(viewerNum);
      }
    }

    if (
      scopeParam &&
      (scopeParam === "user" || scopeParam === "all" || scopeParam === "admin")
    ) {
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
        newParams.set("viewer", viewerId.toString());
      }

      if (viewScope && viewScope !== "user") {
        newParams.set("scope", viewScope);
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

  // Fetch verimeter scores when taskId, viewerId, or mode changes
  useEffect(() => {
    if (taskId) {
      fetchContentScores(taskId, viewerId, mode, aiWeight).then((scores) => {
        setVerimeterScore(scores?.verimeterScore ?? null);
      });
    }
  }, [taskId, viewerId, mode, aiWeight]);

  useEffect(() => {
    setWorkspaceStats(null);
  }, [taskId, viewerId, viewScope]);

  // Try to restore selectedTask from content list if missing
  useEffect(() => {
    if (taskId && !task) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === taskId);
      if (match) {
        setSelectedTask(match);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task]);

  // Direct route loads can have a selectedTaskId before the task object is hydrated.
  useEffect(() => {
    let active = true;
    if (!taskId || task) return;

    fetchTask(taskId)
      .then((loadedTask) => {
        if (active && loadedTask) setSelectedTask(loadedTask);
      })
      .catch((error) => {
        console.error("Failed to hydrate workspace task:", error);
      });

    return () => {
      active = false;
    };
  }, [taskId, task, setSelectedTask]);

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
    return (
      <Center h="80vh">
        <Spinner size="xl" color="teal.400" />
      </Center>
    );
  }

  const handleVerimeterRefresh = async (contentId: number) => {
    await updateScoresForContent(contentId, viewerId);
    const scores = await fetchContentScores(
      contentId,
      viewerId,
      mode,
      aiWeight,
    );
    setVerimeterScore(scores?.verimeterScore ?? null);
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Box p={4} w="100%">
      {/* Sticky Title Bar - Always visible initially */}
      <StickyTitleBar alwaysVisible={true} verimeterScore={verimeterScore} />

      <Box w="100%">
        <Card mb={6} mt={2} w="100%">
          <CardBody>
            <UnifiedHeader
              refreshKey={refreshKey}
              verimeterScore={verimeterScore}
              workspaceStats={workspaceStats ?? undefined}
              workspaceOwnsStats
            />
          </CardBody>
        </Card>

        <GraphControlBar
          title="Workspace"
          metrics={
            <>
              <GraphMetricPill
                tone="cyan"
                label="Score"
                value={typeof verimeterScore === "number" ? Math.round(verimeterScore) : "N/A"}
              />
              <GraphMetricPill tone="purple" label="Mode" value={mode.toUpperCase()} />
              <GraphMetricPill
                tone="blue"
                label="Links"
                value={linkFilter === "all" ? "All" : linkFilter === "user" ? "User" : "AI"}
              />
              <GraphMetricPill tone="green" label="User Links" value={workspaceStats?.totalClaimLinks ?? "-"} />
            </>
          }
        >
          {/* Submit Rating Button */}
          <Button
            className="mr-button"
            size="sm"
            leftIcon={<Icon as={FiAward} />}
            onClick={onOpenSubmitRating}
            isDisabled={!taskId}
            position="relative"
            zIndex={500}
          >
            Submit Rating
          </Button>

          <GeneratePublicReviewButton contentId={taskId} />

          {/* Verimeter Mode Toggle */}
          <Box position="relative" zIndex={500}>
            <VerimeterModeToggle compact />
          </Box>

          {/* Viewer Scope Badge */}
          <Box position="relative" zIndex={500}>
            <ViewerScopeBadge />
          </Box>
        </GraphControlBar>

        <Workspace
          contentId={taskId}
          viewerId={viewerId}
          linkFilter={linkFilter}
          onDataSummary={setWorkspaceStats}
        />
      </Box>

      {/* Submit Rating Modal */}
      {taskId && (
        <SubmitRatingModal
          isOpen={isSubmitRatingOpen}
          onClose={onCloseSubmitRating}
          contentId={taskId}
          contentUrl={task?.url}
          contentTitle={task?.content_name}
          onSuccess={() => {
            void handleVerimeterRefresh(taskId);
          }}
        />
      )}
    </Box>
  );
};

export default WorkspacePage;
