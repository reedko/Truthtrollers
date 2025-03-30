// Updated CytoscapeMolecule.tsx — RefClaims and TaskClaims now arc with visual clarity,
// central focus is on the lines between the arcs, and taskClaim arcs align with ref arcs
// Implements edge convergence halfway between claim groups and main nodes

import React, { useEffect, useRef, useState } from "react";
import cytoscape, { NodeSingular } from "cytoscape";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

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

function fanOutClaims({
  cy,
  claims,
  sourceNode,
  targetNode,
  relation,
  minDistance = 100,
  arcSpan = Math.PI / 2,
  centerShiftFactor = 90,
}: {
  cy: cytoscape.Core;
  claims: NodeData[];
  sourceNode: NodeSingular;
  targetNode: NodeSingular;
  relation: string;
  minDistance?: number;
  arcSpan?: number;
  centerShiftFactor?: number;
}): cytoscape.ElementDefinition[] {
  const isRef = sourceNode.data("type") === "reference";
  const originalPos = { ...sourceNode.position() };
  const targetPos = targetNode.position();
  const dx = targetPos.x - originalPos.x;
  const dy = targetPos.y - originalPos.y;
  const angleRadians = Math.atan2(dy, dx);
  const arcPadding = centerShiftFactor * claims.length;

  if (isRef) {
    const shiftedPos = {
      x: originalPos.x - arcPadding * Math.cos(angleRadians),
      y: originalPos.y - arcPadding * Math.sin(angleRadians),
    };
    sourceNode.position(shiftedPos);
  }

  const arcCenter = sourceNode.position();
  const neededArcLength = Math.max(2, claims.length - 1) * minDistance;
  const radius = neededArcLength / arcSpan;
  const added: cytoscape.ElementDefinition[] = [];

  claims.forEach((claim, i) => {
    const angle =
      -arcSpan / 2 + (i / (claims.length - 1 || 1)) * arcSpan + angleRadians;
    const x = arcCenter.x + radius * Math.cos(angle);
    const y = arcCenter.y + radius * Math.sin(angle);

    added.push({ data: claim });
    cy.add({ data: claim });
    const claimNode = cy.getElementById(claim.id).first() as NodeSingular;
    claimNode.position(arcCenter);
    claimNode.animate({ position: { x, y } }, { duration: 400 });

    added.push({
      data: {
        id: `edge-${claim.id}-${sourceNode.id()}`,
        source: claim.id,
        target: sourceNode.id(),
        relation,
      },
    });
  });

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
  const [selectedClaim, setSelectedClaim] = useState<null | {
    id: string;
    label: string;
    relation: string;
  }>(null);
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
      nodes.find((n) => n.type === "task"); // fallback
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

      // 🧪 Dynamic spiral controls
      const clamp = (min: number, max: number, value: number) =>
        Math.max(min, Math.min(max, value));

      // 🔄 Inverse scaling: tighter with more refs
      const angleMultiplier = clamp(0.1, 0.6, 0.7 - Math.log(refCount) * 0.07);
      const spiralGrowth = clamp(10, 40, 60 - Math.log(refCount) * 10);
      const spiralStart = 150; // start farther from center

      // 🌀 Spiral math
      const angleStep = Math.PI / 4; // finer turns
      const angle = angleMultiplier * refIndex * angleStep;
      const radius = spiralStart + spiralGrowth * angle;

      let x = centerX + radius * Math.cos(angle);
      let y = centerY + radius * Math.sin(angle);

      // 📍 Override for special types
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
                  0: `authors/author_id_${id.replace("autho-", "")}.png`,
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
            width: 2,
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

    // 🧠 Keep track of last clicked node
    const lastClickedNodeId = { current: null };
    // 📌 Main event handler
    cy.on("tap", "node", (event) => {
      const node = event.target;
      const type = node.data("type");
      const contentId = node.data("content_id");

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
          relation,
        });
        return;
      }

      // 🧽 Remove existing claims
      cy.elements('node[type *= "Claim"], edge[relation]').remove();
      // Only restore if layout was previously saved
      if (
        lastRefNode.current &&
        lastRefOriginalPos.current &&
        lastRefNode.current.id() !== node.id()
      ) {
        lastRefNode.current.position(lastRefOriginalPos.current);
      }
      if (Object.keys(originalNodePositions.current).length > 0) {
        restoreNodePositions(cy, originalNodePositions);
      }
      // 📍 Handle reference click
      if (type === "reference") {
        setTimeout(() => {
          saveNodePositions(cy, originalNodePositions); // Save before fanout

          const refClaims = nodes.filter(
            (n) => n.type === "refClaim" && n.content_id === contentId
          );
          const claimLinks = links.filter((l) =>
            refClaims.some((rc) => rc.id === l.source)
          );

          const taskClaimMap = new Map(
            nodes.filter((n) => n.type === "taskClaim").map((n) => [n.id, n])
          );
          const linkedTaskClaims: NodeData[] = [];
          const seen = new Set<string>();
          claimLinks.forEach((link) => {
            if (!seen.has(link.target)) {
              const claim = taskClaimMap.get(link.target);
              if (claim) {
                linkedTaskClaims.push(claim);
                seen.add(link.target);
              }
            }
          });

          if (refClaims.length === 0 && linkedTaskClaims.length === 0) {
            console.log("🛑 No claims to show for this reference.");
            return;
          }

          lastRefOriginalPos.current = { ...node.position() };
          lastRefNode.current = node;

          const taskNode = cy
            .nodes()
            .filter('[type = "task"]')
            .first() as NodeSingular;
          const added: cytoscape.ElementDefinition[] = [];

          const refClaimElements = fanOutClaims({
            cy,
            claims: refClaims,
            sourceNode: node,
            targetNode: taskNode,
            relation: "evidence",
          });
          added.push(...refClaimElements);

          const taskClaimElements = fanOutClaims({
            cy,
            claims: linkedTaskClaims,
            sourceNode: taskNode,
            targetNode: node,
            relation: "evidence",
          });
          added.push(...taskClaimElements);

          claimLinks.forEach((link) => added.push({ data: link }));

          cy.add(added);
          // 🌀 Instant zoom-to-fit
          cy.fit(cy.elements(), 15);
          pushAwayOtherNodes(cy, node.position(), [node.id(), taskNode.id()]);
          // ✅ Capture new positions after push, so we can restore accurately later
        }, 420);
      }
    });

    return () => cy.destroy();
  }, [nodes, links]);

  return (
    <>
      <div
        ref={cyRef}
        style={{ width: "100vw", height: "750px", backgroundColor: "#111" }}
      />
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
    </>
  );
};

export default CytoscapeMolecule;
