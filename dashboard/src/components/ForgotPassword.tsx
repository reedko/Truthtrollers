// src/components/ForgotPassword.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  Link,
} from "@chakra-ui/react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const handleRequestReset = async () => {
    if (!email) {
      toast({
        title: "Email Required",
        description: "Please enter your email address",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Check Your Email",
          description: "If that email exists, a password reset link has been sent. Check your inbox!",
          status: "success",
          duration: 8000,
          isClosable: true,
        });
        // Don't navigate away - let user know to check email
      } else {
        throw new Error(data.error || "Failed to send reset email");
      }
    } catch (error: any) {
      toast({
        title: "Request Failed",
        description: error.message || "Please try again later.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box
      minH="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="gray.900"
      p={4}
    >
      <Box
        bg="gray.800"
        p={8}
        borderRadius="lg"
        boxShadow="2xl"
        maxW="md"
        w="100%"
        border="1px solid"
        borderColor="gray.700"
      >
        <VStack spacing={6} align="stretch">
          <Heading size="lg" color="white" textAlign="center">
            Reset Password
          </Heading>

          <Text color="gray.400" fontSize="sm" textAlign="center">
            Enter your email address and we'll send you a link to reset your password
          </Text>

          <FormControl isRequired>
            <FormLabel color="gray.300">Email</FormLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              bg="gray.700"
              color="white"
              borderColor="gray.600"
              _hover={{ borderColor: "blue.400" }}
              _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
              onKeyPress={(e) => e.key === "Enter" && handleRequestReset()}
            />
          </FormControl>

          <Button
            colorScheme="blue"
            size="lg"
            onClick={handleRequestReset}
            isLoading={isSubmitting}
            isDisabled={!email}
            w="100%"
          >
            Send Reset Link
          </Button>

          <Text color="gray.400" fontSize="sm" textAlign="center">
            Remember your password?{" "}
            <Link color="blue.400" onClick={() => navigate("/login")}>
              Back to Login
            </Link>
          </Text>
        </VStack>
      </Box>
    </Box>
  );
};

export default ForgotPassword;
