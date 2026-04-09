import axios from "axios";
import { useAuthStore } from "../store/useAuthStore";
import { GraphNode, Link } from "../../../shared/entities/types.ts";
import { useTaskStore } from "../store/useTaskStore.ts";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export const fetchNewGraphDataFromLegacyRoute = async (
  selectedNode: GraphNode
): Promise<{ nodes: GraphNode[]; links: Link[] }> => {
  try {
    const viewerId = useTaskStore.getState().viewingUserId;
    const viewScope = useTaskStore.getState().viewScope;

    const contentId = selectedNode.id.replace(/^.*-/, ""); // fallback if not a task
    const response = await fetch(
      `${API_BASE_URL}/api/full-graph/${contentId}?entity=${contentId}&entityType=${selectedNode.type}&viewerId=${viewerId}&viewScope=${viewScope}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:", errorText);
      throw new Error(`API Error: ${errorText}`);
    }

    const data = await response.json();

    const nodes = data.nodes.map(
      (node: GraphNode) => {
        const graphNode = new GraphNode(
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
        );
        // Preserve additional fields like rating, claimCount, provenance, etc
        Object.assign(graphNode, {
          rating: node.rating,
          claimCount: node.claimCount,
          veracity_score: node.veracity_score,
          confidence_level: node.confidence_level,
          added_by_user_id: node.added_by_user_id,
          is_system: node.is_system
        });
        return graphNode;
      }
    );

    return { nodes, links: data.links };
  } catch (error) {
    console.error("🚨 Graph Fetch Error:", error);

    return { nodes: [], links: [] };
  }
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "https://localhost:5001",
  timeout: 600000, // 10 minutes for large video uploads
  maxContentLength: 500 * 1024 * 1024, // 500MB
  maxBodyLength: 500 * 1024 * 1024, // 500MB
});

// Attach the JWT on every request automatically
api.interceptors.request.use(async (config) => {
  const { token } = useAuthStore.getState();

  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Response interceptor: retry on 401 with token refresh (only if truly unauthorized)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't retried yet, try refreshing token ONCE
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { token, setAuth, logout } = useAuthStore.getState();

      if (token) {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/api/refresh-token`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          );

          const { token: newToken, user: updatedUser } = response.data;
          setAuth(updatedUser, newToken);

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          // Token refresh failed - log out
          logout();
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);
