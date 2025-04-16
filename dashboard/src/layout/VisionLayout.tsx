import { Box, useColorModeValue } from "@chakra-ui/react";
import { Outlet } from "react-router-dom";
import NavBar from "../components/NavBar"; // Your custom navbar
import { VStack, HStack, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { FiHome, FiBarChart2 } from "react-icons/fi";

const SIDEBAR_WIDTH = "220px";
const NAVBAR_HEIGHT = "160px"; // match your actual NavBar height

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
