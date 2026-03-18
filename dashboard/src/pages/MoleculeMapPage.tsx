import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Heading,
  Text,
  Spinner,
  Center,
  Card,
  CardBody,
  useToast,
  Hide,
  useColorMode,
  Select,
} from "@chakra-ui/react";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import MoleculeViewTabs from "../components/MoleculeViewTabs";
import DisplayModeSwitcher from "../components/DisplayModeSwitcher";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import { ViewerScopeBadge } from "../components/ViewerScopeBadge";
import { fetchNewGraphDataFromLegacyRoute } from "../services/api";
import { GraphNode, Link } from "../../../shared/entities/types";
import UnifiedHeader from "../components/UnifiedHeader";
import StickyTitleBar from "../components/StickyTitleBar";
import GraphLegend from "../components/GraphLegend";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";
import {
  getMoleculeViews,
  createMoleculeView,
  updateMoleculeView,
  deleteMoleculeView,
  markViewAsViewed,
  updatePin,
  updateViewPositions,
  type MoleculeView,
  type DisplayMode,
} from "../services/moleculeViewsAPI";

const MoleculeMapPage = () => {
  const { colorMode } = useColorMode();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);

  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({ nodes: [], links: [] });
  const [filteredGraphData, setFilteredGraphData] = useState<{
    nodes: GraphNode[];
    links: Link[];
  }>({ nodes: [], links: [] });
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);

  // Molecule views state
  const [views, setViews] = useState<MoleculeView[]>([]);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [loadingViews, setLoadingViews] = useState(true);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [dimUnpinned, setDimUnpinned] = useState(false); // Dim unpinned nodes (default: true)
  const [showReferenceAuthors, setShowReferenceAuthors] = useState(false); // OFF by default to keep graph readable

  const handleVerimeterRefresh = async (contentId: number) => {
    await updateScoresForContent(contentId, viewerId);
    const scores = await fetchContentScores(contentId, viewerId);
    setVerimeterScore(scores?.verimeterScore ?? null);
  };

  // Phase 5: Read URL params on mount
  useEffect(() => {
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
  }, []);

  // Phase 5: Update URL params when viewer/scope changes
  useEffect(() => {
    if (!selectedTaskId) return;

    const newParams = new URLSearchParams();
    if (viewerId !== null && viewerId !== undefined) {
      newParams.set("viewer", viewerId.toString());
    }
    if (viewScope && viewScope !== "user") {
      newParams.set("scope", viewScope);
    }

    setSearchParams(newParams, { replace: true });
  }, [viewerId, viewScope, selectedTaskId]);

  // Set this as the active redirect target when mounted
  useEffect(() => {
    setRedirect("/molecule");
  }, [setRedirect]);

  // Load or create views for the selected task
  useEffect(() => {
    const loadViews = async () => {
      console.log(
        "📋 Loading views for task:",
        selectedTask?.content_id,
        "user:",
        viewerId,
      );

      if (!selectedTask) {
        console.log("📋 Missing selectedTask, skipping view load");
        return;
      }

      // For View All mode (viewerId === null), we skip view loading
      // since views are user-specific
      if (viewerId === null) {
        console.log("📋 View All mode - skipping view load");
        setLoadingViews(false);
        return;
      }

      setLoadingViews(true);
      try {
        let fetchedViews = await getMoleculeViews(
          selectedTask.content_id,
          viewerId,
        );
        console.log("📋 Fetched views:", fetchedViews);

        // If no views exist, create a default "All Sources" view
        if (fetchedViews.length === 0) {
          console.log("📋 No views found, creating default view");
          await createMoleculeView({
            contentId: selectedTask.content_id,
            name: "All Sources",
            isDefault: true,
            displayMode: "circles",
            userId: viewerId,
          });
          fetchedViews = await getMoleculeViews(
            selectedTask.content_id,
            viewerId,
          );
          console.log("📋 Created and fetched new views:", fetchedViews);
        }

        setViews(fetchedViews);

        // Set active view: last viewed, or default, or first
        const lastViewed = fetchedViews.find((v) => v.last_viewed_at);
        const defaultView = fetchedViews.find((v) => v.is_default);
        const activeView = lastViewed || defaultView || fetchedViews[0];

        console.log("📋 Selecting active view:", activeView);

        if (activeView) {
          console.log("📋 Setting activeViewId to:", activeView.id);
          setActiveViewId(activeView.id);
          await markViewAsViewed(activeView.id, viewerId);
        } else {
          console.error("📋 No active view found!");
        }
      } catch (error) {
        console.error("📋 Error loading views:", error);
        toast({
          title: "Failed to load views",
          status: "error",
          duration: 3000,
        });
      } finally {
        setLoadingViews(false);
      }
    };

    loadViews();
  }, [selectedTask, viewerId]);

  // Add dimming metadata to nodes or filter them based on showPinnedOnly toggle
  useEffect(() => {
    // Helper: Determine if an author node is connected to the task (vs only to references)
    const isTaskAuthor = (authorId: string): boolean => {
      // Find the task node
      const taskNode = graphData.nodes.find((n) => n.type === "task");
      if (!taskNode) return false;

      // Check if this author is linked to the task node
      return graphData.links.some(
        (link) =>
          (link.source === authorId && link.target === taskNode.id) ||
          (link.target === authorId && link.source === taskNode.id),
      );
    };

    // If no active view, still filter reference authors based on toggle
    if (!activeViewId || views.length === 0) {
      if (!showReferenceAuthors) {
        const filteredNodes = graphData.nodes.filter((node) => {
          if (node.type === "author") {
            return isTaskAuthor(node.id);
          }
          return true;
        });
        const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
        const filteredLinks = graphData.links.filter(
          (link) =>
            filteredNodeIds.has(link.source) &&
            filteredNodeIds.has(link.target),
        );
        setFilteredGraphData({ nodes: filteredNodes, links: filteredLinks });
      } else {
        setFilteredGraphData(graphData);
      }
      return;
    }

    const activeView = views.find((v) => v.id === activeViewId);
    if (!activeView) {
      setFilteredGraphData(graphData);
      return;
    }

    // Get pinned reference content IDs
    const pinnedIds: Set<number> = new Set(
      activeView.pins
        .filter((p) => p.is_pinned)
        .map((p) => p.reference_content_id)
        .filter((id): id is number => id != null),
    );

    if (showPinnedOnly && activeView.pins.length > 0) {
      // FILTER MODE: Remove unpinned references completely
      const filteredNodes = graphData.nodes.filter((node) => {
        if (node.type === "task") return true;
        if (node.type === "author") {
          // Always show task authors, hide reference authors based on toggle
          if (isTaskAuthor(node.id)) return true;
          return showReferenceAuthors;
        }
        if (node.type === "publisher") return true;
        if (node.type === "taskClaim") return true;
        if (node.type === "reference") {
          return pinnedIds.has(node.content_id!);
        }
        if (node.type === "refClaim") {
          return pinnedIds.has(node.content_id!);
        }
        return false;
      });

      const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredLinks = graphData.links.filter(
        (link) =>
          filteredNodeIds.has(link.source) && filteredNodeIds.has(link.target),
      );

      setFilteredGraphData({
        nodes: filteredNodes,
        links: filteredLinks,
      });
    } else {
      // DIM MODE: Add dimming metadata to nodes without filtering them out
      let nodesWithDimming = graphData.nodes.map((node): GraphNode => {
        // Dim unpinned references if there are any pins configured AND dimUnpinned is true
        if (
          node.type === "reference" &&
          activeView.pins.length > 0 &&
          dimUnpinned
        ) {
          const isPinned = pinnedIds.has(node.content_id!);
          return Object.assign(Object.create(Object.getPrototypeOf(node)), {
            ...node,
            dimmed: !isPinned,
          });
        }
        // Dim refClaims that belong to unpinned references
        if (
          node.type === "refClaim" &&
          activeView.pins.length > 0 &&
          dimUnpinned
        ) {
          const isPinned = pinnedIds.has(node.content_id!);
          return Object.assign(Object.create(Object.getPrototypeOf(node)), {
            ...node,
            dimmed: !isPinned,
          });
        }
        return node;
      });

      // Filter out reference authors if toggle is off
      if (!showReferenceAuthors) {
        nodesWithDimming = nodesWithDimming.filter((node) => {
          if (node.type === "author") {
            return isTaskAuthor(node.id);
          }
          return true;
        });
      }

      const filteredNodeIds = new Set(nodesWithDimming.map((n) => n.id));
      const filteredLinks = graphData.links.filter(
        (link) =>
          filteredNodeIds.has(link.source) && filteredNodeIds.has(link.target),
      );

      setFilteredGraphData({
        nodes: nodesWithDimming,
        links: filteredLinks,
      });
    }
  }, [
    graphData,
    activeViewId,
    views,
    showPinnedOnly,
    dimUnpinned,
    showReferenceAuthors,
  ]);

  // View management handlers
  const handleViewChange = async (viewId: number) => {
    if (!viewerId) return;
    setActiveViewId(viewId);
    await markViewAsViewed(viewId, viewerId);
  };

  const handleCreateView = async (name: string) => {
    if (!selectedTask || !viewerId) return;

    const newView = await createMoleculeView({
      contentId: selectedTask.content_id,
      name,
      isDefault: false,
      displayMode: "circles",
      userId: viewerId,
    });

    setViews([...views, newView]);
    setActiveViewId(newView.id);
  };

  const handleRenameView = async (viewId: number, newName: string) => {
    if (!viewerId) return;
    const updatedView = await updateMoleculeView(viewId, {
      name: newName,
      userId: viewerId,
    });
    setViews(views.map((v) => (v.id === viewId ? updatedView : v)));
  };

  const handleDeleteView = async (viewId: number) => {
    if (!viewerId) return;
    await deleteMoleculeView(viewId, viewerId);
    const remainingViews = views.filter((v) => v.id !== viewId);
    setViews(remainingViews);

    // Switch to another view if deleting active view
    if (activeViewId === viewId && remainingViews.length > 0) {
      setActiveViewId(remainingViews[0].id);
    }
  };

  const handleSetDefault = async (viewId: number) => {
    if (!viewerId) return;
    await updateMoleculeView(viewId, { isDefault: true, userId: viewerId });
    setViews(
      views.map((v) => ({
        ...v,
        is_default: v.id === viewId,
      })),
    );
  };

  const handleTogglePin = async (referenceContentId: number) => {
    if (!activeViewId || !viewerId) return;

    const activeView = views.find((v) => v.id === activeViewId);
    if (!activeView) return;

    // Find current pin status
    const currentPin = activeView.pins.find(
      (p) => p.reference_content_id === referenceContentId,
    );
    const newPinStatus = currentPin ? !currentPin.is_pinned : true;

    // Update via API
    await updatePin(
      activeViewId,
      {
        referenceContentId,
        isPinned: newPinStatus,
      },
      viewerId,
    );

    // Update local state
    setViews(
      views.map((v) => {
        if (v.id !== activeViewId) return v;

        const existingPinIndex = v.pins.findIndex(
          (p) => p.reference_content_id === referenceContentId,
        );

        if (existingPinIndex >= 0) {
          // Update existing pin
          const newPins = [...v.pins];
          newPins[existingPinIndex] = {
            ...newPins[existingPinIndex],
            is_pinned: newPinStatus,
          };
          return { ...v, pins: newPins };
        } else {
          // Add new pin
          return {
            ...v,
            pins: [
              ...v.pins,
              {
                reference_content_id: referenceContentId,
                is_pinned: newPinStatus,
              },
            ],
          };
        }
      }),
    );

    toast({
      title: newPinStatus ? "Source pinned" : "Source unpinned",
      status: "success",
      duration: 2000,
    });
  };

  // Debounce timeout for position saving
  const positionSaveTimeout = useRef<NodeJS.Timeout | null>(null);

  // Handle position changes (debounced to avoid excessive API calls)
  const handlePositionsChange = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      console.log("💾 handlePositionsChange called", {
        activeViewId,
        viewerId,
        positionCount: Object.keys(positions).length,
      });

      if (!activeViewId || !viewerId) {
        console.error(
          "💾 Cannot save positions: missing activeViewId or viewerId",
          { activeViewId, viewerId },
        );
        return;
      }

      // Clear existing timeout
      if (positionSaveTimeout.current) {
        clearTimeout(positionSaveTimeout.current);
      }

      // Set new timeout to save after 1 second of inactivity
      positionSaveTimeout.current = setTimeout(async () => {
        try {
          console.log("💾 Attempting to save positions...", {
            viewId: activeViewId,
            userId: viewerId,
          });
          await updateViewPositions(activeViewId, positions, viewerId);
          console.log("💾 Positions saved successfully for view", activeViewId);

          // Update local state
          setViews((prevViews) =>
            prevViews.map((v) =>
              v.id === activeViewId ? { ...v, positions } : v,
            ),
          );
        } catch (error: any) {
          console.error("💾 Failed to save positions:", error);
          console.error("💾 Error details:", error.message, error.stack);
          toast({
            title: "Failed to save positions",
            description: error.message || "Unknown error",
            status: "error",
            duration: 3000,
          });
        }
      }, 1000);
    },
    [activeViewId, viewerId, toast],
  );

  // Handle display mode change
  const handleDisplayModeChange = async (mode: DisplayMode) => {
    console.log("🎨 Display mode change requested:", mode);
    console.log("🎨 Current activeViewId:", activeViewId);
    console.log("🎨 Current viewerId:", viewerId);

    if (!activeViewId || !viewerId) {
      console.error("🎨 Missing activeViewId or viewerId!");
      return;
    }

    try {
      console.log("🎨 Updating molecule view with mode:", mode);
      await updateMoleculeView(activeViewId, {
        displayMode: mode,
        userId: viewerId,
      });

      console.log("🎨 View updated, updating local state");
      setViews(
        views.map((v) =>
          v.id === activeViewId ? { ...v, display_mode: mode } : v,
        ),
      );

      console.log("🎨 Display mode updated successfully to:", mode);
      toast({
        title: "Display mode updated",
        status: "success",
        duration: 2000,
      });
    } catch (error) {
      console.error("🎨 Error updating display mode:", error);
      toast({
        title: "Failed to update display mode",
        status: "error",
        duration: 3000,
      });
    }
  };

  // 🧠 Restore selectedTask from ID if necessary
  useEffect(() => {
    if (selectedTaskId && !selectedTask) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === selectedTaskId);
      if (match) {
        console.log("🧠 Rehydrating selectedTask from ID");
        setSelectedTask(match);
      }
    }
  }, [selectedTaskId, selectedTask, setSelectedTask]);

  // 🌐 Load graph data for selected task
  useEffect(() => {
    const loadGraph = async () => {
      if (!selectedTask) return;

      const taskNode: GraphNode = {
        id: `conte-${selectedTask.content_id}`,
        label: selectedTask.content_name,
        type: "task",
        url: selectedTask.url,
        group: 2,
        content_id: selectedTask.content_id,
        x: 0,
        y: 0,
      };

      try {
        console.log("🧬 Fetching graph for task:", taskNode);
        const result = await fetchNewGraphDataFromLegacyRoute(taskNode);
        // ─── ADD THESE LOGS ───────────────────────────────────────────────────
        console.log(
          "🔍 [DEBUG] ALL NODES:",
          result.nodes.map((n) => `${n.id} (type=${n.type})`),
        );
        console.log(
          "🔍 [DEBUG] ALL LINKS:",
          result.links.map((l) => `${l.id}: ${l.source}→${l.target}`),
        );
        console.log(
          "🔍 [DEBUG] CLAIM NODES:",
          result.nodes.filter(
            (n) => n.type === "refClaim" || n.type === "taskClaim",
          ),
        );
        console.log(
          "🔍 [DEBUG] CLAIM LINKS:",
          result.links.filter(
            (l) =>
              l.source.startsWith("refClaim") ||
              l.source.startsWith("taskClaim") ||
              l.target.startsWith("refClaim") ||
              l.target.startsWith("taskClaim"),
          ),
        );
        // ─────────────────────────────────────────────────────────────────────

        console.log("✅ Graph data loaded:", result);
        setGraphData(result);
      } catch (err) {
        console.error("🔥 Error loading graph data:", err);
      } finally {
        setLoading(false);
      }
    };

    if (!selectedTask) {
      console.warn("❌ No selected task — redirecting.");
      setLoading(false);
      navigate("/tasks", { state: { redirectTo: "/molecule" } });
      return;
    }

    loadGraph();
  }, [selectedTask, navigate]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleReframeClick = async () => {
    if (!selectedNode) return;

    const pivotType = selectedNode.type as "task" | "author" | "publisher";
    const pivotId =
      selectedNode.content_id ??
      selectedNode.author_id ??
      selectedNode.publisher_id ??
      null;

    try {
      const result = await fetchNewGraphDataFromLegacyRoute(selectedNode);
      setGraphData(result);

      if (pivotType && pivotId !== null) {
        await useTaskStore.getState().fetchTasksByPivot(pivotType, pivotId);
      }
    } catch (err) {
      console.error("❌ Error reframing graph:", err);
    }
  };

  if (!selectedTask || loading || loadingViews) {
    console.log("[🧪 MoleculeMapPage] Not ready:", {
      selectedTaskId,
      selectedTask,
      viewerId,
      loading,
      loadingViews,
    });
    return (
      <Center h="80vh">
        <Spinner size="xl" color="teal.400" />
      </Center>
    );
  }
  console.log("🔗 Links in graphData:", graphData.links);
  console.log("🧠 Nodes in graphData:", graphData.nodes);
  console.log("📋 Views state:", views);
  console.log("📋 activeViewId:", activeViewId);

  const activeView = views.find((v) => v.id === activeViewId);
  console.log("📋 Found activeView:", activeView);

  const pinnedIds: Set<number> = activeView
    ? new Set(
        activeView.pins
          .filter((p) => p.is_pinned)
          .map((p) => p.reference_content_id)
          .filter((id): id is number => id != null),
      )
    : new Set();
  const currentDisplayMode = activeView?.display_mode || "circles";

  console.log("🎨 Current display mode:", currentDisplayMode);
  console.log("🎨 Active view:", activeView);

  return (
    <Box p={4}>
      {/* Sticky Title Bar - Always visible initially */}
      <StickyTitleBar alwaysVisible={true} />

      <Card mb={2} mt={2}>
        <CardBody>
          <UnifiedHeader
            pivotType={
              (selectedNode?.type as "task" | "author" | "publisher") || "task"
            }
            pivotId={
              selectedNode?.content_id ??
              selectedNode?.author_id ??
              selectedNode?.publisher_id ??
              selectedTask.content_id
            }
          />
        </CardBody>
      </Card>

      {/* Control Bar */}
      <Box
        mb={4}
        display="flex"
        gap={4}
        alignItems="center"
        justifyContent="space-between"
        p={4}
        borderRadius="12px"
        bg={
          colorMode === "dark"
            ? "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            : "linear-gradient(135deg, rgba(100, 116, 139, 0.25) 0%, rgba(148, 163, 184, 0.3) 50%, rgba(71, 85, 105, 0.25) 100%)"
        }
        backdropFilter="blur(20px)"
        border="1px solid"
        borderColor={
          colorMode === "dark"
            ? "rgba(0, 162, 255, 0.4)"
            : "rgba(71, 85, 105, 0.4)"
        }
        boxShadow={
          colorMode === "dark"
            ? "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
            : "0 4px 16px rgba(71, 85, 105, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.4)"
        }
        position="relative"
        zIndex={100}
        flexWrap="wrap"
      >
        {/* Molecule Label Box */}
        <Box
          bg={colorMode === "dark" ? "whiteAlpha.100" : "blackAlpha.50"}
          px={3}
          py={2}
          borderRadius="md"
          backdropFilter="blur(8px)"
          border="1px solid"
          borderColor={
            colorMode === "dark" ? "whiteAlpha.200" : "blackAlpha.200"
          }
        >
          <Heading size="md">Molecule</Heading>
        </Box>

        <DisplayModeSwitcher
          currentMode={currentDisplayMode}
          onChange={handleDisplayModeChange}
        />

        {/* View Filter Dropdown */}
        <Box display="flex" alignItems="center" gap={2}>
          <Text
            fontSize="xs"
            color={colorMode === "dark" ? "gray.400" : "gray.600"}
            textTransform="uppercase"
            letterSpacing="1px"
            whiteSpace="nowrap"
          >
            View Filter
          </Text>
          <Select
            size="sm"
            width="180px"
            value={
              showPinnedOnly ? "pinned" : dimUnpinned ? "prominent" : "equal"
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val === "pinned") {
                setShowPinnedOnly(true);
                setDimUnpinned(true);
              } else if (val === "prominent") {
                setShowPinnedOnly(false);
                setDimUnpinned(true);
              } else {
                setShowPinnedOnly(false);
                setDimUnpinned(false);
              }
            }}
            bg={colorMode === "dark" ? "gray.700" : "white"}
          >
            <option value="equal">👁️ All (Equal)</option>
            <option value="prominent">👁️ All (Prominent)</option>
            <option value="pinned">📌 Pinned Only</option>
          </Select>
        </Box>

        {/* Authors Dropdown */}
        <Box display="flex" alignItems="center" gap={2}>
          <Text
            fontSize="xs"
            color={colorMode === "dark" ? "gray.400" : "gray.600"}
            textTransform="uppercase"
            letterSpacing="1px"
            whiteSpace="nowrap"
          >
            Authors
          </Text>
          <Select
            size="sm"
            width="180px"
            value={showReferenceAuthors ? "all" : "task"}
            onChange={(e) => setShowReferenceAuthors(e.target.value === "all")}
            bg={colorMode === "dark" ? "gray.700" : "white"}
          >
            <option value="task">👤 Task Author Only</option>
            <option value="all">👥 All Authors</option>
          </Select>
        </Box>

        {/* Views Dropdown */}
        <Box display="flex" alignItems="center" gap={2}>
          <Text
            fontSize="xs"
            color={colorMode === "dark" ? "gray.400" : "gray.600"}
            textTransform="uppercase"
            letterSpacing="1px"
            whiteSpace="nowrap"
          >
            Views
          </Text>
          <MoleculeViewTabs
            views={views}
            activeViewId={activeViewId}
            onViewChange={handleViewChange}
            onCreateView={handleCreateView}
            onRenameView={handleRenameView}
            onDeleteView={handleDeleteView}
            onSetDefault={handleSetDefault}
          />
        </Box>

        {/* Viewer Scope Badge */}
        <ViewerScopeBadge />
      </Box>

      {filteredGraphData.nodes.length > 0 ? (
        <Box position="relative" height="78vh">
          <CytoscapeMolecule
            nodes={filteredGraphData.nodes}
            links={filteredGraphData.links}
            onNodeClick={handleNodeClick}
            currentUserId={viewerId}
            centerNodeId={
              selectedNode?.id ||
              filteredGraphData.nodes.find((n) => n.type === "task")?.id
            }
            pinnedReferenceIds={pinnedIds}
            onTogglePin={handleTogglePin}
            displayMode={currentDisplayMode}
            savedPositions={activeView?.positions}
            onPositionsChange={handlePositionsChange}
            nodeSettings={activeView?.node_settings}
            onNodeSettingsChange={(settings) => {
              if (!activeViewId || !viewerId) return;
              // Update local state immediately
              setViews((prevViews) =>
                prevViews.map((v) =>
                  v.id === activeViewId ? { ...v, node_settings: settings } : v,
                ),
              );
              // Save to backend
              updateMoleculeView(activeViewId, {
                nodeSettings: settings,
                userId: viewerId,
              }).catch((error) => {
                console.error("Failed to save node settings:", error);
              });
            }}
          />

          {/* {selectedNode && (
            <Hide below="md">
              <Box
                position="absolute"
                top="12px"
                right="12px"
                bg="stat2Gradient"
                border="2px solid #3182ce"
                borderRadius="xl"
                p={4}
                boxShadow="2xl"
                zIndex="20"
                width="280px"
                textAlign="center"
              >
                <Text fontWeight="bold" fontSize="md" mb={1} color="gray.700">
                  Node Type:{" "}
                  <span style={{ textTransform: "capitalize" }}>
                    {selectedNode.type}
                  </span>
                </Text>
                <Text fontWeight="semibold" fontSize="lg" color="teal.700">
                  {selectedNode.label}
                </Text>

                {selectedNode.url && (
                  <Text fontSize="sm" mt={2}>
                    <a
                      href={selectedNode.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#2b6cb0", textDecoration: "underline" }}
                    >
                      Open Link 🔗
                    </a>
                  </Text>
                )}

                <Button
                  mt={3}
                  colorScheme="blue"
                  size="sm"
                  onClick={handleReframeClick}
                  borderRadius="full"
                >
                  Reframe Graph
                </Button>
                <Button
                  mt={2}
                  size="sm"
                  variant="outline"
                  colorScheme="gray"
                  borderRadius="full"
                  onClick={() => {
                    toast({
                      title: "Centered View",
                      description: `Zoomed to ${selectedNode.label}`,
                      status: "info",
                      duration: 2000,
                      isClosable: true,
                      position: "top",
                    });
                  }}
                >
                  Center Graph
                </Button>
              </Box>
            </Hide>
          )} */}
        </Box>
      ) : (
        <Text>No graph data available for this view.</Text>
      )}
    </Box>
  );
};

export default MoleculeMapPage;
