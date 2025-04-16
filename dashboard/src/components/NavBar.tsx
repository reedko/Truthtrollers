import {
  Box,
  Flex,
  HStack,
  Image,
  Input,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Button,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import ColorModeSwitch from "./ColorModeSwitch";
import { useTaskStore } from "../store/useTaskStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

const NavBar = () => {
  const setSearchQuery = useTaskStore((state) => state.setSearchQuery);
  const selectedTask = useTaskStore((state) => state.selectedTask); // ✅ Use Zustand store

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  return (
    <Box>
      {/* Top-Level Navigation */}
      <Box as="nav" p={3} color="white">
        <HStack spacing={6}>
          <Link as={RouterLink} to="/tasks">
            Tasks
          </Link>
          <Link as={RouterLink} to="/dashboard">
            Dashboard
          </Link>
          <Link as={RouterLink} to="/workspace">
            Workspace
          </Link>
          <Link as={RouterLink} to="/molecule">
            Molecule
          </Link>
          <Link as={RouterLink} to="/discussion">
            Discussion
          </Link>
        </HStack>
      </Box>

      {/* Search Bar & Logo Row */}
      <Flex align="center" p={3} boxShadow="sm" width="100%" wrap="wrap">
        <RouterLink to="/">
          <Image
            src={`${API_BASE_URL}/assets/ttlogo11.png`}
            boxSize="100px"
            objectFit="contain"
          />
        </RouterLink>

        <Input
          placeholder="Search content..."
          onChange={handleSearchChange}
          marginLeft="20px"
          maxWidth="1000px"
          flex="1"
        />

        <Spacer />

        {selectedTask && (
          <Menu>
            <MenuButton as={Button}>View</MenuButton>
            <MenuList>
              <MenuItem as={RouterLink} to="/workspace">
                Workspace
              </MenuItem>
              <MenuItem as={RouterLink} to="/molecule">
                Graph
              </MenuItem>
              <MenuItem as={RouterLink} to="/discussion">
                Discussion
              </MenuItem>
            </MenuList>
          </Menu>
        )}

        <ColorModeSwitch />
      </Flex>
    </Box>
  );
};

export default NavBar;
