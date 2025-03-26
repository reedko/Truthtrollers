// ModularNetworkGraph.tsx
import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { useD3Simulation } from "./useD3Simulation";
import ClaimNodeLayer from "./ClaimNodeLayer";

const width = 1000;
const height = 600;

interface Node {
  id: string;
  label: string;
  type: string;
}

interface Link {
  source: string;
  target: string;
  type: "solid" | "ghost";
}

interface Props {
  nodes: Node[];
  links: Link[];
  onReferenceClick: (node: Node) => void;
  activeReferenceId: string | null;
  claimNodes: Node[];
  claimLinks: Link[];
}

const ModularNetworkGraph: React.FC<Props> = ({
  nodes,
  links,
  onReferenceClick,
  activeReferenceId,
  claimNodes,
  claimLinks,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { simulation, nodeElements, linkElements } = useD3Simulation(
    nodes,
    links,
    svgRef
  );

  useEffect(() => {
    nodeElements
      .attr("r", 20)
      .attr("fill", (d) => (d.type === "reference" ? "lightblue" : "gray"))
      .on("click", (event, d) => {
        if (d.type === "reference") onReferenceClick(d);
      })
      .call(
        d3
          .drag<SVGCircleElement, Node>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    linkElements
      .attr("stroke", (d) => (d.type === "solid" ? "black" : "gray"))
      .attr("stroke-dasharray", (d) => (d.type === "ghost" ? "4 2" : "0"))
      .attr("stroke-width", 1.5);

    // Text labels
    d3.select(svgRef.current)
      .selectAll("text.node-label")
      .data(nodes)
      .join("text")
      .attr("class", "node-label")
      .attr("x", (d) => d.x ?? 0)
      .attr("y", (d) => (d.y ?? 0) - 25)
      .text((d) => d.label)
      .style("font-size", "12px")
      .style("text-anchor", "middle");

    simulation.on("tick", () => {
      linkElements
        .attr("x1", (d) => (d.source as any).x)
        .attr("y1", (d) => (d.source as any).y)
        .attr("x2", (d) => (d.target as any).x)
        .attr("y2", (d) => (d.target as any).y);

      nodeElements.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

      d3.select(svgRef.current)
        .selectAll("text.node-label")
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - 25);
    });
  }, [nodeElements, linkElements, simulation, nodes, onReferenceClick]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ border: "1px solid black" }}
    >
      <ClaimNodeLayer
        claimNodes={claimNodes}
        claimLinks={claimLinks}
        activeReferenceId={activeReferenceId}
      />
    </svg>
  );
};

export default ModularNetworkGraph;
