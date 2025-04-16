// src/components/BareGauge.tsx
import { Box, Text, Flex } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";

const pulse = keyframes`
  0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
  50% { transform: translateX(-50%) scale(1.3); box-shadow: 0 0 15px; }
  100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
`;

interface BareGaugeProps {
  score: number; // 0–1
  label?: string;
}

const BareGauge: React.FC<BareGaugeProps> = ({
  score,
  label = "Consensus",
}) => {
  const percent = Math.round(score * 100);
  const [animatedValue, setAnimatedValue] = useState(0);
  const tickCount = 15;
  const tickSpacing = 100 / (tickCount - 1);

  useEffect(() => {
    const timeout = setTimeout(() => setAnimatedValue(percent), 100);
    return () => clearTimeout(timeout);
  }, [percent]);

  return (
    <Box
      w="220px"
      h="180px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      position="relative"
    >
      <CircularProgressbarWithChildren
        value={animatedValue}
        maxValue={100}
        circleRatio={1}
        styles={buildStyles({
          rotation: 0,
          strokeLinecap: "round",
          trailColor: "#333",
          pathColor: "#00ff88",
          pathTransitionDuration: 1.5,
        })}
      >
        <Box textAlign="center">
          <Text fontSize="2xl" fontWeight="bold" color="#00ff88">
            {percent}%
          </Text>
          <Text fontSize="sm" color="gray.300">
            {label}
          </Text>
        </Box>
      </CircularProgressbarWithChildren>

      {/* Tick Bar with animated glow */}
      <Box position="absolute" bottom="0" left="0" width="100%" px={2}>
        <Flex justify="space-between" align="center" position="relative">
          <Text
            fontSize="sm"
            fontWeight="bold"
            color="red.400"
            position="absolute"
            left="-20px"
            bottom="-30px"
          >
            FALSE
          </Text>
          <Text
            fontSize="sm"
            fontWeight="bold"
            color="green.300"
            position="absolute"
            right="-20px"
            bottom="-30px"
          >
            TRUE
          </Text>

          {Array.from({ length: tickCount }, (_, i) => {
            const tickValue = i * tickSpacing;
            const isClosest =
              Math.abs(tickValue - animatedValue) <= tickSpacing / 2;

            return (
              <Box
                key={i}
                position="absolute"
                left={`${tickValue}%`}
                transform="translateX(-50%)"
                width={isClosest ? "6px" : "2px"}
                height={isClosest ? "16px" : "8px"}
                background={isClosest ? "#00ff88" : "gray.500"}
                bottom="-10px"
                borderRadius="1px"
                boxShadow={
                  isClosest ? `0 0 8px #00ff88, 0 0 12px #00ff88` : "none"
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

export default BareGauge;
