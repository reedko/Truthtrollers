// src/pages/AccountSettingsPage.tsx
import React, { useEffect } from "react";
import {
  Box,
  Heading,
  VStack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Avatar,
  Button,
  Text,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import ChangePasswordForm from "../components/ChangePasswordForm";
import UploadProfileImage from "../components/UploadProfileImage";
import ChangeEmailForm from "../components/ChangeEmailForm";

const AccountSettingsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  console.log(user, "JKLJJGFDGUHJKLGFDDH");
  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
    }
  }, [user, navigate]);

  if (!user) return null;

  if (user.isDemo) {
    return (
      <Box maxW="600px" mx="auto" mt={10} p={6} textAlign="center">
        <Avatar name="Guest" size="xl" mb={4} />
        <Heading size="lg" mb={2}>
          Guest Preview Mode
        </Heading>
        <Text mb={4}>
          You’re currently browsing in read-only demo mode. To customize your
          account, please log in or register.
        </Text>
        <VStack spacing={3}>
          <Button as={RouterLink} to="/login" colorScheme="teal">
            Log In
          </Button>
          <Button as={RouterLink} to="/register" variant="outline">
            Create Account
          </Button>
        </VStack>
      </Box>
    );
  }

  return (
    <Box maxW="600px" mx="auto" mt={10} p={6} boxShadow="lg" borderRadius="md">
      <VStack spacing={3} mb={4}>
        <Avatar
          name={user.username}
          src={
            user.user_profile_image
              ? `${import.meta.env.VITE_API_BASE_URL}/${
                  user.user_profile_image
                }`
              : undefined
          }
          size="xl"
        />
        <Heading size="lg" textAlign="center">
          Account Settings
        </Heading>
      </VStack>

      <Tabs variant="enclosed">
        <TabList>
          <Tab>Change Password</Tab>
          <Tab>Change Email</Tab>
          <Tab>Upload Avatar</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <ChangePasswordForm />
          </TabPanel>
          <TabPanel>
            <ChangeEmailForm />
          </TabPanel>
          <TabPanel>
            <UploadProfileImage />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
};

export default AccountSettingsPage;
