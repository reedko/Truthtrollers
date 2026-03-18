import React from "react";
import cytoscape, { NodeSingular } from "cytoscape";
import { animateNode } from "../animation/nodeAnimations";

export function bellValley(
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

export function smartRadialPush({
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

export function pushAwayOtherNodes(
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

export function saveNodePositions(
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

export async function restoreNodePositions(
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
    console.error("Error restoring node positions:", error);
  }
}

// Arrange source nodes in a 3/4 circle arc around the CASE node
export function arrangeSourcesAroundCase({
  cy,
  clickedRefNode,
  taskNode,
}: {
  cy: cytoscape.Core;
  clickedRefNode: NodeSingular;
  taskNode: NodeSingular;
}): void {
  const center = taskNode.position();
  const clickedRefPos = clickedRefNode.position();

  const dx = clickedRefPos.x - center.x;
  const dy = clickedRefPos.y - center.y;
  const angleToClickedRef = Math.atan2(dy, dx);

  // Separate references from authors/publishers
  const otherReferences = cy
    .nodes()
    .filter((node) => {
      const id = node.id();
      const type = node.data("type");
      return (
        id !== clickedRefNode.id() &&
        id !== taskNode.id() &&
        type === "reference"
      );
    })
    .toArray() as cytoscape.NodeSingular[];

  // Don't move authors and publishers - keep them in original positions
  if (otherReferences.length === 0) return;

  // 3/4 circle arc (270 degrees)
  const arcSpan = (Math.PI * 3) / 2;
  const arcStartAngle = angleToClickedRef + Math.PI / 4;

  // Calculate if nodes can fit on single arc without overlapping
  const baseRadius = 550;
  const nodeWidth = 120; // Approximate node width
  const minNodeSpacing = 20; // Minimum gap between nodes
  const requiredSpacing = nodeWidth + minNodeSpacing;

  // Calculate arc length and how many nodes can fit
  const arcLength = baseRadius * arcSpan;
  const maxNodesOnSingleArc = Math.floor(arcLength / requiredSpacing);

  let arcsNeeded = 1;
  if (otherReferences.length > maxNodesOnSingleArc) {
    arcsNeeded = Math.ceil(otherReferences.length / maxNodesOnSingleArc);
  }

  const radiusStagger = 140;

  cy.batch(() => {
    otherReferences.forEach((node, i) => {
      // Determine which arc this node goes on
      const arcIndex =
        arcsNeeded === 1 ? 0 : Math.floor(i / maxNodesOnSingleArc);
      const positionInArc = arcsNeeded === 1 ? i : i % maxNodesOnSingleArc;
      const nodesInThisArc =
        arcsNeeded === 1
          ? otherReferences.length
          : arcIndex === arcsNeeded - 1
            ? otherReferences.length - arcIndex * maxNodesOnSingleArc
            : maxNodesOnSingleArc;

      // Calculate position parameter (0 to 1) for this arc
      const t = nodesInThisArc > 1 ? positionInArc / (nodesInThisArc - 1) : 0.5;
      const angle = arcStartAngle + t * arcSpan;

      // Calculate radius based on which arc
      const radius = baseRadius + arcIndex * radiusStagger;

      const newX = center.x + radius * Math.cos(angle);
      const newY = center.y + radius * Math.sin(angle);

      node.position({ x: newX, y: newY });
    });
  });
}
