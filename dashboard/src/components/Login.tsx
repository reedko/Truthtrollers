import React, { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  InputGroup,
  InputRightElement,
  IconButton,
  Stack,
  Heading,
  useToast,
  VStack,
  HStack,
  Text,
  Image,
  useColorModeValue,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Container,
  Flex,
  Link,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import {
  FiHome,
  FiBarChart2,
  FiMenu,
  FiUser,
  FiVideo,
  FiDownload,
  FiGrid,
  FiTool,
  FiMessageSquare,
} from "react-icons/fi";
import ReCAPTCHA from "react-google-recaptcha";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { login } from "../services/authService";
import { useAuthStore } from "../store/useAuthStore";
import { generateDeviceFingerprint } from "../utils/generateDeviceFingerprint";
import { useTaskStore } from "../store/useTaskStore";
import ColorModeSwitch from "./ColorModeSwitch";
import TopContributors from "./TopContributors";
import HotTopics from "./HotTopics";
import WhitelistRequestModal from "./modals/WhitelistRequestModal";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
const SIDEBAR_WIDTH = "200px";
const HEADER_HEIGHT = "50px";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isWhitelistModalOpen, setIsWhitelistModalOpen] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!captchaToken) {
      toast({
        title: "Please complete the CAPTCHA.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      const fingerprint = generateDeviceFingerprint();
      const user = await login(
        username,
        password,
        fingerprint,
        captchaToken,
        true
      );
      const token = localStorage.getItem("jwt");
      if (!token) throw new Error("No token returned from login");

      setAuth(
        {
          ...user,
          jwt: token,
          can_post: true,
        },
        token
      );

      const taskStore = useTaskStore.getState();
      taskStore.setViewingUserId(user.user_id);
      taskStore.setViewScope('user'); // Default to user view on login

      await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/store-extension-session`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_fingerprint: fingerprint,
          }),
        }
      );

      // ✅ Delay navigation until Zustand confirms user is stored
      setTimeout(() => {
        const result = useAuthStore.getState().user;
        console.log("🧪 Zustand post-setAuth:", result);
        if (result?.user_id) {
          navigate("/dashboard", { replace: true });
        } else {
          toast({
            title: "Login failed.",
            description: "Could not load user from auth store.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
      }, 100);
    } catch (err: any) {
      console.error("Login error:", err);

      // Check if it's a beta access denied error
      if (err.response?.data?.error === "BETA_ACCESS_DENIED") {
        toast({
          title: "Site Unavailable",
          description: err.response.data.message || "The site is currently down for development. Please check back later!",
          status: "warning",
          duration: 8000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Login failed.",
          description: "Invalid credentials or CAPTCHA failed.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    }
  };

  const sidebarColor = useColorModeValue("gray.700", "white");
  const sidebarBorderColor = useColorModeValue(
    "rgba(100, 116, 139, 0.25)",
    "gray.700",
  );
  const sidebarBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.3), rgba(148, 163, 184, 0.2))",
    "transparent",
  );
  const headerBorderColor = useColorModeValue(
    "rgba(100, 116, 139, 0.25)",
    "gray.700",
  );
  const headerBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.35), rgba(148, 163, 184, 0.2))",
    "linear-gradient(to bottom, rgba(2,0,36,0.8), rgba(94,234,212,0.1))",
  );

  return (
    <>
      {/* Sidebar */}
      <VStack
        as="nav"
        background={sidebarBg}
        backdropFilter="blur(8px)"
        color={sidebarColor}
        spacing={6}
        p={4}
        w={SIDEBAR_WIDTH}
        h="100vh"
        position="fixed"
        top={0}
        left={0}
        borderRight="1px solid"
        borderColor={sidebarBorderColor}
        zIndex={100}
        display={{ base: "none", md: "flex" }}
        overflowY="auto"
        sx={{
          "&::-webkit-scrollbar": {
            display: "none",
          },
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <RouterLink to="/">
          <Image
            src={`${API_BASE_URL}/assets/ttlogo11.png`}
            boxSize="120px"
            objectFit="contain"
            mx="auto"
          />
        </RouterLink>

        {/* Greyed-out sidebar content */}
        <VStack align="start" spacing={4} w="full" opacity={0.4} pointerEvents="none">
          <HStack spacing={2} mb={2}>
            <FiVideo />
            <Text>Tutorial Videos</Text>
          </HStack>
          <HStack spacing={2} mb={2}>
            <FiHome />
            <Text>Dashboard</Text>
          </HStack>
          <HStack spacing={2} mb={2}>
            <FiBarChart2 />
            <Text>Cases</Text>
          </HStack>
          <HStack spacing={2} mb={2}>
            <FiDownload />
            <Text>Extension</Text>
          </HStack>

          {/* Workbench Menu */}
          <Menu>
            <MenuButton
              as={Button}
              size="sm"
              variant="ghost"
              leftIcon={<FiTool />}
              justifyContent="flex-start"
              w="full"
            >
              Workbench
            </MenuButton>
          </Menu>

          {/* Community Menu */}
          <Menu>
            <MenuButton
              as={Button}
              size="sm"
              variant="ghost"
              leftIcon={<FiMessageSquare />}
              justifyContent="flex-start"
              w="full"
            >
              Community
            </MenuButton>
          </Menu>

          {/* Gaming Menu */}
          <Menu>
            <MenuButton
              as={Button}
              size="sm"
              variant="ghost"
              leftIcon={<FiGrid />}
              justifyContent="flex-start"
              w="full"
            >
              Gaming
            </MenuButton>
          </Menu>

          <HStack spacing={2} mb={2}>
            <FiUser />
            <Text>Account</Text>
          </HStack>
        </VStack>

        {/* Activity Widgets */}
        <Box w="full" mt={6}>
          <VStack spacing={3} w="full">
            <TopContributors />
            <HotTopics />
          </VStack>
        </Box>
      </VStack>

      {/* Header */}
      <Box
        as="header"
        position="fixed"
        top={0}
        left={{ base: 0, md: SIDEBAR_WIDTH }}
        right={0}
        zIndex={1000}
        h={{ base: "60px", md: HEADER_HEIGHT }}
        px={4}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        borderBottom="1px solid"
        borderColor={headerBorderColor}
        backdropFilter="blur(12px)"
        background={headerBg}
      >
        <HStack spacing={8} flex={1} justify="flex-end">
          <Link
            as={RouterLink}
            to="/"
            fontSize="md"
            fontWeight="medium"
            color="gray.500"
          >
            Home
          </Link>
          <Link
            as={RouterLink}
            to="/about"
            fontSize="md"
            fontWeight="medium"
            color="gray.500"
          >
            About
          </Link>
          <ColorModeSwitch />
        </HStack>
      </Box>

      {/* Main Content */}
      <Box
        ml={{ base: 0, md: SIDEBAR_WIDTH }}
        pt={{ base: "60px", md: HEADER_HEIGHT }}
        px={4}
        pb={8}
      >
        <Box maxW="md" mx="auto" mt={12} p={6} boxShadow="lg" borderRadius="md">
          <Heading mb={6} textAlign="center">
            Log In
          </Heading>

          <form onSubmit={handleSubmit}>
            <Stack spacing={4}>
              <FormControl id="username" isRequired>
                <FormLabel>Username or Email</FormLabel>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your username"
                  autoComplete="username"
                />
              </FormControl>

              <FormControl id="password" isRequired>
                <FormLabel>Password</FormLabel>
                <InputGroup>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    autoComplete="current-password"
                  />
                  <InputRightElement>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                      onClick={() => setShowPassword((v) => !v)}
                    />
                  </InputRightElement>
                </InputGroup>
              </FormControl>

              <ReCAPTCHA
                sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY}
                onChange={(token) => setCaptchaToken(token)}
              />

              <Button type="submit" colorScheme="teal" width="full">
                Log In
              </Button>

              <Button
                type="button"
                variant="link"
                onClick={() => navigate("/forgot-password")}
              >
                Forgot Password?
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => navigate("/register")}
              >
                Register
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => setIsWhitelistModalOpen(true)}
                color="cyan.400"
                fontWeight="600"
              >
                Request Early Access
              </Button>
            </Stack>
          </form>
        </Box>
      </Box>

      {/* Whitelist Request Modal */}
      <WhitelistRequestModal
        isOpen={isWhitelistModalOpen}
        onClose={() => setIsWhitelistModalOpen(false)}
      />
    </>
  );
};

export default Login;
