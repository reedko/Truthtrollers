// dashboard/src/components/PWAInstallBanner.tsx
import React from "react";
import { Box, HStack, Text, Button, IconButton } from "@chakra-ui/react";
import { CloseIcon } from "@chakra-ui/icons";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { useState } from "react";

export default function PWAInstallBanner() {
  const { canInstall, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <Box
      position="fixed"
      bottom={4}
      left="50%"
      transform="translateX(-50%)"
      zIndex={9999}
      bg="rgba(15,23,42,0.97)"
      border="1px solid rgba(0,162,255,0.4)"
      borderRadius="xl"
      px={5}
      py={3}
      boxShadow="0 4px 24px rgba(0,0,0,0.5)"
      maxW="sm"
      w="90%"
    >
      <HStack spacing={3} justify="space-between">
        <HStack spacing={3}>
          <Text fontSize="xl">📲</Text>
          <Box>
            <Text color="white" fontSize="sm" fontWeight="bold">
              Install Truthtrollers
            </Text>
            <Text color="gray.400" fontSize="xs">
              Add to your home screen for quick access
            </Text>
          </Box>
        </HStack>
        <HStack spacing={2}>
          <Button
            size="sm"
            colorScheme="blue"
            borderRadius="full"
            onClick={install}
          >
            Install
          </Button>
          <IconButton
            aria-label="Dismiss"
            icon={<CloseIcon boxSize="10px" />}
            size="xs"
            variant="ghost"
            color="gray.500"
            onClick={() => setDismissed(true)}
          />
        </HStack>
      </HStack>
    </Box>
  );
}
