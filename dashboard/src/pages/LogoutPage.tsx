import React, { useEffect } from "react";
import { Box, Heading, Text, Spinner } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { generateDeviceFingerprint } from "../utils/generateDeviceFingerprint";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
// Import your generateExtensionFingerprint util if possible
// (If you have to duplicate it, just copy the logic from your extension)

const LogoutPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Immediately attempt to clear backend session
    async function logoutBackend() {
      try {
        // If generateExtensionFingerprint is async, await it!
        const fingerprint = await generateDeviceFingerprint();
        await fetch(`${API_BASE_URL}/api/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint }),
        });
        // Optionally: clear local storage, etc.
        localStorage.removeItem("jwt");
        sessionStorage.removeItem("jwt");
      } catch (err) {
        console.error("Error logging out on backend:", err);
      }
    }
    logoutBackend();

    const timeout = setTimeout(() => {
      navigate("/login", { replace: true });
    }, 2000);

    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <Box textAlign="center" mt={20}>
      <Heading size="lg">You've been logged out</Heading>
      <Text mt={2}>Redirecting to login...</Text>
      <Spinner size="lg" mt={4} />
    </Box>
  );
};

export default LogoutPage;
