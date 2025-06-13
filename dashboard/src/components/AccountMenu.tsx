// src/components/AccountMenu.tsx
import React from "react";
import {
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Flex,
  Text,
  Badge,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";

export const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";
  const clearTask = useTaskStore.getState().setSelectedTask;

  const handleLogout = () => {
    logout();
    clearTask(null);
    // Clear browser storage for good measure
    localStorage.removeItem("jwt");
    sessionStorage.removeItem("jwt");
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    document.cookie = "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    navigate("/logout", { replace: true });
  };

  const isDemo = user?.isDemo === true;
  const displayName = user?.username || "Guest";
  const avatarSrc = user?.user_profile_image
    ? `${API_BASE_URL}/${user.user_profile_image}`
    : undefined;

  return (
    <Menu>
      <MenuButton cursor="pointer" border="none" background="transparent">
        <Avatar
          size="sm"
          name={displayName}
          src={avatarSrc}
          bg="teal.500"
          color="white"
          borderColor={isDemo ? "yellow.300" : "transparent"}
          borderWidth={isDemo ? 2 : 0}
          sx={{
            "& .chakra-avatar__initials": {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
            },
          }}
        />
      </MenuButton>

      <MenuList>
        <Flex direction="column" px={4} py={2}>
          <Flex align="center">
            <Text fontWeight="bold" mr={2}>
              {displayName}
            </Text>
            {isDemo && (
              <Badge colorScheme="yellow" fontSize="0.6em">
                Demo
              </Badge>
            )}
          </Flex>
          <Text fontSize="sm" color="gray.500">
            {isDemo ? "Read‑only preview" : user?.email}
          </Text>
        </Flex>
        <MenuItem
          onClick={() =>
            navigate("/select-user", {
              state: { redirectTo: location.pathname },
            })
          }
        >
          Switch Viewer
        </MenuItem>

        <MenuItem onClick={() => navigate("/account")}>
          Account Settings
        </MenuItem>
        {!isDemo && (
          <>
            <MenuItem onClick={() => navigate("/permissions")}>
              Permissions
            </MenuItem>
          </>
        )}
        <MenuItem onClick={handleLogout}>Log out</MenuItem>
      </MenuList>
    </Menu>
  );
};
