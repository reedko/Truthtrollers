// dashboard/src/services/chatSocket.ts
import { io, Socket } from "socket.io-client";
import { useChatStore, ChatMessage, Conversation } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";

// Hardcoded relative path for chat REST calls — always proxied through Vite/nginx
// Relative URLs always match the page protocol, no mixed-content issues.
const BASE_URL = "/api";
// Socket connects to same origin — Vite proxy (dev) or nginx (prod) routes /socket.io
const SOCKET_URL = "";
console.log("[chat] BASE_URL =", BASE_URL);

let socket: Socket | null = null;

export function connectChat(jwt: string, myUserId: number): Socket {
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    auth: { token: jwt },
    transports: ["websocket", "polling"],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  const store = useChatStore.getState();

  socket.on("connect", () => {
    console.log("[chat] connected:", socket!.id);
    store.setSocket(socket);
    // Load conversation list on connect
    fetchConversations();
  });

  socket.on("disconnect", () => {
    console.log("[chat] disconnected");
    store.setSocket(null);
  });

  socket.on("connect_error", (err) => {
    console.warn("[chat] connect error:", err.message);
  });

  socket.on("new_message", (msg: ChatMessage) => {
    // Determine which partner this message belongs to
    const partnerId = msg.sender_id === myUserId ? msg.recipient_id : msg.sender_id;

    const state = useChatStore.getState();
    const existing = state.messages[partnerId] || [];

    // Avoid duplicates
    if (existing.some((m) => m.id === msg.id)) return;

    const updatedMessages = [...existing, msg];
    state.setMessages(partnerId, updatedMessages);

    // Update conversation list
    const convs = [...state.conversations];
    const idx = convs.findIndex((c) => c.partner_id === partnerId);
    const isActive = state.activePartnerId === partnerId && state.isBubbleOpen;

    if (idx >= 0) {
      convs[idx] = {
        ...convs[idx],
        latest_body: msg.body,
        latest_at: msg.created_at,
        unread_count: isActive ? 0 : convs[idx].unread_count + (msg.sender_id !== myUserId ? 1 : 0),
      };
    } else if (msg.sender_id !== myUserId) {
      // New conversation partner
      convs.push({
        partner_id: partnerId,
        partner_username: msg.sender_username,
        partner_avatar: msg.sender_avatar,
        latest_body: msg.body,
        latest_at: msg.created_at,
        unread_count: isActive ? 0 : 1,
      });
    }
    convs.sort((a, b) => new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime());
    const unreadTotal = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    useChatStore.setState({ conversations: convs, unreadTotal });

    // Mark as read immediately if this chat is open
    if (isActive && msg.sender_id !== myUserId) {
      markRead(partnerId);
    }
  });

  socket.on("presence", ({ user_id, online }: { user_id: number; online: boolean }) => {
    useChatStore.getState().setPresence(user_id, online);
  });

  socket.on("messages_read", ({ by }: { by: number }) => {
    // Update read_at for messages sent to this user
    const state = useChatStore.getState();
    const msgs = state.messages[by];
    if (!msgs) return;
    const updated = msgs.map((m) =>
      m.recipient_id === by && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m
    );
    state.setMessages(by, updated);
  });

  return socket;
}

export function disconnectChat() {
  socket?.disconnect();
  socket = null;
  useChatStore.getState().setSocket(null);
}

export function sendMessage(recipientId: number, body: string) {
  if (!socket?.connected) {
    console.warn("[chat] not connected, cannot send");
    return;
  }
  socket.emit("send_message", { recipientId, body });
}

export function markRead(partnerId: number) {
  socket?.emit("mark_read", { senderId: partnerId });
  useChatStore.getState().markRead(partnerId);
}

export async function fetchConversations() {
  const jwt = useAuthStore.getState().user?.jwt;
  if (!jwt) return;
  try {
    const res = await fetch(`${BASE_URL}/chat/conversations`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.ok) {
      const data: Conversation[] = await res.json();
      useChatStore.getState().setConversations(data);
    } else {
      console.error(`[chat] fetchConversations ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("[chat] fetchConversations error:", err);
  }
}

export async function fetchMessages(partnerId: number, before?: string): Promise<ChatMessage[]> {
  const jwt = useAuthStore.getState().user?.jwt;
  if (!jwt) return [];
  const url = `${BASE_URL}/chat/messages/${partnerId}${before ? `?before=${before}` : ""}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

export async function searchUsers(q: string) {
  const jwt = useAuthStore.getState().user?.jwt;
  if (!jwt || !q.trim()) return [];
  const url = `${BASE_URL}/users/search?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      console.error(`[chat] searchUsers ${res.status} from ${url}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error(`[chat] searchUsers error fetching ${url}:`, err);
    return [];
  }
}

export async function fetchAllUsers() {
  const jwt = useAuthStore.getState().user?.jwt;
  if (!jwt) return [];
  const url = `${BASE_URL}/users/all`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      console.error(`[chat] fetchAllUsers ${res.status} from ${url}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error(`[chat] fetchAllUsers error fetching ${url}:`, err);
    return [];
  }
}

export async function fetchOnlineUsers() {
  const jwt = useAuthStore.getState().user?.jwt;
  if (!jwt) return [];
  const url = `${BASE_URL}/users/online`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      console.error(`[chat] fetchOnlineUsers ${res.status} from ${url}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error(`[chat] fetchOnlineUsers error fetching ${url}:`, err);
    return [];
  }
}
