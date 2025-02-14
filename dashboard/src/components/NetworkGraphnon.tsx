// src/components/NetworkGraph.tsx

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { Node, Link } from "../entities/useD3Nodes";

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

  // Type Guard Function
  const isNode = (d: string | Node): d is Node => {
    return typeof d === "object" && d !== null && "id" in d;
  };
  const getNodeId = (d: string | Node): string => {
    return isNode(d) ? d.id : "";
  };

  useEffect(() => {
    console.log("NetworkGraph received nodes:", nodes);
    console.log("NetworkGraph received links:", links);

    // Check for 'publisher-undefined' in links
    const invalidLinks = links.filter((link) => {
      const targetId =
        typeof link.target === "string" ? link.target : link.target.id;
      return targetId === "publisher-undefined";
    });

    if (invalidLinks.length > 0) {
      console.error(
        "Found links referencing 'publisher-undefined':",
        invalidLinks
      );
    }

    // Clear previous SVG content
    if (!svgRef.current) return;
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

    // Add links
    const linkSelection = g
      .selectAll<SVGLineElement, Link>("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.value || 1));

    // Add nodes
    const nodeSelection = g
      .selectAll<SVGCircleElement, Node>("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", 20)
      .attr("fill", (d) => color(String(d.group)))
      .call(drag(simulation));

    // Add labels
    const labelSelection = g
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
    nodeSelection.append("title").text((d) => d.label);

    // Highlight connected nodes and links on mouseover and reset on mouseout
    nodeSelection
      .on("mouseover", (event, d) => {
        // Highlight the hovered node
        d3.select(event.currentTarget)
          .attr("stroke", "black")
          .attr("stroke-width", 2);

        // Highlight connected links
        linkSelection
          .attr("stroke", (l) => {
            const sourceId = getNodeId(l.source);
            const targetId = getNodeId(l.target);
            return sourceId === d.id || targetId === d.id ? "#f00" : "#999";
          })
          .attr("stroke-opacity", (l) => {
            const sourceId = getNodeId(l.source);
            const targetId = getNodeId(l.target);
            return sourceId === d.id || targetId === d.id ? 1 : 0.6;
          });

        // Highlight connected nodes
        nodeSelection.attr("fill", (n) => {
          if (n.id === d.id) return color(String(n.group)); // Keep the hovered node's color
          const isConnected = links.some((l) => {
            const sourceId = getNodeId(l.source);
            const targetId = getNodeId(l.target);
            return (
              (sourceId === d.id && isNode(l.target) && l.target.id === n.id) ||
              (targetId === d.id && isNode(l.source) && l.source.id === n.id)
            );
          });
          return isConnected ? "#f00" : color(String(n.group));
        });
      })
      .on("mouseout", () => {
        // Reset link styles
        linkSelection.attr("stroke", "#999").attr("stroke-opacity", 0.6);

        // Reset node styles
        nodeSelection
          .attr("fill", (d) => color(String(d.group)))
          .attr("stroke", null)
          .attr("stroke-width", null);
      });

    // Click event to handle node selection
    nodeSelection.on("click", (event, d) => {
      if (onNodeClick) {
        onNodeClick(d);
      }
    });

    // Simulation tick
    simulation.on("tick", () => {
      // Update link positions with type guards
      linkSelection
        .attr("x1", (d) => (isNode(d.source) ? d.source.x! : 0))
        .attr("y1", (d) => (isNode(d.source) ? d.source.y! : 0))
        .attr("x2", (d) => (isNode(d.target) ? d.target.x! : 0))
        .attr("y2", (d) => (isNode(d.target) ? d.target.y! : 0));

      // Update node positions
      nodeSelection.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

      // Update label positions
      labelSelection.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
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

    // Cleanup on component unmount
    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, onNodeClick]);

  return <svg ref={svgRef}></svg>;
};

export default NetworkGraph;
