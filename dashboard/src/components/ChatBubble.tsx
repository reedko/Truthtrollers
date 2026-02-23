// dashboard/src/components/ChatBubble.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Box, VStack, HStack, Text, Input, IconButton, Avatar,
  Badge, Spinner, Divider, InputGroup, InputRightElement,
} from "@chakra-ui/react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import {
  connectChat, sendMessage, markRead, fetchMessages, fetchConversations, searchUsers,
  fetchAllUsers, fetchOnlineUsers,
} from "../services/chatSocket";
import { usePushNotifications } from "../hooks/usePushNotifications";

const BUBBLE_SIZE = "56px";

export default function ChatBubble() {
  const user = useAuthStore((s) => s.user);
  const {
    conversations, messages, activePartnerId, activePartnerUsername, activePartnerAvatar,
    isBubbleOpen, unreadTotal, onlineUserIds,
    setActivePartner, setIsBubbleOpen, setMessages,
  } = useChatStore();

  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { autoSubscribeIfNeeded } = usePushNotifications();

  // Connect socket when user logs in
  useEffect(() => {
    if (user?.jwt && user?.user_id) {
      connectChat(user.jwt, user.user_id);
      fetchConversations();
      // Prompt for push permission after connecting (first time only)
      autoSubscribeIfNeeded();
    }
  }, [user?.jwt, user?.user_id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activePartnerId]);

  // Load messages when opening a conversation
  const openConversation = async (partnerId: number, username?: string, avatar?: string) => {
    // Find conversation to get partner info if not provided
    const conv = conversations.find((c) => c.partner_id === partnerId);
    setActivePartner(partnerId, username || conv?.partner_username, avatar || conv?.partner_avatar);

    const existing = useChatStore.getState().messages[partnerId];
    if (!existing || existing.length === 0) {
      const msgs = await fetchMessages(partnerId);
      setMessages(partnerId, msgs);
    }
    markRead(partnerId);
  };

  const handleSend = () => {
    if (!draft.trim() || !activePartnerId) return;
    sendMessage(activePartnerId, draft.trim());
    setDraft("");
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    const results = await searchUsers(q);
    setSearchResults(results);
    setIsSearching(false);
  };

  const handleShowAllUsers = async () => {
    console.log("[ChatBubble] Fetching all users...");
    setIsSearching(true);
    const results = await fetchAllUsers();
    console.log("[ChatBubble] All users results:", results);
    setSearchResults(results);
    setSearchQuery("all");
    setIsSearching(false);
  };

  const handleShowOnlineUsers = async () => {
    console.log("[ChatBubble] Fetching online users...");
    setIsSearching(true);
    const results = await fetchOnlineUsers();
    console.log("[ChatBubble] Online users results:", results);
    setSearchResults(results);
    setSearchQuery("online");
    setIsSearching(false);
  };

  const activeMessages = activePartnerId ? (messages[activePartnerId] || []) : [];

  if (!user) return null;

  return (
    <Box position="fixed" bottom="24px" right="24px" zIndex={9999}>
      {/* Expanded panel */}
      {isBubbleOpen && (
        <Box
          bg="rgba(15, 23, 42, 0.97)"
          border="1px solid rgba(0, 162, 255, 0.3)"
          borderRadius="16px"
          boxShadow="0 8px 40px rgba(0,0,0,0.6), 0 0 30px rgba(0,162,255,0.15)"
          mb={3}
          overflow="hidden"
          w="380px"
          h="520px"
          display="flex"
          flexDirection="column"
        >
          {/* Header */}
          <HStack
            px={4} py={3}
            bg="rgba(0, 162, 255, 0.1)"
            borderBottom="1px solid rgba(0,162,255,0.2)"
            justify="space-between"
          >
            {activePartnerId ? (
              <>
                <HStack>
                  <IconButton
                    aria-label="Back"
                    size="xs"
                    variant="ghost"
                    color="blue.300"
                    icon={<span>←</span>}
                    onClick={() => setActivePartner(null)}
                  />
                  <Box position="relative">
                    <Avatar size="xs" name={activePartnerUsername || undefined} src={activePartnerAvatar || undefined} />
                    <Box
                      position="absolute" bottom="0" right="0"
                      w="8px" h="8px"
                      borderRadius="full"
                      bg={onlineUserIds.has(activePartnerId) ? "green.400" : "gray.600"}
                      border="1px solid rgba(0,162,255,0.1)"
                    />
                  </Box>
                  <VStack align="start" spacing={0}>
                    <Text color="white" fontWeight="bold" fontSize="sm">
                      {activePartnerUsername || "Chat"}
                    </Text>
                    <Text color="gray.400" fontSize="9px">
                      {onlineUserIds.has(activePartnerId) ? "Online" : "Offline"}
                    </Text>
                  </VStack>
                </HStack>
              </>
            ) : (
              <Text color="white" fontWeight="bold">Messages</Text>
            )}
            <IconButton
              aria-label="Close chat"
              size="xs" variant="ghost" color="gray.400"
              icon={<span style={{ fontSize: 18 }}>×</span>}
              onClick={() => setIsBubbleOpen(false)}
            />
          </HStack>

          {activePartnerId ? (
            /* ── Message thread ── */
            <>
              <VStack flex={1} overflowY="auto" p={3} spacing={2} align="stretch">
                {activeMessages.map((msg) => {
                  const isMine = msg.sender_id === user.user_id;
                  return (
                    <Box
                      key={msg.id}
                      alignSelf={isMine ? "flex-end" : "flex-start"}
                      maxW="75%"
                    >
                      <Box
                        bg={isMine ? "rgba(0,162,255,0.25)" : "rgba(255,255,255,0.08)"}
                        border={isMine ? "1px solid rgba(0,162,255,0.4)" : "1px solid rgba(255,255,255,0.1)"}
                        borderRadius={isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px"}
                        px={3} py={2}
                      >
                        <Text color="white" fontSize="sm">{msg.body}</Text>
                      </Box>
                      <Text color="gray.500" fontSize="xs" textAlign={isMine ? "right" : "left"} mt={0.5}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {isMine && msg.read_at && " ✓✓"}
                      </Text>
                    </Box>
                  );
                })}
                <div ref={bottomRef} />
              </VStack>
              <HStack p={3} borderTop="1px solid rgba(255,255,255,0.08)">
                <InputGroup size="sm">
                  <Input
                    placeholder="Type a message…"
                    value={draft}
                    color="white"
                    _placeholder={{ color: "gray.500" }}
                    bg="rgba(255,255,255,0.06)"
                    border="1px solid rgba(255,255,255,0.15)"
                    borderRadius="full"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  />
                  <InputRightElement>
                    <IconButton
                      aria-label="Send"
                      size="xs" variant="ghost" color="blue.300"
                      icon={<span>➤</span>}
                      onClick={handleSend}
                      isDisabled={!draft.trim()}
                    />
                  </InputRightElement>
                </InputGroup>
              </HStack>
            </>
          ) : (
            /* ── Conversation list ── */
            <VStack flex={1} overflowY="auto" spacing={0} align="stretch">
              {/* User search to start new DM */}
              <Box px={3} pt={3} pb={2}>
                <Input
                  placeholder="Search users to message…"
                  size="sm"
                  value={searchQuery === "all" || searchQuery === "online" ? "" : searchQuery}
                  color="white"
                  _placeholder={{ color: "gray.500" }}
                  bg="rgba(255,255,255,0.06)"
                  border="1px solid rgba(255,255,255,0.15)"
                  borderRadius="full"
                  onChange={(e) => handleSearch(e.target.value)}
                />
                <HStack spacing={3} mt={2} fontSize="xs">
                  <Text
                    color="blue.300"
                    cursor="pointer"
                    _hover={{ color: "blue.200", textDecoration: "underline" }}
                    onClick={handleShowAllUsers}
                  >
                    Show all users
                  </Text>
                  <Text color="gray.600">•</Text>
                  <Text
                    color="green.300"
                    cursor="pointer"
                    _hover={{ color: "green.200", textDecoration: "underline" }}
                    onClick={handleShowOnlineUsers}
                  >
                    Show online users
                  </Text>
                </HStack>
                {isSearching && <Spinner size="xs" color="blue.300" mt={2} />}
                {(searchResults.length > 0 || searchQuery === "all" || searchQuery === "online") && (
                  <>
                    <HStack spacing={1} px={2} pt={2} pb={1} fontSize="10px" color="gray.500">
                      <Box w="6px" h="6px" borderRadius="full" bg="green.400" />
                      <Text>Online</Text>
                      <Box w="6px" h="6px" borderRadius="full" bg="red.400" ml={2} />
                      <Text>Offline</Text>
                    </HStack>
                    <Box maxH="200px" overflowY="auto">
                      {searchResults.length > 0 ? (
                        searchResults.map((u) => {
                          const isOnline = onlineUserIds.has(u.user_id);
                          const isMe = u.is_me || u.user_id === user.user_id;
                          return (
                            <HStack
                              key={u.user_id}
                              px={2} py={1} mt={1}
                              borderRadius="md"
                              _hover={{ bg: "rgba(0,162,255,0.1)" }}
                              onClick={() => {
                                // Don't allow chatting with yourself
                                if (isMe) return;
                                setSearchQuery("");
                                setSearchResults([]);
                                // Create a temporary conversation entry if not existing
                                const convs = useChatStore.getState().conversations;
                                if (!convs.find((c) => c.partner_id === u.user_id)) {
                                  useChatStore.setState({
                                    conversations: [
                                      { partner_id: u.user_id, partner_username: u.username, partner_avatar: u.user_profile_image, latest_body: "", latest_at: new Date().toISOString(), unread_count: 0 },
                                      ...convs,
                                    ],
                                  });
                                }
                                openConversation(u.user_id, u.username, u.user_profile_image);
                              }}
                              opacity={isMe ? 0.6 : 1}
                              cursor={isMe ? "default" : "pointer"}
                            >
                              <Box position="relative">
                                <Avatar size="xs" name={u.username} src={u.user_profile_image} />
                                <Box
                                  position="absolute" bottom="0" right="0"
                                  w="8px" h="8px"
                                  borderRadius="full"
                                  bg={isOnline ? "green.400" : "red.400"}
                                  border="1px solid rgba(15,23,42,0.97)"
                                />
                              </Box>
                              <Text color="white" fontSize="sm">
                                {u.username}
                                {isMe && <Text as="span" color="gray.400" ml={1}>(you)</Text>}
                              </Text>
                            </HStack>
                          );
                        })
                      ) : (
                        <Text color="gray.500" fontSize="xs" textAlign="center" py={2}>
                          {searchQuery === "online" ? "No users online" : "No users found"}
                        </Text>
                      )}
                    </Box>
                  </>
                )}
              </Box>
              <Divider borderColor="rgba(255,255,255,0.08)" />
              {conversations.length === 0 && (
                <Text color="gray.500" fontSize="sm" textAlign="center" mt={8}>
                  No conversations yet. Search for a user above to start chatting.
                </Text>
              )}
              {conversations.map((conv) => {
                const isOnline = onlineUserIds.has(conv.partner_id);
                return (
                  <HStack
                    key={conv.partner_id}
                    px={4} py={3}
                    cursor="pointer"
                    borderBottom="1px solid rgba(255,255,255,0.05)"
                    _hover={{ bg: "rgba(0,162,255,0.08)" }}
                    onClick={() => openConversation(conv.partner_id, conv.partner_username, conv.partner_avatar)}
                    spacing={3}
                  >
                    <Box position="relative">
                      <Avatar size="sm" name={conv.partner_username} src={conv.partner_avatar} />
                      {/* Online indicator */}
                      <Box
                        position="absolute" bottom="0" right="0"
                        w="10px" h="10px"
                        borderRadius="full"
                        bg={isOnline ? "green.400" : "gray.600"}
                        border="2px solid rgba(15,23,42,0.97)"
                      />
                      {/* Unread count */}
                      {conv.unread_count > 0 && (
                        <Badge
                          position="absolute" top="-4px" right="-4px"
                          colorScheme="blue" borderRadius="full" fontSize="9px" px={1}
                        >
                          {conv.unread_count}
                        </Badge>
                      )}
                    </Box>
                  <VStack align="start" spacing={0} flex={1} minW={0}>
                    <Text color="white" fontSize="sm" fontWeight={conv.unread_count > 0 ? "bold" : "normal"}>
                      {conv.partner_username}
                    </Text>
                    <Text color="gray.400" fontSize="xs" noOfLines={1}>
                      {conv.latest_body || "Start a conversation"}
                    </Text>
                  </VStack>
                  <Text color="gray.600" fontSize="xs" whiteSpace="nowrap">
                    {conv.latest_at ? new Date(conv.latest_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </Text>
                </HStack>
              );
            })}
            </VStack>
          )}
        </Box>
      )}

      {/* Bubble button */}
      <Box
        as="button"
        w={BUBBLE_SIZE} h={BUBBLE_SIZE}
        borderRadius="full"
        bg="rgba(0,162,255,0.9)"
        boxShadow="0 4px 20px rgba(0,162,255,0.5)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        position="relative"
        transition="all 0.2s"
        _hover={{ bg: "rgba(0,162,255,1)", transform: "scale(1.05)" }}
        onClick={() => setIsBubbleOpen(!isBubbleOpen)}
      >
        <Text fontSize="22px" lineHeight={1}>💬</Text>
        {unreadTotal > 0 && (
          <Badge
            position="absolute" top="-6px" right="-6px"
            bg="red.500"
            color="white"
            borderRadius="full"
            fontSize="13px"
            fontWeight="bold"
            minW="24px"
            h="24px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            border="2px solid white"
            boxShadow="0 2px 8px rgba(0,0,0,0.3)"
            animation="pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
            sx={{
              "@keyframes pulse": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.7 },
              },
            }}
          >
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </Badge>
        )}
      </Box>
    </Box>
  );
}
