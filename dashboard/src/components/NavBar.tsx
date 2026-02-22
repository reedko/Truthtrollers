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
  useColorModeValue,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import ColorModeSwitch from "./ColorModeSwitch";
import HeaderToggleSwitch from "./HeaderToggleSwitch";
import { useTaskStore } from "../store/useTaskStore";
import { AccountMenu } from "./AccountMenu";
import { TourTriggerButton } from "./PlatformTour";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

interface NavBarProps {
  compact?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ compact }) => {
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const navColor = useColorModeValue("gray.700", "white");

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
                <MenuItem as={RouterLink} to="/tasks">
                  Tasks
                </MenuItem>
                <MenuItem as={RouterLink} to="/workspace">
                  Workspace
                </MenuItem>
                <MenuItem as={RouterLink} to="/molecule">
                  Graph
                </MenuItem>
                <MenuItem as={RouterLink} to="/quadrantgrid">
                  QuadrantGrid
                </MenuItem>
                <MenuItem as={RouterLink} to="/textpad">
                  TextPad
                </MenuItem>
                <MenuItem as={RouterLink} to="/chat">
                  Chat
                </MenuItem>
                <MenuItem as={RouterLink} to="/level">
                  Level
                </MenuItem>
                <MenuItem as={RouterLink} to="/game">
                  Game
                </MenuItem>
                <MenuItem as={RouterLink} to="/gamespace">
                  GameSpace
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

          <TourTriggerButton />
          <HeaderToggleSwitch />
          <ColorModeSwitch />
        </Flex>
      ) : (
        <Box>
          {/* Full Navigation Menu */}
          <Box as="nav" p={3} color={navColor}>
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
                to="/quadrantgrid"
                onClick={() => handleNavClick("/quadrantgrid")}
              >
                QuadrantGrid
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
                to="/textpad"
                onClick={() => handleNavClick("/textpad")}
              >
                TextPad
              </Link>
              <Link
                as={RouterLink}
                to="/chat"
                onClick={() => handleNavClick("/chat")}
              >
                Chat
              </Link>
              <Link
                as={RouterLink}
                to="/level"
                onClick={() => handleNavClick("/level")}
              >
                Level
              </Link>
              <Link
                as={RouterLink}
                to="/game"
                onClick={() => handleNavClick("/game")}
              >
                Game
              </Link>
              <Link
                as={RouterLink}
                to="/gamespace"
                onClick={() => handleNavClick("/gamespace")}
              >
                GameSpace
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
                  <MenuItem as={RouterLink} to="/tasks">
                    Tasks
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/workspace">
                    Workspace
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/molecule">
                    Molecule
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/quadrantgrid">
                    QuadrantGrid
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/textpad">
                    TextPad
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/chat">
                    Chat
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/level">
                    Level
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/game">
                    Game
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/gamespace">
                    GameSpace
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

            <TourTriggerButton />
            <HeaderToggleSwitch />
            <ColorModeSwitch />
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export default NavBar;
