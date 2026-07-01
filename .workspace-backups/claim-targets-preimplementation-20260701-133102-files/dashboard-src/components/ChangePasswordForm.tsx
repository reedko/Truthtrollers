// src/components/ChangePasswordForm.tsx
import React, { useState } from "react";
import {
  Box,
  FormControl,
  FormLabel,
  Input,
  InputGroup,
  InputRightElement,
  IconButton,
  Button,
  useToast,
  VStack,
  Heading,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import { useAuthStore } from "../store/useAuthStore";
import axios from "axios";

const API_URL = import.meta.env.VITE_BASE_URL || "http://localhost:5001";

const ChangePasswordForm: React.FC = () => {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      await axios.post(`${API_URL}/api/change-password`, {
        userId: user?.user_id,
        currentPassword,
        newPassword,
      });

      toast({
        title: "Password updated successfully.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Password change error:", error);
      toast({
        title: "Password update failed.",
        description: "Please check your current password and try again.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  return (
    <Box maxW="420px" w="full" mx="auto" mt={6}>
      <Heading size="md" mb={4}>
        Change Password
      </Heading>
      <VStack spacing={4} align="stretch">
        <FormControl isRequired>
          <FormLabel>Current Password</FormLabel>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </FormControl>

        <FormControl isRequired>
          <FormLabel>New Password</FormLabel>
          <InputGroup>
            <Input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <InputRightElement>
              <IconButton
                aria-label="Toggle password visibility"
                icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                variant="ghost"
                onClick={() => setShowPassword(!showPassword)}
              />
            </InputRightElement>
          </InputGroup>
        </FormControl>

        <FormControl isRequired>
          <FormLabel>Confirm New Password</FormLabel>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </FormControl>

        <Button colorScheme="teal" onClick={handleSubmit}>
          Update Password
        </Button>
      </VStack>
    </Box>
  );
};

export default ChangePasswordForm;
