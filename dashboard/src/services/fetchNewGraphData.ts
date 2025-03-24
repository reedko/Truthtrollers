// src/services/fetchNewGraphData.ts

import { GraphNode, Link } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export async function fetchNewGraphData(initialNode: GraphNode): Promise<{
  nodes: GraphNode[];
  links: Link[];
}> {
  try {
    const taskId = parseInt(initialNode.id.replace("task-", ""));
    const response = await fetch(`${API_BASE_URL}/api/graph-data/${taskId}`);

    if (!response.ok) {
      throw new Error("Failed to fetch graph data");
    }

    const { nodes, links } = await response.json();

    // Enhance nodes with required layout fields
    const enrichedNodes: GraphNode[] = nodes.map((node: GraphNode) => ({
      ...node,
      x: 0,
      y: 0,
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
