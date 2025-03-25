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

const getLinkColor = (link: Link): string => {
  if (link.relationship === "supports") return "#38A169"; // green
  if (link.relationship === "refutes") return "#E53E3E"; // red
  return "blue"; // gray
};

const getStrokeWidth = (link: Link): number => {
  return Math.max(1, Math.abs(link.value || 1) * 2.5);
};

const NetworkGraph: React.FC<NetworkGraphProps> = ({
  nodes,
  links,
  width = 1000,
  height = 800,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0 || links.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const svgGroup = svg.append("g");

    // Zoom & pan
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .on("zoom", (event) => svgGroup.attr("transform", event.transform))
    );

    const centerX = width / 2;
    const centerY = height / 2;

    if (nodes[0]) {
      nodes[0].fx = centerX;
      nodes[0].fy = centerY;
    }

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, Link>(links)
          .id((d) => d.id)
          .distance(220)
      )
      .force("charge", d3.forceManyBody().strength(-700))
      .force("center", d3.forceCenter(centerX, centerY));

    const linkGroup = svgGroup
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", getLinkColor)
      .attr("stroke-width", getStrokeWidth)
      .on("click", (event, d) => console.log("🧵 Link clicked:", d));

    const linkLabels = svgGroup
      .append("g")
      .selectAll("text")
      .data(links)
      .enter()
      .append("text")
      .text((d) => d.value?.toFixed(1) || "")
      .attr("font-size", "12px")
      .attr("fill", "#000")
      .attr("pointer-events", "none");

    const nodeGroup = svgGroup
      .append("g")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
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
      .on("click", (event, d) => onNodeClick?.(d));

    nodeGroup.each(function (d) {
      const group = d3.select(this);

      const imageUrl = `${API_BASE_URL}/assets/images/${
        {
          1: `authors/author_id_${d.id}.png`,
          2: `content/content_id_${d.id}.png`,
          3: `publishers/publisher_id_${d.id}.png`,
          4: `content/content_id_${d.id}.png`,
        }[d.group] || `default.png`
      }`;

      if (d.group === 4) {
        group
          .append("rect")
          .attr("width", 60)
          .attr("height", 60)
          .attr("x", -30)
          .attr("y", -30)
          .attr("rx", 5)
          .attr("fill", "#d62728");
      } else if (d.group === 2) {
        group
          .append("polygon")
          .attr(
            "points",
            "0,-15 6,-5 15,-5 7,4 8,12 0,6 -8,12 -7,4 -15,-5 -6,-5"
          )
          .attr("transform", "scale(4.5)")
          .attr("fill", "#ff7f0e");
      } else {
        const radius = d.group === 1 ? 50 : d.group === 3 ? 55 : 36;
        group
          .append("circle")
          .attr("r", radius)
          .attr(
            "fill",
            d.group === 1 ? "#1f77b4" : d.group === 3 ? "#2ca02c" : "#d62728"
          );
      }

      group
        .append("image")
        .attr("href", imageUrl)
        .attr("width", 60)
        .attr("height", 60)
        .attr("x", -30)
        .attr("y", -30)
        .attr("clip-path", "url(#clipCircle)");

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

    simulation.on("tick", () => {
      linkGroup
        .attr("x1", (d) => d.source.x!)
        .attr("y1", (d) => d.source.y!)
        .attr("x2", (d) => d.target.x!)
        .attr("y2", (d) => d.target.y!);

      linkLabels
        .attr("x", (d) => (d.source.x! + d.target.x!) / 2)
        .attr("y", (d) => (d.source.y! + d.target.y!) / 2);

      nodeGroup.attr("transform", (d) => `translate(${d.x}, ${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  return <svg ref={svgRef} width={width} height={height} />;
};

export default NetworkGraph;
