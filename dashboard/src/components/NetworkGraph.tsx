// src/components/NetworkGraph.tsx

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { GraphNode, Link } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

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
  width = 1000,
  height = 1000,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0 || links.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const centerX = width / 2;
    const centerY = height / 2;
    const centerNode = nodes[0];

    if (centerNode) {
      centerNode.fx = centerX;
      centerNode.fy = centerY;
    }

    // Setup zoom/pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    const g = svg.append("g");

    // Define link colors
    const getLinkColor = (link: Link): string => {
      if (link.relationship === "supports") return "#38A169"; // green
      if (link.relationship === "refutes") return "#E53E3E"; // red
      return "#718096"; // gray
    };

    // Draw links
    const linkSelection = g
      .append("g")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", getLinkColor)
      .attr("stroke-width", (d) => Math.sqrt(d.value || 1));

    // Draw nodes
    const nodeSelection = g
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
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
      .on("click", (_, d) => onNodeClick?.(d));

    // Draw node shapes
    nodeSelection.each(function (d) {
      const nodeGroup = d3.select(this);

      // Shape style
      if (d.group === 4) {
        nodeGroup
          .append("rect")
          .attr("width", 60)
          .attr("height", 60)
          .attr("x", -30)
          .attr("y", -30)
          .attr("rx", 5)
          .attr("fill", "#d62728")
          .attr("stroke", "#000");
      } else if (d.group === 2) {
        nodeGroup
          .append("polygon")
          .attr(
            "points",
            "0,-15 6,-5 15,-5 7,4 8,12 0,6 -8,12 -7,4 -15,-5 -6,-5"
          )
          .attr("transform", "scale(4.5)")
          .attr("fill", "#ff7f0e")
          .attr("stroke", "#000");
      } else {
        const radius = d.group === 1 ? 50 : d.group === 3 ? 55 : 36;
        nodeGroup
          .append("circle")
          .attr("r", radius)
          .attr(
            "fill",
            d.group === 1 ? "#1f77b4" : d.group === 3 ? "#2ca02c" : "#d62728"
          )
          .attr("stroke", "#000");
      }

      // Append image
      const imageUrl = `${API_BASE_URL}/assets/images/${
        {
          1: `authors/author_id_${d.id}.png`,
          2: `content/content_id_${d.id}.png`,
          3: `publishers/publisher_id_${d.id}.png`,
          4: `content/content_id_${d.id}.png`,
        }[d.group] || `default.png`
      }`;

      nodeGroup
        .append("image")
        .attr("href", imageUrl)
        .attr("width", 60)
        .attr("height", 60)
        .attr("x", -30)
        .attr("y", -30)
        .attr("clip-path", "url(#clipCircle)");

      // Labels
      const labelGroup = nodeGroup.append("g").attr("class", "labelGroup");

      const words = d.label.split(" ");
      const maxCharsPerLine = 18;
      const lines: string[] = [];
      let currentLine = "";

      words.forEach((word) => {
        if ((currentLine + word).length > maxCharsPerLine) {
          lines.push(currentLine.trim());
          currentLine = word + " ";
        } else {
          currentLine += word + " ";
        }
      });
      if (currentLine) lines.push(currentLine.trim());

      const lineHeight = 15;
      const textHeight = lines.length * lineHeight + 10;

      labelGroup
        .append("rect")
        .attr("x", -70)
        .attr("y", 50)
        .attr("width", 140)
        .attr("height", textHeight)
        .attr("fill", "#333")
        .attr("rx", 5)
        .attr("ry", 5);

      const textElement = labelGroup
        .append("text")
        .attr("x", 0)
        .attr("y", 65)
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

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, Link>(links)
          .id((d) => d.id)
          .distance(200)
      )
      .force("charge", d3.forceManyBody().strength(-1000))
      .force("center", d3.forceCenter(centerX, centerY));

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => d.source.x!)
        .attr("y1", (d) => d.source.y!)
        .attr("x2", (d) => d.target.x!)
        .attr("y2", (d) => d.target.y!);

      nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, onNodeClick]);

  return <svg ref={svgRef} width={width} height={height} />;
};

export default NetworkGraph;
