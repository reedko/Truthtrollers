// src/components/ResetPassword.tsx
import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  InputGroup,
  InputRightElement,
  IconButton,
  VStack,
  Heading,
  Text,
  useToast,
  FormHelperText,
  FormErrorMessage,
  Link,
  Spinner,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const toast = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  // Password validation function
  const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (password.length < 10) {
      errors.push("At least 10 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("At least one capital letter");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("At least one number");
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push("At least one special character");
    }

    return { valid: errors.length === 0, errors };
  };

  const passwordValidation = validatePassword(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = newPassword && confirmPassword && passwordValidation.valid && passwordsMatch;

  // Validate token on component mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsValidating(false);
        setTokenValid(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/verify-reset-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (response.ok && data.valid) {
          setTokenValid(true);
          setUserEmail(data.email);
        } else {
          setTokenValid(false);
          toast({
            title: "Invalid or Expired Link",
            description: data.error || "This password reset link is invalid or has expired.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
      } catch (error) {
        console.error("Token verification error:", error);
        setTokenValid(false);
        toast({
          title: "Verification Failed",
          description: "Could not verify reset token. Please try again.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setIsValidating(false);
      }
    };

    verifyToken();
  }, [token, toast]);

  const handleResetPassword = async () => {
    if (!canSubmit || !token) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/reset-password-with-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Password Reset Successful",
          description: "You can now log in with your new password.",
          status: "success",
          duration: 5000,
          isClosable: true,
        });
        navigate("/login");
      } else {
        throw new Error(data.error || "Failed to reset password");
      }
    } catch (error: any) {
      toast({
        title: "Password Reset Failed",
        description: error.message || "Please try requesting a new reset link.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading state while validating token
  if (isValidating) {
    return (
      <Box
        minH="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="gray.900"
      >
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" thickness="4px" />
          <Text color="white">Verifying reset link...</Text>
        </VStack>
      </Box>
    );
  }

  // Show error if token is invalid
  if (!tokenValid) {
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
            <Alert status="error" bg="red.900" borderRadius="md">
              <AlertIcon />
              <Box>
                <AlertTitle>Invalid Reset Link</AlertTitle>
                <AlertDescription>
                  This password reset link is invalid or has expired.
                </AlertDescription>
              </Box>
            </Alert>

            <Text color="gray.400" fontSize="sm" textAlign="center">
              Reset links expire after 1 hour for security reasons.
            </Text>

            <Button
              colorScheme="blue"
              onClick={() => navigate("/forgot-password")}
              w="100%"
            >
              Request New Reset Link
            </Button>

            <Text color="gray.400" fontSize="sm" textAlign="center">
              <Link color="blue.400" onClick={() => navigate("/login")}>
                Back to Login
              </Link>
            </Text>
          </VStack>
        </Box>
      </Box>
    );
  }

  // Show password reset form if token is valid
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
            Set New Password
          </Heading>

          <Text color="gray.400" fontSize="sm" textAlign="center">
            Creating new password for: <strong>{userEmail}</strong>
          </Text>

          <FormControl isRequired isInvalid={newPassword.length > 0 && !passwordValidation.valid}>
            <FormLabel color="gray.300">New Password</FormLabel>
            <InputGroup>
              <Input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                bg="gray.700"
                color="white"
                borderColor="gray.600"
                _hover={{ borderColor: "blue.400" }}
                _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
              />
              <InputRightElement>
                <IconButton
                  variant="ghost"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                  onClick={() => setShowPassword((v) => !v)}
                  color="gray.400"
                  _hover={{ color: "white" }}
                />
              </InputRightElement>
            </InputGroup>
            {newPassword.length > 0 && !passwordValidation.valid && (
              <FormErrorMessage>
                <VStack align="start" spacing={0}>
                  {passwordValidation.errors.map((error, idx) => (
                    <Text key={idx} fontSize="xs">• {error}</Text>
                  ))}
                </VStack>
              </FormErrorMessage>
            )}
            {newPassword.length === 0 && (
              <FormHelperText color="gray.500" fontSize="xs">
                Min 10 chars, 1 capital, 1 number, 1 special character
              </FormHelperText>
            )}
          </FormControl>

          <FormControl isRequired isInvalid={confirmPassword.length > 0 && !passwordsMatch}>
            <FormLabel color="gray.300">Confirm Password</FormLabel>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              bg="gray.700"
              color="white"
              borderColor="gray.600"
              _hover={{ borderColor: "blue.400" }}
              _focus={{ borderColor: "blue.500", boxShadow: "0 0 0 1px #3182ce" }}
              onKeyPress={(e) => e.key === "Enter" && canSubmit && handleResetPassword()}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <FormErrorMessage>Passwords do not match</FormErrorMessage>
            )}
          </FormControl>

          <Button
            colorScheme="blue"
            size="lg"
            onClick={handleResetPassword}
            isLoading={isSubmitting}
            isDisabled={!canSubmit}
            w="100%"
          >
            Reset Password
          </Button>

          <Text color="gray.400" fontSize="sm" textAlign="center">
            <Link color="blue.400" onClick={() => navigate("/login")}>
              Back to Login
            </Link>
          </Text>
        </VStack>
      </Box>
    </Box>
  );
};

export default ResetPassword;
