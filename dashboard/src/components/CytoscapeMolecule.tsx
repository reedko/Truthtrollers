// Updated CytoscapeMolecule.tsx — RefClaims and TaskClaims now arc with visual clarity,
// central focus is on the lines between the arcs, and taskClaim arcs align with ref arcs
// Implements edge convergence halfway between claim groups and main nodes

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, Button, Text, useToast, CloseButton } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

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

// Minority Report Glassmorphic Card Overlay Component
interface NodeCardProps {
  node: cytoscape.NodeSingular;
  containerRect: DOMRect;
  zoom: number;
  allNodes: NodeData[];
  allLinks?: any[]; // For finding rationale
  pinnedReferenceIds?: Set<number>;
  onTogglePin?: (contentId: number) => void;
  displayMode?: DisplayMode;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onCycleDisplayMode?: (nodeId: string) => void;
}

const NodeCard: React.FC<NodeCardProps> = ({
  node,
  containerRect,
  zoom,
  allNodes,
  allLinks,
  pinnedReferenceIds,
  onTogglePin,
  displayMode: globalDisplayMode = 'mr_cards',
  nodeSettings,
  onCycleDisplayMode,
}) => {
  const pos = node.renderedPosition();
  const data = node.data();
  const type = data.type;
  const id = node.id();

  // Check if this reference is pinned
  const isPinned =
    type === "reference" &&
    data.content_id &&
    pinnedReferenceIds?.has(data.content_id);

  // Check if this node is dimmed (unpinned)
  const isDimmed = data.dimmed;

  // Find rationale from links (for refClaim nodes) - mapped from claim_links.notes
  const linkData = allLinks?.find((link: any) => link.source === id || link.target === id);
  const rationale = linkData?.rationale;
  const stance = linkData?.stance;
  const [showRationale, setShowRationale] = React.useState(false);

  // Determine display mode for THIS node - use node-specific setting or fall back to global
  const displayMode = nodeSettings?.[id]?.displayMode || globalDisplayMode;
  const currentDisplayMode = displayMode; // Store for button labels to avoid type narrowing

  // Color schemes for different node types (used by all modes)
  const colorSchemes = {
    task: {
      bg: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.05))",
      border: "rgba(99, 102, 241, 0.25)",
      text: "#a5b4fc",
      glow: "0 0 20px rgba(99, 102, 241, 0.2)",
      titleBg: "rgba(99, 102, 241, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 100%)",
    },
    reference: {
      bg: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.05))",
      border: "rgba(16, 185, 129, 0.25)",
      text: "#6ee7b7",
      glow: "0 0 20px rgba(16, 185, 129, 0.2)",
      titleBg: "rgba(16, 185, 129, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0) 100%)",
    },
    unifiedClaim: {
      bg: "linear-gradient(135deg, rgba(249, 115, 22, 0.06), rgba(234, 88, 12, 0.04))",
      border: "rgba(249, 115, 22, 0.2)",
      text: "#fed7aa",
      glow: "0 0 15px rgba(249, 115, 22, 0.15)",
      titleBg: "rgba(249, 115, 22, 0.12)",
      leftEdge:
        "linear-gradient(90deg, rgba(249, 115, 22, 0.3) 0%, rgba(249, 115, 22, 0) 100%)",
    },
    refClaim: {
      bg: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.05))",
      border: "rgba(16, 185, 129, 0.25)",
      text: "#6ee7b7",
      glow: "0 0 20px rgba(16, 185, 129, 0.2)",
      titleBg: "rgba(16, 185, 129, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(16, 185, 129, 0.4) 0%, rgba(16, 185, 129, 0) 100%)",
    },
    taskClaim: {
      bg: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.05))",
      border: "rgba(99, 102, 241, 0.25)",
      text: "#a5b4fc",
      glow: "0 0 20px rgba(99, 102, 241, 0.2)",
      titleBg: "rgba(99, 102, 241, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 100%)",
    },
    author: {
      bg: "linear-gradient(135deg, rgba(251, 177, 160, 0.08), rgba(254, 215, 170, 0.05))",
      border: "rgba(251, 177, 160, 0.25)",
      text: "#fecaca",
      glow: "0 0 20px rgba(251, 177, 160, 0.2)",
      titleBg: "rgba(251, 177, 160, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(251, 177, 160, 0.4) 0%, rgba(251, 177, 160, 0) 100%)",
    },
    publisher: {
      bg: "linear-gradient(135deg, rgba(129, 236, 236, 0.08), rgba(103, 232, 249, 0.05))",
      border: "rgba(129, 236, 236, 0.25)",
      text: "#a5f3fc",
      glow: "0 0 20px rgba(129, 236, 236, 0.2)",
      titleBg: "rgba(129, 236, 236, 0.15)",
      leftEdge:
        "linear-gradient(90deg, rgba(129, 236, 236, 0.4) 0%, rgba(129, 236, 236, 0) 100%)",
    },
  };

  // CIRCLES MODE - clean circles with overlay badges
  if (displayMode === 'circles') {
    const veracityScore = data.veracity_score ?? data.rating;
    const claimCount = data.claimCount;
    const confidence = data.confidence_level;

    return (
      <>
        {/* Rationale tooltip (shown on hover) */}
        {showRationale && rationale && (
          <div
            style={{
              position: "absolute",
              left: `${pos.x - 100}px`,
              top: `${pos.y - 100}px`,
              width: "200px",
              background: "rgba(15, 23, 42, 0.98)",
              backdropFilter: "blur(12px)",
              border: "2px solid rgba(139, 92, 246, 0.5)",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "11px",
              lineHeight: "1.5",
              color: "#e2e8f0",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.8), 0 0 20px rgba(139, 92, 246, 0.3)",
              pointerEvents: "none",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              zIndex: 1000,
            }}
          >
            <div style={{ fontSize: "10px", fontWeight: "700", color: "#a78bfa", marginBottom: "6px" }}>
              {stance?.toUpperCase()} - RATIONALE:
            </div>
            {rationale}
          </div>
        )}

        {/* Info icon for rationale/notes (if available) */}
        {rationale && (
          <div
            onMouseEnter={() => setShowRationale(true)}
            onMouseLeave={() => setShowRationale(false)}
            style={{
              position: "absolute",
              left: `${pos.x - 65}px`,
              top: `${pos.y + 35}px`,
              background: "rgba(139, 92, 246, 0.3)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(139, 92, 246, 0.5)",
              borderRadius: "50%",
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              cursor: "help",
              pointerEvents: "auto",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              color: "#a78bfa",
            }}
            title="View AI Rationale"
          >
            ℹ️
          </div>
        )}

        {/* Veracity badge - top-right */}
        {veracityScore !== undefined && veracityScore !== null && (
          <div
            style={{
              position: "absolute",
              left: `${pos.x + 45}px`,
              top: `${pos.y - 55}px`,
              background: "rgba(15, 23, 42, 0.95)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(139, 92, 246, 0.4)",
              borderRadius: "8px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: "700",
              color: "#a78bfa",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.6), 0 0 12px rgba(139, 92, 246, 0.2)",
              pointerEvents: "none",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              opacity: isDimmed ? 0.4 : 1.0,
            }}
            title="Veracity Score"
          >
            ⭐ {typeof veracityScore === 'number' ? veracityScore.toFixed(1) : veracityScore}
          </div>
        )}

        {/* Claim count badge - bottom-right (or confidence for claim nodes) */}
        {(claimCount !== undefined && claimCount !== null && claimCount > 0) || (confidence !== undefined && confidence !== null) ? (
          <div
            style={{
              position: "absolute",
              left: `${pos.x + 45}px`,
              top: `${pos.y + 35}px`,
              background: "rgba(15, 23, 42, 0.95)",
              backdropFilter: "blur(8px)",
              border: confidence ? "1px solid rgba(251, 191, 36, 0.4)" : "1px solid rgba(16, 185, 129, 0.4)",
              borderRadius: "8px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: "700",
              color: confidence ? "#fbbf24" : "#6ee7b7",
              boxShadow: confidence
                ? "0 2px 8px rgba(0, 0, 0, 0.6), 0 0 12px rgba(251, 191, 36, 0.2)"
                : "0 2px 8px rgba(0, 0, 0, 0.6), 0 0 12px rgba(16, 185, 129, 0.2)",
              pointerEvents: "none",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              opacity: isDimmed ? 0.4 : 1.0,
            }}
            title={confidence ? "Confidence Level" : "Claim Count"}
          >
            {confidence ? `🎯 ${Math.round(confidence * 100)}%` : `📝 ${claimCount}`}
          </div>
        ) : null}

        {/* Pin button for references */}
        {type === "reference" && onTogglePin && data.content_id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(data.content_id);
            }}
            style={{
              position: "absolute",
              left: `${pos.x - 65}px`,
              top: `${pos.y - 55}px`,
              background: isPinned
                ? "rgba(251, 191, 36, 0.3)"
                : "rgba(100, 116, 139, 0.3)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(100, 116, 139, 0.4)",
              borderRadius: "8px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "14px",
              pointerEvents: "auto",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
            }}
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
        )}

        {/* Display mode cycle button */}
        {onCycleDisplayMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCycleDisplayMode(id);
            }}
            style={{
              position: "absolute",
              left: `${pos.x - 65}px`,
              top: `${pos.y}px`,
              background: "rgba(99, 102, 241, 0.3)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(99, 102, 241, 0.5)",
              borderRadius: "50%",
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: "10px",
              pointerEvents: "auto",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              color: "#a5b4fc",
            }}
            title="Cycle display mode"
          >
            {currentDisplayMode === 'circles' ? '⚪' : currentDisplayMode === 'compact' ? '📊' : '🎴'}
          </button>
        )}
      </>
    );
  }

  // COMPACT MODE - smaller cards with just metrics
  if (displayMode === 'compact') {
    const scheme =
      colorSchemes[type as keyof typeof colorSchemes] || colorSchemes.reference;

    // Get metrics
    const getCompactMetrics = () => {
      if (type === "reference" || type === "task") {
        const veracityScore = data.veracity_score ?? data.rating;
        const claimCount = data.claimCount ?? allNodes.filter(
          (n) => (type === "reference" ? n.type === "refClaim" : n.type === "taskClaim") && n.content_id === data.content_id,
        ).length;
        return [
          { value: typeof veracityScore === 'number' ? veracityScore.toFixed(1) : (veracityScore ?? "-"), label: "⭐" },
          { value: claimCount, label: "📝" },
        ];
      } else if (type === "refClaim" || type === "taskClaim") {
        const veracityScore = data.veracity_score;
        const confidence = data.confidence_level;
        return [
          { value: veracityScore ? veracityScore.toFixed(2) : "-", label: "⭐" },
          { value: confidence ? Math.round(confidence * 100) + "%" : "-", label: "🎯" },
        ];
      } else if (type === "author" || type === "publisher") {
        const rating = data.rating ?? "-";
        return [{ value: typeof rating === 'number' ? rating.toFixed(1) : rating, label: "⭐" }];
      }
      return [];
    };

    const metrics = getCompactMetrics();

    return (
      <div
        style={{
          position: "absolute",
          left: `${pos.x - 60}px`,
          top: `${pos.y - 70}px`,
          width: "120px",
          height: "140px",
          background: scheme.bg,
          backdropFilter: "blur(6px)",
          border: `1.5px solid ${scheme.border}`,
          borderRadius: "10px",
          boxShadow: `${scheme.glow}, 0 4px 16px rgba(0, 0, 0, 0.3)`,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
          opacity: isDimmed ? 0.4 : 1.0, // Dim compact cards
        }}
      >
        {/* Type badge */}
        <div
          style={{
            fontSize: "9px",
            color: scheme.text,
            textTransform: "uppercase",
            letterSpacing: "1px",
            marginBottom: "4px",
            fontWeight: "600",
            opacity: 0.7,
          }}
        >
          {type === "refClaim" ? "Ref" : type === "taskClaim" ? "Task" : type}
        </div>

        {/* Label */}
        <div
          style={{
            color: scheme.text,
            fontSize: "12px",
            fontWeight: "600",
            textAlign: "center",
            lineHeight: "1.2",
            marginBottom: "8px",
            maxHeight: "48px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          {data.label}
        </div>

        {/* Metrics */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "auto",
          }}
        >
          {metrics.map((metric, idx) => (
            <div
              key={idx}
              style={{
                textAlign: "center",
                fontSize: "16px",
                fontWeight: "600",
                color: scheme.text,
              }}
            >
              <div>{metric.label}</div>
              <div style={{ fontSize: "12px", marginTop: "2px" }}>{metric.value}</div>
            </div>
          ))}
        </div>

        {/* Pin button for references */}
        {type === "reference" && onTogglePin && data.content_id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(data.content_id);
            }}
            style={{
              position: "absolute",
              top: "4px",
              right: "4px",
              background: isPinned
                ? "rgba(251, 191, 36, 0.3)"
                : "rgba(100, 116, 139, 0.3)",
              border: "none",
              borderRadius: "4px",
              padding: "2px 4px",
              cursor: "pointer",
              fontSize: "12px",
              pointerEvents: "auto",
            }}
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
        )}

        {/* Display mode cycle button */}
        {onCycleDisplayMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCycleDisplayMode(id);
            }}
            style={{
              position: "absolute",
              top: "4px",
              left: "4px",
              background: "rgba(99, 102, 241, 0.3)",
              border: "1px solid rgba(99, 102, 241, 0.5)",
              borderRadius: "4px",
              padding: "2px 4px",
              cursor: "pointer",
              fontSize: "10px",
              pointerEvents: "auto",
              color: scheme.text,
            }}
            title="Cycle display mode"
          >
            {currentDisplayMode === 'circles' ? '⚪' : currentDisplayMode === 'compact' ? '📊' : '🎴'}
          </button>
        )}
      </div>
    );
  }

  // MR_CARDS MODE - full Minority Report cards (original implementation)

  let scheme =
    colorSchemes[type as keyof typeof colorSchemes] || colorSchemes.reference;

  // Get thumbnail URL (needed for all card types including unifiedClaim)
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
  const group =
    type === "author"
      ? 1
      : type === "task" || type === "reference"
        ? 2
        : type === "publisher"
          ? 3
          : 0;
  // Use new API endpoint that auto-detects image extension
  let thumbnailUrl;
  if (type === "author") {
    const authorId = data.author_id || id.replace("autho-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/authors/${authorId}`;
  } else if (type === "task" || type === "reference") {
    const contentId = data.content_id || id.replace("conte-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/content/${contentId}`;
  } else if (type === "publisher") {
    const publisherId = data.publisher_id || id.replace("publi-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/publishers/${publisherId}`;
  } else {
    thumbnailUrl = `${API_BASE_URL}/assets/images/ttlogo11.png`;
  }

  console.log(`🎴 NodeCard ${id} (${type}): author_id=${data.author_id}, publisher_id=${data.publisher_id}, content_id=${data.content_id}, thumbnailUrl=${thumbnailUrl}`);

  // Special handling for unified claim cards
  if (type === "unifiedClaim") {
    const relation = data.relation || "related";
    const refClaimText = data.refClaimLabel || "";
    const taskClaimText = data.taskClaimLabel || "";

    return (
      <div
        style={{
          position: "absolute",
          left: `${pos.x - 130}px`,
          top: `${pos.y - 160}px`,
          width: "260px",
          height: "320px",
          background: scheme.bg,
          backdropFilter: "blur(6px)",
          border: `1.5px solid ${scheme.border}`,
          borderRadius: "16px",
          boxShadow: `${scheme.glow}, 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
          pointerEvents: "none",
          transition: "all 0.3s ease",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        {/* Background watermark thumbnail - reduced size */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "60%",
            height: "60%",
            backgroundImage: `url(${thumbnailUrl})`,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            opacity: 0.08,
            zIndex: 0,
          }}
        />

        {/* 3D Left Edge Fade */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "20px",
            height: "100%",
            background: scheme.leftEdge,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        {/* Content container */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "8px",
          }}
        >
          {/* Ref Claim (top) */}
          <div
            style={{
              flex: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px",
              background: "rgba(16, 185, 129, 0.1)",
              borderRadius: "8px",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                color: "#6ee7b7",
                fontSize: "32px",
                fontWeight: "600",
                lineHeight: "1.4",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textShadow: `0 0 6px rgba(110, 231, 183, 0.4), 0 1px 2px rgba(0, 0, 0, 0.8)`,
              }}
            >
              {refClaimText}
            </div>
          </div>

          {/* Relation (middle) */}
          <div
            style={{
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                relation === "supports"
                  ? "rgba(16, 185, 129, 0.2)"
                  : relation === "refutes"
                    ? "rgba(239, 68, 68, 0.2)"
                    : "rgba(251, 191, 36, 0.2)",
              borderRadius: "8px",
              marginBottom: "6px",
            }}
          >
            <span
              style={{
                fontSize: "35px",
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: "3px",
                color:
                  relation === "supports"
                    ? "#10b981"
                    : relation === "refutes"
                      ? "#ef4444"
                      : "#fbbf24",
                textShadow: `0 0 10px ${
                  relation === "supports"
                    ? "rgba(16, 185, 129, 0.6)"
                    : relation === "refutes"
                      ? "rgba(239, 68, 68, 0.6)"
                      : "rgba(251, 191, 36, 0.6)"
                }`,
              }}
            >
              {relation === "supports"
                ? "✅ SUPPORTS"
                : relation === "refutes"
                  ? "❌ REFUTES"
                  : "RELATED"}
            </span>
          </div>

          {/* Task Claim (bottom) */}
          <div
            style={{
              flex: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px",
              background: "rgba(99, 102, 241, 0.1)",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                color: "#a5b4fc",
                fontSize: "32px",
                fontWeight: "600",
                lineHeight: "1.4",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textShadow: `0 0 6px rgba(165, 180, 252, 0.4), 0 1px 2px rgba(0, 0, 0, 0.8)`,
              }}
            >
              {taskClaimText}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Format type name for title bar
  const typeLabel =
    type === "refClaim"
      ? "Ref Claim"
      : type === "taskClaim"
        ? "Task Claim"
        : type.charAt(0).toUpperCase() + type.slice(1);

  // Get metrics based on node type
  const getMetrics = (): Array<{ value: string | number; label: string }> => {
    if (type === "reference") {
      const rating = data.rating ?? "-";
      const contentId = data.content_id;
      // Count refClaims from original data by matching content_id
      const claimCount = allNodes.filter(
        (n) => n.type === "refClaim" && n.content_id === contentId,
      ).length;
      return [
        { value: rating, label: "Rating" },
        { value: claimCount, label: "Claims" },
      ];
    } else if (type === "task") {
      // Count taskClaims from original data
      const claimCount = allNodes.filter((n) => n.type === "taskClaim").length;
      // Count reference nodes from original data
      const refCount = allNodes.filter((n) => n.type === "reference").length;
      return [
        { value: claimCount, label: "Claims" },
        { value: refCount, label: "Refs" },
      ];
    } else if (type === "author" || type === "publisher") {
      const rating = data.rating ?? "-";
      return [{ value: rating, label: "Rating" }];
    } else if (type === "refClaim" || type === "taskClaim") {
      // For claims, could show relation type or confidence
      return [];
    }
    return [];
  };

  return (
    <div
      style={{
        position: "absolute",
        left: `${pos.x - 100}px`,
        top: `${pos.y - 120}px`,
        width: "200px",
        height: "240px",
        background: scheme.bg,
        backdropFilter: "blur(6px)",
        border: `1.5px solid ${scheme.border}`,
        borderRadius: "16px",
        boxShadow: `${scheme.glow}, 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        pointerEvents: "none",
        transition: "all 0.3s ease",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        opacity: isDimmed ? 0.4 : 1.0, // Dim MR cards
        transform: `scale(${zoom})`,
        transformOrigin: "center center",
      }}
    >
      {/* 3D Left Edge Fade */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "20px",
          height: "100%",
          background: scheme.leftEdge,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Transparent Title Bar */}
      <div
        style={{
          background: scheme.titleBg,
          backdropFilter: "blur(5px)",
          padding: "2px 4px",
          borderTopLeftRadius: "14px",
          borderTopRightRadius: "14px",
          borderBottom: `1px solid ${scheme.border}`,
        }}
      >
        <div
          style={{
            color: scheme.text,
            fontSize: "27px",
            fontWeight: "700",
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: "2px",
            textShadow: `0 0 8px ${scheme.text}60, 0 1px 2px rgba(0, 0, 0, 0.9)`,
          }}
        >
          {typeLabel}
        </div>
      </div>

      {/* Content area - image + text */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {/* Thumbnail Area - scrolls out of frame */}
        <div
          style={{
            height: "100px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "0",
            position: "relative",
            zIndex: 0,
          }}
        >
          <img
            src={thumbnailUrl}
            alt={data.label}
            style={{
              maxWidth: "60%",
              maxHeight: "100%",
              objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))",
              opacity: 0.9,
            }}
            onError={(e) => {
              // Fallback to placeholder if image fails to load
              e.currentTarget.style.display = "none";
            }}
          />
        </div>

        {/* Label Text */}
        <div
          style={{
            padding: "5px 8px",
            color: scheme.text,
            fontSize: "30px",
            fontWeight: "600",
            textAlign: "center",
            lineHeight: "1.3",
            textShadow: `0 0 6px ${scheme.text}40, 0 1px 2px rgba(0, 0, 0, 0.8)`,
          }}
        >
          {data.label}
        </div>
      </div>

      {/* Metrics Footer */}
      <div
        style={{
          background: scheme.titleBg,
          backdropFilter: "blur(5px)",
          padding: "4px 2px",
          borderTop: `1px solid ${scheme.border}`,
          borderBottomLeftRadius: "14px",
          borderBottomRightRadius: "14px",
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(
            getMetrics().length,
            3,
          )}, 1fr)`,
          gap: "2px",
        }}
      >
        {getMetrics().map((metric, idx) => (
          <div
            key={idx}
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "40px",
                fontWeight: "400",
                color: scheme.text,
                textShadow: `0 0 8px ${scheme.text}60, 0 1px 2px rgba(0, 0, 0, 0.9)`,
                marginBottom: "5px",
              }}
            >
              {metric.value}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "20px",
                color: scheme.text,
                textTransform: "uppercase",
                letterSpacing: "2px",
                fontWeight: "500",
                opacity: 0.9,
              }}
            >
              {metric.label}
            </span>
          </div>
        ))}
      </div>

      {/* Pin/Unpin Button for Reference Nodes */}
      {type === "reference" && onTogglePin && data.content_id && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            zIndex: 10,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(data.content_id);
            }}
            style={{
              background: isPinned
                ? "linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(251, 191, 36, 0.2))"
                : "linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(100, 116, 139, 0.2))",
              border: `1px solid ${isPinned ? "rgba(251, 191, 36, 0.6)" : "rgba(100, 116, 139, 0.4)"}`,
              borderRadius: "8px",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "18px",
              pointerEvents: "auto",
              transition: "all 0.2s ease",
              boxShadow: isPinned
                ? "0 0 10px rgba(251, 191, 36, 0.3)"
                : "0 2px 8px rgba(0, 0, 0, 0.3)",
            }}
            title={isPinned ? "Unpin from view" : "Pin to view"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
        </div>
      )}
    </div>
  );
};

export async function animateMoleculeScene({
  cy,
  node,
  taskNode,
  nodes,
  links,
  originalNodePositions,
  lastRefNode,
  lastRefOriginalPos,
  animate = true,
  activatedNodeIds,
}: {
  cy: cytoscape.Core;
  node: NodeSingular;
  taskNode: NodeSingular;
  nodes: NodeData[];
  links: LinkData[];
  originalNodePositions: React.MutableRefObject<
    Record<string, cytoscape.Position>
  >;
  lastRefNode: React.MutableRefObject<NodeSingular | null>;
  lastRefOriginalPos: React.MutableRefObject<{ x: number; y: number } | null>;
  animate?: boolean;
  activatedNodeIds?: Set<string>;
}) {
  try {
    const contentId = node.data("content_id");

  // Step 1: Restore positions if previous reference node was moved
  if (
    lastRefNode.current &&
    lastRefOriginalPos.current &&
    lastRefNode.current.id() !== node.id()
  ) {
    lastRefNode.current.position(lastRefOriginalPos.current);
  }

  if (Object.keys(originalNodePositions.current).length > 0) {
    await restoreNodePositions(cy, originalNodePositions, animate);
  }

  // Step 2: Get ref and task claims and create unified claim cards
  const refClaims = nodes.filter(
    (n) => n.type === "refClaim" && n.content_id === contentId,
  );
  const claimLinks = links.filter((l) =>
    refClaims.some((rc) => rc.id === l.source),
  );

  const taskClaimMap = new Map(
    nodes.filter((n) => n.type === "taskClaim").map((n) => [n.id, n]),
  );

  // Create unified claims that combine refClaim + taskClaim
  const unifiedClaims = claimLinks
    .map((link) => {
      const refClaim = refClaims.find((rc) => rc.id === link.source);
      const taskClaim = taskClaimMap.get(link.target);

      if (!refClaim || !taskClaim) return null;

      return {
        id: `unified-${refClaim.id}-${taskClaim.id}`,
        type: "unifiedClaim",
        label: `${refClaim.label} → ${taskClaim.label}`,
        refClaimLabel: refClaim.label,
        taskClaimLabel: taskClaim.label,
        relation: link.relation || "related",
        notes: link.notes || "",
        content_id: contentId,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (unifiedClaims.length === 0) return;

  // Step 3: Scatter away from node using Corridor Arc pattern
  lastRefOriginalPos.current = { ...node.position() };
  lastRefNode.current = node;

  await corridorArcScatter({
    cy,
    refNode: node,
    taskNode,
    animate,
  });

  // Step 4: Fan out unified claim cards along the line between task and reference
  // Position them closer to the reference, spread perpendicular to the connection line
  const refPos = node.position();
  const taskPos = taskNode.position();

  // Calculate angle from task to reference
  const dx = refPos.x - taskPos.x;
  const dy = refPos.y - taskPos.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angleToRef = Math.atan2(dy, dx);

  // Position claims 60% of the way from task to reference
  // This puts them outside the scatter radius (300-400px) but close to the reference
  const centerDistance = distance * 0.65;
  const centerX = taskPos.x + centerDistance * Math.cos(angleToRef);
  const centerY = taskPos.y + centerDistance * Math.sin(angleToRef);

  // Spread claims perpendicular to the task-reference line
  // Use larger spacing to avoid overlaps (cards are now 320px wide)
  const spreadDistance = 370; // Distance between cards
  const perpAngle = angleToRef + Math.PI / 2; // Perpendicular angle

  const claimElements: cytoscape.ElementDefinition[] = [];

  unifiedClaims.forEach((claim, i) => {
    // Center the spread around the midpoint
    const offset = (i - (unifiedClaims.length - 1) / 2) * spreadDistance;

    const x = centerX + offset * Math.cos(perpAngle);
    const y = centerY + offset * Math.sin(perpAngle);

    // Add the unified claim node
    const claimNode: cytoscape.ElementDefinition = {
      data: claim,
      position: { x: centerX, y: centerY }, // Start at center point
    };

    cy.add(claimNode);
    claimElements.push(claimNode);

    // Add edge from task to unified claim
    const taskEdge: cytoscape.ElementDefinition = {
      data: {
        id: `edge-task-${claim.id}`,
        source: taskNode.id(),
        target: claim.id,
        relation: claim.relation,
      },
    };
    cy.add(taskEdge);

    // Add edge from unified claim to reference
    const refEdge: cytoscape.ElementDefinition = {
      data: {
        id: `edge-${claim.id}-ref`,
        source: claim.id,
        target: node.id(),
        relation: claim.relation,
      },
    };
    cy.add(refEdge);

    // Animate to final position
    const cyNode = cy.getElementById(claim.id);
    if (animate) {
      cyNode.animate(
        { position: { x, y } },
        { duration: 200, easing: "ease-out" },
      );
    } else {
      cyNode.position({ x, y });
    }
  });

    // Single fit at the end, no double animation
    if (animate) {
      cy.animate({
        fit: { eles: cy.elements(), padding: 30 },
        duration: 250,
      });
    } else {
      cy.fit(cy.elements(), 30);
    }

    // Restart throbbing for activated nodes after animation
    if (activatedNodeIds) {
      restartAllThrobs(cy, activatedNodeIds);
    }
  } catch (error) {
    console.error("animateMoleculeScene error:", error);
    // Try to restore state gracefully
    if (activatedNodeIds) {
      restartAllThrobs(cy, activatedNodeIds);
    }
  }
}

function animateNode(
  node: NodeSingular,
  options: { position: { x: number; y: number } },
  duration = 200,
): Promise<void> {
  return new Promise((resolve) => {
    // Safety timeout in case animation doesn't complete
    const timeout = setTimeout(() => {
      console.warn("Animation timeout for node:", node.id());
      resolve();
    }, duration + 500);

    node.animate(options, {
      duration,
      easing: "ease-out",
      complete: () => {
        clearTimeout(timeout);
        resolve();
      },
    });
  });
}
function animateNodes(
  nodes: cytoscape.SingularElementArgument[],
  optionsList: { position: { x: number; y: number } }[],
  duration = 250,
): Promise<void> {
  return new Promise((resolve) => {
    if (nodes.length === 0) {
      resolve();
      return;
    }

    // Safety timeout in case animations don't complete
    const timeout = setTimeout(() => {
      console.warn("Animation timeout for", nodes.length, "nodes");
      resolve();
    }, duration + 1000);

    let finished = 0;
    nodes.forEach((node, i) => {
      node.animate(optionsList[i], {
        duration,
        easing: "ease-out",
        complete: () => {
          finished++;
          if (finished === nodes.length) {
            clearTimeout(timeout);
            resolve();
          }
        },
      });
    });
  });
}

async function corridorArcScatter({
  cy,
  refNode,
  taskNode,
  animate = true,
}: {
  cy: cytoscape.Core;
  refNode: NodeSingular;
  taskNode: NodeSingular;
  animate?: boolean;
}): Promise<void> {
  try {
    const center = taskNode.position();
    const refPos = refNode.position();

    // Calculate angle from center to clicked reference
    const dx = refPos.x - center.x;
    const dy = refPos.y - center.y;
    const angleToRef = Math.atan2(dy, dx);

    // Opposite angle - where we'll put the arc
    const oppositeAngle = angleToRef + Math.PI;

    // Create a wide semicircular arc on the opposite side
    const arcSpan = Math.PI * 1.1; // 198 degrees - wide semicircle
    const arcStartAngle = oppositeAngle - arcSpan / 2;

    const nodesToScatter = cy
      .nodes()
      .filter((node) => {
        const id = node.id();
        const type = node.data("type");
        return (
          id !== refNode.id() &&
          id !== taskNode.id() &&
          ["reference", "author", "publisher"].includes(type)
        );
      })
      .toArray() as cytoscape.NodeSingular[];

    if (nodesToScatter.length === 0) return;

    // Distribute nodes along the arc with varying radius for depth/interest
    const promises = nodesToScatter.map((node, i) => {
      const t = i / Math.max(1, nodesToScatter.length - 1);
      const angle = arcStartAngle + t * arcSpan;

      // Create a gentle wave pattern in the radius for visual interest
      const waveOffset = Math.sin(t * Math.PI * 2) * 120;
      const baseRadius = 650 + Math.abs(waveOffset); // Adjusted to match Vogel spiral scale

      const newX = center.x + baseRadius * Math.cos(angle);
      const newY = center.y + baseRadius * Math.sin(angle);

      return animate
        ? animateNode(node, { position: { x: newX, y: newY } }, 200)
        : (node.position({ x: newX, y: newY }), Promise.resolve());
    });

    await Promise.all(promises);
  } catch (error) {
    console.error("corridorArcScatter error:", error);
    // Continue gracefully - don't block the animation pipeline
  }
}

async function fanOutClaims({
  cy,
  claimsWithRelation,
  sourceNode,
  targetNode,
  minDistance = 100,
  arcSpan = Math.PI / 2,
  centerShiftFactor = 90,
  animate = true,
}: {
  cy: cytoscape.Core;
  claimsWithRelation: {
    claim: NodeData;
    relation: "supports" | "refutes" | "related";
    notes: string;
  }[];
  sourceNode: NodeSingular;
  targetNode: NodeSingular;
  minDistance?: number;
  arcSpan?: number;
  centerShiftFactor?: number;
  animate?: boolean;
}): Promise<cytoscape.ElementDefinition[]> {
  const isRef = sourceNode.data("type") === "reference";
  const originalPos = { ...sourceNode.position() };
  const targetPos = targetNode.position();
  const dx = targetPos.x - originalPos.x;
  const dy = targetPos.y - originalPos.y;
  const angleRadians = Math.atan2(dy, dx);
  const arcPadding = centerShiftFactor * claimsWithRelation.length;

  if (isRef) {
    const shiftedPos = {
      x: originalPos.x - arcPadding * Math.cos(angleRadians),
      y: originalPos.y - arcPadding * Math.sin(angleRadians),
    };
    sourceNode.position(shiftedPos);
  }

  const arcCenter = sourceNode.position();
  const neededArcLength =
    Math.max(2, claimsWithRelation.length - 1) * minDistance;
  const radius = neededArcLength / arcSpan;
  const added: cytoscape.ElementDefinition[] = [];

  claimsWithRelation.forEach(({ claim, relation, notes }) => {
    if (!cy.getElementById(claim.id).nonempty()) {
      cy.add({ data: claim });
      added.push({ data: claim });
    }
    const edgeId = `edge-${claim.id}-${sourceNode.id()}`;
    if (!cy.getElementById(edgeId).nonempty()) {
      added.push({
        data: {
          id: edgeId,
          source: claim.id,
          target: sourceNode.id(),
          relation,
          notes,
        },
      });
    }
  });

  const promises = claimsWithRelation.map(({ claim }, i) => {
    const angle =
      -arcSpan / 2 +
      (i / (claimsWithRelation.length - 1 || 1)) * arcSpan +
      angleRadians;
    const x = arcCenter.x + radius * Math.cos(angle);
    const y = arcCenter.y + radius * Math.sin(angle);

    const claimNode = cy.getElementById(claim.id).first() as NodeSingular;
    claimNode.position(arcCenter);

    if (animate) {
      return animateNode(claimNode, { position: { x, y } }, 200);
    } else {
      claimNode.position({ x, y });
      return Promise.resolve();
    }
  });

  Promise.all(promises);
  return added;
}

function bellValley(
  i: number,
  center: number,
  maxHeight: number,
  range: number,
) {
  const dist = Math.abs(i - center);
  if (dist <= range) {
    return (dist / range) * maxHeight; // rising edge
  } else {
    return (1 - (dist - range) / (center - range)) * maxHeight; // falling edge
  }
}

function smartRadialPush({
  cy,
  center,
  excludeIds,
  minRadius,
  maxRadius = 800,
}: {
  cy: cytoscape.Core;
  center: { x: number; y: number };
  excludeIds: string[];
  minRadius: number;
  maxRadius?: number;
}) {
  const usedAngles = new Set<number>();

  cy.nodes().forEach((node) => {
    const id = node.id();
    const type = node.data("type");

    if (
      excludeIds.includes(id) ||
      !["reference", "author", "publisher"].includes(type)
    ) {
      return;
    }

    const pos = node.position();
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    let angle = Math.atan2(dy, dx);

    while (usedAngles.has(angle)) {
      angle += 0.1;
    }
    usedAngles.add(angle);

    const r = Math.min(maxRadius, minRadius + 200);
    const newX = center.x + r * Math.cos(angle);
    const newY = center.y + r * Math.sin(angle);

    console.log(
      `🔄 Smart-pushing ${id} to (${newX.toFixed(1)}, ${newY.toFixed(1)})`,
    );

    node.animate(
      { position: { x: newX, y: newY } },
      { duration: 200, easing: "ease-out" },
    );
  });
}
function pushAwayOtherNodes(
  cy: cytoscape.Core,
  center: { x: number; y: number },
  excludeIds: string[],
  distance: number = 300,
) {
  cy.nodes().forEach((node) => {
    const id = node.id();
    const type = node.data("type");
    if (
      !excludeIds.includes(id) &&
      ["reference", "author", "publisher"].includes(type)
    ) {
      const pos = node.position();
      const dx = pos.x - center.x;
      const dy = pos.y - center.y;
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const normX = dx / mag;
      const normY = dy / mag;
      const newX = pos.x + normX * distance;
      const newY = pos.y + normY * distance;

      console.log(
        `🧼 Pushing ${type} node ${id} from (${pos.x}, ${pos.y}) to (${newX}, ${newY})`,
      );

      node.animate(
        { position: { x: newX, y: newY } },
        { duration: 400, easing: "ease-in-out" },
      );
    }
  });
}

function saveNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<any>,
) {
  store.current = {};
  cy.nodes().forEach((node) => {
    const id = node.id();
    const type = node.data("type");
    if (["reference", "author", "publisher"].includes(type)) {
      store.current[id] = { ...node.position() };
    }
  });
}

async function restoreNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<Record<string, cytoscape.Position>>,
  animate: boolean = true,
): Promise<void> {
  try {
    const promises: Promise<void>[] = [];

    Object.entries(store.current).forEach(([id, pos]) => {
      const coll = cy.getElementById(id);
      if (coll.length > 0 && coll.isNode()) {
        const nodeToRestore = coll.first() as NodeSingular;
        if (animate) {
          promises.push(animateNode(nodeToRestore, { position: pos }, 200));
        } else {
          nodeToRestore.position(pos);
          promises.push(Promise.resolve());
        }
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error("restoreNodePositions error:", error);
    // Continue gracefully
  }
}

// ---- CytoscapeThrobbage™ ----
function startThrobbing(node: any) {
  // Clear any existing throb first
  const existingInterval = node.data("throbInterval");
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  let growing = true;
  const minWidth = node.width();
  const minHeight = node.height();
  const maxWidth = minWidth * 1.07;
  const maxHeight = minHeight * 1.07;
  let throbInterval = setInterval(() => {
    // Check if node still exists before animating
    if (!node || node.removed()) {
      clearInterval(throbInterval);
      return;
    }
    node.animate(
      {
        style: {
          width: growing ? maxWidth : minWidth,
          height: growing ? maxHeight : minHeight,
        },
      },
      {
        duration: 380,
        complete: () => {
          growing = !growing;
        },
      },
    );
  }, 420);
  node.data("throbInterval", throbInterval);
  node.addClass("throb");
}

// Restart throbbing for all activated nodes
function restartAllThrobs(cy: cytoscape.Core, activatedNodeIds: Set<string>) {
  cy.nodes().forEach((node) => {
    if (activatedNodeIds.has(node.id()) && !node.data("throbInterval")) {
      startThrobbing(node);
    }
  });
}
// All other unchanged code is retained as-is

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export type DisplayMode = 'mr_cards' | 'circles' | 'compact';

interface CytoscapeMoleculeProps {
  nodes: {
    id: string;
    label: string;
    type: string;
    claim_id?: number;
    content_id?: number;
    url?: string;
  }[];
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
  onPositionsChange?: (positions: Record<string, { x: number; y: number }>) => void;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onNodeSettingsChange?: (settings: Record<string, { displayMode: DisplayMode }>) => void;
}

type LinkData = CytoscapeMoleculeProps["links"][number];

const CytoscapeMolecule: React.FC<CytoscapeMoleculeProps> = ({
  nodes,
  links,
  onNodeClick,
  centerNodeId,
  pinnedReferenceIds,
  onTogglePin,
  displayMode = 'mr_cards',
  savedPositions,
  onPositionsChange,
  nodeSettings,
  onNodeSettingsChange,
}) => {
  console.log("🔷 CytoscapeMolecule render with displayMode:", displayMode);

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
  const originalNodePositions = useRef<
    Record<string, { x: number; y: number }>
  >({});

  // State for overlay rendering
  const [overlayNodes, setOverlayNodes] = useState<cytoscape.NodeSingular[]>(
    [],
  );
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hoveredNodePopup, setHoveredNodePopup] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    console.log("🧪 CytoscapeMolecule mount — received links:", links);
    if (!cyRef.current) return;

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
      .filter((l) =>
        positionedNodes.some(
          (n) => n.data.id === l.source || n.data.id === l.target,
        ),
      )
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
      if (displayMode === 'circles') {
        return {
          selector: "node",
          style: {
            shape: "ellipse",
            width: 140,
            height: 140,
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

              const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

              // Use new API endpoint for auto extension detection
              let fullUrl;
              if (type === "author") {
                const authorId = data.author_id || nodeId.replace("autho-", "");
                fullUrl = `${API_BASE_URL}/api/image/authors/${authorId}`;
                console.log(`🎨 Author node ${nodeId}: author_id=${data.author_id}, computed authorId=${authorId}`);
              } else if (type === "task" || type === "reference") {
                const contentId = data.content_id || nodeId.replace("conte-", "");
                fullUrl = `${API_BASE_URL}/api/image/content/${contentId}`;
              } else if (type === "publisher") {
                const publisherId = data.publisher_id || nodeId.replace("publi-", "");
                fullUrl = `${API_BASE_URL}/api/image/publishers/${publisherId}`;
                console.log(`🎨 Publisher node ${nodeId}: publisher_id=${data.publisher_id}, computed publisherId=${publisherId}`);
              } else {
                return null; // No image for claims
              }

              console.log(`🖼️ Node ${nodeId} (${type}) background-image: ${fullUrl}`);
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
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#60a5fa";
              return "#6366f1";
            },
            "background-opacity": 0.9,
            "border-width": 3,
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#6366f1";
              if (type === "reference") return "#10b981";
              if (type === "unifiedClaim") return "#f97316";
              if (type === "author") return "#a78bfa";
              if (type === "publisher") return "#60a5fa";
              return "#6366f1";
            },
            "border-opacity": 0.8,
          },
        };
      } else if (displayMode === 'compact') {
        return {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: 120,
            height: 140,
            label: "",
            "background-color": "rgba(0, 0, 0, 0)",
            "background-opacity": 0,
            "border-width": 12,
            // @ts-ignore
            "corner-radius": 10,
            // Apply opacity for dimmed (unpinned) nodes
            opacity: (ele: any) => {
              return ele.data("dimmed") ? 0.3 : 1.0;
            },
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#00a2ff";
              if (type === "reference") return "#4ade80";
              if (type === "unifiedClaim") return "#fbbf24";
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
            shape: "round-rectangle",
            width: (ele: any) => {
              const type = ele.data("type");
              return type === "unifiedClaim" ? 260 : 200;
            },
            height: (ele: any) => {
              const type = ele.data("type");
              return type === "unifiedClaim" ? 320 : 240;
            },
            label: "",
            color: "rgba(0, 0, 0, 0)",
            "background-color": "rgba(0, 0, 0, 0)",
            "background-opacity": 0,
            "border-width": 18,
            // @ts-ignore
            "corner-radius": 16,
            // Apply opacity for dimmed (unpinned) nodes
            opacity: (ele: any) => {
              return ele.data("dimmed") ? 0.3 : 1.0;
            },
            "border-color": (ele: any) => {
              const type = ele.data("type");
              if (type === "task") return "#00a2ff";
              if (type === "reference") return "#4ade80";
              if (type === "unifiedClaim") return "#fbbf24";
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
            // Dim edges connected to dimmed nodes
            opacity: (ele: any) => {
              const sourceNode = ele.source();
              const targetNode = ele.target();
              const sourceDimmed = sourceNode.data("dimmed");
              const targetDimmed = targetNode.data("dimmed");

              // If either end is dimmed, dim the edge
              return (sourceDimmed || targetDimmed) ? 0.2 : 1.0;
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

    // Save positions when user finishes dragging nodes
    cy.on("dragfree", "node", () => {
      if (onPositionsChange) {
        const positions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          const pos = node.position();
          positions[node.id()] = { x: pos.x, y: pos.y };
        });
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

    // 🧠 Keep track of last clicked node
    const lastClickedNodeId = { current: null };
    // 📌 Main event handler
    cy.on("tap", "node", (event) => {
      const node = event.target;
      const type = node.data("type");
      const contentId = node.data("content_id");

      // ← FIRST: log every time a node is tapped
      console.log("📌 [DEBUG] Node tapped:", node.id(), "type=", type);

      if (node.id() === lastClickedNodeId.current) {
        console.log("🛑 Same node clicked again — skipping.");
        return;
      }
      lastClickedNodeId.current = node.id();

      // 🧊 Store initial layout if first interaction (no claims visible)
      if (cy.nodes('node[type *= "Claim"]').length === 0) {
        saveNodePositions(cy, originalNodePositions);
      }

      // 📦 Send clicked node to external handler
      if (onNodeClick) onNodeClick(node.data());
      setSelectedNodeData(node.data());
      // 🧠 Handle unified claim node click
      if (type === "unifiedClaim") {
        const relation = node.data("relation") || "related";
        const refClaimLabel = node.data("refClaimLabel") || "";
        const taskClaimLabel = node.data("taskClaimLabel") || "";
        const notes = node.data("notes") || "";

        setSelectedClaim({
          id: node.id(),
          label: `${refClaimLabel}`,
          taskClaimLabel: taskClaimLabel,
          relation: relation,
          notes: notes,
        });
        return;
      }

      // 🧽 Remove existing unified claims
      const animate = true;
      const claimNodes = cy.nodes('[type = "unifiedClaim"]');
      cy.batch(() => {
        claimNodes.remove();
      });

      // Only restore if layout was previously saved
      if (
        lastRefNode.current &&
        lastRefOriginalPos.current &&
        lastRefNode.current.id() !== node.id()
      ) {
        lastRefNode.current.position(lastRefOriginalPos.current);
      }
      if (Object.keys(originalNodePositions.current).length > 0) {
        restoreNodePositions(cy, originalNodePositions, animate);
      }

      // 📍 Handle reference click (show claims)
      if (type === "reference") {
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

    return () => {
      if (cy) {
        cy.nodes(".throb").forEach((node: any) => {
          clearInterval(node.data("throbInterval"));
        });
        cy.destroy();
      }
    };
  }, [nodes, links, displayMode]);

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

      // Nautilus spiral parameters - gentle growth matching initial layout
      const refCount = references.length;
      const clamp = (min: number, max: number, value: number) =>
        Math.max(min, Math.min(max, value));
      const spiralStart = 400; // Match initial layout
      const growthFactor = clamp(0.05, 0.12, 0.12 - Math.log(refCount) * 0.015);
      const angleStep = clamp(0.25, 0.4, 0.4 - Math.log(refCount) * 0.02);

      const positionedNodes: any[] = [];

      // Position center node
      if (centerNode) {
        positionedNodes.push({
          data: centerNode,
          position: { x: centerX, y: centerY },
        });
      }

      // Position other nodes based on type
      newNodes.forEach((n: any) => {
        if (n.id === selectedId) return; // Skip center node

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
          x = centerX - 1200;
          y = centerY + (authorIndex - authors.length / 2) * 150;
        } else if (n.type === "publisher") {
          // Publishers on right
          const publisherIndex = publishers.findIndex(
            (p: any) => p.id === n.id,
          );
          x = centerX + 1200;
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

    // Remove all unified claim nodes and their edges
    cy.nodes('[type = "unifiedClaim"]').forEach((node) => {
      // Clear throb interval
      const interval = node.data("throbInterval");
      if (interval) clearInterval(interval);
      node.remove();
    });

    // Restore all original node positions
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
      description: "All nodes are now visible",
      status: "info",
      duration: 2000,
      isClosable: true,
    });
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
                    const modes: DisplayMode[] = ['circles', 'compact', 'mr_cards'];
                    const currentMode = nodeSettings?.[nodeId]?.displayMode || displayMode;
                    const currentIndex = modes.indexOf(currentMode);
                    const nextMode = modes[(currentIndex + 1) % modes.length];

                    const newSettings = { ...(nodeSettings || {}), [nodeId]: { displayMode: nextMode } };
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
                      ? "TASK"
                      : selectedNodeData.type === "reference"
                        ? "REFERENCE"
                        : selectedNodeData.type === "author"
                          ? "AUTHOR"
                          : selectedNodeData.type === "publisher"
                            ? "PUBLISHER"
                            : selectedNodeData.type === "refClaim"
                              ? "REF CLAIM"
                              : "TASK CLAIM"}
                  </Text>
                  <Box w="1px" h="16px" bg="rgba(0, 162, 255, 0.3)" />
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
                  {/* Show rating if available */}
                  {selectedNodeData.rating != null && selectedNodeData.rating !== 0 && (
                    <>
                      <Box w="1px" h="16px" bg="rgba(0, 162, 255, 0.3)" />
                      <Text
                        fontSize="xs"
                        fontWeight="600"
                        color={selectedNodeData.rating > 0 ? "#4ade80" : "#f87171"}
                        textShadow={`0 0 8px ${selectedNodeData.rating > 0 ? "rgba(74, 222, 128, 0.6)" : "rgba(248, 113, 113, 0.6)"}`}
                        whiteSpace="nowrap"
                      >
                        ⭐ {typeof selectedNodeData.rating === 'number' ? selectedNodeData.rating.toFixed(1) : selectedNodeData.rating}
                      </Text>
                    </>
                  )}
                </Box>
                {/* Additional details for references */}
                {selectedNodeData.type === "reference" && selectedNodeData.url && (
                  <Text
                    fontSize="xs"
                    color="#94a3b8"
                    noOfLines={1}
                  >
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
              zIndex={1000}
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
              bg="rgba(0, 162, 255, 0.1)"
              backdropFilter="blur(10px)"
              border="1px solid rgba(0, 162, 255, 0.3)"
              color="#00a2ff"
              _hover={{
                bg: "rgba(0, 162, 255, 0.2)",
                borderColor: "#00a2ff",
                boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
              }}
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
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              color="#e2e8f0"
              borderRadius="12px"
              p="20px"
              zIndex={1000}
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
                onClick={() => setShowLegend(false)}
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
                Legend
              </Text>
              <Box
                fontSize="xs"
                lineHeight="1.6"
                color="#cbd5e1"
                position="relative"
                zIndex={2}
              >
                <Box display="flex" alignItems="center" mb={2}>
                  <Box
                    w="12px"
                    h="12px"
                    bg="#6365f1"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(99, 102, 241, 0.4)"
                  />
                  <Text fontSize="10px">Task</Text>
                </Box>
                <Box display="flex" alignItems="center" mb={2}>
                  <Box
                    w="12px"
                    h="12px"
                    bg="#10b981"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(16, 185, 129, 0.4)"
                  />
                  <Text fontSize="10px">Reference</Text>
                </Box>
                <Box display="flex" alignItems="center" mb={2}>
                  <Box
                    w="12px"
                    h="12px"
                    bg="#f97316"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(249, 115, 22, 0.4)"
                  />
                  <Text fontSize="10px">Claims</Text>
                </Box>
                <Box display="flex" alignItems="center" mb={2}>
                  <Box
                    w="12px"
                    h="12px"
                    bg="#fbb1a0"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(251, 177, 160, 0.4)"
                  />
                  <Text fontSize="10px">Author</Text>
                </Box>
                <Box display="flex" alignItems="center" mb={3}>
                  <Box
                    w="12px"
                    h="12px"
                    bg="#81ecec"
                    borderRadius="3px"
                    mr={2}
                    boxShadow="0 0 8px rgba(129, 236, 236, 0.4)"
                  />
                  <Text fontSize="10px">Publisher</Text>
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
              bg="rgba(0, 162, 255, 0.1)"
              backdropFilter="blur(10px)"
              border="1px solid rgba(0, 162, 255, 0.3)"
              color="#00a2ff"
              _hover={{
                bg: "rgba(0, 162, 255, 0.2)",
                borderColor: "#00a2ff",
                boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
              }}
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
              Reference Claim{" "}
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
    </>
  );
};

export default CytoscapeMolecule;
