// Updated CytoscapeMolecule.tsx — RefClaims and TaskClaims now arc with visual clarity,
// central focus is on the lines between the arcs, and taskClaim arcs align with ref arcs
// Implements edge convergence halfway between claim groups and main nodes

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import {
  Box,
  Button,
  Text,
  useToast,
  CloseButton,
  useColorMode,
} from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

// Import refactored modules
import {
  animateMoleculeScene,
  startThrobbing,
  restartAllThrobs,
  arrangeSourcesAroundCase,
  saveNodePositions,
  getCytoscapeStyles,
  EdgeTooltip,
  ClaimModal,
  EdgeModal,
  NodePopup,
  ContextMenu,
  ContextMenuItem,
  API_BASE_URL,
  DisplayMode,
  NodeCard,
  expandCaseWithClaims,
  collapseCaseClaims,
} from "./cytoscape";

// Forward declaration - will be properly defined after CytoscapeMoleculeProps
type NodeData = {
  id: string;
  label: string;
  type: string;
  claim_id?: number;
  content_id?: number;
  author_id?: number;
  publisher_id?: number;
  url?: string;
  rating?: string | number;
  veracity_score?: number;
  confidence_level?: number;
  claimCount?: number;
  refCount?: number;
  rationale?: string;
  stance?: string;
};




interface CytoscapeMoleculeProps {
  nodes: {
    id: string;
    label: string;
    type: string;
    claim_id?: number;
    content_id?: number;
    url?: string;
    added_by_user_id?: number | null;
    is_system?: boolean;
  }[];
  currentUserId?: number | null;
  links: {
    id: string;
    source: string;
    target: string;
    relation?: "supports" | "refutes" | "related";
    notes?: string;
    value?: number;
    claimAggregate?: {
      supportsCount: number;
      refutesCount: number;
      supportsPercent: number;
      refutesPercent: number;
      total: number;
    };
  }[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
  pinnedReferenceIds?: Set<number>;
  onTogglePin?: (contentId: number) => void;
  displayMode?: DisplayMode;
  savedPositions?: Record<string, { x: number; y: number }> | null;
  onPositionsChange?: (
    positions: Record<string, { x: number; y: number }>,
  ) => void;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onNodeSettingsChange?: (
    settings: Record<string, { displayMode: DisplayMode }>,
  ) => void;
}

type LinkData = CytoscapeMoleculeProps["links"][number];

const CytoscapeMolecule: React.FC<CytoscapeMoleculeProps> = ({
  nodes,
  links,
  onNodeClick,
  centerNodeId,
  pinnedReferenceIds,
  onTogglePin,
  displayMode = "mr_cards",
  savedPositions,
  onPositionsChange,
  nodeSettings,
  onNodeSettingsChange,
  currentUserId,
}) => {
  const { colorMode } = useColorMode();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const activatedNodeIdsRef = useRef<Set<string>>(new Set());
  const [selectedClaim, setSelectedClaim] = useState<null | {
    id: string;
    label: string;
    taskClaimLabel?: string;
    relation: string;
    notes?: string;
  }>(null);
  const [selectedEdge, setSelectedEdge] = useState<null | {
    sourceLabel: string;
    targetLabel: string;
    relation: string;
    value: number;
    notes: string;
  }>(null);
  const [hoveredEdgeTooltip, setHoveredEdgeTooltip] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNode | null>(
    null,
  );
  const toast = useToast();

  // HUD toggles (visible on desktop, hidden on mobile)
  const [showMobileHUD, setShowMobileHUD] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  const [showLegend, setShowLegend] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );

  const lastRefNode = useRef<NodeSingular | null>(null);
  const lastRefOriginalPos = useRef<{ x: number; y: number } | null>(null);
  const activeRefWithClaims = useRef<string | null>(null); // Track which ref is showing claims
  const isReframedGraph = useRef<boolean>(false); // Track if graph was reframed (don't rebuild on position changes)
  const originalNodePositions = useRef<
    Record<string, { x: number; y: number }>
  >({});

  // State for overlay rendering
  const [overlayNodes, setOverlayNodes] = useState<cytoscape.NodeSingular[]>(
    [],
  );
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [forceRebuild, setForceRebuild] = useState<number>(0); // Toggle to force useEffect rebuild
  const [hoveredNodePopup, setHoveredNodePopup] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const [highlightedType, setHighlightedType] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [caseExpanded, setCaseExpanded] = useState<boolean>(false);
  const snapshotNodesRef = useRef<typeof nodes | null>(null);
  const snapshotLinksRef = useRef<typeof links | null>(null);

  useEffect(() => {
    console.log("🔄 useEffect triggered - caseExpanded:", caseExpanded, "nodes:", nodes.length, "links:", links.length);

    if (!cyRef.current) return;

    // CRITICAL: Check if case claims exist in the actual graph
    const caseClaimsExist = cyInstance.current ? cyInstance.current.nodes('[type="caseClaim"]').length > 0 : false;

    // BLOCK if case claims are visible - check both state and actual graph
    if (caseExpanded || caseClaimsExist) {
      console.log(
        "🛑 BLOCKED: Case claims exist in graph - skipping rebuild (state:", caseExpanded, "actual:", caseClaimsExist, ")",
      );
      // Store snapshot when first blocking
      if (!snapshotNodesRef.current) {
        snapshotNodesRef.current = nodes;
        snapshotLinksRef.current = links;
        console.log("📸 Saved nodes/links snapshot for when claims collapse");
      }
      return;
    }

    // Clear snapshot when rebuilding (claims have been collapsed)
    snapshotNodesRef.current = null;
    snapshotLinksRef.current = null;

    // If graph was reframed, don't rebuild - let users drag nodes freely
    if (isReframedGraph.current) {
      console.log(
        "⏭️ Skipping graph rebuild - reframed graph, preserving user positions",
      );
      return;
    }

    // If claims are visible when data changes, clear them first before rebuilding
    if (activeRefWithClaims.current !== null && cyInstance.current) {
      try {
        const cy = cyInstance.current;

        // Clear active ref tracker
        activeRefWithClaims.current = null;

        // Remove all claim nodes and their edges
        cy.batch(() => {
          cy.nodes('[type = "refClaim"], [type = "taskClaim"]').forEach(
            (node) => {
              // Clear throb interval
              const interval = node.data("throbInterval");
              if (interval) clearInterval(interval);
              node.remove();
            },
          );
        });

        // Show all ref-to-task edges again
        cy.edges().forEach((edge) => {
          const source = edge.source();
          const target = edge.target();
          if (source && target) {
            const isRefTaskEdge =
              (source.data("type") === "reference" &&
                target.data("type") === "task") ||
              (source.data("type") === "task" &&
                target.data("type") === "reference");
            if (isRefTaskEdge) {
              edge.style("display", "element");
            }
          }
        });
      } catch (error) {
        console.error("Error clearing claims during rebuild:", error);
        // Reset the ref and continue
        activeRefWithClaims.current = null;
      }
    }

    const centerX = 500;
    const centerY = 350;

    const centerNode =
      nodes.find((n) => n.id === centerNodeId) ||
      nodes.find((n) => n.type === "task");

    const baseNodes = nodes.filter((n) =>
      ["task", "reference", "author", "publisher"].includes(n.type),
    );

    // Nautilus spiral parameters - Gentle exponential growth for clean spiral
    const refCount = baseNodes.filter(
      (node) => node.type === "reference",
    ).length;

    const clamp = (min: number, max: number, value: number) =>
      Math.max(min, Math.min(max, value));

    // Nautilus uses exponential growth: radius = a * e^(b * theta)
    // Cards are 200px wide
    const spiralStart = 400; // Starting radius
    const growthFactor = clamp(0.05, 0.12, 0.12 - Math.log(refCount) * 0.015); // Very gentle growth
    const angleStep = clamp(0.25, 0.4, 0.4 - Math.log(refCount) * 0.02); // Tighter angle steps

    // Calculate claim aggregate for each reference (for edge coloring)
    const getClaimAggregate = (
      refId: string,
    ): { supportsCount: number; refutesCount: number; total: number } => {
      const ref = baseNodes.find((b) => b.id === refId);
      if (!ref) return { supportsCount: 0, refutesCount: 0, total: 0 };

      const refClaims = nodes.filter(
        (n) => n.type === "refClaim" && n.content_id === ref.content_id,
      );

      if (refClaims.length === 0)
        return { supportsCount: 0, refutesCount: 0, total: 0 };

      let supportsCount = 0;
      let refutesCount = 0;

      refClaims.forEach((claim) => {
        const claimEdge = links.find(
          (l) => l.source === claim.id || l.target === claim.id,
        );
        if (claimEdge?.relation === "supports") supportsCount++;
        else if (claimEdge?.relation === "refutes") refutesCount++;
      });

      return {
        supportsCount,
        refutesCount,
        total: supportsCount + refutesCount,
      };
    };

    // Store claim aggregates for each reference (for edge coloring)
    const refClaimAggregates = new Map<
      string,
      { supportsCount: number; refutesCount: number; total: number }
    >();
    baseNodes
      .filter((n) => n.type === "reference")
      .forEach((ref) => {
        refClaimAggregates.set(ref.id, getClaimAggregate(ref.id));
      });

    const positionedNodes = baseNodes.map((n) => {
      // Check if we have saved positions for this node
      if (savedPositions && savedPositions[n.id]) {
        return {
          data: { ...n },
          position: savedPositions[n.id],
        };
      }

      if (n.id === centerNode?.id) {
        return {
          data: { ...n },
          position: { x: centerX, y: centerY },
        };
      }

      const refIndex = baseNodes.findIndex((b) => b.id === n.id);

      // True nautilus spiral formula: radius = a * e^(b * theta)
      // This creates the characteristic exponential spiral of a nautilus shell
      const angle = refIndex * angleStep;
      const radius = spiralStart * Math.exp(growthFactor * angle);

      let x = centerX + radius * Math.cos(angle);
      let y = centerY + radius * Math.sin(angle);

      // AUTHORS: Far left edge - OUTSIDE the spiral
      if (n.type === "author") {
        const authorIndex = baseNodes
          .filter((node) => node.type === "author")
          .findIndex((a) => a.id === n.id);
        x = centerX - 1200; // Further left
        y =
          centerY +
          (authorIndex -
            baseNodes.filter((node) => node.type === "author").length / 2) *
            150;
      }

      // PUBLISHERS: Far right edge - OUTSIDE the spiral
      if (n.type === "publisher") {
        const publisherIndex = baseNodes
          .filter((node) => node.type === "publisher")
          .findIndex((p) => p.id === n.id);
        x = centerX + 1200; // Further right
        y =
          centerY +
          (publisherIndex -
            baseNodes.filter((node) => node.type === "publisher").length / 2) *
            150;
      }

      return {
        data: { ...n },
        position: { x, y },
      };
    });

    const initialEdges = links
      .filter((l) => {
        const sourceExists = positionedNodes.some(
          (n) => n.data.id === l.source,
        );
        const targetExists = positionedNodes.some(
          (n) => n.data.id === l.target,
        );
        return sourceExists && targetExists;
      })
      .map((l) => {
        // Color edges based on claim aggregates for references
        const sourceNode = baseNodes.find((n) => n.id === l.source);
        const targetNode = baseNodes.find((n) => n.id === l.target);

        let edgeData = { ...l };

        // If this edge connects to a reference, check claim aggregates
        const refNode =
          sourceNode?.type === "reference"
            ? sourceNode
            : targetNode?.type === "reference"
              ? targetNode
              : null;

        if (refNode) {
          const aggregate = refClaimAggregates.get(refNode.id);
          if (aggregate && aggregate.total > 0) {
            // Calculate percentage
            const supportsPercent = Math.round(
              (aggregate.supportsCount / aggregate.total) * 100,
            );
            const refutesPercent = Math.round(
              (aggregate.refutesCount / aggregate.total) * 100,
            );

            // Store aggregate info on edge
            edgeData = {
              ...edgeData,
              claimAggregate: {
                supportsCount: aggregate.supportsCount,
                refutesCount: aggregate.refutesCount,
                supportsPercent,
                refutesPercent,
                total: aggregate.total,
              },
            };
          }
        }

        return { data: edgeData };
      });

    // Style configuration based on display mode
    const getNodeStyle = () => {
      if (displayMode === "circles") {
        return {
          selector: "node",
          style: {
            shape: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim")
                return "round-triangle";
              return "ellipse";
            },
            width: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 70;
              return 140;
            },
            height: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 70;
              return 140;
            },
            label: (ele: any) => ele.data("label"),
            "text-wrap": "wrap",
            "text-max-width": "120px",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 8,
            "font-size": "13px",
            "font-weight": 600,
            color: "#e2e8f0",
            "text-outline-color": "#1e293b",
            "text-outline-width": 2,
            // Apply opacity for dimmed (unpinned) nodes
            opacity: (ele: any) => {
              return ele.data("dimmed") ? 0.3 : 1.0;
            },
            // Z-index: rated nodes in foreground
            "z-index": (ele: any) => {
              const rating = ele.data("rating");
              // Nodes with ratings get higher z-index
              if (rating != null && rating !== 0) {
                return 100 + Math.abs(rating); // Higher ratings even more in front
              }
              return 1; // Default z-index
            },
            // Use background image - use new API endpoint that auto-detects extension
            "background-image": (ele: any) => {
              const data = ele.data();
              const type = data.type;
              const nodeId = ele.id();

              const API_BASE_URL =
                import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

              // Use new API endpoint for auto extension detection
              let fullUrl;
              if (type === "author") {
                const authorId = data.author_id || nodeId.replace("autho-", "");
                fullUrl = `${API_BASE_URL}/api/image/authors/${authorId}`;
              } else if (type === "task" || type === "reference") {
                const contentId =
                  data.content_id || nodeId.replace("conte-", "");
                fullUrl = `${API_BASE_URL}/api/image/content/${contentId}`;
              } else if (type === "publisher") {
                const publisherId =
                  data.publisher_id || nodeId.replace("publi-", "");
                fullUrl = `${API_BASE_URL}/api/image/publishers/${publisherId}`;
              } else {
                return null; // No image for claims
              }

              return fullUrl;
            },
            "background-fit": "cover",
            "background-clip": "node",
            "background-color": (ele: any) => {
              const type = ele.data("type");
              // Fallback colors if no image
              if (type === "task") return "#6366f1";
              if (type === "reference") return "#10b981";
              if (type === "unifiedClaim") return "#f97316";
              if (type === "refClaim") return "#ec4899"; // Pink for reference claims
              if (type === "taskClaim") return "#f59e0b"; // Amber for task claims
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#60a5fa";
              return "#6366f1";
            },
            "background-opacity": (ele: any) => {
              const type = ele.data("type");
              const highlighted = ele.data("highlightedType");
              // Dim nodes that don't match highlighted type
              if (highlighted && highlighted !== type) return 0.2;
              return 0.9;
            },
            "border-width": (ele: any) => {
              const type = ele.data("type");
              const highlighted = ele.data("highlightedType");
              // Thicker border for highlighted type
              if (highlighted && highlighted === type) return 15;
              return 8;
            },
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#6366f1";
              if (type === "reference") return "#10b981";
              if (type === "unifiedClaim") return "#f97316";
              if (type === "refClaim") return "#ec4899"; // Pink for reference claims
              if (type === "taskClaim") return "#f59e0b"; // Amber for task claims
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#60a5fa";
              return "#6366f1";
            },
            "border-opacity": (ele: any) => {
              const type = ele.data("type");
              const highlighted = ele.data("highlightedType");
              // Dim borders that don't match highlighted type
              if (highlighted && highlighted !== type) return 0.2;
              return 1.0;
            },
          },
        };
      } else if (displayMode === "compact") {
        return {
          selector: "node",
          style: {
            shape: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim")
                return "round-triangle";
              return "round-rectangle";
            },
            width: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 60;
              return 120;
            },
            height: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 70;
              return 140;
            },
            label: "",
            "background-color": "rgba(0, 0, 0, 0)",
            "background-opacity": 0,
            "border-width": (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 6;
              return 12;
            },
            // @ts-ignore
            "corner-radius": (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 5;
              return 10;
            },
            // Apply opacity for dimmed (unpinned) nodes
            opacity: (ele: any) => {
              return ele.data("dimmed") ? 0.3 : 1.0;
            },
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#00a2ff";
              if (type === "reference") return "#4ade80";
              if (type === "unifiedClaim") return "#fbbf24";
              if (type === "refClaim") return "#ec4899"; // Pink for reference claims
              if (type === "taskClaim") return "#f59e0b"; // Amber for task claims
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#00a2ff";
              return "#00a2ff";
            },
            "border-opacity": 0.4,
          },
        };
      } else {
        // mr_cards mode
        return {
          selector: "node",
          style: {
            shape: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim")
                return "round-triangle";
              return "round-rectangle";
            },
            width: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 130;
              return type === "unifiedClaim" ? 260 : 200;
            },
            height: (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 160;
              return type === "unifiedClaim" ? 320 : 240;
            },
            label: "",
            color: "rgba(0, 0, 0, 0)",
            "background-color": "rgba(0, 0, 0, 0)",
            "background-opacity": 0,
            "border-width": (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 9;
              return 18;
            },
            // @ts-ignore
            "corner-radius": (ele: any) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") return 8;
              return 16;
            },
            // Apply opacity for dimmed (unpinned) nodes
            opacity: (ele: any) => {
              return ele.data("dimmed") ? 0.3 : 1.0;
            },
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#00a2ff";
              if (type === "reference") return "#4ade80";
              if (type === "unifiedClaim") return "#fbbf24";
              if (type === "refClaim") return "#ec4899"; // Pink for reference claims
              if (type === "taskClaim") return "#f59e0b"; // Amber for task claims
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#00a2ff";
              return "#00a2ff";
            },
            "border-opacity": 0.4,
          },
        };
      }
    };

    const cy: cytoscape.Core = cytoscape({
      container: cyRef.current,
      elements: { nodes: positionedNodes, edges: initialEdges },
      layout: { name: "preset" },
      style: [
        getNodeStyle() as any,
        {
          selector: "edge",
          style: {
            width: (ele: EdgeSingular) => {
              const val = Math.abs(ele.data("value") || 0);
              return 2 + val * 4;
            },
            label: "", // Remove default label
            "text-rotation": "autorotate",
            "text-margin-y": -10,
            "font-size": 9,
            color: "#eee",
            "line-color": (ele: any) => {
              const aggregate = ele.data("claimAggregate");

              if (aggregate && aggregate.total > 0) {
                // Color based on claim aggregate - Minority Report theme
                const ratio =
                  (aggregate.supportsCount - aggregate.refutesCount) /
                  aggregate.total;

                if (ratio > 0.3) {
                  return "#4ade80"; // mr-green for mostly supports
                } else if (ratio < -0.3) {
                  return "#ef4444"; // mr-red for mostly refutes
                } else {
                  return "#fbbf24"; // mr-yellow for balanced
                }
              }

              // Default colors based on relation - Minority Report theme
              const rel = ele.data("relation");
              return rel === "supports"
                ? "#4ade80" // mr-green
                : rel === "refutes"
                  ? "#ef4444" // mr-red
                  : "#00a2ff"; // mr-blue
            },
            "target-arrow-color": "#aaa",
            "target-arrow-shape": "triangle",
            "curve-style": "unbundled-bezier",
            "control-point-distances": [40],
            "control-point-weights": [0.5],
            // Dim edges connected to dimmed nodes or non-highlighted nodes
            opacity: (ele: any) => {
              const sourceNode = ele.source();
              const targetNode = ele.target();
              const sourceDimmed = sourceNode.data("dimmed");
              const targetDimmed = targetNode.data("dimmed");

              // Dim if either end is dimmed
              if (sourceDimmed || targetDimmed) return 0.2;

              // Dim if highlightedType is set and neither end matches
              const highlighted = ele.data("highlightedType");
              if (highlighted) {
                const sourceType = sourceNode.data("type");
                const targetType = targetNode.data("type");
                if (sourceType !== highlighted && targetType !== highlighted) {
                  return 0.2;
                }
              }

              return 1.0;
            },
          },
        },
      ],
    });
    // @ts-ignore
    window.cy = cy;
    // Mark nodes that have unified claims
    const contentIdsWithClaims = new Set(
      nodes
        .filter((n) => n.type === "refClaim")
        .map((n) => n.content_id)
        .filter(Boolean),
    );
    const activatedNodeIds = new Set(
      [...contentIdsWithClaims].map((cid) => `conte-${cid}`),
    );
    activatedNodeIdsRef.current = activatedNodeIds;

    // Function to update overlay positions and zoom
    const updateOverlays = () => {
      if (cyRef.current) {
        setContainerRect(cyRef.current.getBoundingClientRect());
      }
      setOverlayNodes(cy.nodes().toArray());
      setZoomLevel(cy.zoom());
    };

    cy.ready(() => {
      cy.nodes().forEach((node) => {
        if (activatedNodeIds.has(node.id())) {
          startThrobbing(node);
          node.addClass("throb");
        }
      });

      // Initial overlay render
      updateOverlays();
    });
    cyInstance.current = cy;

    // Update overlays on position changes (drag, animate, zoom, pan)
    cy.on("position", updateOverlays);
    cy.on("pan zoom", updateOverlays);
    cy.on("add remove", updateOverlays);

    // Save positions when user finishes dragging nodes (exclude claim nodes)
    cy.on("dragfree", "node", (event) => {
      // Check if case claims exist in graph - more reliable than state
      const caseClaimsExist = cy.nodes('[type="caseClaim"]').length > 0;

      // STOP EVERYTHING if case claims are visible
      if (caseClaimsExist) {
        console.log("🛑 Case claims exist - BLOCKING dragfree completely");
        event.stopPropagation();
        event.preventDefault();
        return false;
      }

      // Don't save positions while ref claims are visible - it triggers a re-render that destroys claims
      if (activeRefWithClaims.current !== null) {
        console.log("🛑 Ref claims visible - ignoring dragfree");
        return;
      }

      if (onPositionsChange) {
        const positions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          const type = node.data("type");
          // Don't save positions for claim nodes (they're generated dynamically)
          if (type !== "refClaim" && type !== "taskClaim" && type !== "caseClaim") {
            const pos = node.position();
            positions[node.id()] = { x: pos.x, y: pos.y };
          }
        });
        console.log("💾 Saving node positions");
        onPositionsChange(positions);
      }
    });

    cy.on("mouseover", "edge", (event) => {
      const edge = event.target;
      const aggregate = edge.data("claimAggregate");

      let label = "";

      if (aggregate && aggregate.total > 0) {
        // Show claim aggregate
        const supportsPercent = aggregate.supportsPercent;
        const refutesPercent = aggregate.refutesPercent;

        if (supportsPercent > refutesPercent) {
          label = `✅ Supports ${supportsPercent}%`;
        } else if (refutesPercent > supportsPercent) {
          label = `❌ Refutes ${refutesPercent}%`;
        } else {
          label = `⚖️ Balanced (${supportsPercent}% / ${refutesPercent}%)`;
        }
      } else {
        // Fallback to original edge data
        const relation = edge.data("relation") || "related";
        const value = edge.data("value") || 0;
        label =
          (relation === "supports"
            ? "✅ Supports"
            : relation === "refutes"
              ? "❌ Refutes"
              : "Related") + `: ${Math.round(Math.abs(value) * 100)}%`;
      }

      const { x, y } = event.renderedPosition;
      setHoveredEdgeTooltip({ label, x, y });
    });

    cy.on("mouseout", "edge", () => {
      setHoveredEdgeTooltip(null);
    });

    // Node hover events for text popup
    cy.on("mouseover", "node", (event) => {
      const node = event.target;
      const label = node.data("label") || "";
      const { x, y } = event.renderedPosition;
      setHoveredNodePopup({ label, x, y });
    });

    cy.on("mouseout", "node", () => {
      setHoveredNodePopup(null);
    });

    // --- Touch detection ---
    const isTouchDevice =
      (typeof window !== "undefined" && "ontouchstart" in window) ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

    // Enable pinch zoom on touch; keep desktop user zoom off
    if (isTouchDevice) {
      cy.userZoomingEnabled(true); // pinch-to-zoom enabled
      cy.userPanningEnabled(true);
    } else {
      cy.userZoomingEnabled(false); // desktop: no wheel-zoom by default
      cy.userPanningEnabled(true);
    }
    cy.ready(() => {
      if (cyInstance.current) {
        cyRef.current?.addEventListener(
          "wheel",
          (e: WheelEvent & { wheelDelta?: number }) => {
            const isShift = e.shiftKey;
            const cy = cyInstance.current;
            if (!cy || !isShift) return;

            if (isShift) {
              // 👇 Fallback to wheelDelta if deltaY is useless
              const direction =
                e.deltaY && e.deltaY !== 0
                  ? e.deltaY < 0
                  : e.wheelDelta && e.wheelDelta > 0;
              // Zoom behavior
              const zoomFactor = 1.05; //e.deltaY < 0 ? 1.1 : 0.9;
              const zoom = cy.zoom();
              if (cyRef.current) {
                const { left, top } = cyRef.current!.getBoundingClientRect();
                const x = e.clientX - left;
                const y = e.clientY - top;

                const newZoom =
                  cy.zoom() * (direction ? zoomFactor : 1 / zoomFactor);
                cy.zoom({
                  level: newZoom,
                  renderedPosition: { x, y },
                });
              }
              e.preventDefault();
              // Only block scroll if shift is held
            }
            // Otherwise let default scroll behavior pass through
          },
          { passive: false },
        );
      }
      cy.animate({
        fit: {
          eles: cy.elements(),
          padding: 15,
        },
        duration: 250,
        easing: "ease-out",
      });
    });

    // More logic (node click, layout updates, etc.) continues in next part

    // 📌 Main event handler
    cy.on("tap", "node", (event) => {
      const node = event.target;
      const type = node.data("type");

      // 🧊 Store initial layout if first interaction (no claims visible)
      if (cy.nodes('node[type *= "Claim"]').length === 0) {
        saveNodePositions(cy, originalNodePositions);
      }

      // 📦 Send clicked node to external handler
      if (onNodeClick) onNodeClick(node.data());
      setSelectedNodeData(node.data());
      // 🧠 Handle claim node click - show both refClaim and taskClaim
      if (type === "refClaim" || type === "taskClaim") {
        const claimId = node.id();

        // Find the edge connecting refClaim and taskClaim
        const connectedEdge = cy
          .edges()
          .filter(
            (edge) =>
              edge.source().id() === claimId || edge.target().id() === claimId,
          )
          .toArray()
          .find((e) =>
            ["supports", "refutes", "related"].includes(e.data("relation")),
          );

        const relation = connectedEdge?.data("relation") || "related";

        // Get both refClaim and taskClaim nodes
        let refClaimNode: NodeSingular | null = null;
        let taskClaimNode: NodeSingular | null = null;

        if (type === "refClaim") {
          refClaimNode = node;
          // Find connected taskClaim
          if (connectedEdge && connectedEdge.isEdge()) {
            const otherId =
              connectedEdge.source().id() === claimId
                ? connectedEdge.target().id()
                : connectedEdge.source().id();
            taskClaimNode = cy.getElementById(otherId);
          }
        } else {
          taskClaimNode = node;
          // Find connected refClaim
          if (connectedEdge && connectedEdge.isEdge()) {
            const otherId =
              connectedEdge.source().id() === claimId
                ? connectedEdge.target().id()
                : connectedEdge.source().id();
            refClaimNode = cy.getElementById(otherId);
          }
        }

        setSelectedClaim({
          id: claimId,
          label: refClaimNode?.data("label") || "Unknown claim",
          taskClaimLabel: taskClaimNode?.data("label"),
          relation: relation,
          notes: node.data("rationale") || node.data("notes"),
        });
        return;
      }

      // 📍 Handle reference click (show claims)
      if (type === "reference") {
        const clickedRefId = node.id();

        // If clicking the same ref that's already showing claims, do nothing
        if (activeRefWithClaims.current === clickedRefId) {
          return;
        }

        // Remove existing claim nodes only when clicking a DIFFERENT reference
        const animate = true;
        const claimNodes = cy.nodes(
          '[type = "refClaim"], [type = "taskClaim"]',
        );
        cy.batch(() => {
          claimNodes.remove();
        });

        // Show all ref-to-task edges before adding new claims
        cy.edges().style("display", "element");

        // Update active ref tracker
        activeRefWithClaims.current = clickedRefId;

        (async () => {
          await animateMoleculeScene({
            cy,
            node,
            taskNode: cy
              .nodes()
              .filter('[type = "task"]')
              .first() as NodeSingular,
            nodes,
            links,
            originalNodePositions,
            lastRefNode,
            lastRefOriginalPos,
            animate,
            activatedNodeIds: activatedNodeIdsRef.current,
          });
        })();
      }

      // 📍 Handle task click - do nothing, keep claims visible
      if (type === "task") {
        return;
      }
    });

    // 🎯 Handle edge click (relation line between claims)
    cy.on("tap", "edge", (event) => {
      const edge = event.target as EdgeSingular;
      const rel = edge.data("relation");
      const value = edge.data("value") ?? 0;
      const notes = edge.data("notes") || "";

      const sourceNode = cy.getElementById(edge.data("source"));
      const targetNode = cy.getElementById(edge.data("target"));

      const sourceData = sourceNode.data();
      const targetData = targetNode.data();

      // For unifiedClaim edges, use the refClaimLabel and taskClaimLabel
      const sourceLabel =
        sourceData.type === "unifiedClaim"
          ? sourceData.refClaimLabel || sourceData.label
          : sourceData.label;
      const targetLabel =
        targetData.type === "unifiedClaim"
          ? targetData.taskClaimLabel || targetData.label
          : targetData.label;

      setSelectedEdge({
        sourceLabel,
        targetLabel,
        relation: rel,
        value,
        notes,
      });
    });

    // 🎯 Handle right-click on case/task nodes - expand/collapse case claims
    cy.on("cxttap", 'node[type="task"]', (event) => {
      const node = event.target;
      const contentId = node.data("content_id");
      const nodeId = node.id();

      console.log("🖱️ Right-clicked on case node:", nodeId, "contentId:", contentId);

      // Check if case claims currently exist in the graph
      const caseClaimsExist = cy.nodes('[type="caseClaim"]').length > 0;
      console.log("📊 Case claims currently visible:", caseClaimsExist);

      // Get rendered position for context menu
      const renderedPos = node.renderedPosition();

      setContextMenu({
        x: renderedPos.x,
        y: renderedPos.y,
        items: [
          {
            label: caseClaimsExist ? "Collapse Claims" : "Show Claims",
            icon: caseClaimsExist ? "📥" : "📤",
            action: async () => {
              console.log("📤 Context menu action triggered");
              // Get fresh node reference from cy instance
              const freshNode = cy.getElementById(nodeId);

              // Check again at action time
              const claimsNowExist = cy.nodes('[type="caseClaim"]').length > 0;

              if (claimsNowExist) {
                console.log("📥 Collapsing case claims...");
                collapseCaseClaims(cy, freshNode);
                setCaseExpanded(false);
              } else {
                console.log("📤 Expanding case claims for contentId:", contentId);
                try {
                  await expandCaseWithClaims({
                    cy,
                    caseNode: freshNode,
                    contentId,
                    viewerId: currentUserId || undefined,
                    viewScope: "user",
                  });
                  console.log("✅ Expansion complete");
                  setCaseExpanded(true);
                } catch (error) {
                  console.error("❌ Error expanding case claims:", error);
                }
              }
            },
          },
        ],
      });
    });

    return () => {
      // Don't destroy graph if case claims are visible
      const caseClaimsExist = cy ? cy.nodes('[type="caseClaim"]').length > 0 : false;
      if (caseClaimsExist) {
        console.log("⏭️ SKIPPING CLEANUP - case claims visible, preserving graph");
        return;
      }

      // Don't destroy graph if it's been reframed - preserve user's work
      if (isReframedGraph.current) {
        console.log("⏭️ Skipping cleanup - reframed graph, preserving nodes");
        return;
      }

      if (cy) {
        console.log("🗑️ Cleaning up and destroying graph");
        cy.nodes(".throb").forEach((node: any) => {
          clearInterval(node.data("throbInterval"));
        });
        cy.destroy();
      }
    };
  }, [nodes, links, displayMode, forceRebuild]);

  // Update node styles when highlightedType changes
  useEffect(() => {
    const cy = cyInstance.current;
    if (!cy) return;

    // Store highlightedType on each node's data so style functions can access it
    cy.nodes().forEach((node) => {
      node.data("highlightedType", highlightedType);
    });

    // Store on edges too
    cy.edges().forEach((edge) => {
      edge.data("highlightedType", highlightedType);
    });

    // Force Cytoscape to recalculate all styles
    cy.style().update();
  }, [highlightedType]);

  // Reframe: rebuild graph with clicked node in center
  const reframe = async () => {
    const cy = cyInstance.current;
    if (!cy || !selectedNodeData) {
      // If no node selected, just fit all
      if (cy) cy.fit(cy.elements(), 28);
      return;
    }

    const selectedId = selectedNodeData.id;
    const selectedType = selectedNodeData.type;

    // Skip for unified claims
    if (selectedType === "unifiedClaim") {
      toast({
        title: "Cannot reframe",
        description: "Reframe is not available for claim cards",
        status: "warning",
        duration: 2000,
        isClosable: true,
      });
      return;
    }

    // Extract entity ID based on type
    let entityId: string | number = "";
    let entityType = selectedType;

    if (selectedType === "task" || selectedType === "reference") {
      entityId =
        selectedNodeData.content_id || selectedId.replace("conte-", "");
      entityType = selectedType === "task" ? "task" : "reference";
    } else if (selectedType === "author") {
      entityId = selectedNodeData.author_id || selectedId.replace("autho-", "");
      entityType = "author";
    } else if (selectedType === "publisher") {
      entityId =
        selectedNodeData.publisher_id || selectedId.replace("publi-", "");
      entityType = "publisher";
    }

    try {
      const API_BASE_URL =
        import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
      const response = await fetch(
        `${API_BASE_URL}/api/get-graph-data?entity=${entityId}&entityType=${entityType}`,
      );

      if (!response.ok) throw new Error("Failed to fetch graph data");

      const data = await response.json();
      const { nodes: newNodes, links: newLinks } = data;

      // Clear existing graph
      cy.elements().remove();

      // Position new nodes with clicked node in center
      const centerX = 500;
      const centerY = 350;

      // Find the clicked node in new data
      const centerNode = newNodes.find((n: any) => n.id === selectedId);

      // Separate nodes by type
      const references = newNodes.filter((n: any) => n.type === "reference");
      const authors = newNodes.filter((n: any) => n.type === "author");
      const publishers = newNodes.filter((n: any) => n.type === "publisher");
      const tasks = newNodes.filter((n: any) => n.type === "task");

      // Find the case/task node (should be at center regardless of what was clicked)
      const caseNode = tasks.find((n: any) => n.id !== selectedId) || tasks[0];

      // Nautilus spiral parameters - gentle growth matching initial layout
      const refCount = references.length;
      const clamp = (min: number, max: number, value: number) =>
        Math.max(min, Math.min(max, value));
      const spiralStart = 400; // Match initial layout
      const growthFactor = clamp(0.05, 0.12, 0.12 - Math.log(refCount) * 0.015);
      const angleStep = clamp(0.25, 0.4, 0.4 - Math.log(refCount) * 0.02);

      const positionedNodes: any[] = [];

      // Center the node that was clicked (whatever it is)
      if (centerNode) {
        positionedNodes.push({
          data: centerNode,
          position: { x: centerX, y: centerY },
        });
      }

      // Position other nodes based on type
      newNodes.forEach((n: any) => {
        // Skip the node we already positioned at center
        if (centerNode && n.id === centerNode.id) return;

        let x = centerX;
        let y = centerY;

        if (n.type === "reference" || n.type === "task") {
          // Use exponential nautilus spiral
          const index =
            n.type === "reference"
              ? references.findIndex((r: any) => r.id === n.id)
              : tasks.findIndex((t: any) => t.id === n.id);

          const angle = index * angleStep;
          const radius = spiralStart * Math.exp(growthFactor * angle);

          x = centerX + radius * Math.cos(angle);
          y = centerY + radius * Math.sin(angle);
        } else if (n.type === "author") {
          // Authors on left
          const authorIndex = authors.findIndex((a: any) => a.id === n.id);
          x = centerX - 950;
          y = centerY + (authorIndex - authors.length / 2) * 150;
        } else if (n.type === "publisher") {
          // Publishers on right
          const publisherIndex = publishers.findIndex(
            (p: any) => p.id === n.id,
          );
          x = centerX + 950;
          y = centerY + (publisherIndex - publishers.length / 2) * 150;
        }

        positionedNodes.push({
          data: n,
          position: { x, y },
        });
      });

      // Add nodes to graph
      cy.add(positionedNodes);

      // Add edges
      const edges = newLinks.map((l: any) => ({ data: l }));
      cy.add(edges);

      // Fit view
      cy.fit(cy.elements(), 50);

      // CRITICAL: Update originalNodePositions with the NEW reframed positions
      // This makes the reframe layout the new "baseline" for dragging
      originalNodePositions.current = {};
      cy.nodes().forEach((node) => {
        originalNodePositions.current[node.id()] = { ...node.position() };
      });

      // Mark graph as reframed so useEffect doesn't rebuild it
      isReframedGraph.current = true;
      console.log("✅ Graph reframed - position tracking disabled");

      // Restart throbbing for all activated nodes after reframe
      restartAllThrobs(cy, activatedNodeIdsRef.current);

      toast({
        title: "Graph Reframed",
        description: `Showing ${newNodes.length} nodes related to ${selectedNodeData.label}`,
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Reframe error:", error);
      toast({
        title: "Reframe failed",
        description: "Could not fetch related nodes",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const centerTask = () => {
    const cy = cyInstance.current;
    if (!cy) return;
    const task = cy.nodes('[type = "task"]');
    if (task.length > 0) cy.center(task);
    else cy.center();
  };

  const resetGraph = () => {
    const cy = cyInstance.current;
    if (!cy) return;

    // Clear active ref tracker
    activeRefWithClaims.current = null;

    // Reset the reframed flag so graph can be rebuilt normally
    isReframedGraph.current = false;
    console.log(
      "🔄 Reset clicked - re-enabling graph rebuilds, will rebuild original nautilus",
    );

    // Remove all claim nodes and their edges
    cy.nodes('[type = "refClaim"], [type = "taskClaim"]').forEach((node) => {
      const interval = node.data("throbInterval");
      if (interval) clearInterval(interval);
      node.remove();
    });

    // Restore all original node positions IF we have them
    if (Object.keys(originalNodePositions.current).length > 0) {
      Object.entries(originalNodePositions.current).forEach(([id, pos]) => {
        const node = cy.getElementById(id);
        if (node.length > 0 && node.isNode()) {
          node.position(pos);
        }
      });
    }

    // Restore last ref node if it was moved
    if (lastRefNode.current && lastRefOriginalPos.current) {
      lastRefNode.current.position(lastRefOriginalPos.current);
      lastRefNode.current = null;
      lastRefOriginalPos.current = null;
    }

    // Show all nodes and edges
    cy.elements().style("display", "element");

    // Fit all
    cy.fit(cy.elements(), 28);

    // Restart throbbing for all activated nodes
    restartAllThrobs(cy, activatedNodeIdsRef.current);

    toast({
      title: "Graph Reset",
      description: "Returning to original nautilus layout",
      status: "info",
      duration: 2000,
      isClosable: true,
    });

    // Force a rebuild by incrementing forceRebuild, which will trigger the useEffect
    setForceRebuild((prev) => prev + 1);
  };

  return (
    <>
      {/* OUTER WRAPPER:
          - width "100%" so it aligns with your unified header container
          - no border/padding on mobile so it doesn't feel inset/overlap
       */}
      <Box
        pt={{ base: 0, md: 4 }}
        width={{ base: "100%", md: "calc(100vw - 300px)" }}
        ml={{ base: 0, md: "8px" }}
        mt={{ base: 0, md: -4 }}
        overflowX={{ base: "hidden", md: "visible" }}
      >
        <Box
          position="relative"
          height={{
            base: "calc(100dvh - var(--tt-header-h, 98px))",
            md: "80vh",
          }} // mobile matches header space via CSS var fallback
          width="100%"
          borderWidth={{ base: "0px", md: "1px" }}
          borderRadius={{ base: "0", md: "lg" }}
          p={{ base: 0, md: 4 }}
          bg={"stat2Gradient"}
          borderColor="gray.300"
          overflow="hidden"
          sx={{
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-x pan-y",
          }}
        >
          {/* Cytoscape container */}
          <div
            ref={cyRef}
            style={{
              width: "100%",
              height: "100%",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          />

          {/* Node Overlays - render NodeCard for all display modes */}
          {containerRect &&
            overlayNodes.map((node) => {
              return (
                <NodeCard
                  key={node.id()}
                  node={node}
                  containerRect={containerRect}
                  zoom={zoomLevel}
                  allNodes={nodes}
                  allLinks={links}
                  pinnedReferenceIds={pinnedReferenceIds}
                  onTogglePin={onTogglePin}
                  displayMode={displayMode}
                  nodeSettings={nodeSettings}
                  onCycleDisplayMode={(nodeId: string) => {
                    const modes: DisplayMode[] = [
                      "circles",
                      "compact",
                      "mr_cards",
                    ];
                    const currentMode =
                      nodeSettings?.[nodeId]?.displayMode || displayMode;
                    const currentIndex = modes.indexOf(currentMode);
                    const nextMode = modes[(currentIndex + 1) % modes.length];

                    const newSettings = {
                      ...(nodeSettings || {}),
                      [nodeId]: { displayMode: nextMode },
                    };
                    if (onNodeSettingsChange) {
                      onNodeSettingsChange(newSettings);
                    }
                  }}
                />
              );
            })}

          {/* Hovered Node Text Popup - Cleaner Minority Report Style */}
          {hoveredNodePopup && (
            <div
              style={{
                position: "absolute",
                left: `${hoveredNodePopup.x + 20}px`,
                top: `${hoveredNodePopup.y - 30}px`,
                background:
                  "linear-gradient(135deg, rgba(0, 0, 0, 0.92), rgba(15, 23, 42, 0.88))",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(0, 162, 255, 0.5)",
                borderRadius: "8px",
                padding: "10px 16px",
                color: "#e2e8f0",
                fontSize: "14px",
                fontWeight: "500",
                lineHeight: "1.3",
                maxWidth: "400px",
                textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
                boxShadow:
                  "0 4px 24px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 162, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
                pointerEvents: "none",
                zIndex: 2000,
                letterSpacing: "0.3px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {hoveredNodePopup.label}
            </div>
          )}

          {/* Centered Node Title Bar */}
          {selectedNodeData && (
            <Box
              position="absolute"
              top="16px"
              left="50%"
              transform="translateX(-50%)"
              zIndex={1000}
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              border="1px solid rgba(0, 162, 255, 0.4)"
              borderRadius="12px"
              px="24px"
              py="10px"
              boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 60px rgba(0, 162, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
              minW="300px"
              maxW="800px"
              sx={{ position: "relative", overflow: "hidden" }}
            >
              {/* 3D Left Edge Fade - matching node cards */}
              <Box
                position="absolute"
                left={0}
                top={0}
                width="20px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
                pointerEvents="none"
                zIndex={1}
              />
              <Box
                display="flex"
                flexDirection="column"
                gap={1}
                position="relative"
                zIndex={2}
              >
                <Box display="flex" alignItems="center" gap={3}>
                  <Text
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="2px"
                    fontWeight="600"
                    color="#00a2ff"
                    textShadow="0 0 8px rgba(0, 162, 255, 0.6)"
                    whiteSpace="nowrap"
                  >
                    {selectedNodeData.type === "task"
                      ? "CASE"
                      : selectedNodeData.type === "reference"
                        ? "SOURCE"
                        : selectedNodeData.type === "author"
                          ? "AUTHOR"
                          : selectedNodeData.type === "publisher"
                            ? "PUBLISHER"
                            : selectedNodeData.type === "refClaim"
                              ? "REF CLAIM"
                              : "TASK CLAIM"}
                  </Text>
                  <Box w="1px" h="16px" bg="rgba(0, 162, 255, 0.3)" />
                  {selectedNodeData.url ? (
                    <Text
                      as="a"
                      href={selectedNodeData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      fontSize="sm"
                      fontWeight="300"
                      color="#f1f5f9"
                      letterSpacing="0.5px"
                      lineHeight="1.3"
                      flex={1}
                      noOfLines={1}
                      cursor="pointer"
                      title={selectedNodeData.url}
                      _hover={{
                        color: "#00a2ff",
                        textDecoration: "underline",
                      }}
                    >
                      {selectedNodeData.label}
                    </Text>
                  ) : (
                    <Text
                      fontSize="sm"
                      fontWeight="300"
                      color="#f1f5f9"
                      letterSpacing="0.5px"
                      lineHeight="1.3"
                      flex={1}
                      noOfLines={1}
                    >
                      {selectedNodeData.label}
                    </Text>
                  )}
                  {/* Show rating if available */}
                  {selectedNodeData.rating != null &&
                    selectedNodeData.rating !== 0 && (
                      <>
                        <Box w="1px" h="16px" bg="rgba(0, 162, 255, 0.3)" />
                        <Text
                          fontSize="xs"
                          fontWeight="600"
                          color={
                            selectedNodeData.rating > 0 ? "#4ade80" : "#f87171"
                          }
                          textShadow={`0 0 8px ${selectedNodeData.rating > 0 ? "rgba(74, 222, 128, 0.6)" : "rgba(248, 113, 113, 0.6)"}`}
                          whiteSpace="nowrap"
                        >
                          ⭐{" "}
                          {typeof selectedNodeData.rating === "number"
                            ? selectedNodeData.rating.toFixed(1)
                            : selectedNodeData.rating}
                        </Text>
                      </>
                    )}
                </Box>
                {/* Additional details for references */}
                {selectedNodeData.type === "reference" &&
                  selectedNodeData.url && (
                    <Text fontSize="xs" color="#94a3b8" noOfLines={1}>
                      🔗 {selectedNodeData.url}
                    </Text>
                  )}
              </Box>
            </Box>
          )}

          {/* Controls HUD (top-right). No listener changes, pure actions. */}
          {showMobileHUD ? (
            <Box
              display="block"
              position="absolute"
              right="16px"
              top="16px"
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              color="#e2e8f0"
              borderRadius="12px"
              p="20px"
              zIndex={99}
              border="1px solid rgba(0, 162, 255, 0.4)"
              boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
              width="200px"
              sx={{ overflow: "hidden" }}
            >
              {/* 3D Left Edge Fade - matching node cards */}
              <Box
                position="absolute"
                left={0}
                top={0}
                width="20px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
                pointerEvents="none"
                zIndex={1}
              />
              <CloseButton
                size="sm"
                onClick={() => setShowMobileHUD(false)}
                position="absolute"
                top="6px"
                right="6px"
                color="#00a2ff"
                _hover={{ bg: "rgba(0, 162, 255, 0.2)" }}
                zIndex={2}
              />
              <Text
                fontSize="xs"
                mb={3}
                textTransform="uppercase"
                letterSpacing="2px"
                fontWeight="300"
                color="#00a2ff"
                textShadow="0 0 8px rgba(0, 162, 255, 0.6)"
                position="relative"
                zIndex={2}
              >
                Controls
              </Text>
              <Button
                size="xs"
                onClick={reframe}
                mb={2}
                width="100%"
                bg="rgba(0, 162, 255, 0.1)"
                backdropFilter="blur(10px)"
                border="1px solid rgba(0, 162, 255, 0.3)"
                color="#00a2ff"
                _hover={{
                  bg: "rgba(0, 162, 255, 0.2)",
                  borderColor: "#00a2ff",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                }}
                fontWeight="300"
                textTransform="uppercase"
                letterSpacing="1px"
                fontSize="xs"
                position="relative"
                zIndex={2}
                isDisabled={
                  !selectedNodeData || selectedNodeData.type === "unifiedClaim"
                }
                opacity={
                  !selectedNodeData || selectedNodeData.type === "unifiedClaim"
                    ? 0.5
                    : 1
                }
              >
                ⊙ Reframe
              </Button>
              <Button
                size="xs"
                onClick={resetGraph}
                mb={2}
                width="100%"
                bg="rgba(34, 197, 94, 0.1)"
                backdropFilter="blur(10px)"
                border="1px solid rgba(34, 197, 94, 0.3)"
                color="#4ade80"
                _hover={{
                  bg: "rgba(34, 197, 94, 0.2)",
                  borderColor: "#4ade80",
                  boxShadow: "0 0 20px rgba(34, 197, 94, 0.3)",
                }}
                fontWeight="300"
                textTransform="uppercase"
                letterSpacing="1px"
                fontSize="xs"
                position="relative"
                zIndex={2}
              >
                ⟲ Reset
              </Button>
              <Button
                size="xs"
                onClick={centerTask}
                width="100%"
                bg="rgba(0, 162, 255, 0.1)"
                backdropFilter="blur(10px)"
                border="1px solid rgba(0, 162, 255, 0.3)"
                color="#00a2ff"
                _hover={{
                  bg: "rgba(0, 162, 255, 0.2)",
                  borderColor: "#00a2ff",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                }}
                fontWeight="300"
                textTransform="uppercase"
                letterSpacing="1px"
                fontSize="xs"
                position="relative"
                zIndex={2}
              >
                ⊕ Center
              </Button>
            </Box>
          ) : (
            <Button
              display="inline-flex"
              position="absolute"
              right="16px"
              top="16px"
              size="xs"
              onClick={() => setShowMobileHUD(true)}
              zIndex={1000}
              bg={
                colorMode === "dark"
                  ? "rgba(0, 162, 255, 0.1)"
                  : "rgba(248, 250, 252, 0.9)"
              }
              backdropFilter="blur(10px)"
              border="1px solid"
              borderColor={
                colorMode === "dark"
                  ? "rgba(0, 162, 255, 0.3)"
                  : "rgba(71, 85, 105, 0.3)"
              }
              color={colorMode === "dark" ? "#00a2ff" : "#475569"}
              _hover={
                colorMode === "dark"
                  ? {
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                    }
                  : {
                      bg: "rgba(241, 245, 249, 1)",
                      borderColor: "#475569",
                      boxShadow: "0 2px 8px rgba(71, 85, 105, 0.2)",
                    }
              }
            >
              Show Controls
            </Button>
          )}

          {/* LEGEND — visible by default on desktop */}
          {showLegend ? (
            <Box
              display="block"
              position="absolute"
              left="16px"
              top="16px"
              background={
                colorMode === "dark"
                  ? "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
                  : "linear-gradient(135deg, rgba(100, 116, 139, 0.25) 0%, rgba(148, 163, 184, 0.3) 50%, rgba(71, 85, 105, 0.25) 100%)"
              }
              backdropFilter="blur(20px)"
              color={colorMode === "dark" ? "#e2e8f0" : "#1e293b"}
              borderRadius="12px"
              p="20px"
              zIndex={1000}
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
              width="200px"
              sx={{ overflow: "hidden" }}
            >
              {/* 3D Left Edge Fade - matching node cards */}
              <Box
                position="absolute"
                left={0}
                top={0}
                width="20px"
                height="100%"
                background={
                  colorMode === "dark"
                    ? "linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
                    : "linear-gradient(90deg, rgba(71, 85, 105, 0.3) 0%, rgba(71, 85, 105, 0) 100%)"
                }
                pointerEvents="none"
                zIndex={1}
              />
              <CloseButton
                size="sm"
                onClick={() => setShowLegend(false)}
                position="absolute"
                top="6px"
                right="6px"
                color={colorMode === "dark" ? "#00a2ff" : "#475569"}
                _hover={{
                  bg:
                    colorMode === "dark"
                      ? "rgba(0, 162, 255, 0.2)"
                      : "rgba(71, 85, 105, 0.15)",
                }}
                zIndex={2}
              />
              <Text
                fontSize="xs"
                mb={3}
                textTransform="uppercase"
                letterSpacing="2px"
                fontWeight="300"
                color={colorMode === "dark" ? "#00a2ff" : "#475569"}
                textShadow={
                  colorMode === "dark"
                    ? "0 0 8px rgba(0, 162, 255, 0.6)"
                    : "none"
                }
                position="relative"
                zIndex={2}
              >
                Legend {highlightedType && "(Filtering)"}
              </Text>
              <Box
                fontSize="xs"
                lineHeight="1.6"
                color={colorMode === "dark" ? "#cbd5e1" : "#475569"}
                position="relative"
                zIndex={2}
              >
                <Box
                  display="flex"
                  alignItems="center"
                  mb={2}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "task" ? null : "task",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "task" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="12px"
                    h="12px"
                    bg="#6365f1"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(99, 102, 241, 0.4)"
                  />
                  <Text fontSize="10px">
                    Case {highlightedType === "task" && "✓"}
                  </Text>
                </Box>
                <Box
                  display="flex"
                  alignItems="center"
                  mb={2}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "reference" ? null : "reference",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "reference" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="12px"
                    h="12px"
                    bg="#10b981"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(16, 185, 129, 0.4)"
                  />
                  <Text fontSize="10px">
                    Source {highlightedType === "reference" && "✓"}
                  </Text>
                </Box>
                <Box
                  display="flex"
                  alignItems="center"
                  mb={2}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "taskClaim" ? null : "taskClaim",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "taskClaim" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="0"
                    h="0"
                    borderTop="5px solid transparent"
                    borderBottom="5px solid transparent"
                    borderLeft="8px solid #f59e0b"
                    mr={2}
                    filter="drop-shadow(0 0 4px rgba(245, 158, 11, 0.4))"
                  />
                  <Text fontSize="10px">
                    Case Claim {highlightedType === "taskClaim" && "✓"}
                  </Text>
                </Box>
                <Box
                  display="flex"
                  alignItems="center"
                  mb={2}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "refClaim" ? null : "refClaim",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "refClaim" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="0"
                    h="0"
                    borderTop="5px solid transparent"
                    borderBottom="5px solid transparent"
                    borderRight="8px solid #ec4899"
                    mr={2}
                    filter="drop-shadow(0 0 4px rgba(236, 72, 153, 0.4))"
                  />
                  <Text fontSize="10px">
                    Source Claim {highlightedType === "refClaim" && "✓"}
                  </Text>
                </Box>
                <Box
                  display="flex"
                  alignItems="center"
                  mb={2}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "author" ? null : "author",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "author" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="12px"
                    h="12px"
                    bg="#fbb1a0"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(251, 177, 160, 0.4)"
                  />
                  <Text fontSize="10px">
                    Author {highlightedType === "author" && "✓"}
                  </Text>
                </Box>
                <Box
                  display="flex"
                  alignItems="center"
                  mb={3}
                  cursor="pointer"
                  onClick={() =>
                    setHighlightedType(
                      highlightedType === "publisher" ? null : "publisher",
                    )
                  }
                  opacity={
                    highlightedType && highlightedType !== "publisher" ? 0.4 : 1
                  }
                  transition="opacity 0.2s"
                  _hover={{ opacity: 1 }}
                >
                  <Box
                    w="12px"
                    h="12px"
                    bg="#81ecec"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(129, 236, 236, 0.4)"
                  />
                  <Text fontSize="10px">
                    Publisher {highlightedType === "publisher" && "✓"}
                  </Text>
                </Box>
                <Box
                  pt={3}
                  borderTop="1px solid rgba(100, 116, 139, 0.2)"
                  fontSize="9px"
                  color="#64748b"
                  letterSpacing="0.5px"
                >
                  SHIFT + SCROLL to ZOOM
                </Box>
              </Box>
            </Box>
          ) : (
            <Button
              display="inline-flex"
              position="absolute"
              left="16px"
              top="16px"
              size="xs"
              onClick={() => setShowLegend(true)}
              zIndex={1000}
              bg={
                colorMode === "dark"
                  ? "rgba(0, 162, 255, 0.1)"
                  : "rgba(248, 250, 252, 0.9)"
              }
              backdropFilter="blur(10px)"
              border="1px solid"
              borderColor={
                colorMode === "dark"
                  ? "rgba(0, 162, 255, 0.3)"
                  : "rgba(71, 85, 105, 0.3)"
              }
              color={colorMode === "dark" ? "#00a2ff" : "#475569"}
              _hover={
                colorMode === "dark"
                  ? {
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                    }
                  : {
                      bg: "rgba(241, 245, 249, 1)",
                      borderColor: "#475569",
                      boxShadow: "0 2px 8px rgba(71, 85, 105, 0.2)",
                    }
              }
            >
              Show Legend
            </Button>
          )}
        </Box>
      </Box>

      {selectedClaim &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#222",
              color: "#fff",
              padding: "1rem",
              borderRadius: 12,
              boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              zIndex: 1000,

              // ✅ Mobile-safe sizing
              width: "min(92vw, 520px)",
              maxHeight: "min(78vh, 560px)",
              overflowY: "auto",

              // ✅ Text wrapping & safe areas
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <h3
              style={{
                fontSize: "1.1rem",
                lineHeight: 1.2,
                marginBottom: "12px",
                color: "#00a2ff",
              }}
            >
              Source Claim{" "}
              {selectedClaim.relation === "supports"
                ? "✅ SUPPORTS"
                : selectedClaim.relation === "refutes"
                  ? "❌ REFUTES"
                  : "RELATES TO"}{" "}
              Task Claim
            </h3>

            <div style={{ marginBottom: "16px" }}>
              <strong style={{ color: "#10b981", fontSize: "0.85rem" }}>
                REF CLAIM:
              </strong>
              <p
                style={{
                  marginTop: 6,
                  fontSize: "0.95rem",
                  lineHeight: 1.35,
                  color: "#f1f5f9",
                }}
              >
                {selectedClaim.label}
              </p>
            </div>

            {selectedClaim.taskClaimLabel && (
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ color: "#6366f1", fontSize: "0.85rem" }}>
                  TASK CLAIM:
                </strong>
                <p
                  style={{
                    marginTop: 6,
                    fontSize: "0.95rem",
                    lineHeight: 1.35,
                    color: "#f1f5f9",
                  }}
                >
                  {selectedClaim.taskClaimLabel}
                </p>
              </div>
            )}

            {selectedClaim.notes && (
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ color: "#fbbf24", fontSize: "0.85rem" }}>
                  NOTES:
                </strong>
                <p
                  style={{
                    marginTop: 6,
                    fontSize: "0.9rem",
                    lineHeight: 1.3,
                    color: "#d1d5db",
                    fontStyle: "italic",
                  }}
                >
                  {selectedClaim.notes}
                </p>
              </div>
            )}

            <button
              onClick={() => setSelectedClaim(null)}
              style={{
                marginTop: 16,
                background:
                  "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.2))",
                border: "1px solid rgba(0, 162, 255, 0.6)",
                color: "#00a2ff",
                padding: "0.6em 1em",
                borderRadius: 8,
                width: "100%",
                fontSize: "0.95rem",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              CLOSE
            </button>
          </div>,
          document.body,
        )}
      {hoveredEdgeTooltip &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: hoveredEdgeTooltip.y + 10,
              left: hoveredEdgeTooltip.x + 10,
              background: "#333",
              color: "#fff",
              padding: "0.5em 1em",
              borderRadius: 6,
              fontSize: "0.85em",
              pointerEvents: "none",
              zIndex: 1000,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
            }}
          >
            {hoveredEdgeTooltip.label}
          </div>,
          document.body,
        )}

      {selectedEdge &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#222",
              color: "#fff",
              padding: "1rem",
              borderRadius: 12,
              boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              zIndex: 1000,

              // ✅ Mobile-safe sizing
              width: "min(92vw, 560px)",
              maxHeight: "min(78vh, 640px)",
              overflowY: "auto",

              // ✅ Text wrapping & safe areas
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <h3
              style={{
                marginBottom: "0.5em",
                fontSize: "1rem",
                lineHeight: 1.2,
              }}
            >
              {selectedEdge.relation === "supports"
                ? "✅ Supports"
                : selectedEdge.relation === "refutes"
                  ? "❌ Refutes"
                  : "↔️ Related"}{" "}
              ({Math.round(Math.abs(selectedEdge.value) * 100)}% confidence)
            </h3>
            <p>
              <strong>From:</strong> {selectedEdge.sourceLabel}
            </p>
            <p>
              <strong>To:</strong> {selectedEdge.targetLabel}
            </p>
            <p style={{ marginTop: "1em" }}>
              <strong>Notes:</strong>
            </p>
            <p>{selectedEdge.notes || "—"}</p>
            <button
              onClick={() => setSelectedEdge(null)}
              style={{
                marginTop: 16,
                background: "#6c5ce7",
                color: "#fff",
                padding: "0.6em 1em",
                borderRadius: 8,
                width: "100%", // 🔹 Easy tap target on mobile
                fontSize: "0.95rem",
              }}
            >
              Close
            </button>
          </div>,
          document.body,
        )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};

export default CytoscapeMolecule;
