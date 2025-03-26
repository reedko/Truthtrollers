// NetworkGraph.tsx
import React, { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { GraphNode, Link } from "../../../shared/entities/types";
import ClaimNodesLayer from "./ClaimNodesLayer";

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
  height = 800,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(
    null
  );
  const [svgGroup, setSvgGroup] = useState<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0 || links.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const group = svg.append("g");
    setSvgGroup(group);

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .filter((event) => event.type !== "wheel")
        .on("zoom", (event) => group.attr("transform", event.transform))
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
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(centerX, centerY))
      .force("collision", d3.forceCollide().radius(75));

    const linkGroup = group
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "gray")
      .attr("stroke-width", 1.5);

    const nodeGroup = group
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
            d.fx = d.x;
            d.fy = d.y;
          })
      )
      .on("click", (event, d) => {
        if ((event.target as Element).tagName === "line") return;
        onNodeClick?.(d);
        if (d.type === "reference") {
          setSelectedReferenceId(d.content_id?.toString() || null);
        }
      });

    nodeGroup.each(function (d) {
      const group = d3.select(this);

      if (d.type === "taskClaim" || d.type === "refClaim") return;

      const trustScore = d.trust_score ?? 50;
      const baseColor =
        d.type === "publisher"
          ? trustScore > 80
            ? "#38A169"
            : trustScore < 40
            ? "#E53E3E"
            : "#A0AEC0"
          : d.type === "task"
          ? "#FFD700"
          : d.type === "reference"
          ? "#d62728"
          : d.type === "author"
          ? "#1f77b4"
          : "#3182bd";

      if (d.type === "task") {
        group
          .append("polygon")
          .attr(
            "points",
            "0,-15 6,-5 15,-5 7,4 8,12 0,6 -8,12 -7,4 -15,-5 -6,-5"
          )
          .attr("transform", "scale(4.5)")
          .attr("fill", baseColor);
      } else if (d.type === "publisher") {
        group
          .append("rect")
          .attr("width", 60)
          .attr("height", 60)
          .attr("x", -30)
          .attr("y", -30)
          .attr("rx", 5)
          .attr("fill", baseColor);
      } else {
        group.append("circle").attr("r", 40).attr("fill", baseColor);
      }

      const getUnprefixedId = (id: string) => {
        const parts = id.split("-");
        return parts.length > 1 ? parts[1] : id;
      };

      const imageUrl = `${API_BASE_URL}/assets/images/${
        {
          1: `authors/author_id_${getUnprefixedId(d.id)}.png`,
          2: `content/content_id_${getUnprefixedId(d.id)}.png`,
          3: `publishers/publisher_id_${getUnprefixedId(d.id)}.png`,
          4: `content/content_id_${getUnprefixedId(d.id)}.png`,
        }[d.group] || `default.png`
      }`;

      const shapeSize = 60;

      group
        .append("clipPath")
        .attr("id", `clip-${d.id}`)
        .append("circle")
        .attr("r", shapeSize / 2)
        .attr("cx", 0)
        .attr("cy", 0);

      group
        .append("image")
        .attr("href", imageUrl)
        .attr("width", shapeSize)
        .attr("height", shapeSize)
        .attr("x", -shapeSize / 2)
        .attr("y", -shapeSize / 2)
        .attr("clip-path", `url(#clip-${d.id})`);

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

      nodeGroup.attr("transform", (d) => `translate(${d.x}, ${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, onNodeClick]);

  return (
    <>
      <svg ref={svgRef} width={width} height={height} />
      {svgGroup && (
        <ClaimNodesLayer
          svgGroup={svgGroup}
          nodes={nodes}
          links={links}
          referenceId={selectedReferenceId}
          onClaimClick={(node) => console.log("Claim clicked:", node)}
        />
      )}
    </>
  );
};

export default NetworkGraph;
