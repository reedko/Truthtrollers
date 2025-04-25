import { Box, Text, Flex } from "@chakra-ui/react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";
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
      setAnimatedValue(normalizedToPositive);
    }, 100); // delay to trigger animation
    return () => clearTimeout(timeout);
  }, [normalized]);

  const getColor = (s: number) => {
    if (s >= -1 && s < -0.25) return tealGaugeTheme.colors.red;
    if (s >= -0.25 && s <= 0.25) return tealGaugeTheme.colors.highlight;
    if (s > 0.25 && s <= 1) return tealGaugeTheme.colors.green;
    return tealGaugeTheme.colors.verdigris;
  };

  const activeColor = getColor(score);
  const tickCount = 15;
  const tickSpacing = 100 / (tickCount - 1);

  return (
    <Box
      w={size?.w || "260px"}
      h={size?.h || "140px"}
      position="relative"
      //bg="stackGradient"
    >
      <CircularProgressbarWithChildren
        value={animatedValue}
        minValue={-100}
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
        {/* === Inside the gauge === */}

        {/* Verimeter Number */}
        <Box
          mt={size?.h ? (size.h === 120 ? -20 : -12) : -20}
          mb={size?.h ? (size.h === 120 ? 5 : 3) : 5}
          textAlign="center"
        >
          <Text fontSize="2xl" fontWeight="bold" color={activeColor}>
            {(score * 100).toFixed(0)}%
          </Text>
        </Box>

        {/* Label */}
        <Box mt={-3} textAlign="center">
          <Text fontSize="md" color={tealGaugeTheme.colors.parchment}>
            {label}
          </Text>
        </Box>

        {/* === Ticks are now INSIDE === */}
        <Box position="absolute" bottom="20px" left="0" width="100%" px={2}>
          <Flex justify="space-between" align="center" position="relative">
            <Text
              fontSize="xs"
              fontWeight="bold"
              color={tealGaugeTheme.colors.red}
              position="absolute"
              left="-20px"
              bottom="10px"
            >
              FALSE
            </Text>
            <Text
              fontSize="xs"
              fontWeight="bold"
              color={tealGaugeTheme.colors.green}
              position="absolute"
              right="-20px"
              bottom="10px"
            >
              TRUE
            </Text>

            {/* Ticks */}
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
                    isClosest ? activeColor : tealGaugeTheme.colors.parchment
                  }
                  bottom="30px"
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
      </CircularProgressbarWithChildren>
    </Box>
  );
};

export default TruthGauge;
