// VisionLayout.tsx
import { Box, VStack, HStack, Text } from "@chakra-ui/react";
import { Outlet, useLocation, Link as RouterLink } from "react-router-dom";
import { FiHome, FiBarChart2 } from "react-icons/fi";
import TopicList from "../components/TopicList";
import NavBar from "../components/NavBar";
import { useTaskStore } from "../store/useTaskStore";

const SIDEBAR_WIDTH = "220px";
const HEADER_HEIGHT = "160px";

const Sidebar = () => {
  const location = useLocation();
  const isTaskPage = location.pathname === "/tasks";

  const selectedTaskId = useTaskStore((s) => s.selectedTaskId); // ✅ moved here
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
      <HStack spacing={2}>
        <FiBarChart2 />
        <Text>{label}</Text>
      </HStack>
    </RouterLink>
  );

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
    >
      <Text fontSize="2xl" fontWeight="bold" color="teal.300">
        Truthtrollers
      </Text>

      <VStack align="start" spacing={3} w="full">
        <RouterLink to="/dashboard">
          <HStack spacing={2}>
            <FiHome />
            <Text>Dashboard</Text>
          </HStack>
        </RouterLink>

        {createLink("Workspace", "/workspace")}
        {createLink("Molecule", "/molecule")}
        {createLink("Discussion", "/discussion")}
      </VStack>

      {isTaskPage && (
        <Box overflowY="auto" flex="1" w="full" mt={4} pr={1}>
          <TopicList />
        </Box>
      )}
    </VStack>
  );
};

const VisionLayout = () => {
  return (
    <>
      <Sidebar />

      <Box
        as="header"
        position="fixed"
        top="0"
        left={SIDEBAR_WIDTH}
        right="0"
        zIndex={90}
        borderBottom="1px solid"
        borderColor="gray.700"
        backdropFilter="blur(12px)"
        background="linear-gradient(to bottom, rgba(2, 0, 36, 0.8), rgba(94, 234, 212, 0.1))"
      >
        <NavBar />
      </Box>

      <Box as="main" ml={SIDEBAR_WIDTH} pt={HEADER_HEIGHT} px={4} minH="100vh">
        <Outlet />
      </Box>
    </>
  );
};

export default VisionLayout;
