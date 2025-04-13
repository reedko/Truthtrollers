// src/components/Beacon/MiniVoteArcGauge.tsx

import React, { useEffect, useState } from "react";
import { Box, Text } from "@chakra-ui/react";
import {
  CircularProgressbarWithChildren,
  buildStyles,
} from "react-circular-progressbar";
import { steampunkTealTheme } from "./themes/steampunkTealTheme";

interface MiniVoteArcGaugeProps {
  label: string;
  value: number;
  total: number;
  color: string;
  size?: { w?: string | number; h?: string | number }; // ✅
}

const MiniVoteArcGauge: React.FC<MiniVoteArcGaugeProps> = ({
  label,
  value,
  total,
  color,
  size,
}) => {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setAnimatedValue(value);
    }, 100);
    return () => clearTimeout(timeout);
  }, [value]);

  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <Box
      w={size?.w || "150px"}
      h={size?.h || "100px"}
      position="relative"
      bg="gray.600"
    >
      <CircularProgressbarWithChildren
        value={animatedValue}
        maxValue={total}
        circleRatio={0.5}
        styles={buildStyles({
          rotation: 0.75,
          strokeLinecap: "butt",
          trailColor: "#333",
          pathColor: color,
          pathTransitionDuration: 1.2,
        })}
      >
        <Box mt={-1} textAlign="center">
          <Text fontSize="xs" color={steampunkTealTheme.colors.parchment}>
            {label}
          </Text>
          <Text fontSize="lg" fontWeight="bold" color={color}>
            {value}/{total}
          </Text>
        </Box>
      </CircularProgressbarWithChildren>
    </Box>
  );
};

export default MiniVoteArcGauge;
