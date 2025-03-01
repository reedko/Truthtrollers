// src/components/NetworkGraph.tsx

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { GraphNode, Link } from "../../../shared/entities/types";

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
    console.log("🎯 Rendering NetworkGraph with:", nodes, links);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous graph

    // Append defs for clipPath (clip images to fit within node shape)
    const defs = svg.append("defs");

    defs
      .append("clipPath")
      .attr("id", "clipCircle")
      .append("circle")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("r", 30); // Clip images inside circles

    defs
      .append("clipPath")
      .attr("id", "clipSquare")
      .append("circle")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("r", 30); // Clip images inside circles

    const centerX = width / 2;
    const centerY = height / 2;
    const centerNode = nodes[0]; // First node is the center
    let offSetter = 0;
    if (centerNode) {
      centerNode.fx = centerX;
      centerNode.fy = centerY;
    }

    // Compute node angles and offsets
    nodes.forEach((node, index) => {
      if (index === 0) return; // Skip center node
      node.angle = Math.atan2(node.y - centerY, node.x - centerX);
      node.radialOffset = node.label.length > 25 ? 40 : -2;
      offSetter = node.radialOffset;
    });

    // Create the force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, Link>(links)
          .id((d) => d.id)
          .distance((d) =>
            d.target.angle
              ? d.target.angle
              : 100 % 2 === 0
              ? 250 + offSetter
              : 300 + offSetter
          ) // Alternating distances
      )
      .force("charge", d3.forceManyBody().strength(-1000))
      .force("center", d3.forceCenter(centerX, centerY));

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

    // Draw nodes
    const nodeSelection = svg
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
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d);
      });

    // Append shape, image, and labels to nodes
    nodeSelection.each(function (d) {
      const nodeGroup = d3.select(this);
      const imageUrl = `http://localhost:5001/assets/images/${
        {
          1: `authors/author_id_${d.id}.png`,
          2: `content/content_id_${d.id}.png`,
          3: `publishers/publisher_id_${d.id}.png`,
          4: `content/content_id_${d.id}.png`,
        }[d.group] || `default.png`
      }`;

      // Draw shape
      if (d.group === 4) {
        nodeGroup
          .append("rect")
          .attr("width", 60)
          .attr("height", 60)
          .attr("x", -30)
          .attr("y", -30)
          .attr("rx", 5)
          .attr("fill", "#d62728")
          .attr("stroke", "#000")
          .attr("stroke-width", 1.5);
      } else if (d.group === 2) {
        nodeGroup
          .append("polygon")
          .attr(
            "points",
            "0,-15 6,-5 15,-5 7,4 8,12 0,6 -8,12 -7,4 -15,-5 -6,-5"
          )
          .attr("transform", "scale(4.5)")
          .attr("fill", "#ff7f0e")
          .attr("stroke", "#000")
          .attr("stroke-width", 2);
      } else {
        const radius = d.group === 1 ? 50 : d.group === 3 ? 55 : 36;
        nodeGroup
          .append("circle")
          .attr("r", radius)
          .attr(
            "fill",
            d.group === 1 ? "#1f77b4" : d.group === 3 ? "#2ca02c" : "#d62728"
          )
          .attr("stroke", "#000")
          .attr("stroke-width", 1.5);
      }

      // Append image
      nodeGroup
        .append("image")
        .attr("href", imageUrl)
        .attr("width", 60)
        .attr("height", 60)
        .attr("x", -30)
        .attr("y", -30)
        .attr(
          "clip-path",
          d.group === 4 ? "url(#clipSquare)" : "url(#clipCircle)"
        );

      // **Label Box with Proper Word Wrapping**
      const labelGroup = nodeGroup.append("g").attr("class", "labelGroup");

      // Word wrapping logic
      const words = d.label.split(" ");
      const maxCharsPerLine = 18;
      let lines: string[] = [];
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

      // Draw label background box
      labelGroup
        .append("rect")
        .attr("x", -70)
        .attr("y", 50)
        .attr("width", 140)
        .attr("height", textHeight)
        .attr("fill", "#333")
        .attr("rx", 5)
        .attr("ry", 5);

      // Draw wrapped text
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
      linkSelection
        .attr("x1", (d) => d.source.x!)
        .attr("y1", (d) => d.source.y!)
        .attr("x2", (d) => d.target.x!)
        .attr("y2", (d) => d.target.y!);

      // Update node positions with alternating radial offset:
      nodeSelection.attr("transform", (d, i) => {
        const angle = Math.atan2(d.y - centerY, d.x - centerX);
        // Alternate offset: even-index nodes get +20, odd-index nodes get -20
        const alternatingOffset = i % 2 === 0 ? 40 : -40;
        const totalOffset = alternatingOffset + (d.radialOffset || 0);
        const newX = d.x + totalOffset * Math.cos(angle);
        const newY = d.y + totalOffset * Math.sin(angle);
        return `translate(${newX}, ${newY})`;
      });
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  return <svg ref={svgRef} width={width} height={height} />;
};

export default NetworkGraph;
