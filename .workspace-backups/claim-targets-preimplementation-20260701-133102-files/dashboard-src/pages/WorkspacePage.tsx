import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Box,
  Card,
  CardBody,
  Spinner,
  Center,
  Select,
  Text,
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
  fetchClaimsAndLinkedReferencesForTask,
  fetchTask,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, aiWeight } = useVerimeterMode();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasCheckedUserLinks, setHasCheckedUserLinks] = useState(false);
  const [userLinkCount, setUserLinkCount] = useState<number | null>(null);
  const [bubbleStyle, setBubbleStyleState] = useState<boolean>(() => localStorage.getItem("workspaceBubbleStyle") === "true");
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

  const setPersistentBubbleStyle = (next: boolean) => {
    setBubbleStyleState(next);
    localStorage.setItem("workspaceBubbleStyle", String(next));
  };

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
    const viewerParam = searchParams.get("viewer");
    const scopeParam = searchParams.get("scope") as ViewScope | null;

    if (viewerParam) {
      const viewerNum =
        viewerParam === "null" ? null : parseInt(viewerParam, 10);
      if (!isNaN(viewerNum as number) || viewerNum === null) {
        console.log("🔗 Setting viewerId from URL param:", viewerNum);
        setViewingUserId(viewerNum);
      }
    }

    if (
      scopeParam &&
      (scopeParam === "user" || scopeParam === "all" || scopeParam === "admin")
    ) {
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

  // Check for user-created links and default filter to 'user' if they exist
  useEffect(() => {
    setHasCheckedUserLinks(false);
    setUserLinkCount(null);
  }, [taskId, viewerId, viewScope]);

  useEffect(() => {
    if (taskId && !hasCheckedUserLinks) {
      fetchClaimsAndLinkedReferencesForTask(taskId, viewerId, viewScope).then((links) => {
        const count = links.length;
        setUserLinkCount(count);
        setHasCheckedUserLinks(true);
      });
    }
  }, [taskId, viewerId, viewScope, hasCheckedUserLinks]);

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
    const scores = await fetchContentScores(
      contentId,
      viewerId,
      mode,
      aiWeight,
    );
    console.log("✅ New fetched score:", scores);
    setVerimeterScore(scores?.verimeterScore ?? null);
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Box p={4} w="100%">
      {/* Sticky Title Bar - Always visible initially */}
      <StickyTitleBar alwaysVisible={true} />

      <Box w="100%">
        <Card mb={6} mt={2} w="100%">
          <CardBody>
            <UnifiedHeader refreshKey={refreshKey} />
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
              <GraphMetricPill tone="green" label="User Links" value={userLinkCount ?? "-"} />
            </>
          }
        >
          <Box
            display="flex"
            alignItems="center"
            gap={2}
            bg="rgba(15, 23, 42, 0.6)"
            px={3}
            py={2}
            borderRadius="full"
            border="1px solid rgba(113, 219, 255, 0.2)"
            boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
            position="relative"
            zIndex={500}
            flexShrink={0}
          >
            <Text
              className="mr-text-muted"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="1px"
              whiteSpace="nowrap"
            >
              Bubble
            </Text>
            <Select
              size="sm"
              width="92px"
              value={bubbleStyle ? "on" : "off"}
              onChange={(e) => setPersistentBubbleStyle(e.target.value === "on")}
              bg="rgba(15, 23, 42, 0.9)"
              border="1px solid var(--mr-blue-border)"
              color="var(--mr-text-primary)"
              borderRadius="full"
              boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </Box>

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
          bubbleStyle={bubbleStyle}
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
            setRefreshKey((prev) => prev + 1);
          }}
        />
      )}
    </Box>
  );
};

export default WorkspacePage;
