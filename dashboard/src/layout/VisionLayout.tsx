import { Box, useColorModeValue } from "@chakra-ui/react";
import { Outlet, useLocation } from "react-router-dom";
import NavBar from "../components/NavBar"; // Your custom navbar
import { VStack, HStack, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { FiHome, FiBarChart2 } from "react-icons/fi";
// inside VisionLayout.tsx
import TopicList from "../components/TopicList"; // ✅ Import it

const SIDEBAR_WIDTH = "220px";
const NAVBAR_HEIGHT = "160px"; // match your actual NavBar height

const Sidebar = () => {
  const location = useLocation(); // 👀 Get current path
  const isTaskPage = location.pathname === "/tasks";
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
        <Link to="/dashboard">
          <HStack spacing={2}>
            <FiHome />
            <Text>Dashboard</Text>
          </HStack>
        </Link>
        <Link to="/workspace">
          <HStack spacing={2}>
            <FiBarChart2 />
            <Text>Workspace</Text>
          </HStack>
        </Link>
        <Link to="/molecule">
          <HStack spacing={2}>
            <FiBarChart2 />
            <Text>Molecule</Text>
          </HStack>
        </Link>
        <Link to="/discussion">
          <HStack spacing={2}>
            <FiBarChart2 />
            <Text>Discussion</Text>
          </HStack>
        </Link>
      </VStack>
      {/* 🫣 Only show this on /tasks */}
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
      {/* Fixed Sidebar */}
      <Sidebar />

      {/* Fixed Top NavBar */}
      <Box
        as="header"
        position="fixed"
        top="0"
        left={SIDEBAR_WIDTH}
        right="0"
        height={NAVBAR_HEIGHT}
        zIndex={90}
        borderBottom="1px solid"
        borderColor="gray.700"
        backdropFilter="blur(12px)" // ✅ adds glass blur2, 0, 36,
        background="linear-gradient(to bottom, rgba(2, 0, 36, 0.8), rgba(94, 234, 212, 0.1))" // ✅ darker transparent overlay
      >
        <NavBar />
      </Box>

      {/* Main content */}
      <Box as="main" ml={SIDEBAR_WIDTH} pt={NAVBAR_HEIGHT} px={4} minH="100vh">
        <Outlet />
      </Box>
    </>
  );
};

export default VisionLayout;
