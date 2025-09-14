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
  useBreakpointValue,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import ColorModeSwitch from "./ColorModeSwitch";
import { useTaskStore } from "../store/useTaskStore";
import { AccountMenu } from "./AccountMenu";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

interface NavBarProps {
  compact?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ compact }) => {
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleNavClick = (target: string) => {
    if (!selectedTaskId) {
      setRedirect(target);
    }
  };

  return (
    <Box w="100%">
      {/* Compact mode: Only search and switches */}
      {compact ? (
        <Flex
          align="center"
          px={2}
          py={1}
          justify="space-between"
          wrap="nowrap"
        >
          <HStack spacing={2} align="center">
            <Box h="50px">
              <Image
                src={`${API_BASE_URL}/assets/ttlogo11.png`}
                boxSize="50px"
                objectFit="contain"
              />
            </Box>
          </HStack>

          <Input
            placeholder="Search..."
            onChange={handleSearchChange}
            fontSize="xs"
            size="sm"
            width="130px"
            mx={2}
          />

          {selectedTaskId && (
            <Menu>
              <MenuButton as={Button} size="sm">
                View
              </MenuButton>
              <MenuList>
                <MenuItem as={RouterLink} to="/workspace">
                  Workspace
                </MenuItem>
                <MenuItem as={RouterLink} to="/molecule">
                  Graph
                </MenuItem>
                <MenuItem as={RouterLink} to="/game">
                  Game
                </MenuItem>
                <MenuItem
                  as={RouterLink}
                  to={
                    selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks"
                  }
                >
                  Discussion
                </MenuItem>
              </MenuList>
            </Menu>
          )}

          <ColorModeSwitch />
        </Flex>
      ) : (
        <Box>
          {/* Full Navigation Menu */}
          <Box as="nav" p={3} color="white">
            <HStack spacing={6} wrap="wrap">
              <Link as={RouterLink} to="/extension">
                Extension
              </Link>
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
                to={selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks"}
                onClick={() => handleNavClick("/discussion")}
              >
                Discussion
              </Link>
              <Link
                as={RouterLink}
                to="/game"
                onClick={() => handleNavClick("/game")}
              >
                Game
              </Link>
              <AccountMenu />
            </HStack>
          </Box>

          {/* Logo, Search and View Switch */}
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
                    Molecule
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to={
                      selectedTaskId
                        ? `/discussion/${selectedTaskId}`
                        : "/tasks"
                    }
                  >
                    Discussion
                  </MenuItem>
                </MenuList>
              </Menu>
            )}

            <ColorModeSwitch />
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default NavBar;
