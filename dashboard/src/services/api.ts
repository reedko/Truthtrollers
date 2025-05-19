import axios from "axios";
import { useAuthStore } from "../store/useAuthStore";
import { GraphNode, Link } from "../../../shared/entities/types.ts";
import { useTaskStore } from "../store/useTaskStore.ts";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export const fetchNewGraphDataFromLegacyRoute = async (
  selectedNode: GraphNode
): Promise<{ nodes: GraphNode[]; links: Link[] }> => {
  console.log("📡 Fetching Graph Data for:", selectedNode);

  try {
    const viewerId = useTaskStore.getState().viewingUserId;

    const contentId = selectedNode.id.replace(/^.*-/, ""); // fallback if not a task
    console.log(contentId, selectedNode.type, selectedNode.id);
    const response = await fetch(
      `${API_BASE_URL}/api/full-graph/${contentId}?entity=${contentId}&entityType=${selectedNode.type}&viewerId=${viewerId}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:", errorText);
      throw new Error(`API Error: ${errorText}`);
    }

    const data = await response.json();
    console.log("[API] raw nodes:", data.nodes.length, data.nodes);
    console.log("[API] raw links:", data.links.length, data.links);

    const nodes = data.nodes.map(
      (node: GraphNode) =>
        new GraphNode(
          node.id,
          node.label,
          node.type,
          node.x ?? 0,
          node.y ?? 0,
          node.url,
          node.content_id,
          node.claim_id,
          node.publisher_id,
          node.author_id
        )
    );

    console.log(data.nodes, "nodes", data.links, "links");
    return { nodes, links: data.links };
  } catch (error) {
    console.error("🚨 Graph Fetch Error:", error);

    return { nodes: [], links: [] };
  }
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_BASE_URL || "http://localhost:5001",
});

// Attach the JWT on every request automatically
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
