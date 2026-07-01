// src/services/fetchNewGraphData.ts

import { GraphNode, Link } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export async function fetchNewGraphData(initialNode: GraphNode): Promise<{
  nodes: GraphNode[];
  links: Link[];
}> {
  try {
    // Extract the numeric taskId from something like "task-9002"
    const taskId = parseInt(
      initialNode.id.replace("task-", "").replace("ref-", "")
    );

    console.log("🧭 Calling /api/full-graph with taskId:", taskId);

    const response = await fetch(`${API_BASE_URL}/api/full-graph/${taskId}`);

    if (!response.ok) {
      throw new Error("Failed to fetch full graph data");
    }

    const { nodes, links } = await response.json();

    const enrichedNodes: GraphNode[] = nodes.map((node: GraphNode) => ({
      ...node,
      x: node.x ?? 0,
      y: node.y ?? 0,
    }));

    return {
      nodes: enrichedNodes,
      links,
    };
  } catch (err) {
    console.error("🌐 fetchNewGraphData error:", err);
    return { nodes: [], links: [] };
  }
}
