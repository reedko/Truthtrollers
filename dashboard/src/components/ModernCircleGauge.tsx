import { Box, Text, Flex } from "@chakra-ui/react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import { keyframes } from "@emotion/react";
import React, { useEffect, useState } from "react";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";
import "react-circular-progressbar/dist/styles.css";

const pulse = keyframes`
  0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
  50% { transform: translateX(-50%) scale(1.3); box-shadow: 0 0 15px; }
  100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
`;

interface GlowGaugeProps {
  score: number; // -1 to 1
  label?: string;
  size?: { w?: string | number; h?: string | number };
  normalize?: boolean;
}

const GlowGauge: React.FC<GlowGaugeProps> = ({
  score,
  label = "Consensus",
  size = { w: 220, h: 180 },
  normalize = false,
}) => {
  const normalizedToAll = ((score + 1) / 2) * 100;
  const normalizedToPositive = (score + 1) * 100 - 100;
  const normalized = normalize ? normalizedToPositive : normalizedToAll;
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => setAnimatedValue(normalized), 100);
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
      w={size.w}
      h={size.h}
      position="relative"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="transparent"
      zIndex={1} // ✅ makes sure it's above any blending layer
      overflow="visible" // ✅ helps ensure SVG isn't clipped
      style={{ pointerEvents: "none" }} // just in case
    >
      <CircularProgressbarWithChildren
        value={animatedValue}
        maxValue={100}
        circleRatio={1}
        styles={buildStyles({
          rotation: 0,
          strokeLinecap: "round",
          trailColor: "#222",
          pathColor: activeColor,
          pathTransitionDuration: 1.5,
        })}
      >
        <Box textAlign="center">
          <Text fontSize="2xl" fontWeight="bold" color={activeColor}>
            {Math.round(score * 100)}%
          </Text>
          <Text fontSize="sm" color="gray.300">
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
            color={tealGaugeTheme.colors.red}
            position="absolute"
            left="-20px"
            bottom="-30px"
          >
            FALSE
          </Text>
          <Text
            fontSize="sm"
            fontWeight="bold"
            color={tealGaugeTheme.colors.green}
            position="absolute"
            right="-20px"
            bottom="-30px"
          >
            TRUE
          </Text>

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

export default GlowGauge;
