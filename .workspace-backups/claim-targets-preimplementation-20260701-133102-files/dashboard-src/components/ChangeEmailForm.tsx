import React, { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";

const ChangeEmailForm: React.FC = () => {
  const { user } = useAuthStore();
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const toast = useToast();

  const handleSubmit = async () => {
    if (!newEmail || !confirmEmail || newEmail !== confirmEmail) {
      toast({
        title: "Email mismatch.",
        description: "Make sure both email fields match.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      const res = await fetch("/api/change-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user?.jwt}`,
        },
        body: JSON.stringify({ newEmail, password }),
      });

      if (!res.ok) throw new Error("Server error");

      toast({
        title: "Email updated.",
        description: "Your email has been changed successfully.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      setNewEmail("");
      setConfirmEmail("");
      setPassword("");
    } catch (err) {
      toast({
        title: "Update failed.",
        description: "Please check your password and try again.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  return (
    <VStack spacing={4} align="stretch">
      <FormControl isRequired>
        <FormLabel>New Email</FormLabel>
        <Input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
      </FormControl>

      <FormControl isRequired>
        <FormLabel>Confirm New Email</FormLabel>
        <Input
          type="email"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
        />
      </FormControl>

      <FormControl isRequired>
        <FormLabel>Current Password</FormLabel>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormControl>

      <Button colorScheme="teal" onClick={handleSubmit}>
        Update Email
      </Button>
    </VStack>
  );
};

export default ChangeEmailForm;
