import { GraphNode, Link } from "../../../shared/entities/types.ts";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const fetchNewGraphDataFromLegacyRoute = async (
  selectedNode: GraphNode
): Promise<{ nodes: GraphNode[]; links: Link[] }> => {
  console.log("📡 Fetching Graph Data for:", selectedNode);

  try {
    const taskId =
      selectedNode.type === "task" ? selectedNode.id.replace("task-", "") : "0"; // fallback if not a task

    const response = await fetch(
      `${API_BASE_URL}/api/full-graph/${taskId}?entity=${selectedNode.id}&entityType=${selectedNode.type}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:", errorText);
      throw new Error(`API Error: ${errorText}`);
    }

    const data = await response.json();

    const nodes = data.nodes.map(
      (node: GraphNode) =>
        new GraphNode(node.id, node.label, node.type, node.x, node.y, node.url)
    );
    console.log(nodes, "nodes", data.links, "links");
    return { nodes, links: data.links };
  } catch (error) {
    console.error("🚨 Graph Fetch Error:", error);

    return { nodes: [], links: [] };
  }
};
