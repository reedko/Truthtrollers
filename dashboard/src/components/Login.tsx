// src/components/Login.tsx
import React, { useState } from "react";
import { login } from "../services/authService";
import { useNavigate } from "react-router-dom";
import { Button, Input, Stack, Heading, useToast } from "@chakra-ui/react";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const toast = useToast();

  const handleLogin = async () => {
    try {
      await login(username, password);
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

  const handleForgotPassword = () => {
    // Redirect to forgot password page
    navigate("/forgot-password");
  };

  const handleRegister = () => {
    // Redirect to registration page
    navigate("/register");
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
      <Button variant="link" onClick={handleForgotPassword}>
        Forgot Password?
      </Button>
      <Button variant="link" onClick={handleRegister}>
        Register
      </Button>
    </Stack>
  );
};

export default Login;
