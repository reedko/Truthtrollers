// src/components/AccountMenu.tsx
import React from "react";
import {
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  MenuGroup,
  Flex,
  Text,
  Badge,
  useDisclosure,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";
import { UserSelectorModal } from "./UserSelectorModal";

export const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const { isOpen: isModalOpen, onOpen: onOpenModal, onClose: onCloseModal } = useDisclosure();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";
  const clearTask = useTaskStore.getState().setSelectedTask;

  const handleLogout = () => {
    logout();
    clearTask(null);
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
    <>
      <Menu>
        <MenuButton
          cursor="pointer"
          border="none"
          background="transparent"
          _hover={{
            "& .chakra-avatar": {
              boxShadow: "0 0 20px rgba(113, 219, 255, 0.6)",
              borderColor: "rgba(113, 219, 255, 0.8)",
            },
          }}
        >
          <Avatar
            size="sm"
            name={displayName}
            src={avatarSrc}
            bg="teal.500"
            color="white"
            borderColor={isDemo ? "yellow.300" : "transparent"}
            borderWidth={isDemo ? 2 : 0}
            transition="all 0.2s"
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
          <MenuItem onClick={onOpenModal}>
            Switch Viewer
          </MenuItem>

          <MenuItem onClick={() => navigate("/account")}>Account Settings</MenuItem>
          <MenuItem onClick={() => navigate("/admin/social")}>Social Admin</MenuItem>
          {!isDemo && (
            <MenuItem onClick={() => navigate("/permissions")}>Permissions</MenuItem>
          )}
          {user?.role === "super_admin" && (
            <MenuItem onClick={() => navigate("/admin")} color="purple.400" fontWeight="bold">
              Admin Panel
            </MenuItem>
          )}

          {user?.role === "super_admin" && (
            <>
              <MenuDivider />
              <MenuGroup title="🛠 All Tools">
                <MenuItem onClick={() => navigate("/workspace")} fontSize="sm">Workspace</MenuItem>
                <MenuItem onClick={() => navigate("/casefocus")} fontSize="sm">Case Focus</MenuItem>
                <MenuItem onClick={() => navigate("/molecule")} fontSize="sm">Molecule</MenuItem>
                <MenuItem onClick={() => navigate("/knowgraph")} fontSize="sm">KnowGraph</MenuItem>
                <MenuItem onClick={() => navigate("/credibility")} fontSize="sm">Credibility</MenuItem>
                <MenuItem onClick={() => navigate("/textpad")} fontSize="sm">TextPad</MenuItem>
                <MenuItem onClick={() => navigate("/tutorials")} fontSize="sm">🎓 Tutorials</MenuItem>
                <MenuItem onClick={() => navigate("/social-media")} fontSize="sm">🐦 Social Media</MenuItem>
                <MenuItem onClick={() => navigate("/ttlive")} fontSize="sm">💬 TT Live</MenuItem>
                <MenuItem onClick={() => navigate("/game")} fontSize="sm">🎮 Game</MenuItem>
                <MenuItem onClick={() => navigate("/gamespace")} fontSize="sm">🕹 GameSpace</MenuItem>
                <MenuItem onClick={() => navigate("/level")} fontSize="sm">📈 Level</MenuItem>
                <MenuItem onClick={() => navigate("/game/truefalse")} fontSize="sm">🎯 TrueFalse Game</MenuItem>
                <MenuItem onClick={() => navigate("/quadrantgrid")} fontSize="sm">📊 QuadrantGrid</MenuItem>
                <MenuItem onClick={() => navigate("/claim-duel")} fontSize="sm">⚔️ Claim Duel</MenuItem>
                <MenuItem onClick={() => navigate("/foxcase")} fontSize="sm">🦊 FoxCase</MenuItem>
                <MenuItem onClick={() => navigate("/chat")} fontSize="sm">Chat</MenuItem>
                <MenuItem onClick={() => navigate("/evaluate-ratings")} fontSize="sm">Evaluate Ratings</MenuItem>
                <MenuItem onClick={() => navigate("/admin/social")} fontSize="sm">Social Admin</MenuItem>
                <MenuItem onClick={() => navigate("/permissions")} fontSize="sm">Permissions</MenuItem>
              </MenuGroup>
            </>
          )}

          <MenuDivider />
          <MenuItem onClick={handleLogout}>Log out</MenuItem>
        </MenuList>
      </Menu>

      <UserSelectorModal isOpen={isModalOpen} onClose={onCloseModal} />
    </>
  );
};
