import React, { useEffect } from "react";
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
} from "@chakra-ui/react";
import { Outlet, useLocation, Link as RouterLink } from "react-router-dom";
import { FiHome, FiBarChart2, FiMenu, FiUser } from "react-icons/fi";
import TopicList from "../components/TopicList";
import NavBar from "../components/NavBar";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { decodeJwt } from "../utils/jwt";
import { AccountMenu } from "../components/AccountMenu";

const SIDEBAR_WIDTH = "220px";
const HEADER_HEIGHT = "160px";

const SidebarContent: React.FC = () => {
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
  }, [hasHydrated, user?.user_id]);

  const createLink = (label: string, path: string) => (
    <RouterLink
      to={path}
      onClick={() => {
        if (!selectedTaskId) setRedirect(path);
      }}
    >
      <HStack spacing={2} mb={2}>
        <FiBarChart2 />
        <Text>{label}</Text>
      </HStack>
    </RouterLink>
  );

  return (
    <VStack align="start" spacing={4} w="full">
      <RouterLink to="/dashboard">
        <HStack spacing={2} mb={2}>
          <FiHome />
          <Text>Dashboard</Text>
        </HStack>
      </RouterLink>
      {createLink("Extension", "/extension")}
      {createLink("Workspace", selectedTaskId ? "/workspace" : "/tasks")}
      {createLink("Molecule", selectedTaskId ? "/molecule" : "/tasks")}
      {createLink(
        "Discussion",
        selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks"
      )}

      <RouterLink to="/game">
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

      {isTaskPage && selectedTaskId && (
        <Box overflowY="auto" flex="1" w="full" mt={4} pr={1}>
          <TopicList />
        </Box>
      )}
    </VStack>
  );
};

const Sidebar: React.FC = () => (
  <VStack
    as="nav"
    color="white"
    spacing={6}
    p={4}
    w={SIDEBAR_WIDTH}
    h="100vh"
    position="fixed"
    top={0}
    left={0}
    borderRight="1px solid"
    borderColor="gray.700"
    zIndex={100}
    display={{ base: "none", md: "flex" }}
  >
    <Text fontSize="2xl" fontWeight="bold" color="teal.300">
      Truthtrollers
    </Text>
    <SidebarContent />
  </VStack>
);

const VisionLayout: React.FC = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const isMobile = useBreakpointValue({ base: true, md: false });
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

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

      // Remove ?demo=... from URL for aesthetics
      params.delete("demo");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        location.pathname + (newSearch ? `?${newSearch}` : "")
      );
    }
    // Don't add logout or clearing logic here!
  }, [location.search, location.pathname, setAuth]);
  return (
    <>
      <Sidebar />

      {isMobile && (
        <Drawer placement="left" onClose={onClose} isOpen={isOpen}>
          <DrawerOverlay />
          <DrawerContent bg="gray.900" color="white">
            <DrawerCloseButton />
            <DrawerHeader borderBottomWidth="1px">Menu</DrawerHeader>
            <DrawerBody>
              <SidebarContent />
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
        borderColor="gray.700"
        backdropFilter="blur(12px)"
        background="linear-gradient(to bottom, rgba(2,0,36,0.8), rgba(94,234,212,0.1))"
      >
        <HStack spacing={2} align="center">
          {isMobile && (
            <IconButton
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
        minH="100vh"
      >
        <Outlet />
      </Box>
    </>
  );
};

export default VisionLayout;
