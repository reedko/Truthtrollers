import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, Button, Text, useToast } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

function fartScatterAwayFromRef({
  cy,
  refNode,
  taskNode,
  radius = 300,
  radiusStep = 40,
  dipRange = 5,
}: {
  cy: cytoscape.Core;
  refNode: NodeSingular;
  taskNode: NodeSingular;
  radius?: number;
  radiusStep?: number;
  dipRange?: number;
}) {
  const center = taskNode.position();
  const refPos = refNode.position();

  const dx = refPos.x - center.x;
  const dy = refPos.y - center.y;
  const angleToRef = Math.atan2(dy, dx);

  const arcSpan = (3 * Math.PI) / 2;
  const startAngle = angleToRef + Math.PI - arcSpan / 2;

  const nodesToScatter = cy.nodes().filter((node) => {
    const id = node.id();
    const type = node.data("type");
    return (
      id !== refNode.id() &&
      id !== taskNode.id() &&
      ["reference", "author", "publisher"].includes(type)
    );
  });

  const centerIndex = (nodesToScatter.length - 1) / 2;

  function valleyCurve(i: number): number {
    const dist = Math.abs(i - centerIndex);
    if (dist <= dipRange) {
      return dist;
    } else {
      const decay = dist - dipRange;
      return dipRange - decay * 0.7;
    }
  }

  nodesToScatter.forEach((node, i) => {
    const t = i / Math.max(1, nodesToScatter.length - 1);
    const angle = startAngle + t * arcSpan;

    const rOffset = Math.max(0, valleyCurve(i)) * radiusStep;
    const effectiveRadius = radius + rOffset;

    const newX = center.x + effectiveRadius * Math.cos(angle);
    const newY = center.y + effectiveRadius * Math.sin(angle);

    node.animate(
      { position: { x: newX, y: newY } },
      { duration: 500, easing: "ease-in-out" }
    );
  });
}

function bellValley(
  i: number,
  center: number,
  maxHeight: number,
  range: number
) {
  const dist = Math.abs(i - center);
  if (dist <= range) {
    return (dist / range) * maxHeight;
  } else {
    return (1 - (dist - range) / (center - range)) * maxHeight;
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

    node.animate(
      { position: { x: newX, y: newY } },
      { duration: 400, easing: "ease-in-out" }
    );
  });
}

function pushAwayOtherNodes(
  cy: cytoscape.Core,
  center: { x: number; y: number },
  excludeIds: string[],
  distance: number = 300
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

      node.animate(
        { position: { x: newX, y: newY } },
        { duration: 400, easing: "ease-in-out" }
      );
    }
  });
}

function saveNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<any>
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

function restoreNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<Record<string, cytoscape.Position>>,
  excludeId?: string
) {
  Object.entries(store.current).forEach(([id, pos]) => {
    if (id === excludeId) return;
    const nodeToRestore = cy.getElementById(id).first() as NodeSingular;
    if (nodeToRestore.nonempty()) {
      nodeToRestore.animate(
        { position: pos },
        { duration: 400, easing: "ease-in-out" }
      );
    }
  });
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

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
  }[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
}

type NodeData = CytoscapeMoleculeProps["nodes"][number];
type LinkData = CytoscapeMoleculeProps["links"][number];
const CytoscapeMolecule: React.FC<CytoscapeMoleculeProps> = ({
  nodes,
  links,
  onNodeClick,
  centerNodeId,
}) => {
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<null | {
    id: string;
    label: string;
    relation: string;
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
    null
  );
  const toast = useToast();

  const lastRefNode = useRef<NodeSingular | null>(null);
  const lastRefOriginalPos = useRef<{ x: number; y: number } | null>(null);
  const originalNodePositions = useRef<
    Record<string, { x: number; y: number }>
  >({});

  const reframe = (nodeId: string) => {
    const cy = cyInstance.current;
    const node = cy?.getElementById(nodeId);
    if (node?.nonempty()) {
      cy?.animate({
        fit: {
          eles: node.closedNeighborhood(),
          padding: 100,
        },
        duration: 600,
        easing: "ease-in-out",
      });
      toast({
        title: "Graph Reframed",
        description: `Centered on ${node.data("label")}`,
        status: "info",
        duration: 2500,
        isClosable: true,
        position: "top",
        variant: "left-accent",
      });
    }
  };

  useEffect(() => {
    if (!cyRef.current) return;

    const centerX = 500;
    const centerY = 350;

    const centerNode =
      nodes.find((n) => n.id === centerNodeId) ||
      nodes.find((n) => n.type === "task");

    const baseNodes = nodes.filter((n) =>
      ["task", "reference", "author", "publisher"].includes(n.type)
    );

    const positionedNodes = baseNodes.map((n, i) => {
      if (n.id === centerNode?.id) {
        return {
          data: { ...n },
          position: { x: centerX, y: centerY },
        };
      }

      const refCount = baseNodes.filter(
        (node) => node.type === "reference"
      ).length;
      const refIndex = baseNodes.findIndex((b) => b.id === n.id);

      const clamp = (min: number, max: number, value: number) =>
        Math.max(min, Math.min(max, value));
      const angleMultiplier = clamp(0.1, 0.6, 0.7 - Math.log(refCount) * 0.07);
      const spiralGrowth = clamp(10, 40, 60 - Math.log(refCount) * 10);
      const spiralStart = 150;

      const angleStep = Math.PI / 4;
      const angle = angleMultiplier * refIndex * angleStep;
      const radius = spiralStart + spiralGrowth * angle;

      let x = centerX + radius * Math.cos(angle);
      let y = centerY + radius * Math.sin(angle);

      if (n.type === "author") {
        x = centerX - 800;
        y = centerY + refIndex * 100;
      } else if (n.type === "publisher") {
        x = centerX + 800;
        y = centerY + refIndex * 100;
      }

      return {
        data: { ...n },
        position: { x, y },
      };
    });

    const initialEdges = links
      .filter((l) =>
        positionedNodes.some(
          (n) => n.data.id === l.source || n.data.id === l.target
        )
      )
      .map((l) => ({ data: l }));

    const cy = cytoscape({
      container: cyRef.current,
      elements: { nodes: positionedNodes, edges: initialEdges },
      layout: { name: "preset" },
      style: [
        {
          selector: "node",
          style: {
            shape: "ellipse",
            width: 90,
            height: 90,
            label: (ele: NodeSingular) => {
              const type = ele.data("type");
              if (type === "refClaim" || type === "taskClaim") {
                return ele.data("label").slice(0, 35) + "...";
              }
              return ele.data("label");
            },
            "text-wrap": "wrap",
            "text-max-width": "120",
            "text-valign": (ele: NodeSingular) =>
              ["task", "reference", "author", "publisher"].includes(
                ele.data("type")
              )
                ? "bottom"
                : "center",
            "text-halign": "center",
            "font-size": "9px",
            color: "#fff",
            "text-background-color": (ele: NodeSingular) => {
              const type = ele.data("type");
              return ["task", "reference", "author", "publisher"].includes(type)
                ? "#222"
                : "transparent";
            },
            "text-background-opacity": 1,
            "text-background-shape": "roundrectangle",
            "background-color": (ele) => {
              const type = ele.data("type");
              if (type === "task") return "#6c5ce7";
              if (type === "reference") return "#00b894";
              if (type === "refClaim") return "#aaa";
              if (type === "taskClaim") return "#ffeaa7";
              if (type === "author") return "#fab1a0";
              if (type === "publisher") return "#81ecec";
              return "#ccc";
            },
            "background-fit": "contain",
            "background-clip": "node",
            "border-width": 2,
            "border-color": "#222",
          },
        },
        {
          selector: "edge",
          style: {
            width: (ele: EdgeSingular) => {
              const val = Math.abs(ele.data("value") || 0);
              return 2 + val * 4;
            },
            label: (ele: EdgeSingular) => {
              const rel = ele.data("relation");
              const val = ele.data("value");
              if (!val) return "";
              const pct = Math.round(Math.abs(val) * 100);
              return `${rel}: ${pct}%`;
            },
            "text-rotation": "autorotate",
            "text-margin-y": -10,
            "font-size": 9,
            color: "#eee",
            "line-color": (ele) => {
              const rel = ele.data("relation");
              return rel === "supports"
                ? "#0f6"
                : rel === "refutes"
                ? "#f33"
                : "#39f";
            },
            "target-arrow-color": "#aaa",
            "target-arrow-shape": "triangle",
            "curve-style": "unbundled-bezier",
            "control-point-step-size": 60,
          },
        },
      ],
    });

    cyInstance.current = cy;

    cy.on("mouseover", "edge", (event) => {
      const edge = event.target;
      const relation = edge.data("relation") || "related";
      const value = edge.data("value") || 0;
      const label =
        (relation === "supports"
          ? "✅ Supports"
          : relation === "refutes"
          ? "❌ Refutes"
          : "Related") + `: ${Math.round(Math.abs(value) * 100)}%`;

      const { x, y } = event.renderedPosition;
      setHoveredEdgeTooltip({ label, x, y });
    });

    cy.on("mouseout", "edge", () => {
      setHoveredEdgeTooltip(null);
    });

    cy.ready(() => {
      cy.animate({
        fit: {
          eles: cy.elements(),
          padding: 15,
        },
        duration: 500,
        easing: "ease-in-out",
      });
    });

    // More logic (node click, layout updates, etc.) continues in next part
    // 🎯 Handle edge click
    cy.on("tap", "edge", (event) => {
      const edge = event.target as EdgeSingular;
      const rel = edge.data("relation");
      const value = edge.data("value") ?? 0;
      const notes = edge.data("notes") || "";

      const sourceNode = cy.getElementById(edge.data("source")).data();
      const targetNode = cy.getElementById(edge.data("target")).data();

      setSelectedEdge({
        sourceLabel: sourceNode.label,
        targetLabel: targetNode.label,
        relation: rel,
        value,
        notes,
      });
    });

    return () => cy.destroy();
  }, [nodes, links]);

  return (
    <>
      <Box pt={4} width="calc(100vw - 300px)" ml="8px" mt={-4}>
        <Box
          ref={cyRef}
          height="80vh"
          width="100%"
          borderWidth="1px"
          borderRadius="lg"
          p={4}
          bg={"stat2Gradient"}
          borderColor="gray.300"
        />
      </Box>

      {selectedNodeData && (
        <Box
          mt={4}
          p={4}
          borderRadius="md"
          bg="gray.800"
          color="white"
          boxShadow="md"
          maxW="800px"
          mx="auto"
        >
          <Text fontWeight="bold" fontSize="lg" mb={2}>
            🔍 {selectedNodeData.label}
          </Text>

          {selectedNodeData.url && (
            <Box mb={3}>
              <a
                href={selectedNodeData.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#90cdf4",
                  textDecoration: "underline",
                }}
              >
                View Content
              </a>
            </Box>
          )}

          <Button
            size="sm"
            colorScheme="teal"
            onClick={() => {
              if (selectedNodeData?.id) {
                reframe(selectedNodeData.id);
                setSelectedClaim(null);
                setSelectedEdge(null);
                setHoveredEdgeTooltip(null);
                setSelectedNodeData(null);
              }
            }}
          >
            🔄 Reframe Graph Around This Node
          </Button>
        </Box>
      )}

      {selectedClaim &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#222",
              color: "#fff",
              padding: "1.5em",
              borderRadius: 12,
              boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              zIndex: 1000,
            }}
          >
            <h3>
              {selectedClaim.relation === "supports"
                ? "✅ Supports"
                : selectedClaim.relation === "refutes"
                ? "❌ Refutes"
                : "Claim"}
            </h3>
            <p style={{ marginTop: 12 }}>{selectedClaim.label}</p>
            <button
              onClick={() => setSelectedClaim(null)}
              style={{
                marginTop: 20,
                background: "#6c5ce7",
                color: "#fff",
                padding: "0.5em 1em",
                borderRadius: 6,
              }}
            >
              Close
            </button>
          </div>,
          document.body
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
          document.body
        )}

      {selectedEdge &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#222",
              color: "#fff",
              padding: "1.5em",
              borderRadius: 12,
              boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              zIndex: 1000,
              maxWidth: "500px",
              width: "90%",
            }}
          >
            <h3 style={{ marginBottom: "0.5em" }}>
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
                marginTop: 20,
                background: "#6c5ce7",
                color: "#fff",
                padding: "0.5em 1em",
                borderRadius: 6,
              }}
            >
              Close
            </button>
          </div>,
          document.body
        )}
    </>
  );
};

export default CytoscapeMolecule;
