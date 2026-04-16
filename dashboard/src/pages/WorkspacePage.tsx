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
import {
  updateScoresForContent,
  fetchContentScores,
  fetchAIEvidenceLinks,
} from "../services/useDashboardAPI";

const WorkspacePage = () => {
  const { contentId: routeContentId } = useParams<{ contentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, aiWeight } = useVerimeterMode();
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [linkFilter, setLinkFilter] = useState<"all" | "user" | "ai">("all");
  const [hasCheckedUserLinks, setHasCheckedUserLinks] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<boolean>(false);
  const navigate = useNavigate();
  const { colorMode } = useColorMode();
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
    if (taskId && !hasCheckedUserLinks) {
      fetchAIEvidenceLinks(taskId).then((links) => {
        const hasUserLinks = links.some((link) => !link.created_by_ai);
        if (hasUserLinks) {
          setLinkFilter("user");
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
        <Card mb={6} mt={2} maxW="1400px" mx="auto">
          <CardBody>
            <UnifiedHeader refreshKey={refreshKey} />
          </CardBody>
        </Card>

        {/* Control Bar */}
        <Box
          className="mr-card mr-card-purple"
          bg="transparent"
          mb={2}
          display="flex"
          gap={16}
          alignItems="center"
          justifyContent="space-between"
          p={4}
          position="relative"
          zIndex={1}
          borderLeftRadius="24px"
          overflow="visible"
          sx={{
            "&::before": {
              content: '""',
              position: "absolute",
              left: 0,
              top: 0,
              width: "20px",
              height: "100%",
              background:
                "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
              borderLeftRadius: "24px",
              pointerEvents: "none",
              zIndex: -1,
            },
          }}
        >
          {/* Workspace Label Box */}
          <Box>
            <Heading size="md" className="mr-text-primary">
              Workspace
            </Heading>
          </Box>
          {/* Link Filter */}
          <Box
            display="flex"
            alignItems="center"
            gap={2}
            bg={
              colorMode === "dark"
                ? "rgba(15, 23, 42, 0.6)"
                : "rgba(255, 255, 255, 0.6)"
            }
            px={3}
            py={2}
            borderRadius="full"
            border="1px solid"
            borderColor={
              colorMode === "dark"
                ? "rgba(113, 219, 255, 0.2)"
                : "rgba(71, 85, 105, 0.2)"
            }
            boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
            position="relative"
            zIndex={500}
          >
            <Text
              className="mr-text-muted"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="1px"
              whiteSpace="nowrap"
            >
              Link Filter
            </Text>
            <Select
              size="sm"
              width="150px"
              value={linkFilter}
              onChange={(e) =>
                setLinkFilter(e.target.value as "all" | "user" | "ai")
              }
              bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white"}
              border="1px solid"
              borderColor={
                colorMode === "dark"
                  ? "var(--mr-blue-border)"
                  : "rgba(71, 85, 105, 0.3)"
              }
              color={
                colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800"
              }
              borderRadius="full"
              boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
              _hover={{
                borderColor:
                  colorMode === "dark"
                    ? "var(--mr-blue)"
                    : "rgba(71, 85, 105, 0.5)",
              }}
            >
              <option value="all">All Links</option>
              <option value="user">User Links</option>
              <option value="ai">AI Links</option>
            </Select>
          </Box>

          {/* 3D Bubble Toggle */}
          <HStack
            spacing={2}
            bg={
              colorMode === "dark"
                ? "rgba(15, 23, 42, 0.6)"
                : "rgba(255, 255, 255, 0.6)"
            }
            px={3}
            py={2}
            borderRadius="full"
            border="1px solid"
            borderColor={
              colorMode === "dark"
                ? "rgba(113, 219, 255, 0.2)"
                : "rgba(71, 85, 105, 0.2)"
            }
            boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
          >
            <Text
              className="mr-text-muted"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="1px"
              whiteSpace="nowrap"
            >
              3D Bubble
            </Text>
            <Switch
              isChecked={bubbleStyle}
              onChange={(e) => setBubbleStyle(e.target.checked)}
              colorScheme="purple"
              size="sm"
            />
          </HStack>

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

          {/* Verimeter Mode Toggle */}
          <Box position="relative" zIndex={500}>
            <VerimeterModeToggle compact />
          </Box>

          {/* Viewer Scope Badge */}
          <Box position="relative" zIndex={500}>
            <ViewerScopeBadge />
          </Box>
        </Box>

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
