import {
  Box,
  Flex,
  HStack,
  Image,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Button,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import ColorModeSwitch from "./ColorModeSwitch";
import HeaderToggleSwitch from "./HeaderToggleSwitch";
import { useTaskStore } from "../store/useTaskStore";
import { AccountMenu } from "./AccountMenu";
import { TourTriggerButton } from "./PlatformTour";
import SearchInput from "./SearchInput";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

interface NavBarProps {
  compact?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ compact }) => {
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const navColor = useColorModeValue("gray.700", "white");

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

          <Box width="200px" mx={2}>
            <SearchInput />
          </Box>

          {selectedTaskId && (
            <Menu>
              <MenuButton as={Button} size="sm">
                View
              </MenuButton>
              <MenuList>
                <MenuItem as={RouterLink} to="/tasks">
                  Cases
                </MenuItem>
                <MenuItem as={RouterLink} to="/workspace">
                  Workspace
                </MenuItem>
                <MenuItem as={RouterLink} to="/molecule">
                  Graph
                </MenuItem>
                <MenuItem as={RouterLink} to="/textpad">
                  TextPad
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
              <Link as={RouterLink} to="/tutorials">
                Tutorial Videos
              </Link>
              <Link as={RouterLink} to="/dashboard">
                Dashboard
              </Link>
              <Link as={RouterLink} to="/tasks">
                Cases
              </Link>
              <Link as={RouterLink} to="/extension">
                Extension
              </Link>
              <Menu>
                <MenuButton as={Button} size="sm" variant="ghost">
                  Workbench
                </MenuButton>
                <MenuList>
                  <MenuItem
                    as={RouterLink}
                    to="/textpad"
                    onClick={() => handleNavClick("/textpad")}
                  >
                    TextPad
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/workspace"
                    onClick={() => handleNavClick("/workspace")}
                  >
                    Workspace
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/molecule"
                    onClick={() => handleNavClick("/molecule")}
                  >
                    Molecule
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/quadrantgrid"
                    onClick={() => handleNavClick("/quadrantgrid")}
                  >
                    QuadrantGrid
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton as={Button} size="sm" variant="ghost">
                  Community
                </MenuButton>
                <MenuList>
                  <MenuItem
                    as={RouterLink}
                    to="/chat"
                    onClick={() => handleNavClick("/chat")}
                  >
                    Chat
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to={selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks"}
                    onClick={() => handleNavClick("/discussion")}
                  >
                    Discussion Board
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton as={Button} size="sm" variant="ghost">
                  Gaming
                </MenuButton>
                <MenuList>
                  <MenuItem as={RouterLink} to="/game">
                    Game
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/gamespace">
                    GameSpace
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/level">
                    Level
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/truefalse">
                    TrueFalse Game
                  </MenuItem>
                </MenuList>
              </Menu>
              <HStack spacing={2}>
                <AccountMenu />
                <Text>Account</Text>
              </HStack>
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

            <Box marginLeft="20px" maxWidth="1000px" flex="1">
              <SearchInput />
            </Box>

            <Spacer />

            {selectedTaskId && (
              <Menu>
                <MenuButton as={Button}>View</MenuButton>
                <MenuList>
                  <MenuItem as={RouterLink} to="/tasks">
                    Cases
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/workspace">
                    Workspace
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/molecule">
                    Molecule
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/textpad">
                    TextPad
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
