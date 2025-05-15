// src/pages/LogoutPage.tsx
import React, { useEffect } from "react";
import { Box, Heading, Text, Spinner } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";

const LogoutPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
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
