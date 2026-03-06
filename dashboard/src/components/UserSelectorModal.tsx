// src/components/UserSelectorModal.tsx
import React, { useState, useEffect, useMemo } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Input,
  VStack,
  Button,
  Text,
  Spinner,
  Box,
  useColorMode,
  InputGroup,
  InputLeftElement,
  Icon,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { FiUsers } from "react-icons/fi";
import { useTaskStore } from "../store/useTaskStore";

interface UserSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserSelectorModal: React.FC<UserSelectorModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { colorMode } = useColorMode();
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);
  const currentViewerId = useTaskStore((s) => s.viewingUserId);
  const users = useTaskStore((s) => s.users); // Read from store
  const fetchUsers = useTaskStore((s) => s.fetchUsers); // Get fetch function

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setSearchQuery(""); // Reset search when modal opens
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      await fetchUsers(); // Use TaskStore fetch to update store
    } catch (err) {
      console.error("Error loading users:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const query = searchQuery.toLowerCase();
    return users.filter(
      (user) =>
        user.username?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
    );
  }, [users, searchQuery]);

  const handleSelectUser = (userId: number | null) => {
    setViewingUserId(userId);

    // Set scope based on selection
    if (userId === null) {
      setViewScope('all'); // View All Users
    } else {
      setViewScope('user'); // View specific user
    }

    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent
        bg={colorMode === "dark" ? "gray.800" : "white"}
        borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
        maxH="80vh"
      >
        <ModalHeader
          borderBottom="1px solid"
          borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
        >
          Select User to View
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody p={4}>
          {loading ? (
            <Box textAlign="center" py={8}>
              <Spinner />
            </Box>
          ) : (
            <>
              {/* Search Input */}
              <InputGroup mb={4}>
                <InputLeftElement pointerEvents="none">
                  <SearchIcon color="gray.400" />
                </InputLeftElement>
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  bg={colorMode === "dark" ? "gray.700" : "gray.50"}
                  borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.300"}
                />
              </InputGroup>

              {/* User List */}
              <VStack spacing={2} align="stretch" maxH="400px" overflowY="auto">
                {/* All Users Option */}
                <Button
                  onClick={() => handleSelectUser(null)}
                  colorScheme={currentViewerId === null ? "blue" : undefined}
                  variant={currentViewerId === null ? "solid" : "ghost"}
                  justifyContent="flex-start"
                  leftIcon={<Icon as={FiUsers} />}
                  size="md"
                  _hover={{
                    bg: currentViewerId === null
                      ? undefined
                      : colorMode === "dark"
                      ? "whiteAlpha.100"
                      : "gray.100"
                  }}
                >
                  <Text flex="1" textAlign="left">
                    All Users
                  </Text>
                </Button>

                {/* Individual Users */}
                {filteredUsers.length === 0 ? (
                  <Text color="gray.500" textAlign="center" py={4}>
                    No users found
                  </Text>
                ) : (
                  filteredUsers.map((user) => (
                    <Button
                      key={user.user_id}
                      onClick={() => handleSelectUser(user.user_id)}
                      colorScheme={currentViewerId === user.user_id ? "green" : undefined}
                      variant={currentViewerId === user.user_id ? "solid" : "ghost"}
                      justifyContent="space-between"
                      size="md"
                      _hover={{
                        bg: currentViewerId === user.user_id
                          ? undefined
                          : colorMode === "dark"
                          ? "whiteAlpha.100"
                          : "gray.100"
                      }}
                    >
                      <Text flex="1" textAlign="left">
                        {user.username}
                      </Text>
                      <Text fontSize="sm" color="gray.500">
                        {user.verimeter_score ?? 0} 🧠
                      </Text>
                    </Button>
                  ))
                )}
              </VStack>
            </>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
