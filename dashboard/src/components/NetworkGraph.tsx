// src/components/NetworkGraph.tsx

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { GraphNode, Link } from "../entities/types.ts";

interface NetworkGraphProps {
  nodes: GraphNode[];
  links: Link[];
  width?: number;
  height?: number;
  onNodeClick?: (node: GraphNode) => void;
}

const NetworkGraph: React.FC<NetworkGraphProps> = ({
  nodes,
  links,
  width = 600,
  height = 400,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0 || links.length === 0) return;
    console.log("🎯 Rendering NetworkGraph with:", nodes, links);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous graph

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, Link>(links)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Draw links
    const linkSelection = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.value || 1));

    // Draw nodes with different shapes
    const nodeSelection = svg
      .append("g")
      .selectAll("g") // Use groups to attach different shapes
      .data(nodes)
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .each(function (d) {
        const node = d3.select(this);

        if (d.group === 4) {
          // REF NODE (SQUARE)
          node
            .append("rect")
            .attr("width", 30)
            .attr("height", 30)
            .attr("x", -12) // Centering
            .attr("y", -12)
            .attr("rx", 5) // Rounded corners
            .attr("fill", "#d62728") // red
            .attr("stroke", "#000")
            .attr("stroke-width", 1.5);
        } else if (d.group === 2) {
          // TASK NODE (STAR)
          node
            .append("polygon")
            .attr(
              "points",
              "0,-10 4,-3 10,-3 5,2 6,8 0,5 -6,8 -5,2 -10,-3 -4,-3"
            ) // Star shape
            .attr("transform", "scale(2.5)") // Adjust star size
            .attr("fill", "#ff7f0e") // orange for references
            .attr("stroke", "#000")
            .attr("stroke-width", 1.5);
        } else {
          // OTHER NODES (CIRCLES)
          node
            .append("circle")
            .attr("r", d.group === 1 ? 24 : d.group === 3 ? 30 : 12)
            .attr("fill", () =>
              d.group === 1
                ? "#1f77b4" // Blue (Author)
                : d.group === 3
                ? "#2ca02c" // Green (Publisher)
                : "#d62728"
            ) // Red (References)
            .attr("stroke", "#000")
            .attr("stroke-width", 1.5);
        }
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
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
      )
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d);
      });

    // Add labels with contrast
    const labelSelection = svg
      .append("g")
      .selectAll("text")
      .data(nodes)
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("fill", (d) => (d.group === 2 ? "white" : "white")) // Tasks get black text
      .style("font-weight", (d) => (d.group === 2 ? "bold" : "normal")) // Bold for tasks
      .style("pointer-events", "none")
      .each(function (d) {
        const text = d3.select(this);
        const words = d.label.split(" ");
        const lineHeight = 12;
        const maxWidth = d.group === 2 ? 20 : 20; // Set max width for wrapping
        let line = "";
        let lineNumber = 0;

        // Get correct x and y
        const xPos = d.x ?? 0;
        const yPos = d.y ?? 0;

        // Clear previous text before appending new tspans
        text.selectAll("tspan").remove();

        words.forEach((word, index) => {
          if ((line + word).length > maxWidth) {
            text
              .append("tspan")
              .attr("x", xPos)
              .attr("dy", lineNumber === 0 ? 0 : lineHeight)
              .text(line.trim());
            line = word + " ";
            lineNumber++;
          } else {
            line += word + " ";
          }
        });

        // Append the final line
        text
          .append("tspan")
          .attr("x", xPos)
          .attr("dy", lineNumber === 0 ? 0 : lineHeight)
          .text(line.trim());
      });

    // Attach the text labels to the node's position in the tick function
    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => (typeof d.source === "object" ? d.source.x! : 0))
        .attr("y1", (d) => (typeof d.source === "object" ? d.source.y! : 0))
        .attr("x2", (d) => (typeof d.target === "object" ? d.target.x! : 0))
        .attr("y2", (d) => (typeof d.target === "object" ? d.target.y! : 0));

      nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);

      // Correct text placement
      labelSelection.attr(
        "transform",
        (d) => `translate(${d.x ?? 0},${d.y ?? 0 - 15})`
      );
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  return <svg ref={svgRef} width={width} height={height} />;
};

export default NetworkGraph;
