// src/components/ViewerScopeBadge.tsx
import React, { useEffect } from "react";
import {
  Text,
  Select,
  Icon,
  Box,
  useColorMode,
  useDisclosure,
  Button,
} from "@chakra-ui/react";
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

  const getDisplayValue = () => {
    if (viewScope === 'user') return `user:${viewedUserName}`;
    if (viewScope === 'all') return 'all';
    if (viewScope === 'admin') return 'admin';
    return 'user';
  };

  return (
    <>
      <Box
        display="flex"
        alignItems="center"
        gap={{ base: 0.5, md: 1 }}
        bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)"}
        px={{ base: 1.5, md: 2 }}
        py={{ base: 0.5, md: 1 }}
        borderRadius="full"
        border="1px solid"
        borderColor={colorMode === "dark" ? "rgba(113, 219, 255, 0.2)" : "rgba(71, 85, 105, 0.2)"}
        boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
        position="relative"
        zIndex={500}
      >
        <Text
          className="mr-text-muted"
          fontSize={{ base: "8px", md: "9px", lg: "10px" }}
          textTransform="uppercase"
          letterSpacing="0.3px"
          whiteSpace="nowrap"
          display={{ base: "none", lg: "block" }}
        >
          Viewing
        </Text>
        <Select
          size="xs"
          width={{ base: "85px", md: "100px", lg: "120px" }}
          fontSize={{ base: "9px", md: "10px", lg: "11px" }}
          height={{ base: "20px", md: "24px" }}
          value={getDisplayValue()}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'all') {
              handleScopeChange('all');
            } else if (val === 'admin') {
              handleScopeChange('admin');
            } else if (val === 'switch') {
              handleSwitchViewer();
            } else {
              handleScopeChange('user');
            }
          }}
          bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white"}
          border="1px solid"
          borderColor={colorMode === "dark" ? "var(--mr-blue-border)" : "rgba(71, 85, 105, 0.3)"}
          color={colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800"}
          borderRadius="full"
          boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
          _hover={{
            borderColor: colorMode === "dark" ? "var(--mr-blue)" : "rgba(71, 85, 105, 0.5)",
          }}
        >
          <option value={`user:${viewedUserName}`}>👤 {viewedUserName}</option>
          <option value="all">👥 All</option>
          {user?.role === 'admin' && <option value="admin">🛡️ Admin</option>}
          <option value="switch">🔄 Switch</option>
        </Select>
      </Box>

      <UserSelectorModal isOpen={isOpen} onClose={onClose} />
    </>
  );
};
