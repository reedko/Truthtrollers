import React, { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Stack,
  Heading,
  useToast,
} from "@chakra-ui/react";
import ReCAPTCHA from "react-google-recaptcha";
import { useNavigate } from "react-router-dom";
import { login } from "../services/authService";
import { useAuthStore } from "../store/useAuthStore";
import { generateDeviceFingerprint } from "../utils/generateDeviceFingerprint";
import { useTaskStore } from "../store/useTaskStore";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

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
      const user = await login(username, password, captchaToken, true);
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

      await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/store-extension-session`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_fingerprint: generateDeviceFingerprint(),
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
    } catch (err) {
      console.error("Login error:", err);
      toast({
        title: "Login failed.",
        description: "Invalid credentials or CAPTCHA failed.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  return (
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
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
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
        </Stack>
      </form>
    </Box>
  );
};

export default Login;
