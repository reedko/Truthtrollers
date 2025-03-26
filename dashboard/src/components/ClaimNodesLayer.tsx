// ClaimNodesLayer.tsx
import * as d3 from "d3";
import { useEffect } from "react";
import { GraphNode, Link } from "../../../shared/entities/types";

interface ClaimNodesLayerProps {
  svgGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  nodes: GraphNode[];
  links: Link[];
  referenceId: string | null;
  onClaimClick?: (node: GraphNode) => void;
}

const ClaimNodesLayer = ({
  svgGroup,
  nodes,
  links,
  referenceId,
  onClaimClick,
}: ClaimNodesLayerProps) => {
  useEffect(() => {
    svgGroup.selectAll(".claim-group").remove();
    svgGroup.selectAll(".ghost-link").remove();
    svgGroup.selectAll(".claim-link").remove();

    if (!referenceId) return;

    const refNode = nodes.find(
      (n) => n.type === "reference" && String(n.content_id) === referenceId
    );
    if (!refNode || refNode.x == null || refNode.y == null) {
      console.warn("❗Reference node not found or unpositioned:", referenceId);
      return;
    }

    const refClaims = nodes.filter(
      (n) =>
        n.type === "refClaim" && String(n.content_id) === String(referenceId)
    );

    const connectedLinks = links.filter(
      (l) =>
        typeof l.source === "object" &&
        typeof l.target === "object" &&
        refClaims.some((rc) => rc.claim_id === l.source.claim_id)
    );

    const taskClaims = connectedLinks
      .map((l) => l.target as GraphNode)
      .filter((tc, i, arr) => arr.findIndex((x) => x.id === tc.id) === i);

    const taskNode = nodes.find((n) => n.type === "task");
    if (!taskNode || taskNode.x == null || taskNode.y == null) return;

    // Determine relative position of refNode to taskNode
    const refSide = refNode.x < taskNode.x ? -1 : 1;
    const radius = 140;

    refClaims.forEach((node, i) => {
      const angle = (i / refClaims.length) * 2 * Math.PI;
      node.fx = refNode.x! + Math.cos(angle) * radius;
      node.fy = refNode.y! + Math.sin(angle) * radius;
    });

    taskClaims.forEach((node, i) => {
      const offsetX = 250 * refSide;
      const offsetY = (i - taskClaims.length / 2) * 60;
      node.fx = taskNode.x + offsetX;
      node.fy = taskNode.y + offsetY;
    });

    const allClaims = [...refClaims, ...taskClaims];

    // Ghost links
    const ghostLinks = [
      ...refClaims.map((claimNode) => ({
        source: refNode.id,
        target: claimNode.id,
        type: "ghost" as const,
      })),
      ...taskClaims.map((claimNode) => ({
        source: claimNode.id,
        target: taskNode.id,
        type: "ghost",
      })),
    ];

    svgGroup
      .append("g")
      .lower()
      .attr("class", "ghost-link")
      .selectAll("line")
      .data(ghostLinks)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-dasharray", "4 2")
      .attr("stroke-width", 1)
      .attr(
        "x1",
        (d) =>
          nodes.find((n) => n.id === (d.source as unknown as string))?.fx ?? 0
      )
      .attr(
        "y1",
        (d) =>
          nodes.find((n) => n.id === (d.source as unknown as string))?.fy ?? 0
      )
      .attr(
        "x2",
        (d) =>
          nodes.find((n) => n.id === (d.target as unknown as string))?.fx ?? 0
      )
      .attr(
        "y2",
        (d) =>
          nodes.find((n) => n.id === (d.target as unknown as string))?.fy ?? 0
      );

    const group = svgGroup.append("g").attr("class", "claim-group");

    const nodeEnter = group
      .selectAll("g")
      .data(allClaims)
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.fx},${d.fy})`)
      .on("click", (_, d) => onClaimClick?.(d));

    nodeEnter.each(function (d) {
      const group = d3.select(this);
      const labelGroup = group.append("g").attr("class", "labelGroup");
      const words = d.label.split(" ");
      const maxChars = 18;
      let lines: string[] = [];
      let current = "";

      words.forEach((word) => {
        if ((current + word).length > maxChars) {
          lines.push(current.trim());
          current = word + " ";
        } else {
          current += word + " ";
        }
      });
      if (current) lines.push(current.trim());

      const lineHeight = 15;
      const textHeight = lines.length * lineHeight + 10;

      labelGroup
        .append("rect")
        .attr("x", -70)
        .attr("y", -textHeight / 2)
        .attr("width", 140)
        .attr("height", textHeight)
        .attr("fill", d.type === "refClaim" ? "#2b6cb0" : "#d69e2e")
        .attr("rx", 5)
        .attr("ry", 5);

      const textElement = labelGroup
        .append("text")
        .attr("x", 0)
        .attr("y", -textHeight / 2 + 15)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .style("font-size", "12px");

      lines.forEach((line, i) => {
        textElement
          .append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? 0 : lineHeight)
          .text(line);
      });
    });

    svgGroup
      .append("g")
      .attr("class", "claim-link")
      .selectAll("line")
      .data(connectedLinks)
      .enter()
      .append("line")
      .attr("stroke", (d) => (d.relationship === "supports" ? "green" : "red"))
      .attr("stroke-width", 2)
      .attr("x1", (d) => (d.source as GraphNode)?.fx ?? 0)
      .attr("y1", (d) => (d.source as GraphNode)?.fy ?? 0)
      .attr("x2", (d) => (d.target as GraphNode)?.fx ?? 0)
      .attr("y2", (d) => (d.target as GraphNode)?.fy ?? 0);
  }, [svgGroup, referenceId, nodes, links, onClaimClick]);

  return null;
};

export default ClaimNodesLayer;
