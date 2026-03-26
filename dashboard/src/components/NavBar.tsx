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
  Button,
  Text,
  useColorModeValue,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { SearchIcon } from "@chakra-ui/icons";
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
  const { isOpen, onOpen, onClose } = useDisclosure();

  const handleNavClick = (target: string) => {
    if (!selectedTaskId) {
      setRedirect(target);
    }
  };

  return (
    <Box w="100%" position="relative" zIndex={1000}>
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

          <Menu>
            <MenuButton as={Button} size="sm">
              Workbench
            </MenuButton>
            <MenuList zIndex={9999}>
              <MenuItem as={RouterLink} to="/textpad">
                TextPad
              </MenuItem>
              <MenuItem as={RouterLink} to="/workspace">
                Workspace
              </MenuItem>
              <MenuItem as={RouterLink} to="/molecule">
                Molecule
              </MenuItem>
              <MenuItem as={RouterLink} to="/credibility">
                Credibility
              </MenuItem>
              <MenuItem as={RouterLink} to="/casefocus">
                CaseFocus
              </MenuItem>
            </MenuList>
          </Menu>

          <Menu>
            <MenuButton as={Button} size="sm">
              GrabBag
            </MenuButton>
            <MenuList zIndex={9999}>
              <MenuItem as={RouterLink} to="/quadrantgrid">
                QuadrantGrid
              </MenuItem>
              <MenuItem as={RouterLink} to="/claim-duel">
                Claim Duel
              </MenuItem>
              <MenuItem as={RouterLink} to="/truefalse">
                TrueFalse Game
              </MenuItem>
              <MenuItem as={RouterLink} to="/casefocus">
                CaseFocus
              </MenuItem>
            </MenuList>
          </Menu>

          <TourTriggerButton />
          <HeaderToggleSwitch />
          <ColorModeSwitch />
        </Flex>
      ) : (
        <Box>
          {/* Single Compact Row: Everything in one line */}
          <Flex
            as="nav"
            py={12}
            px={6}
            color={navColor}
            align="center"
            justify="space-between"
            gap={6}
          >
            {/* Navigation Menu - Left Side */}
            <HStack spacing={6} flex="1">
              <Link as={RouterLink} to="/tutorials" fontSize="md">
                Tutorial Videos
              </Link>
              <Link as={RouterLink} to="/dashboard" fontSize="md">
                Dashboard
              </Link>
              <Link as={RouterLink} to="/tasks" fontSize="md">
                Cases
              </Link>
              <Link as={RouterLink} to="/extension" fontSize="md">
                Extension
              </Link>
              <Menu>
                <MenuButton as={Button} size="md" variant="ghost" fontSize="md">
                  Workbench
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem
                    as={RouterLink}
                    to="/textpad"
                    onClick={() => handleNavClick("/textpad")}
                    fontSize="md"
                  >
                    TextPad
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/workspace"
                    onClick={() => handleNavClick("/workspace")}
                    fontSize="md"
                  >
                    Workspace
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/molecule"
                    onClick={() => handleNavClick("/molecule")}
                    fontSize="md"
                  >
                    Molecule
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/credibility"
                    onClick={() => handleNavClick("/credibility")}
                    fontSize="md"
                  >
                    Credibility
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/casefocus"
                    onClick={() => handleNavClick("/casefocus")}
                    fontSize="md"
                  >
                    CaseFocus
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton as={Button} size="md" variant="ghost" fontSize="md">
                  Community
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem
                    as={RouterLink}
                    to="/chat"
                    onClick={() => handleNavClick("/chat")}
                    fontSize="md"
                  >
                    Chat
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to={selectedTaskId ? `/discussion/${selectedTaskId}` : "/tasks"}
                    onClick={() => handleNavClick("/discussion")}
                    fontSize="md"
                  >
                    Discussion Board
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton as={Button} size="md" variant="ghost" fontSize="md">
                  Gaming
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem as={RouterLink} to="/game" fontSize="md">
                    Game
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/gamespace" fontSize="md">
                    GameSpace
                  </MenuItem>
                  <MenuItem as={RouterLink} to="/level" fontSize="md">
                    Level
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton as={Button} size="md" variant="ghost" fontSize="md">
                  GrabBag
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem
                    as={RouterLink}
                    to="/quadrantgrid"
                    onClick={() => handleNavClick("/quadrantgrid")}
                    fontSize="md"
                  >
                    QuadrantGrid
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/claim-duel"
                    onClick={() => handleNavClick("/claim-duel")}
                    fontSize="md"
                  >
                    Claim Duel
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/truefalse"
                    fontSize="md"
                  >
                    TrueFalse Game
                  </MenuItem>
                  <MenuItem
                    as={RouterLink}
                    to="/casefocus"
                    onClick={() => handleNavClick("/casefocus")}
                    fontSize="md"
                  >
                    CaseFocus
                  </MenuItem>
                </MenuList>
              </Menu>
              <HStack spacing={2}>
                <AccountMenu />
                <Text fontSize="md">Account</Text>
              </HStack>
            </HStack>

            {/* Right Side: Search, View, and Controls */}
            <HStack spacing={3}>
              {/* Search Button */}
              <Button
                size="md"
                variant="ghost"
                leftIcon={<SearchIcon />}
                onClick={onOpen}
                fontSize="md"
              >
                Search
              </Button>

              {/* View Menu */}
              {selectedTaskId && (
                <Menu>
                  <MenuButton as={Button} size="md" variant="ghost" fontSize="md">
                    View
                  </MenuButton>
                  <MenuList zIndex={9999}>
                    <MenuItem as={RouterLink} to="/tasks" fontSize="md">
                      Cases
                    </MenuItem>
                    <MenuItem as={RouterLink} to="/workspace" fontSize="md">
                      Workspace
                    </MenuItem>
                    <MenuItem as={RouterLink} to="/molecule" fontSize="md">
                      Molecule
                    </MenuItem>
                    <MenuItem as={RouterLink} to="/claim-duel" fontSize="md">
                      Claim Duel
                    </MenuItem>
                    <MenuItem as={RouterLink} to="/foxcase" fontSize="md">
                      FoxCase
                    </MenuItem>
                    <MenuItem as={RouterLink} to="/textpad" fontSize="md">
                      TextPad
                    </MenuItem>
                    <MenuItem
                      as={RouterLink}
                      to={
                        selectedTaskId
                          ? `/discussion/${selectedTaskId}`
                          : "/tasks"
                      }
                      fontSize="md"
                    >
                      Discussion
                    </MenuItem>
                  </MenuList>
                </Menu>
              )}

              <TourTriggerButton />
              <HeaderToggleSwitch />
              <ColorModeSwitch />
            </HStack>
          </Flex>

          {/* Search Modal */}
          <Modal isOpen={isOpen} onClose={onClose} size="xl">
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>Search</ModalHeader>
              <ModalCloseButton />
              <ModalBody pb={6}>
                <SearchInput />
              </ModalBody>
            </ModalContent>
          </Modal>
        </Box>
      )}
    </Box>
  );
};

export default NavBar;
