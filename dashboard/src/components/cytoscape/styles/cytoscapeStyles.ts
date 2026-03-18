import cytoscape, { EdgeSingular } from "cytoscape";
import { DisplayMode } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export function getCytoscapeStyles(displayMode: DisplayMode): any[] {
  const nodeStyle = getNodeStyle(displayMode);
  const edgeStyle = getEdgeStyle();

  return [nodeStyle as any, edgeStyle as any];
}

function getNodeStyle(displayMode: DisplayMode) {
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

          // Use new API endpoint for auto extension detection
          let fullUrl;
          if (type === "author") {
            const authorId = data.author_id || nodeId.replace("autho-", "");
            fullUrl = `${API_BASE_URL}/api/image/authors/${authorId}`;
          } else if (type === "task" || type === "reference") {
            const contentId = data.content_id || nodeId.replace("conte-", "");
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
          if (type === "caseClaim") return "#8b5cf6"; // Purple for case claims
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
          if (type === "caseClaim") return "#8b5cf6"; // Purple for case claims
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
}

function getEdgeStyle() {
  return {
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
  };
}
