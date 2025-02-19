import { GraphNode, Link } from "../../../shared/entities/types.ts";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const fetchNewGraphData = async (
  selectedNode: GraphNode
): Promise<{ nodes: GraphNode[]; links: Link[] }> => {
  console.log("📡 Fetching Graph Data for:", selectedNode);

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/get-graph-data?entity=${selectedNode.id}&entityType=${selectedNode.type}`,
      { headers: { Accept: "application/json" } } // Ensure JSON response
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:", errorText);
      throw new Error(`API Error: ${errorText}`);
    }

    const data = await response.json();
    // ✅ Convert raw node objects into proper `GraphNode` instances
    const nodes = data.nodes.map(
      (node: any) => new GraphNode(node.id, node.label, node.type, node.url)
    );

    return { nodes, links: data.links };
  } catch (error) {
    console.error("🚨 Graph Fetch Error:", error);
    return { nodes: [], links: [] }; // Return empty set instead of breaking UI
  }
};
