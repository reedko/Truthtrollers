import React, { useEffect, useRef, useState } from "react";
import cytoscape, { EdgeSingular, NodeSingular } from "cytoscape";
import { Box, Button, Text, useToast } from "@chakra-ui/react";
import { createPortal } from "react-dom";
import { GraphNode } from "../../../shared/entities/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// 🧠 Dynamic node image resolver
function getImageUrl(id: string, type: string): string {
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
}

// 💾 Save layout of non-claim nodes (task, refs, authors, pubs)
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

// 🔁 Restore prior layout (if a new node was clicked)
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
function fanOutClaims({
  cy,
  claimsWithRelation,
  sourceNode,
  targetNode,
  minDistance = 100,
  arcSpan = Math.PI / 2,
  centerShiftFactor = 90,
}: {
  cy: cytoscape.Core;
  claimsWithRelation: {
    claim: GraphNode;
    relation: "supports" | "refutes" | "related";
    notes: string;
  }[];
  sourceNode: NodeSingular;
  targetNode: NodeSingular;
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
  const arcPadding = centerShiftFactor * claimsWithRelation.length;

  if (isRef) {
    const shiftedPos = {
      x: originalPos.x - arcPadding * Math.cos(angleRadians),
      y: originalPos.y - arcPadding * Math.sin(angleRadians),
    };
    sourceNode.position(shiftedPos);
  }

  const arcCenter = sourceNode.position();
  const radius =
    (Math.max(2, claimsWithRelation.length - 1) * minDistance) / arcSpan;
  const added: cytoscape.ElementDefinition[] = [];

  claimsWithRelation.forEach(({ claim, relation, notes }, i) => {
    const angle =
      -arcSpan / 2 +
      (i / (claimsWithRelation.length - 1 || 1)) * arcSpan +
      angleRadians;
    const x = arcCenter.x + radius * Math.cos(angle);
    const y = arcCenter.y + radius * Math.sin(angle);

    if (!cy.getElementById(claim.id).nonempty()) {
      cy.add({ data: claim });
      added.push({ data: claim });
    }

    const claimNode = cy.getElementById(claim.id).first() as NodeSingular;
    claimNode.position(arcCenter);
    claimNode.animate({ position: { x, y } }, { duration: 400 });

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

  return added;
}

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
    const group =
      n.type === "author"
        ? 1
        : n.type === "task" || n.type === "reference"
        ? 2
        : n.type === "publisher"
        ? 3
        : 0;

    const getImageUrl = (id: string) => {
      const path =
        {
          0: `authors/author_id_${id.replace("autho-", "")}.png`,
          1: `authors/author_id_${id.replace("autho-", "")}.png`,
          2: `content/content_id_${id.replace("conte-", "")}.png`,
          3: `publishers/publisher_id_${id.replace("publi-", "")}.png`,
        }[group] || `default.png`;

      return `${API_BASE_URL}/assets/images/${path}`;
    };

    if (n.id === centerNode?.id) {
      return {
        data: {
          ...n,
          image: getImageUrl(n.id),
        },
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
      data: {
        ...n,
        image: getImageUrl(n.id),
      },
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
    elements: {
      nodes: positionedNodes,
      edges: initialEdges,
    },
    layout: { name: "preset" },
    style: [
      {
        selector: "node",
        style: {
          shape: "ellipse",
          width: 90,
          height: 90,
          "background-color": "#444",
          "background-image": "data(image)",
          "background-fit": "cover",
          "background-clip": "node",
          "border-width": 2,
          "border-color": "#222",
          label: "data(label)",
          color: "#fff",
          "text-valign": "bottom",
          "text-halign": "center",
          "font-size": 10,
          "text-background-color": "#000",
          "text-background-opacity": 0.6,
          "text-background-padding": 2,
          "text-border-radius": 4,
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": (ele: EdgeSingular) => {
            const rel = ele.data("relation");
            return rel === "supports"
              ? "#0f6"
              : rel === "refutes"
              ? "#f33"
              : "#999";
          },
          "curve-style": "unbundled-bezier",
          "control-point-distance": 80,
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#ccc",
        },
      },
    ],
  });

  cyInstance.current = cy;

  // 🚀 Trigger initial fit
  cy.ready(() => {
    cy.animate({
      fit: { eles: cy.elements(), padding: 20 },
      duration: 400,
      easing: "ease-in-out",
    });
  });

  // (👉 Next part will handle node clicks for reference claim fanout + reframe support)

  return () => cy.destroy();
}, [nodes, links, centerNodeId]);
  // 🧠 Keep track of last clicked node
  const lastClickedNodeId = useRef<string | null>(null);

  // 🔥 Main click logic
  cy.on("tap", "node", (event) => {
    const node = event.target;
    const type = node.data("type");
    const contentId = node.data("content_id");

    if (node.id() === lastClickedNodeId.current) {
      console.log("🛑 Same node clicked again — skipping.");
      return;
    }
    lastClickedNodeId.current = node.id();

    // 🧠 Optional: Send selection to parent
    if (onNodeClick) onNodeClick(node.data());
    setSelectedNodeData(node.data());

    // 🧽 Remove existing claims (refClaim + taskClaim)
    cy.elements('node[type *= "Claim"], edge[relation]').remove();

    if (type === "refClaim" || type === "taskClaim") return;

    // 🧠 Find task node
    const taskNode = cy.nodes('[type = "task"]').first() as NodeSingular;

    // Restore layout before new fanout
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

    // 🔍 Handle Reference Node Click
    if (type === "reference") {
      lastRefNode.current = node;
      lastRefOriginalPos.current = { ...node.position() };

      saveNodePositions(cy, originalNodePositions);

      const refClaims = nodes.filter(
        (n) => n.type === "refClaim" && n.content_id === contentId
      );
      const claimLinks = links.filter((l) =>
        refClaims.some((rc) => rc.id === l.source)
      );

      const claimsWithRelation = claimLinks
        .map((link) => {
          const claim = refClaims.find((rc) => rc.id === link.source);
          if (!claim) return null;
          return {
            claim,
            relation: ["supports", "refutes", "related"].includes(
              link.relation || ""
            )
              ? (link.relation as "supports" | "refutes" | "related")
              : "related",
            notes: link.notes || "",
          };
        })
        .filter((x): x is {
          claim: GraphNode;
          relation: "supports" | "refutes" | "related";
          notes: string;
        } => !!x);

      const taskClaimMap = new Map(
        nodes.filter((n) => n.type === "taskClaim").map((n) => [n.id, n])
      );

      const taskClaimsWithRelation = claimLinks
        .map((link) => {
          const claim = taskClaimMap.get(link.target);
          if (!claim) return null;
          return {
            claim,
            relation: ["supports", "refutes", "related"].includes(
              link.relation || ""
            )
              ? (link.relation as "supports" | "refutes" | "related")
              : "related",
            notes: link.notes || "",
          };
        })
        .filter((x): x is {
          claim: GraphNode;
          relation: "supports" | "refutes" | "related";
          notes: string;
        } => !!x);

      if (refClaims.length === 0 && taskClaimsWithRelation.length === 0) {
        console.log("🛑 No claims for this reference.");
        return;
      }

      const refElems = fanOutClaims({
        cy,
        claimsWithRelation,
        sourceNode: node,
        targetNode: taskNode,
      });

      const taskElems = fanOutClaims({
        cy,
        claimsWithRelation: taskClaimsWithRelation,
        sourceNode: taskNode,
        targetNode: node,
      });

      const extraLinks = claimLinks.map((link) => ({
        data: {
          ...link,
          relation: ["supports", "refutes", "related"].includes(
            link.relation || ""
          )
            ? link.relation
            : "related",
        },
      }));

      cy.add([...refElems, ...taskElems, ...extraLinks]);
      cy.fit(cy.elements(), 25);
      fartScatterAwayFromRef({ cy, refNode: node, taskNode });
    }
  });

  // 🎯 Handle edge click (show modal)
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
          bg="stat2Gradient"
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

