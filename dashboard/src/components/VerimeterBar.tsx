// src/components/VerimeterBar.tsx
import React from "react";
import { Box, HStack, Text, Tooltip } from "@chakra-ui/react";

interface VerimeterBarProps {
  score: number; // -1 to 1
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showValue?: boolean;
}

const VerimeterBar: React.FC<VerimeterBarProps> = ({
  score,
  size = "md",
  showLabel = true,
  showValue = true,
}) => {
  // Clamp score to -1..1
  const clampedScore = Math.max(-1, Math.min(1, score));

  // Convert -1..1 to 0..100 for positioning
  const percentage = ((clampedScore + 1) / 2) * 100;

  // Determine color based on score
  const getColor = () => {
    if (clampedScore > 0.5) return "green.400";
    if (clampedScore > 0.2) return "green.300";
    if (clampedScore > -0.2) return "yellow.400";
    if (clampedScore > -0.5) return "orange.400";
    return "red.400";
  };

  // Determine label
  const getLabel = () => {
    if (clampedScore > 0.7) return "HIGHLY SUPPORTED";
    if (clampedScore > 0.3) return "SUPPORTED";
    if (clampedScore > -0.3) return "NEUTRAL";
    if (clampedScore > -0.7) return "REFUTED";
    return "HIGHLY REFUTED";
  };

  const height = size === "sm" ? "8px" : size === "md" ? "12px" : "16px";
  const fontSize = size === "sm" ? "xs" : size === "md" ? "sm" : "md";

  return (
    <Box w="100%">
      {showLabel && (
        <HStack justify="space-between" mb={1}>
          <Text fontSize={fontSize} fontWeight="bold" color="gray.300">
            Verimeter
          </Text>
          {showValue && (
            <Text fontSize={fontSize} fontWeight="bold" color={getColor()}>
              {clampedScore.toFixed(2)}
            </Text>
          )}
        </HStack>
      )}

      <Tooltip label={`${getLabel()} (${clampedScore.toFixed(2)})`} hasArrow>
        <Box position="relative" w="100%" h={height} bg="gray.700" borderRadius="full" overflow="hidden">
          {/* Center line (neutral) */}
          <Box
            position="absolute"
            left="50%"
            top="0"
            bottom="0"
            w="2px"
            bg="gray.500"
            zIndex={1}
          />

          {/* Gradient background */}
          <Box
            position="absolute"
            left="0"
            right="0"
            top="0"
            bottom="0"
            bgGradient="linear(to-r, red.600, orange.500, yellow.400, green.400, green.500)"
            opacity={0.3}
          />

          {/* Fill indicator */}
          <Box
            position="absolute"
            left="0"
            top="0"
            bottom="0"
            w={`${percentage}%`}
            bg={getColor()}
            transition="all 0.3s ease"
            boxShadow={`0 0 10px ${getColor()}`}
          />

          {/* Marker dot */}
          <Box
            position="absolute"
            left={`${percentage}%`}
            top="50%"
            transform="translate(-50%, -50%)"
            w={size === "sm" ? "12px" : size === "md" ? "16px" : "20px"}
            h={size === "sm" ? "12px" : size === "md" ? "16px" : "20px"}
            bg={getColor()}
            borderRadius="full"
            border="2px solid"
            borderColor="white"
            boxShadow="0 0 8px rgba(0,0,0,0.5)"
            zIndex={2}
          />
        </Box>
      </Tooltip>

      {size !== "sm" && (
        <HStack justify="space-between" mt={1}>
          <Text fontSize="xs" color="red.400">REFUTED</Text>
          <Text fontSize="xs" color="gray.500">NEUTRAL</Text>
          <Text fontSize="xs" color="green.400">SUPPORTED</Text>
        </HStack>
      )}
    </Box>
  );
};

export default VerimeterBar;
