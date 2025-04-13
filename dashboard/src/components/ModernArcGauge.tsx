import { Box, Text, Flex } from "@chakra-ui/react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import { steampunkTealTheme } from "./themes/steampunkTealTheme";
import { keyframes } from "@emotion/react";
import React, { useEffect, useState } from "react";

const pulse = keyframes`
  0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
  50% { transform: translateX(-50%) scale(1.3); box-shadow: 0 0 15px; }
  100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
`;
interface TruthGaugeProps {
  score: number; // -1 to 1
  label?: string;
  size?: { w?: string | number; h?: string | number }; // ✅ new
  normalize?: boolean;
}

const TruthGauge: React.FC<TruthGaugeProps> = ({
  score,
  label = "Consensus",
  size,
  normalize = false,
}) => {
  const normalizedToAll = ((score + 1) / 2) * 100;
  const [animatedValue, setAnimatedValue] = useState(0);
  const normalizedToPositive = (score + 1) * 100 - 100;
  const normalized = normalize ? normalizedToPositive : normalizedToAll;
  useEffect(() => {
    const timeout = setTimeout(() => {
      setAnimatedValue(normalized);
    }, 100); // delay to trigger animation
    return () => clearTimeout(timeout);
  }, [normalized]);

  const getColor = (s: number) => {
    if (s >= -1 && s < -0.25) return steampunkTealTheme.colors.red;
    if (s >= -0.25 && s <= 0.25) return steampunkTealTheme.colors.highlight;
    if (s > 0.25 && s <= 1) return steampunkTealTheme.colors.green;
    return steampunkTealTheme.colors.verdigris;
  };

  const activeColor = getColor(score);
  const tickCount = 15;
  const tickSpacing = 100 / (tickCount - 1);

  return (
    <Box
      w={size?.w || "260px"}
      h={size?.h || "140px"}
      position="relative"
      bg="gray.600"
    >
      <CircularProgressbarWithChildren
        value={animatedValue}
        maxValue={100}
        circleRatio={0.5}
        styles={buildStyles({
          rotation: 0.75,
          strokeLinecap: "butt",
          trailColor: "#222",
          pathColor: activeColor,
          pathTransitionDuration: 1.5,
          pathTransition: "stroke-dashoffset 1.5s ease-in-out",
        })}
      >
        <Box
          mt={size?.h ? (size.h === 120 ? -20 : -12) : -20}
          mb={size?.h ? (size.h === 120 ? 5 : 3) : 5}
          textAlign="center"
        >
          <Text fontSize="2xl" fontWeight="bold" color={activeColor}>
            {(score * 100).toFixed(0)}%
          </Text>
        </Box>
        <Box mt={-3} textAlign="center">
          <Text fontSize="sm" color={steampunkTealTheme.colors.parchment}>
            {label}
          </Text>
        </Box>
      </CircularProgressbarWithChildren>

      {/* Label Bar with Ticks */}
      <Box position="absolute" bottom="0" left="0" width="100%" px={2}>
        <Flex justify="space-between" align="center" position="relative">
          <Text
            fontSize="sm"
            fontWeight="bold"
            color={steampunkTealTheme.colors.red}
            position="absolute"
            left="-20px"
            bottom="-30px"
          >
            FALSE
          </Text>
          <Text
            fontSize="sm"
            fontWeight="bold"
            color={steampunkTealTheme.colors.green}
            position="absolute"
            right="-20px"
            bottom="-30px"
          >
            TRUE
          </Text>

          {/* Ticks with active highlight */}
          {Array.from({ length: tickCount }, (_, i) => {
            const tickValue = i * tickSpacing;
            const isClosest =
              Math.abs(tickValue - normalized) <= tickSpacing / 2;
            return (
              <Box
                key={i}
                position="absolute"
                left={`${tickValue}%`}
                transform="translateX(-50%)"
                width={isClosest ? "6px" : "2px"}
                height={isClosest ? "16px" : "8px"}
                background={
                  isClosest ? activeColor : steampunkTealTheme.colors.parchment
                }
                bottom="-10px"
                borderRadius="1px"
                boxShadow={
                  isClosest
                    ? `0 0 8px ${activeColor}, 0 0 12px ${activeColor}`
                    : "none"
                }
                animation={
                  isClosest ? `${pulse} 1.2s ease-in-out infinite` : "none"
                }
                transition="all 0.3s ease"
              />
            );
          })}
        </Flex>
      </Box>
    </Box>
  );
};

export default TruthGauge;
