// useD3Simulation.ts
import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface Node {
  id: string;
  label: string;
  type: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string;
  target: string;
  type: "solid" | "ghost";
}

export function useD3Simulation(
  nodes: Node[],
  links: Link[],
  svgRef: React.RefObject<SVGSVGElement>
) {
  const nodeElementsRef =
    useRef<d3.Selection<SVGCircleElement, Node, any, unknown>>();
  const linkElementsRef =
    useRef<d3.Selection<SVGLineElement, Link, any, unknown>>();
  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    const linkSelection = svg
      .selectAll<SVGLineElement, Link>("line.link")
      .data(links, (d) => `${d.source}-${d.target}`)
      .join("line")
      .attr("class", "link")
      .attr("stroke", "gray")
      .attr("stroke-width", 1);

    const nodeSelection = svg
      .selectAll<SVGCircleElement, Node>("circle.node")
      .data(nodes, (d) => d.id)
      .join("circle")
      .attr("class", "node")
      .attr("r", 20)
      .attr("fill", (d) => (d.type === "reference" ? "lightblue" : "gray"));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => (d as Node).id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(500, 300))
      .alpha(1)
      .restart();

    nodeElementsRef.current = nodeSelection;
    linkElementsRef.current = linkSelection;
    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [nodes, links, svgRef]);

  return {
    simulation: simulationRef.current!,
    nodeElements: nodeElementsRef.current!,
    linkElements: linkElementsRef.current!,
  };
}
