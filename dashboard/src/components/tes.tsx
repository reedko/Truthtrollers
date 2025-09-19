// CytoscapeMolecule.tsx — single-click fan-out preserved + mobile polish (no interfering listeners)
// - Keeps original single-tap fan-out behavior
// - Targeted clearing (no 'edge[relation]' nuke)
// - Awaited scatter/fan-out internals to avoid races
// - Mobile: native pinch-to-zoom + pan, label LOD, responsive container
// - No custom wheel/keyboard zoom listeners; desktop scroll stays normal

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, useToast } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

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
    value?: number;
  }[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
}

type NodeData = CytoscapeMoleculeProps["nodes"][number];
type LinkData = CytoscapeMoleculeProps["links"][number];

/* ---------------- helpers ---------------- */

function animateNode(
  node: NodeSingular,
  options: { position: { x: number; y: number } },
  duration = 400
): Promise<void> {
  return new Promise((resolve) => {
    node.animate(options, {
      duration,
      easing: "ease-in-out",
      complete: () => resolve(),
    });
  });
}

async function fartScatterAwayFromRef({
  cy,
  refNode,
  taskNode,
  radius = 300,
  radiusStep = 40,
  dipRange = 5,
  animate = true,
}: {
  cy: cytoscape.Core;
  refNode: NodeSingular;
  taskNode: NodeSingular;
  radius?: number;
  radiusStep?: number;
  dipRange?: number;
  animate?: boolean;
}): Promise<void> {
  const center = taskNode.position();
  const refPos = refNode.position();

  const dx = refPos.x - center.x;
  const dy = refPos.y - center.y;
  const angleToRef = Math.atan2(dy, dx);

  const arcSpan = (3 * Math.PI) / 2;
  const startAngle = angleToRef + Math.PI - arcSpan / 2;

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

  const centerIndex = (nodesToScatter.length - 1) / 2;

  function valleyCurve(i: number): number {
    const dist = Math.abs(i - centerIndex);
    if (dist <= dipRange) return dist;
    const decay = dist - dipRange;
    return dipRange - decay * 0.7;
  }

  const moves = nodesToScatter.map((node, i) => {
    const t = i / Math.max(1, nodesToScatter.length - 1);
    const angle = startAngle + t * arcSpan;

    const rOffset = Math.max(0, valleyCurve(i)) * radiusStep;
    const effectiveRadius = radius + rOffset;

    const newX = center.x + effectiveRadius * Math.cos(angle);
    const newY = center.y + effectiveRadius * Math.sin(angle);

    return animate
      ? animateNode(node, { position: { x: newX, y: newY } }, 500)
      : (node.position({ x: newX, y: newY }), Promise.resolve());
  });

  await Promise.all(moves); // ensure scatter finishes before fan-out
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

  // nudge source to make space for arc
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

  // add missing claim nodes + edges (portable existence check via .length)
  claimsWithRelation.forEach(({ claim, relation, notes }) => {
    if (cy.getElementById(claim.id).length === 0) {
      cy.add({ data: claim });
      added.push({ data: claim });
    }
    const edgeId = `edge-${claim.id}-${sourceNode.id()}`;
    if (cy.getElementById(edgeId).length === 0) {
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

  const moves = claimsWithRelation.map(({ claim }, i) => {
    const angle =
      -arcSpan / 2 +
      (i / (claimsWithRelation.length - 1 || 1)) * arcSpan +
      angleRadians;

    const x = arcCenter.x + radius * Math.cos(angle);
    const y = arcCenter.y + radius * Math.sin(angle);

    const claimNode = cy.getElementById(claim.id).first() as NodeSingular;
    claimNode.position(arcCenter); // start at source

    return animate
      ? animateNode(claimNode, { position: { x, y } }, 400)
      : (claimNode.position({ x, y }), Promise.resolve());
  });

  await Promise.all(moves); // ensure fan-out completes
  return added;
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

async function restoreNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<Record<string, cytoscape.Position>>,
  animate: boolean = true
): Promise<void> {
  const promises: Promise<void>[] = [];

  Object.entries(store.current).forEach(([id, pos]) => {
    const coll = cy.getElementById(id); // collection
    if (coll.length > 0) {
      const nodeToRestore = coll.first() as NodeSingular;
      if (nodeToRestore.isNode()) {
        if (animate) {
          promises.push(animateNode(nodeToRestore, { position: pos }, 400));
        } else {
          nodeToRestore.position(pos);
          promises.push(Promise.resolve());
        }
      }
    }
  });

  await Promise.all(promises);
}

function startThrobbing(node: any) {
  let growing = true;
  const minSize = node.width();
  const maxSize = minSize * 1.18;
  const throbInterval = setInterval(() => {
    node.animate(
      {
        style: {
          width: growing ? maxSize : minSize,
          height: growing ? maxSize : minSize,
        },
      },
      {
        duration: 380,
        complete: () => {
          growing = !growing;
        },
      }
    );
  }, 420);
  node.data("throbInterval", throbInterval);
}

/* --------------- scene orchestrator --------------- */

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
}) {
  const contentId = node.data("content_id");

  // 1) restore previous ref + original layout
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

  // 2) gather claims + links
  const refClaims = nodes.filter(
    (n) => n.type === "refClaim" && n.content_id === contentId
  );
  const claimLinks = links.filter((l) =>
    refClaims.some((rc) => rc.id === l.source)
  );

  const claimsWithRelation = claimLinks
    .map((link) => {
      const claim = refClaims.find((rc) => rc.id === link.source);
      return claim
        ? {
            claim,
            relation: (link.relation as any) || "related",
            notes: link.notes || "",
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const taskClaimMap = new Map(
    nodes.filter((n) => n.type === "taskClaim").map((n) => [n.id, n])
  );
  const taskClaimsWithRelation = claimLinks
    .map((link) => {
      const claim = taskClaimMap.get(link.target);
      return claim
        ? {
            claim,
            relation: (link.relation as any) || "related",
            notes: link.notes || "",
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (refClaims.length === 0 && taskClaimsWithRelation.length === 0) return;

  // 3) remember where ref was; scatter ring
  lastRefOriginalPos.current = { ...node.position() };
  lastRefNode.current = node;
  await fartScatterAwayFromRef({
    cy,
    refNode: node,
    taskNode,
    radius: 300,
    radiusStep: 40,
    dipRange: 5,
    animate,
  });

  // 4) fan out both sides
  const refClaimElements = await fanOutClaims({
    cy,
    claimsWithRelation,
    sourceNode: node,
    targetNode: taskNode,
    animate,
  });

  const taskClaimElements = await fanOutClaims({
    cy,
    claimsWithRelation: taskClaimsWithRelation,
    sourceNode: taskNode,
    targetNode: node,
    animate,
  });

  // 5) add edges linking refClaims <-> taskClaims
  const addedEdges = claimLinks.map((link) => ({
    data: { ...link, relation: (link.relation as any) || "related" },
  }));
  cy.add([...refClaimElements, ...taskClaimElements, ...addedEdges]);

  // 6) fit view
  if (animate) {
    cy.animate({ fit: { eles: cy.elements(), padding: 30 }, duration: 500 });
    await cy.promiseOn("viewport");
    await new Promise((res) => setTimeout(res, 300));
    cy.animate({ fit: { eles: cy.elements(), padding: 30 }, duration: 300 });
  } else {
    cy.fit(cy.elements(), 30);
  }
}

/* --------------- component --------------- */

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
        return { data: { ...n }, position: { x: centerX, y: centerY } };
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

      return { data: { ...n }, position: { x, y } };
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
                const text: string = ele.data("label") || "";
                return text.length > 35 ? text.slice(0, 35) + "…" : text;
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
            "text-background-color": (ele: NodeSingular) =>
              ["task", "reference", "author", "publisher"].includes(
                ele.data("type")
              )
                ? "#222"
                : "transparent",
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
            "background-image": (ele) => {
              const id = ele.id();
              const type = ele.data("type");
              const group =
                type === "author"
                  ? 1
                  : type === "task" || type === "reference"
                  ? 2
                  : type === "publisher"
                  ? 3
                  : 0;
              const path =
                {
                  0: `ttlogo11.png`,
                  1: `authors/author_id_${id.replace("autho-", "")}.png`,
                  2: `content/content_id_${id.replace("conte-", "")}.png`,
                  3: `publishers/publisher_id_${id.replace("publi-", "")}.png`,
                }[group] || `default.png`;
              return `${API_BASE_URL}/assets/images/${path}`;
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
            width: (ele: EdgeSingular) =>
              2 + Math.abs(ele.data("value") || 0) * 4,
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
            "control-point-distances": [40],
            "control-point-weights": [0.5],
          },
        },
      ],
    });

    // -------- Mobile polish (minimal, non-interfering) --------
    // Decide device mode (coarse pointer ~ touch)
    const isMobile =
      window.matchMedia("(pointer: coarse)").matches ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Enable Cytoscape’s native pinch-zoom and panning
    cy.userZoomingEnabled(true);
    cy.panningEnabled(true);
    (cy as any).wheelSensitivity = isMobile ? 0.25 : 0.5;

    // Ensure touch gestures aren't swallowed by the browser inside the canvas
    if (cyRef.current) {
      // @ts-ignore
      cyRef.current.style.touchAction = isMobile ? "none" : "auto";
    }

    // Label LOD for claims (show full labels when zoomed in)
    const updateLabels = () => {
      const z = cy.zoom();
      cy.style()
        .selector("node[type = 'refClaim'], node[type = 'taskClaim']")
        .style("text-opacity", z > 1.0 ? "1" : "0")
        .update();
    };
    cy.on("zoom", updateLabels);
    updateLabels();

    // Expose for debug
    // @ts-ignore
    window.cy = cy;
    cyInstance.current = cy;

    // Throb active content nodes
    const activatedContentIds = new Set(
      nodes
        .filter((n) => n.type === "refClaim" || n.type === "taskClaim")
        .map((n) => n.content_id)
        .filter(Boolean)
    );
    const activatedNodeIds = new Set(
      [...activatedContentIds].map((cid) => `conte-${cid}`)
    );
    cy.ready(() => {
      cy.nodes().forEach((node) => {
        if (activatedNodeIds.has(node.id())) {
          startThrobbing(node);
          node.addClass("throb");
        }
      });
    });

    // Edge hover tooltips
    cy.on("mouseover", "edge", (event) => {
      const edge = event.target as EdgeSingular;
      const relation = (edge.data("relation") as string) || "related";
      const value = edge.data("value") || 0;
      const label =
        (relation === "supports"
          ? "✅ Supports"
          : relation === "refutes"
          ? "❌ Refutes"
          : "Related") + `: ${Math.round(Math.abs(value) * 100)}%`;
      // @ts-ignore
      const { x, y } =
        (event as any).renderedPosition || (event as any).renderedPosition;
      setHoveredEdgeTooltip({ label, x, y });
    });
    cy.on("mouseout", "edge", () => setHoveredEdgeTooltip(null));

    // Initial fit only
    cy.ready(() => {
      cy.animate({
        fit: { eles: cy.elements(), padding: 15 },
        duration: 500,
        easing: "ease-in-out",
      });
    });

    // Auto-resize: resize canvas only (no re-fit that could fight animations)
    const ro = new ResizeObserver(() => {
      cy.resize();
    });
    if (cyRef.current) ro.observe(cyRef.current);

    // Last-click guard
    const lastClickedNodeId = { current: null as null | string };

    // Tap handler (non-async to preserve original single-tap behavior)
    cy.on("tap", "node", (event) => {
      const node = event.target as NodeSingular;
      const type = node.data("type");

      if (node.id() === lastClickedNodeId.current) return;
      lastClickedNodeId.current = node.id();

      // Capture original layout the first time
      if (cy.nodes('node[type *= "Claim"]').length === 0) {
        saveNodePositions(cy, originalNodePositions);
      }

      if (onNodeClick) onNodeClick(node.data());
      setSelectedNodeData(node.data());

      // Claim node tap → bubble info
      if (type === "refClaim" || type === "taskClaim") {
        const claimId = node.id();
        const connectedEdge = cy
          .edges()
          .filter(
            (edge) =>
              edge.source().id() === claimId || edge.target().id() === claimId
          )
          .toArray()
          .find((e) => ["supports", "refutes"].includes(e.data("relation")));
        const relation =
          (connectedEdge?.data("relation") as string) || "related";
        setSelectedClaim({ id: claimId, label: node.data("label"), relation });
        return;
      }

      // Targeted clearing: existing claim nodes and their edges only
      const claimNodes = cy.nodes('node[type *= "Claim"]');
      const claimEdges = claimNodes.connectedEdges();
      cy.batch(() => {
        claimEdges.remove();
        claimNodes.remove();
      });

      // Restore last ref if switching
      if (
        lastRefNode.current &&
        lastRefOriginalPos.current &&
        lastRefNode.current.id() !== node.id()
      ) {
        lastRefNode.current.position(lastRefOriginalPos.current);
      }
      if (Object.keys(originalNodePositions.current).length > 0) {
        restoreNodePositions(cy, originalNodePositions, true);
      }

      // Reference click → animate scene
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
            animate: true,
          });
        })();
      }
    });

    // Edge click detail
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

    return () => {
      ro.disconnect();
      if (cy) {
        cy.nodes(".throb").forEach((node) =>
          clearInterval(node.data("throbInterval"))
        );
        cy.destroy();
      }
    };
  }, [nodes, links, centerNodeId, toast]);

  return (
    <>
      <Box
        pt={{ base: 0, md: 4 }}
        width={{ base: "100vw", md: "calc(100vw - 300px)" }}
        ml={{ base: 0, md: "8px" }}
        mt={{ base: 0, md: -4 }}
      >
        <Box
          ref={cyRef}
          height={{ base: "calc(100dvh - 98px)", md: "80vh" }} // mobile leaves space for header/tabs
          width="100%"
          borderWidth="1px"
          borderRadius="lg"
          p={{ base: 0, md: 4 }}
          bg={"stat2Gradient"}
          borderColor="gray.300"
        />
      </Box>

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
