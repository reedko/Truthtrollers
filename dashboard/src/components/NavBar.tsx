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
  const borderColor = useColorModeValue("gray.300", "gray.600");
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
              <MenuItem as={RouterLink} to="/knowgraph">
                KnowGraph
              </MenuItem>
              <MenuItem as={RouterLink} to="/credibility">
                Credibility
              </MenuItem>
              <MenuItem as={RouterLink} to="/casefocus">
                Case Focus
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
              <MenuItem as={RouterLink} to="/game/truefalse">
                TrueFalse Game
              </MenuItem>
              <MenuItem as={RouterLink} to="/casefocus">
                Case Focus
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
            py={1}
            px={{ base: 2, lg: 3 }}
            color={navColor}
            align="center"
            justify="space-between"
            gap={{ base: 1, lg: 2 }}
          >
            {/* Navigation Menu - Left Side */}
            <HStack spacing={{ base: 1, lg: 2 }} flex="1">
              <Menu>
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                  border="1px solid"
                  borderColor={borderColor}
                  borderRadius="full"
                  px={2}
                  py={1}
                >
                  Tutorial
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem as={RouterLink} to="/tutorials" fontSize="md">
                    Video Gallery
                  </MenuItem>
                </MenuList>
              </Menu>
              <Link
                as={RouterLink}
                to="/dashboard"
                fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="full"
                px={2}
                py={1}
              >
                Dashboard
              </Link>
              <Link
                as={RouterLink}
                to="/tasks"
                fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="full"
                px={2}
                py={1}
              >
                Cases
              </Link>
              <Link
                as={RouterLink}
                to="/extension"
                fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="full"
                px={2}
                py={1}
              >
                Extension
              </Link>
              <Menu>
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                  border="1px solid"
                  borderColor={borderColor}
                  borderRadius="full"
                  px={2}
                  py={1}
                >
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
                    to="/knowgraph"
                    onClick={() => handleNavClick("/knowgraph")}
                    fontSize="md"
                  >
                    KnowGraph
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
                    Case Focus
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                  border="1px solid"
                  borderColor={borderColor}
                  borderRadius="full"
                  px={2}
                  py={1}
                >
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
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                  border="1px solid"
                  borderColor={borderColor}
                  borderRadius="full"
                  px={2}
                  py={1}
                >
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
                  <MenuItem as={RouterLink} to="/game/truefalse" fontSize="md">
                    TrueFalse Game
                  </MenuItem>
                </MenuList>
              </Menu>
              <Menu>
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                  border="1px solid"
                  borderColor={borderColor}
                  borderRadius="full"
                  px={2}
                  py={1}
                >
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
                    to="/game/truefalse"
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
                    Case Focus
                  </MenuItem>
                </MenuList>
              </Menu>
              <HStack
                spacing={2}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="full"
                px={2}
                py={1}
              >
                <AccountMenu />
                <Text fontSize={{ base: "11px", lg: "11px", xl: "15px" }}>Account</Text>
              </HStack>
            </HStack>

            {/* Right Side: Search, View, and Controls */}
            <HStack spacing={{ base: 1, lg: 2 }}>
              {/* Search Button */}
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<SearchIcon />}
                onClick={onOpen}
                fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                border="1px solid"
                borderColor={borderColor}
                borderRadius="full"
                px={2}
                py={1}
              >
                Search
              </Button>

              {/* View Menu */}
              {selectedTaskId && (
                <Menu>
                  <MenuButton
                    as={Button}
                    size="xs"
                    variant="ghost"
                    fontSize={{ base: "11px", lg: "11px", xl: "15px" }}
                    border="1px solid"
                    borderColor={borderColor}
                    borderRadius="full"
                    px={2}
                    py={1}
                  >
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
