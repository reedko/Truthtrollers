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
    const viewScope = useTaskStore.getState().viewScope;

    const contentId = selectedNode.id.replace(/^.*-/, ""); // fallback if not a task
    console.log(contentId, selectedNode.type, selectedNode.id);
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
    console.log("[API] raw nodes:", data.nodes.length, data.nodes);
    console.log("[API] raw links:", data.links.length, data.links);

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

    console.log(data.nodes, "nodes", data.links, "links");
    return { nodes, links: data.links };
  } catch (error) {
    console.error("🚨 Graph Fetch Error:", error);

    return { nodes: [], links: [] };
  }
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5001",
  timeout: 600000, // 10 minutes for large video uploads
  maxContentLength: 500 * 1024 * 1024, // 500MB
  maxBodyLength: 500 * 1024 * 1024, // 500MB
});

// Attach the JWT on every request automatically
// Also auto-refresh if token is near expiry
let isRefreshing = false;
api.interceptors.request.use(async (config) => {
  const { token, setAuth, logout } = useAuthStore.getState();

  if (token) {
    // Check if token is near expiry (within 5 minutes)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresAt = payload.exp * 1000;
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;
      const minutesRemaining = Math.floor(timeUntilExpiry / 1000 / 60);
      const FIVE_MINUTES = 5 * 60 * 1000;

      console.log(`🔍 [API Interceptor] Request to ${config.url} - Token has ${minutesRemaining} min remaining (expires at ${new Date(expiresAt).toLocaleTimeString()})`);

      // If token is already expired
      if (timeUntilExpiry <= 0) {
        console.error('🚨 [API Interceptor] Token is EXPIRED! Auto-logging out...');
        console.log(`   Token expired at: ${new Date(expiresAt).toLocaleTimeString()}`);
        console.log(`   Current time: ${new Date(now).toLocaleTimeString()}`);
        logout();
        throw new Error('Token expired');
      }

      // If token expires in less than 5 minutes and we're not already refreshing, refresh it
      if (timeUntilExpiry < FIVE_MINUTES && !isRefreshing && config.url !== '/api/refresh-token') {
        isRefreshing = true;
        console.log(`⚠️ [API Interceptor] Token expiring soon (${minutesRemaining} min), attempting refresh...`);
        console.log(`   Request URL: ${config.url}`);
        console.log(`   Token expires at: ${new Date(expiresAt).toLocaleTimeString()}`);

        try {
          const refreshStartTime = Date.now();
          const response = await axios.post(
            `${config.baseURL}/api/refresh-token`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          );

          const refreshDuration = Date.now() - refreshStartTime;
          const { token: newToken, user: updatedUser } = response.data;

          // Parse new token to show expiration
          const newPayload = JSON.parse(atob(newToken.split('.')[1]));
          const newExpiresAt = newPayload.exp * 1000;
          const newMinutesRemaining = Math.floor((newExpiresAt - Date.now()) / 1000 / 60);

          setAuth(updatedUser, newToken);
          console.log(`✅ [API Interceptor] Token refreshed successfully in ${refreshDuration}ms`);
          console.log(`   New token expires at: ${new Date(newExpiresAt).toLocaleTimeString()} (${newMinutesRemaining} min from now)`);
          console.log(`   User: ${updatedUser.username} (ID: ${updatedUser.user_id})`);

          // Use the new token for this request
          config.headers = config.headers ?? {};
          config.headers.Authorization = `Bearer ${newToken}`;
        } catch (error: any) {
          console.error('❌ [API Interceptor] Token refresh FAILED - Auto-logging out');
          console.error(`   Error: ${error.message}`);
          console.error(`   Request that triggered refresh: ${config.url}`);
          console.error(`   Token had ${minutesRemaining} min remaining when refresh was attempted`);
          if (error.response) {
            console.error(`   Backend response status: ${error.response.status}`);
            console.error(`   Backend response data:`, error.response.data);
          }
          logout();
          throw error;
        } finally {
          isRefreshing = false;
        }
      } else {
        // Token is fine, just attach it
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error: any) {
      console.error('❌ [API Interceptor] Error parsing token:', error);
      console.error('   Token value (first 20 chars):', token.substring(0, 20) + '...');
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } else {
    console.log(`🔓 [API Interceptor] No token available for request to ${config.url}`);
  }

  return config;
});
