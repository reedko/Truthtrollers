import React from "react";
import cytoscape, { NodeSingular } from "cytoscape";
import { NodeData, LinkData } from "../types";
import { arrangeSourcesAroundCase } from "../layout/layoutHelpers";
import { restartAllThrobs } from "./nodeAnimations";

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

    // Step 1: Get ref and task claims and relevant links
    const refClaims = nodes.filter(
      (n) => n.type === "refClaim" && n.content_id === contentId,
    );
    const claimLinks = links.filter((l) =>
      refClaims.some((rc) => rc.id === l.source),
    );

    const taskClaimMap = new Map(
      nodes.filter((n) => n.type === "taskClaim").map((n) => [n.id, n]),
    );

    if (refClaims.length === 0 || claimLinks.length === 0) return;

    lastRefOriginalPos.current = { ...node.position() };
    lastRefNode.current = node;

    cy.batch(() => {
      cy.nodes('[type = "refClaim"], [type = "taskClaim"]').remove();
    });

    let taskPos = taskNode.position();
    let refPos = node.position();
    let dx = refPos.x - taskPos.x;
    let dy = refPos.y - taskPos.y;
    let angleToRef = Math.atan2(dy, dx);

    const optimalDistance = 950;
    const newRefX = taskPos.x + optimalDistance * Math.cos(angleToRef);
    const newRefY = taskPos.y + optimalDistance * Math.sin(angleToRef);

    node.position({ x: newRefX, y: newRefY });

    // Arrange other sources immediately without animation
    arrangeSourcesAroundCase({
      cy,
      clickedRefNode: node,
      taskNode,
    });

    taskPos = taskNode.position();
    refPos = node.position();
    dx = refPos.x - taskPos.x;
    dy = refPos.y - taskPos.y;
    angleToRef = Math.atan2(dy, dx);
    const refTaskEdges = cy.edges().filter((edge) => {
      const source = edge.source();
      const target = edge.target();
      return (
        (source.id() === node.id() && target.id() === taskNode.id()) ||
        (source.id() === taskNode.id() && target.id() === node.id())
      );
    });
    refTaskEdges.style("display", "none");

    // Step 8: Position claim nodes in arcs around their parent nodes
    // (positions already recalculated above)

    // Arc radius for claims - tighter for source claims to prevent overlap
    const taskClaimArcRadius = 280;
    const refClaimArcRadius = 300; // Give claims more breathing room from source

    // Arc span - how wide the arc of claims should be
    const arcSpan = Math.PI / 1.5; // ~120 degrees

    const claimElements: cytoscape.ElementDefinition[] = [];
    const edgeElements: cytoscape.ElementDefinition[] = [];
    const animationData: Array<{ nodeId: string; x: number; y: number }> = [];

    // First pass: collect all data
    claimLinks.forEach((link, i) => {
      const refClaim = refClaims.find((rc) => rc.id === link.source);
      const taskClaim = taskClaimMap.get(link.target);

      if (!refClaim || !taskClaim) return;

      // Calculate arc position parameter (0 to 1) - reversed for taskClaims to align edges
      const t = claimLinks.length > 1 ? i / (claimLinks.length - 1) : 0.5;
      const tReversed = 1 - t; // Reverse order for task claims

      // RefClaim: Arc around the reference node (bottom to top) - smaller radius
      const refArcCenter = angleToRef + Math.PI; // Point toward task
      const refArcStart = refArcCenter - arcSpan / 2;
      const refAngle = refArcStart + t * arcSpan;
      const refX = refPos.x + refClaimArcRadius * Math.cos(refAngle);
      const refY = refPos.y + refClaimArcRadius * Math.sin(refAngle);

      // TaskClaim: Arc around the task node (reversed, top to bottom, to align with refClaims)
      const taskArcCenter = angleToRef; // Point toward reference
      const taskArcStart = taskArcCenter - arcSpan / 2;
      const taskAngle = taskArcStart + tReversed * arcSpan;
      const taskX = taskPos.x + taskClaimArcRadius * Math.cos(taskAngle);
      const taskY = taskPos.y + taskClaimArcRadius * Math.sin(taskAngle);

      // Collect refClaim node if it doesn't exist
      if (cy.getElementById(refClaim.id).length === 0) {
        claimElements.push({
          data: refClaim,
          position: { x: refPos.x, y: refPos.y }, // Start at reference
        });
      }
      animationData.push({ nodeId: refClaim.id, x: refX, y: refY });

      // Collect taskClaim node if it doesn't exist
      if (cy.getElementById(taskClaim.id).length === 0) {
        claimElements.push({
          data: taskClaim,
          position: { x: taskPos.x, y: taskPos.y }, // Start at task
        });
      }
      animationData.push({ nodeId: taskClaim.id, x: taskX, y: taskY });

      // Collect edges
      edgeElements.push({
        data: {
          id: `edge-ref-${node.id()}-refclaim-${refClaim.id}`,
          source: node.id(),
          target: refClaim.id,
          relation: "contains",
        },
      });

      edgeElements.push({
        data: {
          id: `edge-task-${taskNode.id()}-taskclaim-${taskClaim.id}`,
          source: taskNode.id(),
          target: taskClaim.id,
          relation: "contains",
        },
      });

      edgeElements.push({
        data: {
          ...link,
          id: `edge-refclaim-${refClaim.id}-taskclaim-${taskClaim.id}`,
          relation: link.relation || "related",
        },
      });
    });

    // Add all nodes and edges in batches
    cy.batch(() => {
      if (claimElements.length > 0) {
        cy.add(claimElements);
      }
      if (edgeElements.length > 0) {
        cy.add(edgeElements);
      }
    });

    // Position all claim nodes directly - no animation
    cy.batch(() => {
      animationData.forEach(({ nodeId, x, y }) => {
        const nodeEle = cy.getElementById(nodeId);
        if (nodeEle.length > 0) {
          nodeEle.position({ x, y });
        }
      });
    });

    // Fit view to show all nodes with optimal zoom
    cy.fit(cy.nodes(), 50);

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
