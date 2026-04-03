// src/components/VerimeterBar.tsx
import React from "react";
import { Box, Text, useColorModeValue } from "@chakra-ui/react";
import { VERIMETER_LABELS } from "../utils/verimeterUtils";

interface VerimeterBarProps {
  score: number; // -1 to 1
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showValue?: boolean;
}

const VerimeterBar: React.FC<VerimeterBarProps> = ({
  score,
  size = "md",
}) => {
  // Clamp score to -1..1
  const clampedScore = Math.max(-1, Math.min(1, score));

  // Score as -100 to +100
  const displayScore = Math.round(clampedScore * 100);

  // Position on bar: map -1 to +1 score to 0% to 100% position
  const barPosition = ((clampedScore + 1) / 2) * 100;

  // Determine color based on score (matching VerimeterMeter logic)
  const getVerdictColor = () => {
    const percentage = clampedScore * 100;
    if (percentage >= 10) return "green.400";
    if (percentage <= -10) return "red.400";
    return "blue.400";
  };

  const verdictColor = getVerdictColor();

  return (
    <Box
      w="100%"
      position="relative"
      display="flex"
      alignItems="center"
      gap={2}
    >
      {/* REFUTED label on left */}
      <Text fontSize="2xs" fontWeight="bold" color="red.400" flexShrink={0}>
        {VERIMETER_LABELS.negative}
      </Text>

      {/* Gradient Bar Container */}
      <Box position="relative" flex="1" h="18px">
        {/* Gradient Bar */}
        <Box
          h="100%"
          w="100%"
          borderRadius="md"
          background="linear-gradient(to right, #E53E3E 0%, #3182CE 50%, #38A169 100%)"
          boxShadow="inset 0 1px 2px rgba(0, 0, 0, 0.2)"
        />

        {/* Score Badge positioned on bar */}
        <Box
          position="absolute"
          left={`${barPosition}%`}
          top="50%"
          transform="translate(-50%, -50%)"
          bg={useColorModeValue("white", "gray.800")}
          px={2}
          py={0.5}
          borderRadius="sm"
          border="1px solid"
          borderColor={verdictColor}
          boxShadow="0 1px 4px rgba(0, 0, 0, 0.3)"
          zIndex={2}
        >
          <Text
            fontSize="2xs"
            fontWeight="bold"
            color={verdictColor}
            whiteSpace="nowrap"
          >
            {displayScore}
          </Text>
        </Box>
      </Box>

      {/* SUPPORTED label on right */}
      <Text fontSize="2xs" fontWeight="bold" color="green.400" flexShrink={0}>
        {VERIMETER_LABELS.positive}
      </Text>
    </Box>
  );
};

export default VerimeterBar;
