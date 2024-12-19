// src/NetworkGraph.tsx

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { Node, Link } from "../entities/useD3Nodes"; // Updated import path

interface NetworkGraphProps {
  nodes: Node[];
  links: Link[];
  width?: number;
  height?: number;
  onNodeClick?: (node: Node) => void; // Optional click handler
}

const NetworkGraph: React.FC<NetworkGraphProps> = ({
  nodes,
  links,
  width = 800,
  height = 600,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return; // Exit if SVG ref is not attached

    // Clear previous SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    // Initialize SVG with zoom and pan
    const svg = d3
      .select(svgRef.current)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "auto")
      .call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.1, 4])
          .on("zoom", (event) => {
            g.attr("transform", event.transform);
          })
      )
      .append("g");

    const g = svg.append("g");
    const getNodeX = (node: string | Node): number => {
      if (typeof node === "string") {
        // Handle string case if necessary
        // This might not occur after the simulation has started
        return 0;
      } else {
        return node.x || 0;
      }
    };

    const getNodeY = (node: string | Node): number => {
      if (typeof node === "string") {
        // Handle string case if necessary
        // This might not occur after the simulation has started
        return 0;
      } else {
        return node.y || 0;
      }
    };

    // Define simulation
    const simulation = d3
      .forceSimulation<Node, Link>(nodes)
      .force(
        "link",
        d3
          .forceLink<Node, Link>(links)
          .id((d) => d.id)
          .distance(150)
          .strength(0.1)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50));

    // Define color scale based on group
    const color = d3
      .scaleOrdinal<string>()
      .domain(["1", "2", "3", "4"])
      .range(["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"]); // Colors for Authors, Tasks, Publishers, Lit_References

    // Add arrow markers
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25) // Adjust according to node size and link distance
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    // Add links
    const link = g
      .selectAll<SVGLineElement, Link>("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.value || 1))
      .attr("marker-end", "url(#arrow)"); // Add arrow markers

    // Add nodes
    const node = g
      .selectAll<SVGCircleElement, Node>("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", 20)
      .attr("fill", (d) => color(String(d.group)))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .call(drag(simulation))
      .on("click", (event, d) => {
        if (onNodeClick) {
          onNodeClick(d);
        }
      });

    // Add labels
    const label = g
      .selectAll<SVGTextElement, Node>("text")
      .data(nodes)
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .text((d) => d.label)
      .style("font-size", "12px")
      .style("pointer-events", "none"); // Prevent text from capturing mouse events

    // Tooltip
    node.append("title").text((d) => d.label);

    // Simulation tick
    simulation.on("tick", () => {
      // Update link positions
      link
        .attr("x1", (d) => getNodeX(d.source))
        .attr("y1", (d) => getNodeY(d.source))
        .attr("x2", (d) => getNodeX(d.target))
        .attr("y2", (d) => getNodeY(d.target));

      // Update node positions
      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

      // Update label positions
      label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });

    // Drag functions
    function drag(simulation: d3.Simulation<Node, Link>) {
      function dragstarted(event: any, d: Node) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }

      function dragged(event: any, d: Node) {
        d.fx = event.x;
        d.fy = event.y;
      }

      function dragended(event: any, d: Node) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }

      return d3
        .drag<SVGCircleElement, Node>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    // Highlight connected nodes and links on mouseover and reset on mouseout
    node
      .on("mouseover", (event, d) => {
        // Highlight the hovered node
        d3.select(event.currentTarget)
          .attr("stroke", "black")
          .attr("stroke-width", 2);

        // Highlight connected links
        link
          .attr("stroke", (l) =>
            l.source.id === d.id || l.target.id === d.id ? "#f00" : "#999"
          )
          .attr("stroke-opacity", (l) =>
            l.source.id === d.id || l.target.id === d.id ? 1 : 0.6
          );

        // Highlight connected nodes
        node.attr("fill", (n) =>
          links.some(
            (l) =>
              (l.source.id === d.id && l.target.id === n.id) ||
              (l.target.id === d.id && l.source.id === n.id)
          )
            ? "#f00"
            : color(String(n.group))
        );
      })
      .on("mouseout", () => {
        // Reset link styles
        link.attr("stroke", "#999").attr("stroke-opacity", 0.6);

        // Reset node styles
        node
          .attr("fill", (d) => color(String(d.group)))
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5);
      });

    // Cleanup on component unmount
    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, onNodeClick]);

  return <svg ref={svgRef}></svg>;
};

export default NetworkGraph;
