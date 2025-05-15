// src/components/Register.tsx
import React, { useState } from "react";
import {
  Box,
  VStack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  InputGroup,
  InputRightElement,
  IconButton,
  Button,
  Link,
  useToast,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import ReCAPTCHA from "react-google-recaptcha";
import { login, register } from "../services/authService";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate, Link as RouterLink } from "react-router-dom";

const Register: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const toast = useToast();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleRegister = async () => {
    try {
      // 1️⃣ Create the account
      await register(username, password, email, captchaToken);

      // 2️⃣ Immediately log in (skipping captcha on login call)
      //    Our login service will return the User and persist JWT into localStorage
      const user = await login(username, password, undefined, true);

      // 3️⃣ Grab that token out of localStorage
      const token = localStorage.getItem("jwt") || "";

      // 4️⃣ Tell the store about our freshly‑minted user+token
      setAuth({ ...user, jwt: token, can_post: true }, token);

      toast({
        title: "Welcome!",
        description: "Registration successful.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      // 5️⃣ Send them into the app
      navigate("/dashboard");
    } catch (error) {
      console.error("Registration failed:", error);
      toast({
        title: "Registration failed",
        description: "Please check your details and try again.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const isFormValid = !!username && !!email && !!password && !!captchaToken;

  return (
    <Box maxW="420px" w="full" mx="auto" mt={{ base: 6, md: 12 }} px={4}>
      <Heading as="h1" size="lg" textAlign="center" mb={6}>
        Create an Account
      </Heading>

      <VStack spacing={4} align="stretch">
        <FormControl id="username" isRequired>
          <FormLabel>Username</FormLabel>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a username"
          />
        </FormControl>

        <FormControl id="email" isRequired>
          <FormLabel>Email</FormLabel>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </FormControl>

        <FormControl id="password" isRequired>
          <FormLabel>Password</FormLabel>
          <InputGroup>
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
            />
            <InputRightElement>
              <IconButton
                variant="ghost"
                aria-label={showPassword ? "Hide password" : "Show password"}
                icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                onClick={() => setShowPassword((v) => !v)}
              />
            </InputRightElement>
          </InputGroup>
        </FormControl>

        <Box display="flex" justifyContent="center" pt={2}>
          <ReCAPTCHA
            sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY as string}
            onChange={(token) => setCaptchaToken(token)}
            style={{ transform: "scale(0.9)", transformOrigin: "0 0" }}
          />
        </Box>

        <Button
          colorScheme="teal"
          onClick={handleRegister}
          isDisabled={!isFormValid}
          mt={2}
        >
          Register
        </Button>

        <Box textAlign="center" fontSize="sm" pt={2}>
          Already have an account?{" "}
          <Link
            as={RouterLink}
            to="/login"
            color="teal.500"
            fontWeight="semibold"
          >
            Sign in
          </Link>
        </Box>
      </VStack>
    </Box>
  );
};

export default Register;
