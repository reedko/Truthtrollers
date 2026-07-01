// dashboard/src/pages/ChatPage.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Box, VStack, HStack, Text, Input, IconButton, Avatar,
  Badge, Spinner, Divider, InputGroup, InputRightElement, Heading,
} from "@chakra-ui/react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { usePushNotifications } from "../hooks/usePushNotifications";
import {
  connectChat, sendMessage, markRead, fetchMessages, fetchConversations, searchUsers,
  fetchAllUsers, fetchOnlineUsers,
} from "../services/chatSocket";

export default function ChatPage() {
  const user = useAuthStore((s) => s.user);
  const {
    conversations, messages, activePartnerId, activePartnerUsername, activePartnerAvatar, onlineUserIds,
    setActivePartner, setMessages, markRead: markReadStore,
  } = useChatStore();

  const { autoSubscribeIfNeeded } = usePushNotifications();
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.jwt && user?.user_id) {
      connectChat(user.jwt, user.user_id);
      fetchConversations();
    }
  }, [user?.jwt, user?.user_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activePartnerId]);

  const openConversation = async (partnerId: number, username?: string, avatar?: string) => {
    const conv = conversations.find((c) => c.partner_id === partnerId);
    setActivePartner(partnerId, username || conv?.partner_username, avatar || conv?.partner_avatar);

    const existing = useChatStore.getState().messages[partnerId];
    if (!existing || existing.length === 0) {
      const msgs = await fetchMessages(partnerId);
      setMessages(partnerId, msgs);
    }
    markRead(partnerId);

    // Request push notification permission after opening first conversation
    autoSubscribeIfNeeded();
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
    console.log("[ChatPage] Fetching all users...");
    setIsSearching(true);
    const results = await fetchAllUsers();
    console.log("[ChatPage] All users results:", results);
    setSearchResults(results);
    setSearchQuery("all");
    setIsSearching(false);
  };

  const handleShowOnlineUsers = async () => {
    console.log("[ChatPage] Fetching online users...");
    setIsSearching(true);
    const results = await fetchOnlineUsers();
    console.log("[ChatPage] Online users results:", results);
    setSearchResults(results);
    setSearchQuery("online");
    setIsSearching(false);
  };

  const activeMessages = activePartnerId ? (messages[activePartnerId] || []) : [];

  return (
    <Box h="calc(100vh - 80px)" display="flex" overflow="hidden">
      {/* ── Sidebar ─────────────────────────────── */}
      <Box
        w="300px"
        flexShrink={0}
        bg="rgba(15, 23, 42, 0.8)"
        borderRight="1px solid rgba(0,162,255,0.2)"
        display="flex"
        flexDirection="column"
      >
        <Box px={4} py={4} borderBottom="1px solid rgba(0,162,255,0.15)">
          <Heading size="md" color="white" mb={3}>Messages</Heading>
          <InputGroup size="sm">
            <Input
              placeholder="Search users…"
              value={searchQuery === "all" || searchQuery === "online" ? "" : searchQuery}
              color="white"
              _placeholder={{ color: "gray.500" }}
              bg="rgba(255,255,255,0.06)"
              border="1px solid rgba(255,255,255,0.15)"
              borderRadius="full"
              onChange={(e) => handleSearch(e.target.value)}
            />
            {isSearching && (
              <InputRightElement><Spinner size="xs" color="blue.300" /></InputRightElement>
            )}
          </InputGroup>
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
          {(searchResults.length > 0 || searchQuery === "all" || searchQuery === "online") && (
            <Box
              mt={1}
              bg="rgba(15,23,42,0.98)"
              border="1px solid rgba(0,162,255,0.3)"
              borderRadius="md"
              overflow="hidden"
              maxH="300px"
              overflowY="auto"
            >
              {searchResults.length > 0 ? (
                searchResults.map((u) => {
                  const isMe = u.is_me || u.user_id === user?.user_id;
                  return (
                    <HStack
                      key={u.user_id}
                      px={3} py={2}
                      cursor={isMe ? "default" : "pointer"}
                      opacity={isMe ? 0.6 : 1}
                      _hover={!isMe ? { bg: "rgba(0,162,255,0.1)" } : {}}
                      onClick={() => {
                        // Don't allow chatting with yourself
                        if (isMe) return;
                        setSearchQuery("");
                        setSearchResults([]);
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
                    >
                      <Box position="relative">
                        <Avatar size="xs" name={u.username} src={u.user_profile_image} />
                        {(u.is_online || onlineUserIds.has(u.user_id)) && (
                          <Box
                            position="absolute" bottom="0" right="0"
                            w="8px" h="8px" borderRadius="full"
                            bg="green.400" border="1.5px solid #0f172a"
                          />
                        )}
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
          )}
        </Box>

        <VStack flex={1} overflowY="auto" spacing={0} align="stretch">
          {conversations.length === 0 && (
            <Text color="gray.500" fontSize="sm" textAlign="center" mt={10} px={4}>
              Search for a user above to start a conversation.
            </Text>
          )}
          {conversations.map((conv) => (
            <HStack
              key={conv.partner_id}
              px={4} py={3}
              cursor="pointer"
              bg={activePartnerId === conv.partner_id ? "rgba(0,162,255,0.12)" : "transparent"}
              borderLeft={activePartnerId === conv.partner_id ? "3px solid #00a2ff" : "3px solid transparent"}
              borderBottom="1px solid rgba(255,255,255,0.05)"
              _hover={{ bg: "rgba(0,162,255,0.08)" }}
              onClick={() => openConversation(conv.partner_id, conv.partner_username, conv.partner_avatar)}
              spacing={3}
            >
              <Box position="relative">
                <Avatar size="sm" name={conv.partner_username} src={conv.partner_avatar} />
                {onlineUserIds.has(conv.partner_id) && (
                  <Box
                    position="absolute" bottom="0" right="0"
                    w="10px" h="10px" borderRadius="full"
                    bg="green.400" border="2px solid #0f172a"
                  />
                )}
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
              {conv.latest_at && (
                <Text color="gray.600" fontSize="xs" whiteSpace="nowrap">
                  {new Date(conv.latest_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              )}
            </HStack>
          ))}
        </VStack>
      </Box>

      {/* ── Message thread ───────────────────────── */}
      {activePartnerId ? (
        <Box flex={1} display="flex" flexDirection="column" bg="rgba(10,15,30,0.6)">
          {/* Thread header */}
          <HStack
            px={6} py={4}
            bg="rgba(15,23,42,0.8)"
            borderBottom="1px solid rgba(0,162,255,0.15)"
            spacing={3}
          >
            <Box position="relative">
              <Avatar size="sm" name={activePartnerUsername || undefined} src={activePartnerAvatar || undefined} />
              {activePartnerId && onlineUserIds.has(activePartnerId) && (
                <Box
                  position="absolute" bottom="0" right="0"
                  w="10px" h="10px" borderRadius="full"
                  bg="green.400" border="2px solid #0f172a"
                />
              )}
            </Box>
            <VStack align="start" spacing={0}>
              <Text color="white" fontWeight="bold">{activePartnerUsername || "Chat"}</Text>
              {activePartnerId && (
                <Text fontSize="xs" color={onlineUserIds.has(activePartnerId) ? "green.400" : "gray.500"}>
                  {onlineUserIds.has(activePartnerId) ? "Online" : "Offline"}
                </Text>
              )}
            </VStack>
          </HStack>

          {/* Messages */}
          <VStack flex={1} overflowY="auto" p={6} spacing={3} align="stretch">
            {activeMessages.map((msg) => {
              const isMine = msg.sender_id === user?.user_id;
              return (
                <Box key={msg.id} alignSelf={isMine ? "flex-end" : "flex-start"} maxW="65%">
                  {!isMine && (
                    <HStack mb={1} spacing={1}>
                      <Avatar size="2xs" name={msg.sender_username} src={msg.sender_avatar} />
                      <Text color="gray.400" fontSize="xs">{msg.sender_username}</Text>
                    </HStack>
                  )}
                  <Box
                    bg={isMine ? "rgba(0,162,255,0.25)" : "rgba(255,255,255,0.07)"}
                    border={isMine ? "1px solid rgba(0,162,255,0.4)" : "1px solid rgba(255,255,255,0.1)"}
                    borderRadius={isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px"}
                    px={4} py={2.5}
                  >
                    <Text color="white">{msg.body}</Text>
                  </Box>
                  <Text color="gray.600" fontSize="xs" textAlign={isMine ? "right" : "left"} mt={0.5}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {isMine && msg.read_at && " · Seen"}
                  </Text>
                </Box>
              );
            })}
            <div ref={bottomRef} />
          </VStack>

          {/* Input */}
          <HStack p={4} borderTop="1px solid rgba(255,255,255,0.08)" spacing={3}>
            <InputGroup>
              <Input
                placeholder="Type a message…"
                value={draft}
                color="white"
                _placeholder={{ color: "gray.500" }}
                bg="rgba(255,255,255,0.06)"
                border="1px solid rgba(255,255,255,0.15)"
                borderRadius="full"
                size="md"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <InputRightElement>
                <IconButton
                  aria-label="Send message"
                  variant="ghost" color="blue.300" size="sm"
                  icon={<span>➤</span>}
                  onClick={handleSend}
                  isDisabled={!draft.trim()}
                />
              </InputRightElement>
            </InputGroup>
          </HStack>
        </Box>
      ) : (
        <Box flex={1} display="flex" alignItems="center" justifyContent="center" bg="rgba(10,15,30,0.6)">
          <VStack spacing={3}>
            <Text fontSize="48px">💬</Text>
            <Text color="gray.400" fontSize="lg">Select a conversation or search for a user to start chatting</Text>
          </VStack>
        </Box>
      )}
    </Box>
  );
}
