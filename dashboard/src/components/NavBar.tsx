import { useEffect, useState } from "react";
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
import { Link as RouterLink, useNavigate, useLocation } from "react-router-dom";
import { SearchIcon } from "@chakra-ui/icons";
import ColorModeSwitch from "./ColorModeSwitch";
import HeaderToggleSwitch from "./HeaderToggleSwitch";
import { useTaskStore } from "../store/useTaskStore";
import { AccountMenu } from "./AccountMenu";
import { TourTriggerButton } from "./PlatformTour";
import SearchInput from "./SearchInput";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

// Module-level constant — no component refs, so safe here; avoids recreating + re-hashing sx on every render
const pillNavStyles = {
  fontSize: { base: "11px", lg: "11px", xl: "15px" },
  fontWeight: "normal",
  lineHeight: "1.5",
  border: "1px solid",
  borderColor: "rgba(0, 162, 255, 0.35)",
  borderRadius: "full",
  px: 3,
  py: 1,
  minH: "unset",
  height: "auto",
  color: "rgba(113, 219, 255, 0.88)",
  boxShadow: "0 4px 14px rgba(0,0,0,0.4), 0 0 16px rgba(0,162,255,0.13), inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.22)",
  transition: "all 0.2s ease",
  sx: {
    background: "linear-gradient(90deg, rgba(0,162,255,0.2) 0%, rgba(0,8,22,0.55) 30%, rgba(0,3,12,0.45) 100%)",
    "&:hover": {
      background: "linear-gradient(90deg, rgba(0,162,255,0.36) 0%, rgba(0,16,44,0.62) 30%, rgba(0,8,26,0.52) 100%)",
      boxShadow: "0 6px 22px rgba(0,0,0,0.55), 0 0 32px rgba(0,162,255,0.45), inset 0 1px 0 rgba(255,255,255,0.15)",
      borderColor: "rgba(0, 162, 255, 0.75)",
      transform: "translateY(-1px)",
    },
  },
};

// ─── Typed nav config (single source of truth for compact + full) ─────────────

interface NavItem {
  label: string;
  to: string;
}

type NavMenuId = "workbench" | "explore" | "community";

const WORKBENCH_ITEMS: NavItem[] = [
  { label: "Workspace", to: "/workspace" },
  { label: "Case Focus", to: "/casefocus" },
  { label: "Evidence Map", to: "/evidence-map" },
  { label: "Molecule", to: "/molecule" },
  { label: "KnowGraph", to: "/knowgraph" },
  { label: "Credibility", to: "/credibility" },
  { label: "TextPad", to: "/textpad" },
];

const EXPLORE_ITEMS: NavItem[] = [
  { label: "🎓 Tutorials", to: "/tutorials" },
  { label: "🐦 Social Media", to: "/social-media" },
  { label: "💬 TT Live", to: "/ttlive" },
  { label: "🎮 Game", to: "/game" },
  { label: "🕹 GameSpace", to: "/gamespace" },
  { label: "📊 QuadrantGrid", to: "/quadrantgrid" },
  { label: "⚔️ Claim Duel", to: "/claim-duel" },
  { label: "🎯 TrueFalse Game", to: "/game/truefalse" },
];

// Community items are dynamic (Discussion depends on selectedTaskId) so we
// handle them inline in the component.

// ─── Shared NavMenu component ─────────────────────────────────────────────────

interface NavMenuProps {
  id: NavMenuId;
  label: string;
  items: NavItem[];
  pillStyles: Record<string, unknown>;
  size?: "xs" | "sm";
  onItemClick?: (to: string) => void;
  openMenu: NavMenuId | null;
  setOpenMenu: (id: NavMenuId | null) => void;
}

const NavMenu: React.FC<NavMenuProps> = ({
  id,
  label,
  items,
  pillStyles,
  size = "xs",
  onItemClick,
  openMenu,
  setOpenMenu,
}) => {
  const navigate = useNavigate();
  const navigateAndClose = (to: string) => {
    setOpenMenu(null);
    onItemClick?.(to);
    window.setTimeout(() => navigate(to), 0);
  };

  return (
    <Menu
      isLazy
      closeOnSelect
      isOpen={openMenu === id}
      onOpen={() => setOpenMenu(id)}
      onClose={() => setOpenMenu(null)}
    >
      <MenuButton as={Button} size={size} variant="ghost" {...pillStyles}>
        {label}
      </MenuButton>
      <MenuList zIndex={9999}>
        {items.map((item) => (
          <MenuItem
            key={item.to}
            fontSize="md"
            onClick={() => navigateAndClose(item.to)}
          >
            {item.label}
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  );
};

// ─── NavBar ───────────────────────────────────────────────────────────────────

interface NavBarProps {
  compact?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ compact }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const navColor = useColorModeValue("gray.700", "white");
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [openMenu, setOpenMenu] = useState<NavMenuId | null>(null);

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname, location.search]);

  const handleNavClick = (target: string) => {
    if (!selectedTaskId) {
      setRedirect(target);
    }
  };

  const discussionTo = selectedTaskId
    ? `/discussion/${selectedTaskId}`
    : "/tasks";

  const navigateFromMenu = (to: string, redirectTarget = to) => {
    setOpenMenu(null);
    handleNavClick(redirectTarget);
    window.setTimeout(() => navigate(to), 0);
  };

  return (
    <Box w="100%" position="relative" zIndex={1000}>
      {/* ── Compact mode ── */}
      {compact ? (
        <Flex align="center" px={2} py={1} justify="space-between" wrap="nowrap">
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

          <NavMenu
            id="workbench"
            label="Workbench"
            items={WORKBENCH_ITEMS}
            pillStyles={{ ...pillNavStyles, size: "sm" }}
            size="sm"
            onItemClick={handleNavClick}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />

          <NavMenu
            id="explore"
            label="Explore"
            items={EXPLORE_ITEMS}
            pillStyles={{ ...pillNavStyles, size: "sm" }}
            size="sm"
            onItemClick={handleNavClick}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />

          {/* Community — inline for dynamic Discussion link */}
          <Menu
            isLazy
            closeOnSelect
            isOpen={openMenu === "community"}
            onOpen={() => setOpenMenu("community")}
            onClose={() => setOpenMenu(null)}
          >
            <MenuButton as={Button} size="sm" variant="ghost" {...pillNavStyles}>
              Community
            </MenuButton>
            <MenuList zIndex={9999}>
              <MenuItem fontSize="md" onClick={() => navigateFromMenu("/chat")}>
                Chat
              </MenuItem>
              <MenuItem fontSize="md" onClick={() => navigateFromMenu(discussionTo, "/discussion")}>
                Discussion Board
              </MenuItem>
              <MenuItem fontSize="md" onClick={() => navigateFromMenu("/review-articles")}>
                Review Articles
              </MenuItem>
              <MenuItem fontSize="md" onClick={() => navigateFromMenu("/evaluate-ratings")}>
                Evaluate Ratings
              </MenuItem>
            </MenuList>
          </Menu>

          <TourTriggerButton />
          <HeaderToggleSwitch />
          <ColorModeSwitch />
        </Flex>
      ) : (
        /* ── Full mode ── */
        <Box>
          <Flex
            as="nav"
            py={1}
            px={{ base: 2, lg: 3 }}
            color={navColor}
            align="center"
            justify="space-between"
            gap={{ base: 1, lg: 2 }}
          >
            {/* Left side: primary navigation */}
            <HStack spacing={{ base: 1, lg: 2 }} flex="1">
              <Link as={RouterLink} to="/dashboard" {...pillNavStyles}>Dashboard</Link>
              <Link as={RouterLink} to="/tasks" {...pillNavStyles}>Cases</Link>
              <Link as={RouterLink} to="/extension" {...pillNavStyles}>Extension</Link>

              <NavMenu
                id="workbench"
                label="Workbench"
                items={WORKBENCH_ITEMS}
                pillStyles={pillNavStyles}
                onItemClick={handleNavClick}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
              />

              <NavMenu
                id="explore"
                label="Explore"
                items={EXPLORE_ITEMS}
                pillStyles={pillNavStyles}
                onItemClick={handleNavClick}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
              />

              {/* Community — inline for dynamic Discussion link */}
              <Menu
                isLazy
                closeOnSelect
                isOpen={openMenu === "community"}
                onOpen={() => setOpenMenu("community")}
                onClose={() => setOpenMenu(null)}
              >
                <MenuButton as={Button} size="xs" variant="ghost" {...pillNavStyles}>
                  Community
                </MenuButton>
                <MenuList zIndex={9999}>
                  <MenuItem fontSize="md" onClick={() => navigateFromMenu("/chat")}>
                    Chat
                  </MenuItem>
                  <MenuItem fontSize="md" onClick={() => navigateFromMenu(discussionTo, "/discussion")}>
                    Discussion Board
                  </MenuItem>
                  <MenuItem fontSize="md" onClick={() => navigateFromMenu("/review-articles")}>
                    Review Articles
                  </MenuItem>
                  <MenuItem fontSize="md" onClick={() => navigateFromMenu("/evaluate-ratings")}>
                    Evaluate Ratings
                  </MenuItem>
                </MenuList>
              </Menu>

              {/* Account pill */}
              <HStack spacing={2} {...pillNavStyles}>
                <AccountMenu />
                <Text fontSize={{ base: "11px", lg: "11px", xl: "15px" }}>
                  Account
                </Text>
              </HStack>
            </HStack>

            {/* Right side: search + controls */}
            <HStack spacing={{ base: 1, lg: 2 }}>
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<SearchIcon />}
                onClick={onOpen}
                {...pillNavStyles}
              >
                Search
              </Button>

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
