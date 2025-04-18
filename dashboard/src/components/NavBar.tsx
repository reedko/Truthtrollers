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
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  // Helper to conditionally set redirect before navigating
  const handleNavClick = (target: string) => {
    if (!selectedTaskId) {
      setRedirect(target);
    }
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

          <Link
            as={RouterLink}
            to="/workspace"
            onClick={() => handleNavClick("/workspace")}
          >
            Workspace
          </Link>

          <Link
            as={RouterLink}
            to="/molecule"
            onClick={() => handleNavClick("/molecule")}
          >
            Molecule
          </Link>

          <Link
            as={RouterLink}
            to="/discussion"
            onClick={() => handleNavClick("/discussion")}
          >
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

        {selectedTaskId && (
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
