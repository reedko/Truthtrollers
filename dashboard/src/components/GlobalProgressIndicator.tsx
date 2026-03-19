import React from 'react';
import { Box, Spinner, Text, VStack } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
`;

const glow = keyframes`
  0%, 100% { filter: drop-shadow(0 0 8px rgba(94, 234, 212, 0.6)); }
  50% { filter: drop-shadow(0 0 16px rgba(94, 234, 212, 0.9)); }
`;

interface GlobalProgressIndicatorProps {
  isActive: boolean;
  message?: string;
}

export const GlobalProgressIndicator: React.FC<GlobalProgressIndicatorProps> = ({
  isActive,
  message = 'Processing...',
}) => {
  if (!isActive) return null;

  return (
    <Box
      position="fixed"
      top="20px"
      right="20px"
      zIndex={10000}
      bg="rgba(26, 32, 44, 0.9)"
      backdropFilter="blur(20px)"
      borderRadius="xl"
      border="1px solid"
      borderColor="cyan.400"
      boxShadow="0 8px 32px rgba(94, 234, 212, 0.3), inset 0 0 20px rgba(94, 234, 212, 0.1)"
      p={4}
      animation={`${pulse} 2s ease-in-out infinite`}
    >
      <VStack spacing={2}>
        <Spinner
          size="md"
          color="cyan.400"
          thickness="3px"
          speed="0.65s"
          animation={`${glow} 2s ease-in-out infinite`}
        />
        {message && (
          <Text
            fontSize="sm"
            color="cyan.300"
            fontWeight="medium"
            whiteSpace="nowrap"
          >
            {message}
          </Text>
        )}
      </VStack>
    </Box>
  );
};
