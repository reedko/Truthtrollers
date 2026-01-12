// Updated CytoscapeMolecule.tsx — RefClaims and TaskClaims now arc with visual clarity,
// central focus is on the lines between the arcs, and taskClaim arcs align with ref arcs
// Implements edge convergence halfway between claim groups and main nodes

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, Button, Text, useToast, CloseButton } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

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
            relation: link.relation || "related",
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
            relation: link.relation || "related",
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
      relation: link.relation || "related",
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
    .toArray() as cytoscape.NodeSingular[]; // ⬅️ type assertion here

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
      return animateNode(claimNode, { position: { x, y } }, 400);
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
  range: number
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
      `🔄 Smart-pushing ${id} to (${newX.toFixed(1)}, ${newY.toFixed(1)})`
    );

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

      console.log(
        `🧼 Pushing ${type} node ${id} from (${pos.x}, ${pos.y}) to (${newX}, ${newY})`
      );

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
    const coll = cy.getElementById(id);
    if (coll.length > 0 && coll.isNode()) {
      const nodeToRestore = coll.first() as NodeSingular;
      if (animate) {
        promises.push(animateNode(nodeToRestore, { position: pos }, 400));
      } else {
        nodeToRestore.position(pos);
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
  let throbInterval = setInterval(() => {
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
// All other unchanged code is retained as-is

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

  // HUD toggles (Legend starts hidden to avoid blocking)
  const [showMobileHUD, setShowMobileHUD] = useState(true);
  const [showLegend, setShowLegend] = useState(false);

  const lastRefNode = useRef<NodeSingular | null>(null);
  const lastRefOriginalPos = useRef<{ x: number; y: number } | null>(null);
  const originalNodePositions = useRef<
    Record<string, { x: number; y: number }>
  >({});

  useEffect(() => {
    console.log("🧪 CytoscapeMolecule mount — received links:", links);
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
    // @ts-ignore
    window.cy = cy;
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
          { passive: false }
        );
      }
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
      // 🧠 Handle claim node click
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
        const relation = connectedEdge?.data("relation") || "related";

        setSelectedClaim({
          id: claimId,
          label: node.data("label"),
          relation: relation,
        });
        return;
      }

      // 🧽 Remove existing claims
      const animate = true; // or true, depending on what you want
      const claimNodes = cy.nodes('node[type *= "Claim"]');
      const claimEdges = claimNodes.connectedEdges();
      cy.batch(() => {
        claimEdges.remove();
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
      // 📍 Handle reference click
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

    // 🎯 Handle edge click (relation line between claims)
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
      if (cy) {
        cy.nodes(".throb").forEach((node) => {
          clearInterval(node.data("throbInterval"));
        });
        cy.destroy();
      }
    };
  }, [nodes, links]);

  // helpers for mobile HUD buttons (no extra listeners)
  const fitAll = () => {
    const cy = cyInstance.current;
    if (!cy) return;
    cy.fit(cy.elements(), 28);
  };
  const centerTask = () => {
    const cy = cyInstance.current;
    if (!cy) return;
    const task = cy.nodes('[type = "task"]');
    if (task.length > 0) cy.center(task);
    else cy.center();
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
          ref={cyRef}
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
        />
      </Box>

      {/* MOBILE HUD (bottom-right). No listener changes, pure actions. */}
      {showMobileHUD ? (
        <Box
          display={{ base: "block", md: "none" }}
          position="absolute"
          right="10px"
          top="10px"
          bg="rgba(20,20,20,0.92)"
          color="#fff"
          borderRadius="12px"
          p="10px"
          zIndex={1000}
          boxShadow="0 6px 24px rgba(0,0,0,0.35)"
        >
          <CloseButton
            size="sm"
            onClick={() => setShowMobileHUD(false)}
            position="absolute"
            top="6px"
            right="6px"
            color="#fff"
          />
          <Text fontSize="xs" opacity={0.8} mb={2}>
            Graph Controls
          </Text>
          <Button
            size="xs"
            variant="solid"
            onClick={fitAll}
            mr={2}
            colorScheme="purple"
          >
            Reframe Graph
          </Button>
          <Button size="xs" variant="outline" onClick={centerTask}>
            Center Graph
          </Button>
        </Box>
      ) : (
        <Button
          display={{ base: "inline-flex", md: "none" }}
          position="absolute"
          right="4px"
          top="10px"
          size="xs"
          onClick={() => setShowMobileHUD(true)}
          zIndex={1000}
        >
          Show Controls
        </Button>
      )}

      {/* MOBILE LEGEND (bottom-left) — starts hidden to avoid blocking */}
      {showLegend ? (
        <Box
          display={{ base: "block", md: "none" }}
          position="absolute"
          left="1px"
          top="10px"
          bg="rgba(20,20,20,0.92)"
          color="#fff"
          borderRadius="12px"
          p="10px"
          zIndex={1000}
          boxShadow="0 6px 24px rgba(0,0,0,0.35)"
          maxW="58vw"
        >
          <CloseButton
            size="sm"
            onClick={() => setShowLegend(false)}
            position="absolute"
            top="6px"
            right="6px"
            color="#fff"
          />
          <Text fontSize="xs" opacity={0.8} mb={2}>
            Legend
          </Text>
          <Box fontSize="xs" lineHeight="1.4">
            <Box display="flex" alignItems="center" mb={1}>
              <Box w="10px" h="10px" bg="#6c5ce7" borderRadius="2px" mr={2} />
              Task
            </Box>
            <Box display="flex" alignItems="center" mb={1}>
              <Box w="10px" h="10px" bg="#00b894" borderRadius="2px" mr={2} />
              Reference
            </Box>
            <Box display="flex" alignItems="center" mb={1}>
              <Box w="10px" h="10px" bg="#aaa" borderRadius="2px" mr={2} />
              Ref Claim
            </Box>
            <Box display="flex" alignItems="center" mb={1}>
              <Box w="10px" h="10px" bg="#ffeaa7" borderRadius="2px" mr={2} />
              Task Claim
            </Box>
            <Box display="flex" alignItems="center" mb={1}>
              <Box w="10px" h="10px" bg="#fab1a0" borderRadius="2px" mr={2} />
              Author
            </Box>
            <Box display="flex" alignItems="center">
              <Box w="10px" h="10px" bg="#81ecec" borderRadius="2px" mr={2} />
              Publisher
            </Box>
            <Box display="flex" alignItems="center">
              SHIFT + SCROLL to ZOOM
            </Box>
          </Box>
        </Box>
      ) : (
        <Button
          display={{ base: "inline-flex", md: "none" }}
          position="absolute"
          left="4px"
          top="10px"
          size="xs"
          onClick={() => setShowLegend(true)}
          zIndex={1000}
          variant="outline"
        >
          Show Legend
        </Button>
      )}

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
            <h3 style={{ fontSize: "1rem", lineHeight: 1.2 }}>
              {selectedClaim.relation === "supports"
                ? "✅ Supports"
                : selectedClaim.relation === "refutes"
                ? "❌ Refutes"
                : "Claim"}
            </h3>
            <p style={{ marginTop: 12, fontSize: "0.95rem", lineHeight: 1.35 }}>
              {selectedClaim.label}
            </p>
            <button
              onClick={() => setSelectedClaim(null)}
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
          document.body
        )}
    </>
  );
};

export default CytoscapeMolecule;
