// src/components/Login.tsx
import React, { useState } from "react";
import { login } from "../services/authService";
import { useNavigate } from "react-router-dom";
import { Button, Input, Stack, Heading, useToast } from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore"; // ✅ NEW

import { User } from "../../../shared/entities/types";
const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const setUser = useAuthStore((s) => s.setUser); // ✅ GET STORE
  const navigate = useNavigate();
  const toast = useToast();

  const handleLogin = async () => {
    try {
      const user: User = await login(username, password); // Assume this returns user data
      setUser(user); // ✅ STORE IN ZUSTAND
      console.log(user.username, "USER");
      localStorage.setItem("user", JSON.stringify(user));
      setUser(user);
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Login failed.",
        description: "Invalid username or password.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  return (
    <Stack spacing={4} width="300px" margin="auto" marginTop="100px">
      <Heading as="h1" size="lg">
        Login
      </Heading>
      <Input
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button colorScheme="teal" onClick={handleLogin}>
        Login
      </Button>
      <Button variant="link" onClick={() => navigate("/forgot-password")}>
        Forgot Password?
      </Button>
      <Button variant="link" onClick={() => navigate("/register")}>
        Register
      </Button>
    </Stack>
  );
};

export default Login;
