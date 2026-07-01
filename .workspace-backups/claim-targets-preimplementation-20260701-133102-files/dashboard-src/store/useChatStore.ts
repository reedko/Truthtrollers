// dashboard/src/store/useChatStore.ts
import { create } from "zustand";
import type { Socket } from "socket.io-client";

export interface ChatMessage {
  id: number;
  sender_id: number;
  sender_username: string;
  sender_avatar?: string;
  recipient_id: number;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Conversation {
  partner_id: number;
  partner_username: string;
  partner_avatar?: string;
  latest_body: string;
  latest_at: string;
  unread_count: number;
}

interface ChatState {
  socket: Socket | null;
  conversations: Conversation[];
  messages: Record<number, ChatMessage[]>; // keyed by partner_id
  activePartnerId: number | null;
  activePartnerUsername: string | null;
  activePartnerAvatar: string | null;
  isBubbleOpen: boolean;
  unreadTotal: number;
  onlineUserIds: Set<number>;

  setSocket: (s: Socket | null) => void;
  setConversations: (c: Conversation[]) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (partnerId: number, msgs: ChatMessage[]) => void;
  setActivePartner: (id: number | null, username?: string, avatar?: string) => void;
  setIsBubbleOpen: (open: boolean) => void;
  markRead: (partnerId: number) => void;
  setPresence: (userId: number, online: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  socket: null,
  conversations: [],
  messages: {},
  activePartnerId: null,
  activePartnerUsername: null,
  activePartnerAvatar: null,
  isBubbleOpen: false,
  unreadTotal: 0,
  onlineUserIds: new Set(),

  setSocket: (socket) => set({ socket }),

  setConversations: (conversations) => {
    const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    set({ conversations, unreadTotal });
  },

  addMessage: (msg) => {
    const state = get();
    const partnerId = msg.sender_id === state.activePartnerId
      ? msg.sender_id
      : msg.sender_id;

    // Determine which conversation this belongs to (the "other" person)
    const myId = msg.sender_id; // will be resolved in chatSocket using auth store
    const convKey = msg.sender_id; // set by chatSocket after resolving

    // Update messages list
    const existing = state.messages[convKey] || [];
    const updated = [...existing, msg];

    // Update conversations list
    const convs = [...state.conversations];
    const idx = convs.findIndex((c) => c.partner_id === convKey);
    if (idx >= 0) {
      convs[idx] = {
        ...convs[idx],
        latest_body: msg.body,
        latest_at: msg.created_at,
        unread_count: convs[idx].unread_count + 1,
      };
      convs.sort((a, b) => new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime());
    }

    const unreadTotal = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    set({ messages: { ...state.messages, [convKey]: updated }, conversations: convs, unreadTotal });
  },

  setMessages: (partnerId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [partnerId]: msgs } })),

  setActivePartner: (id, username, avatar) =>
    set({
      activePartnerId: id,
      activePartnerUsername: username || null,
      activePartnerAvatar: avatar || null
    }),

  setIsBubbleOpen: (open) => set({ isBubbleOpen: open }),

  markRead: (partnerId) => {
    const state = get();
    const convs = state.conversations.map((c) =>
      c.partner_id === partnerId ? { ...c, unread_count: 0 } : c
    );
    const unreadTotal = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    set({ conversations: convs, unreadTotal });
  },

  setPresence: (userId, online) => {
    set((s) => {
      const next = new Set(s.onlineUserIds);
      if (online) next.add(userId);
      else next.delete(userId);
      return { onlineUserIds: next };
    });
  },
}));
