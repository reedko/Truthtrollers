// src/components/ViewerScopeBadge.tsx
import React, { useEffect } from "react";
import {
  HStack,
  Text,
  Badge,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Button,
  Icon,
  Flex,
  Box,
  useColorMode,
  useDisclosure,
} from "@chakra-ui/react";
import { ChevronDownIcon } from "@chakra-ui/icons";
import { FiUsers, FiUser, FiShield } from "react-icons/fi";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { UserSelectorModal } from "./UserSelectorModal";

interface ViewerScopeBadgeProps {
  onScopeChange?: (scope: ViewScope) => void;
}

export const ViewerScopeBadge: React.FC<ViewerScopeBadgeProps> = ({
  onScopeChange,
}) => {
  const { colorMode } = useColorMode();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
  const setViewScope = useTaskStore((s) => s.setViewScope);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const user = useAuthStore((s) => s.user);
  const users = useTaskStore((s) => s.users);
  const fetchUsers = useTaskStore((s) => s.fetchUsers);

  // Load users if not already loaded
  useEffect(() => {
    if (users.length === 0) {
      fetchUsers();
    }
  }, [users.length, fetchUsers]);

  const viewedUser = users.find((u) => u.user_id === viewerId);
  const viewedUserName = viewedUser?.username || user?.username || "Unknown";

  const handleScopeChange = (newScope: ViewScope) => {
    setViewScope(newScope);
    if (onScopeChange) onScopeChange(newScope);

    // If switching to "all", clear viewerId
    if (newScope === 'all') {
      setViewingUserId(null);
    }
    // If switching to "user" and no viewer selected, default to logged-in user
    else if (newScope === 'user' && !viewerId && user?.user_id) {
      setViewingUserId(user.user_id);
    }
  };

  const handleSwitchViewer = () => {
    onOpen();
  };

  const getScopeIcon = () => {
    switch (viewScope) {
      case 'all':
        return FiUsers;
      case 'admin':
        return FiShield;
      case 'user':
      default:
        return FiUser;
    }
  };

  const getScopeColor = () => {
    switch (viewScope) {
      case 'all':
        return 'blue';
      case 'admin':
        return 'cyan';  // Changed from purple to cyan (blue/teal)
      case 'user':
      default:
        return 'green';
    }
  };

  const getScopeLabel = () => {
    switch (viewScope) {
      case 'all':
        return 'All Users';
      case 'admin':
        return 'Admin View';
      case 'user':
      default:
        return viewedUserName;
    }
  };

  return (
    <>
      <Flex
        align="center"
        gap={1.5}
        bg={colorMode === "dark" ? "whiteAlpha.100" : "blackAlpha.50"}
        px={2.5}
        py={2}
        borderRadius="md"
        backdropFilter="blur(8px)"
        border="1px solid"
        borderColor={colorMode === "dark" ? "whiteAlpha.200" : "blackAlpha.200"}
        position="relative"
        zIndex={1000}
      >
        <Icon as={getScopeIcon()} boxSize={3.5} color={colorMode === "dark" ? `${getScopeColor()}.400` : `${getScopeColor()}.600`} />
        <Text fontSize="xs" fontWeight="medium" color={colorMode === "dark" ? "whiteAlpha.900" : "gray.700"}>
          {viewScope === 'user' ? 'Viewing as:' : 'Viewing:'}
        </Text>
        <Menu>
          <MenuButton
            as={Button}
            rightIcon={<ChevronDownIcon />}
            size="sm"
            variant="ghost"
            colorScheme={getScopeColor()}
            _hover={{ bg: colorMode === "dark" ? `${getScopeColor()}.700` : `${getScopeColor()}.100` }}
            fontSize="xs"
            px={2}
          >
            {getScopeLabel()}
          </MenuButton>
          <MenuList bg={colorMode === "dark" ? "gray.800" : "white"} borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"} zIndex={99999}>
            <MenuItem
              icon={<Icon as={FiUser} />}
              onClick={() => handleScopeChange('user')}
              bg={viewScope === 'user' ? (colorMode === "dark" ? 'green.700' : 'green.100') : undefined}
            >
              User View
            </MenuItem>
            <MenuItem
              icon={<Icon as={FiUsers} />}
              onClick={() => handleScopeChange('all')}
              bg={viewScope === 'all' ? (colorMode === "dark" ? 'blue.700' : 'blue.100') : undefined}
            >
              All Users
            </MenuItem>
            <MenuItem
              icon={<Icon as={FiShield} />}
              onClick={() => handleScopeChange('admin')}
              bg={viewScope === 'admin' ? (colorMode === "dark" ? 'cyan.700' : 'cyan.100') : undefined}
              isDisabled={!user || user.role !== 'admin'}
            >
              Admin View
            </MenuItem>
            <MenuItem
              icon={<Icon as={FiUser} />}
              onClick={handleSwitchViewer}
              borderTop="1px solid"
              borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
              mt={2}
            >
              Switch User...
            </MenuItem>
          </MenuList>
        </Menu>
      </Flex>

      <UserSelectorModal isOpen={isOpen} onClose={onClose} />
    </>
  );
};
