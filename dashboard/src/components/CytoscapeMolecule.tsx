// Updated CytoscapeMolecule.tsx — RefClaims and TaskClaims now arc with visual clarity,
// central focus is on the lines between the arcs, and taskClaim arcs align with ref arcs
// Implements edge convergence halfway between claim groups and main nodes

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, useToast } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

// ----------------------------- helpers / animations -----------------------------

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

  // Step 2: Get ref and task claims and relevant links
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

  // Step 3: Scatter away from node
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

  // Step 4: Fan out claims
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

  // Step 5: Add edges
  const addedEdges = claimLinks.map((link) => ({
    data: {
      ...link,
      relation: (link.relation as any) || "related",
    },
  }));

  cy.add([...refClaimElements, ...taskClaimElements, ...addedEdges]);

  cy.animate({
    fit: { eles: cy.elements(), padding: 30 },
    duration: 500,
  });

  if (animate) {
    await cy.promiseOn("viewport");
  } else {
    cy.fit(cy.elements(), 30);
  }
  // Step 6: Fit view
  if (animate) {
    await new Promise((res) => setTimeout(res, 400));
    cy.animate({ fit: { eles: cy.elements(), padding: 30 }, duration: 300 });
  } else {
    cy.fit(cy.elements(), 30);
  }
}

function animateNode(
  node: NodeSingular,
  options: { position: { x: number; y: number } },
  duration = 400
): Promise<void> {
  return new Promise((resolve) => {
    node.animate(options, {
      duration,
      complete: () => resolve(),
    });
  });
}

function animateNodes(
  nodes: cytoscape.SingularElementArgument[],
  optionsList: { position: { x: number; y: number } }[],
  duration = 500
): Promise<void> {
  return new Promise((resolve) => {
    let finished = 0;
    nodes.forEach((node, i) => {
      node.animate(optionsList[i], {
        duration,
        easing: "ease-in-out",
        complete: () => {
          finished++;
          if (finished === nodes.length) resolve();
        },
      });
    });
    if (nodes.length === 0) resolve();
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
    if (dist <= dipRange) {
      return dist;
    } else {
      const decay = dist - dipRange;
      return dipRange - decay * 0.7;
    }
  }

  const optionsList = nodesToScatter.map((node, i) => {
    const t = i / Math.max(1, nodesToScatter.length - 1);
    const angle = startAngle + t * arcSpan;

    const rOffset = Math.max(0, valleyCurve(i)) * radiusStep;
    const effectiveRadius = radius + rOffset;

    const newX = center.x + effectiveRadius * Math.cos(angle);
    const newY = center.y + effectiveRadius * Math.sin(angle);

    return { node, position: { x: newX, y: newY } };
  });

  const promises = optionsList.map(({ node, position }) =>
    animate
      ? animateNode(node, { position }, 500)
      : (node.position(position), Promise.resolve())
  );

  Promise.all(
    nodesToScatter.map((node, i) => {
      const pos = optionsList[i].position;
      return animate
        ? animateNode(node, { position: pos }, 500)
        : (node.position(pos), Promise.resolve());
    })
  );
}

// Put this near the top if you like tidy types
type ClaimWithRelation = {
  claim: NodeData;
  relation: "supports" | "refutes" | "related";
  notes: string;
};

type FanOutArgs = {
  cy: cytoscape.Core;
  claimsWithRelation: ClaimWithRelation[];
  sourceNode: NodeSingular;
  targetNode: NodeSingular;
  minDistance?: number;
  arcSpan?: number;
  centerShiftFactor?: number;
  animate?: boolean;
};

// ✅ Correctly annotated return type AFTER the param list
async function fanOutClaims({
  cy,
  claimsWithRelation,
  sourceNode,
  targetNode,
  minDistance = 100,
  arcSpan = Math.PI / 2,
  centerShiftFactor = 90,
  animate = true,
}: FanOutArgs): Promise<cytoscape.ElementDefinition[]> {
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

  // Add missing claim nodes + edges back to sourceNode
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

  // Place the claims along an arc between source and target
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
      return animateNode(claimNode, { position: { x, y } }, 400);
    } else {
      claimNode.position({ x, y });
      return Promise.resolve();
    }
  });

  await Promise.all(promises);
  return added;
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

async function restoreNodePositions(
  cy: cytoscape.Core,
  store: React.MutableRefObject<Record<string, cytoscape.Position>>,
  animate: boolean = true
): Promise<void> {
  const promises: Promise<void>[] = [];
  Object.entries(store.current).forEach(([id, pos]) => {
    const nodeToRestore = cy.getElementById(id).first();
    if (
      nodeToRestore &&
      (nodeToRestore as any).nonempty &&
      nodeToRestore.nonempty() &&
      nodeToRestore.isNode()
    ) {
      if (animate) {
        promises.push(
          animateNode(
            nodeToRestore as unknown as NodeSingular,
            { position: pos },
            400
          )
        );
      } else {
        (nodeToRestore as unknown as NodeSingular).position(pos);
        promises.push(Promise.resolve());
      }
    }
  });
  await Promise.all(promises);
}

// ---- CytoscapeThrobbage™ ----
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

// ----------------------------- component -----------------------------

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export interface CytoscapeMoleculeProps {
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
    value?: number; // used for edge width/label strength
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
            "control-point-distances": [40],
            "control-point-weights": [0.5],
          },
        },
      ],
    });

    // Make interactive on phones
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    cy.userZoomingEnabled(true);
    cy.panningEnabled(true);
    (cy as any).wheelSensitivity = isMobile ? 0.25 : 0.5;

    // Label LOD: show labels more when zoomed in
    const updateLabels = () => {
      const z = cy.zoom();
      cy.style()
        .selector("node[type = 'refClaim'], node[type = 'taskClaim']")
        .style("text-opacity", z > 1.0 ? "1 " : "0")
        .update();
    };
    cy.on("zoom", updateLabels);
    updateLabels();

    // Expose for debugging
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

    // Hover tooltips on edges
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

      const { x, y } = (event as any).renderedPosition;
      setHoveredEdgeTooltip({ label, x, y });
    });
    cy.on("mouseout", "edge", () => setHoveredEdgeTooltip(null));

    // Shift + wheel zoom (desktop convenience)
    cyRef.current?.addEventListener(
      "wheel",
      (e: WheelEvent & { wheelDelta?: number }) => {
        const isShift = e.shiftKey;
        const c = cyInstance.current;
        if (!c || !isShift) return;

        const direction =
          e.deltaY && e.deltaY !== 0
            ? e.deltaY < 0
            : !!(e.wheelDelta && e.wheelDelta > 0);
        const zoomFactor = 1.05;
        if (cyRef.current) {
          const { left, top } = cyRef.current.getBoundingClientRect();
          const x = e.clientX - left;
          const y = e.clientY - top;
          const newZoom = c.zoom() * (direction ? zoomFactor : 1 / zoomFactor);
          c.zoom({ level: newZoom, renderedPosition: { x, y } });
        }
        e.preventDefault();
      },
      { passive: false }
    );

    // Fit on ready
    cy.ready(() => {
      cy.animate({
        fit: { eles: cy.elements(), padding: 15 },
        duration: 500,
        easing: "ease-in-out",
      });
    });

    // helper: current viewport center in *rendered* pixels
    const getViewportCenter = () => ({ x: cy.width() / 2, y: cy.height() / 2 });

    const onZoomIn = () =>
      cy.zoom({
        level: cy.zoom() * 1.2,
        renderedPosition: getViewportCenter(),
      });

    const onZoomOut = () =>
      cy.zoom({
        level: cy.zoom() / 1.2,
        renderedPosition: getViewportCenter(),
      });

    const onFit = () => cy.fit(cy.elements(), 28);
    window.addEventListener("tt-zoom-in", onZoomIn as any);
    window.addEventListener("tt-zoom-out", onZoomOut as any);
    window.addEventListener("tt-fit", onFit as any);

    // Auto-resize/fit
    const ro = new ResizeObserver(() => {
      cy.resize();
      if (cy.elements().length) cy.fit(undefined, 28);
    });
    if (cyRef.current) ro.observe(cyRef.current);

    // Main interaction
    const lastClickedNodeId = { current: null as null | string };
    cy.on("tap", "node", (event) => {
      const node = event.target as NodeSingular;
      const type = node.data("type");

      if (node.id() === lastClickedNodeId.current) return;
      lastClickedNodeId.current = node.id();

      if (cy.nodes('node[type *= "Claim"]').length === 0) {
        saveNodePositions(cy, originalNodePositions);
      }

      if (onNodeClick) onNodeClick(node.data());
      setSelectedNodeData(node.data());

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

        setSelectedClaim({
          id: claimId,
          label: node.data("label"),
          relation,
        });
        return;
      }

      // Clear existing claim nodes/edges and restore layout if switching ref
      const animate = true;
      cy.elements('node[type *= "Claim"], edge[relation]').remove();

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
            animate,
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

    // Cleanup
    return () => {
      window.removeEventListener("tt-zoom-in", onZoomIn as any);
      window.removeEventListener("tt-zoom-out", onZoomOut as any);
      window.removeEventListener("tt-fit", onFit as any);
      ro.disconnect();
      if (cy) {
        cy.nodes(".throb").forEach((node) => {
          clearInterval(node.data("throbInterval"));
        });
        cy.destroy();
      }
    };
  }, [nodes, links, centerNodeId, toast]);

  return (
    <>
      {/* outer wrapper: just fill parent, no vw, no margins */}
      <Box w="100%" h="100%" overflow="hidden" minW={0} minH={0}>
        <Box
          ref={cyRef}
          w="100%"
          h="100%"
          borderWidth="1px"
          borderRadius="lg"
          p={{ base: 0, md: 4 }}
          bg="stat2Gradient"
          borderColor="gray.300"
          // ensure the inner div respects flex shrink/grow
          sx={{ minWidth: 0, minHeight: 0, boxSizing: "border-box" }}
        />
      </Box>

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
