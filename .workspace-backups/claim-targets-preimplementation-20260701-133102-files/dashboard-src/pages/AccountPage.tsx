// src/pages/AccountPage.tsx
import React from "react";
import {
  Box,
  Heading,
  Text,
  Avatar,
  FormControl,
  FormLabel,
  Input,
  Button,
  VStack,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";

const AccountPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Text>Loading...</Text>;

  return (
    <Box maxW="600px" mx="auto" mt={10} p={6}>
      <Heading size="lg" mb={6}>
        Account Settings
      </Heading>

      <VStack spacing={5} align="stretch">
        <Avatar name={user.username} size="xl" />

        <FormControl>
          <FormLabel>Username</FormLabel>
          <Input value={user.username} isReadOnly />
        </FormControl>

        <FormControl>
          <FormLabel>Email</FormLabel>
          <Input value={user.email} isReadOnly />
        </FormControl>

        <Button colorScheme="teal" isDisabled>
          Change Password (Coming Soon)
        </Button>
      </VStack>
    </Box>
  );
};

export default AccountPage;
