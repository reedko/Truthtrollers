// VisionLayout.tsx (Responsive with Burger Menu)
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
import { FiHome, FiBarChart2, FiMenu } from "react-icons/fi";
import TopicList from "../components/TopicList";
import NavBar from "../components/NavBar";
import { useTaskStore } from "../store/useTaskStore";

const SIDEBAR_WIDTH = "220px";
const HEADER_HEIGHT = "160px";

const SidebarContent = () => {
  const location = useLocation();
  const isTaskPage = location.pathname === "/tasks";
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);

  const createLink = (label: string, route: string) => (
    <RouterLink
      to={selectedTaskId ? route : "/tasks"}
      onClick={() => {
        if (!selectedTaskId) {
          setRedirect(route);
        }
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
      {createLink("Workspace", "/workspace")}
      {createLink("Molecule", "/molecule")}
      {createLink("Discussion", "/discussion")}

      {isTaskPage && (
        <Box overflowY="auto" flex="1" w="full" mt={4} pr={1}>
          <TopicList />
        </Box>
      )}
    </VStack>
  );
};

const Sidebar = () => {
  return (
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
};

const VisionLayout = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const isMobile = useBreakpointValue({ base: true, md: false });

  return (
    <>
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Mobile Burger Drawer */}
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
        top="0"
        left={{ base: 0, md: SIDEBAR_WIDTH }}
        right="0"
        zIndex={90}
        h={{ base: "60px", md: HEADER_HEIGHT }}
        px={4}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        borderBottom="1px solid"
        borderColor="gray.700"
        backdropFilter="blur(12px)"
        background="linear-gradient(to bottom, rgba(2, 0, 36, 0.8), rgba(94, 234, 212, 0.1))"
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
        <Box flex="1">
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
