import React, { useState } from "react";
import {
  Box,
  FormControl,
  FormLabel,
  Input,
  Button,
  Heading,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "http://localhost:5001";

const ChangeEmailPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const toast = useToast();

  const handleChangeEmail = async () => {
    if (!newEmail || !currentPassword) return;

    try {
      await axios.post(
        `${API_BASE_URL}/api/change-email`,
        {
          userId: user?.user_id,
          newEmail,
          currentPassword,
        },
        {
          headers: {
            Authorization: `Bearer ${user?.jwt}`,
          },
        }
      );

      toast({
        title: "Email updated",
        description: "Your email address was successfully changed.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      setNewEmail("");
      setCurrentPassword("");
    } catch (err) {
      console.error("Email update error:", err);
      toast({
        title: "Update failed",
        description: "Please check your password and try again.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  return (
    <Box maxW="420px" mx="auto" mt={10} p={6} borderWidth={1} borderRadius="lg">
      <Heading size="md" mb={6} textAlign="center">
        Change Email Address
      </Heading>
      <VStack spacing={4} align="stretch">
        <FormControl isRequired>
          <FormLabel>New Email</FormLabel>
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="your-new@email.com"
          />
        </FormControl>

        <FormControl isRequired>
          <FormLabel>Current Password</FormLabel>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Confirm your password"
          />
        </FormControl>

        <Button colorScheme="teal" onClick={handleChangeEmail}>
          Update Email
        </Button>
      </VStack>
    </Box>
  );
};

export default ChangeEmailPage;
