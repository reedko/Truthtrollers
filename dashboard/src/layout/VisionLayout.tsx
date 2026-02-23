import React, { useEffect, useRef } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  IconButton,
  useDisclosure,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerHeader,
  DrawerBody,
  useBreakpointValue,
  useColorModeValue,
} from "@chakra-ui/react";
import { Outlet, useLocation, Link as RouterLink } from "react-router-dom";
import {
  FiHome,
  FiBarChart2,
  FiMenu,
  FiUser,
  FiAward,
  FiEdit,
  FiMail,
  FiMessageSquare,
} from "react-icons/fi";
import TopicList from "../components/TopicList";
import TopContributors from "../components/TopContributors";
import HotTopics from "../components/HotTopics";
import CollapsibleTopics from "../components/CollapsibleTopics";
import ChatBubble from "../components/ChatBubble";
import PWAInstallBanner from "../components/PWAInstallBanner";
import NavBar from "../components/NavBar";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { decodeJwt } from "../utils/jwt";
import { AccountMenu } from "../components/AccountMenu";
import { PlatformTour } from "../components/PlatformTour";

const SIDEBAR_WIDTH = "200px";
const HEADER_HEIGHT = "160px";

const SidebarContent: React.FC<{ onNavigate?: () => void }> = ({
  onNavigate,
}) => {
  const location = useLocation();
  const isTaskPage = location.pathname.startsWith("/tasks");
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const user = useAuthStore((s) => s.user);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const resetTasks = useTaskStore((s) => s.resetTasks);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const hasHydrated = useTaskStore((s) => s.hasHydrated);

  // 🚦 Only fetch once Zustand store is hydrated
  useEffect(() => {
    if (hasHydrated && user?.user_id) {
      resetTasks();
      fetchTasksForUser(user.user_id);
    }
  }, [hasHydrated, user?.user_id, resetTasks, fetchTasksForUser]);

  const handleClick = (path: string) => () => {
    onNavigate?.(); // close drawer (mobile)
    if (!selectedTaskId) setRedirect(path);
  };

  const createLink = (label: string, path: string) => (
    <RouterLink to={path} onClick={handleClick(path)}>
      <HStack spacing={2} mb={2}>
        <FiBarChart2 />
        <Text>{label}</Text>
      </HStack>
    </RouterLink>
  );

  return (
    <VStack align="start" spacing={4} w="full">
      <RouterLink to="/dashboard" onClick={handleClick("/dashboard")}>
        <HStack spacing={2} mb={2}>
          <FiHome />
          <Text>Dashboard</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/tasks" onClick={handleClick("/tasks")}>
        <HStack spacing={2} mb={2}>
          <FiBarChart2 />
          <Text>Tasks</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/gamespace" onClick={handleClick("/gamespace")}>
        <HStack spacing={2} mb={2}>
          <FiHome />
          <Text>GameSpace</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/level" onClick={handleClick("/level")}>
        <HStack spacing={2} mb={2}>
          <FiAward />
          <Text>Level</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/textpad" onClick={handleClick("/textpad")}>
        <HStack spacing={2} mb={2}>
          <FiEdit />
          <Text>TextPad</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/chat" onClick={handleClick("/chat")}>
        <HStack spacing={2} mb={2}>
          <FiMessageSquare />
          <Text>Chat</Text>
        </HStack>
      </RouterLink>
      <RouterLink to="/emailtest" onClick={handleClick("/emailtest")}>
        <HStack spacing={2} mb={2}>
          <FiMail />
          <Text>Email Test</Text>
        </HStack>
      </RouterLink>
      {createLink("Extension", "/extension")}
      {createLink("Workspace", selectedTaskId ? "/workspace" : "/tasks")}
      {createLink("Molecule", selectedTaskId ? "/molecule" : "/tasks")}
      {createLink(
        "Discussion",
        selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks",
      )}

      <RouterLink to="/game" onClick={handleClick("/game")}>
        <HStack spacing={2} mb={2}>
          <FiHome />
          <Text>Game</Text>
        </HStack>
      </RouterLink>

      <HStack spacing={2} mb={2} align="center">
        <FiUser />
        <AccountMenu />
        <Text>Account</Text>
      </HStack>

      {/* Activity Widgets */}
      <Box w="full" mt={6}>
        <VStack spacing={3} w="full">
          {isTaskPage && <CollapsibleTopics />}
          <TopContributors />
          <HotTopics />
        </VStack>
      </Box>
    </VStack>
  );
};

const Sidebar: React.FC = () => {
  const sidebarColor = useColorModeValue("gray.700", "white");
  const sidebarBorderColor = useColorModeValue("rgba(100, 116, 139, 0.25)", "gray.700");
  const brandColor = useColorModeValue("gray.700", "teal.300");
  const sidebarBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.3), rgba(148, 163, 184, 0.2))",
    "transparent"
  );

  return (
    <VStack
      as="nav"
      bgGradient={sidebarBg}
      backdropFilter="blur(8px)"
      color={sidebarColor}
      spacing={6}
      p={4}
      w={SIDEBAR_WIDTH}
      h="100vh"
      position="fixed"
      top={0}
      left={0}
      borderRight="1px solid"
      borderColor={sidebarBorderColor}
      zIndex={100}
      display={{ base: "none", md: "flex" }}
      overflowY="auto"
      sx={{
        "&::-webkit-scrollbar": {
          display: "none",
        },
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <Text fontSize="2xl" fontWeight="bold" color={brandColor}>
        Truthtrollers
      </Text>
      <SidebarContent />
    </VStack>
  );
};

const VisionLayout: React.FC = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const isMobile = useBreakpointValue({ base: true, md: false });
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  // Color mode values
  const drawerBg = useColorModeValue("rgba(255, 255, 255, 0.95)", "gray.900");
  const drawerColor = useColorModeValue("gray.700", "white");
  const headerBorderColor = useColorModeValue("rgba(100, 116, 139, 0.25)", "gray.700");
  const headerBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.35), rgba(148, 163, 184, 0.2))",
    "linear-gradient(to bottom, rgba(2,0,36,0.8), rgba(94,234,212,0.1))"
  );

  // Auto-close drawer on route change
  useEffect(() => {
    if (isOpen) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const demoToken = params.get("demo");

    if (demoToken) {
      const payload = decodeJwt(demoToken);
      const demoUser = {
        ...payload,
        username: "CritStink",
        avatar: "C",
        can_post: false,
        isDemo: true,
      };
      setAuth(demoUser, demoToken);

      // Set default viewing user to demo user
      if (demoUser.user_id) {
        useTaskStore.getState().setViewingUserId(demoUser.user_id);
      }

      // Remove ?demo=... from URL for aesthetics
      params.delete("demo");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        location.pathname + (newSearch ? `?${newSearch}` : ""),
      );
    }
  }, [location.search, location.pathname, setAuth]);

  return (
    <>
      <Sidebar />

      {isMobile && (
        <Drawer
          placement="left"
          onClose={onClose}
          isOpen={isOpen}
          closeOnOverlayClick
          returnFocusOnClose
          finalFocusRef={menuBtnRef}
        >
          <DrawerOverlay />
          <DrawerContent bg={drawerBg} color={drawerColor}>
            <DrawerCloseButton />
            <DrawerHeader borderBottomWidth="1px">Menu</DrawerHeader>
            <DrawerBody>
              {/* Close drawer immediately on any link tap */}
              <SidebarContent onNavigate={onClose} />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}

      <Box
        as="header"
        position="fixed"
        top={0}
        left={{ base: 0, md: SIDEBAR_WIDTH }}
        right={0}
        zIndex={90}
        h={{ base: "60px", md: HEADER_HEIGHT }}
        px={4}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        borderBottom="1px solid"
        borderColor={headerBorderColor}
        backdropFilter="blur(12px)"
        background={headerBg}
      >
        <HStack spacing={2} align="center">
          {isMobile && (
            <IconButton
              ref={menuBtnRef}
              icon={<FiMenu />}
              aria-label="Menu"
              onClick={onOpen}
              size="sm"
              variant="outline"
              colorScheme="teal"
              mr={2}
            />
          )}
        </HStack>

        <Box flex={1}>
          <NavBar compact={isMobile} />
        </Box>
      </Box>

      <Box
        as="main"
        ml={{ base: 0, md: SIDEBAR_WIDTH }}
        pt={{ base: "60px", md: HEADER_HEIGHT }}
        px={4}
        pb={8}
      >
        <Outlet />
      </Box>

      <PlatformTour />
      <ChatBubble />
      <PWAInstallBanner />
    </>
  );
};

export default VisionLayout;
