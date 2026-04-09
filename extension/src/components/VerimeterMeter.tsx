import React from "react";
import { Box, VStack, Text, useColorModeValue } from "@chakra-ui/react";
import { VERIMETER_LABELS } from "../utils/verimeterLabels";

interface VerimeterMeterProps {
  /**
   * Score from -1 to +1 (will be displayed as -100 to +100)
   */
  score: number | null;
  /**
   * Width of the meter bar
   */
  width?: string;
  /**
   * Show interpretation text below the meter
   */
  showInterpretation?: boolean;
}

// Helper function to get verdict info based on verimeter score
const getVerdictInfo = (
  score: number | null,
): {
  color: string;
  word: string;
  interpretation: string;
} => {
  if (score === null) {
    return {
      color: "gray.400",
      word: VERIMETER_LABELS.unknown,
      interpretation: "No evidence assessment available yet",
    };
  }

  // Score is -1 to +1, convert to percentage (-100 to 100)
  const percentage = score * 100;

  // Color thresholds: -100 to -10 = RED (refute), -10 to 10 = BLUE (nuanced), 10 to 100 = GREEN (support)
  if (percentage >= 10) {
    return {
      color: "green.400",
      word: VERIMETER_LABELS.positive,
      interpretation: "Evidence supports this claim",
    };
  } else if (percentage <= -10) {
    return {
      color: "red.400",
      word: VERIMETER_LABELS.negative,
      interpretation: "Evidence refutes this claim",
    };
  } else {
    return {
      color: "blue.400",
      word: VERIMETER_LABELS.neutral,
      interpretation: "Evidence is mixed or inconclusive",
    };
  }
};

const VerimeterMeter: React.FC<VerimeterMeterProps> = ({
  score,
  width = "600px",
  showInterpretation = true,
}) => {
  // Score is -1 to +1, display as -100 to +100
  const displayScore = score !== null ? Math.round(score * 100) : 0;

  // Position on bar: map -1 to +1 score to 0% to 100% position
  // -1 (score) -> 0% (left edge)
  //  0 (score) -> 50% (center)
  // +1 (score) -> 100% (right edge)
  const barPosition = score !== null ? ((score + 1) / 2) * 100 : 50;

  console.log('[VerimeterMeter] score:', score, 'displayScore:', displayScore, 'barPosition:', barPosition);

  const verdictInfo = getVerdictInfo(score);

  return (
    <VStack spacing={1} w="100%" align="center">
      {/* Bar with Labels and Badge */}
      <Box w={width} position="relative" display="flex" alignItems="center" gap={2}>
        {/* REFUTED label on left */}
        <Text
          fontSize="2xs"
          fontWeight="bold"
          color="red.400"
          flexShrink={0}
          fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
        >
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
            borderColor={verdictInfo.color}
            boxShadow="0 1px 4px rgba(0, 0, 0, 0.3)"
            zIndex={2}
          >
            <Text
              fontSize="2xs"
              fontWeight="bold"
              color={verdictInfo.color}
              whiteSpace="nowrap"
              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
            >
              {displayScore}
            </Text>
          </Box>
        </Box>

        {/* SUPPORTED label on right */}
        <Text
          fontSize="2xs"
          fontWeight="bold"
          color="green.400"
          flexShrink={0}
          fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
        >
          {VERIMETER_LABELS.positive}
        </Text>
      </Box>

      {/* Interpretation Text centered below */}
      {showInterpretation && (
        <Text
          fontSize="lg"
          fontWeight="bold"
          color={useColorModeValue("gray.800", "gray.100")}
          textAlign="center"
        >
          {verdictInfo.interpretation}
        </Text>
      )}
    </VStack>
  );
};

// 🔧 PERF: Memoize to prevent unnecessary re-renders
export default React.memo(VerimeterMeter);
