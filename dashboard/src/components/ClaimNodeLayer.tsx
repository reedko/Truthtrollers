// ClaimNodeLayer.tsx
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";

interface Node {
  id: string;
  label: string;
  type: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string;
  target: string;
  type: "solid" | "ghost";
}

interface Props {
  claimNodes: Node[];
  claimLinks: Link[];
  activeReferenceId: string | null;
}

const ClaimNodeLayer: React.FC<Props> = ({
  claimNodes,
  claimLinks,
  activeReferenceId,
}) => {
  const layerRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    if (!layerRef.current || !activeReferenceId) return;

    const svg = d3.select(layerRef.current);

    // Render claim links
    svg
      .selectAll("line.claim-link")
      .data(claimLinks, (d) => `${d.source}-${d.target}`)
      .join("line")
      .attr("class", "claim-link")
      .attr("stroke", (d) => (d.type === "solid" ? "black" : "gray"))
      .attr("stroke-dasharray", (d) => (d.type === "ghost" ? "4 2" : "0"))
      .attr("stroke-width", 1.5);

    // Render claim nodes
    const nodeSelection = svg
      .selectAll("circle.claim-node")
      .data(claimNodes, (d) => d.id)
      .join("circle")
      .attr("class", "claim-node")
      .attr("r", 12)
      .attr("fill", "orange")
      .attr(
        "cx",
        (d, i) => 600 + 80 * Math.cos((2 * Math.PI * i) / claimNodes.length)
      )
      .attr(
        "cy",
        (d, i) => 300 + 80 * Math.sin((2 * Math.PI * i) / claimNodes.length)
      );

    // Render claim labels
    svg
      .selectAll("text.claim-label")
      .data(claimNodes, (d) => d.id)
      .join("text")
      .attr("class", "claim-label")
      .attr(
        "x",
        (d, i) => 600 + 80 * Math.cos((2 * Math.PI * i) / claimNodes.length)
      )
      .attr(
        "y",
        (d, i) =>
          300 + 80 * Math.sin((2 * Math.PI * i) / claimNodes.length) - 15
      )
      .text((d) => d.label)
      .style("font-size", "10px")
      .style("text-anchor", "middle");
  }, [claimNodes, claimLinks, activeReferenceId]);

  return <g ref={layerRef} />;
};

export default ClaimNodeLayer;
