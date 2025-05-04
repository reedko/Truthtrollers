// src/components/Beacon/CustomVerimeterGauge.tsx
import { Box, Text, Center } from "@chakra-ui/react";
import React from "react";
import { steampunkTealTheme } from "./experimental/steampunkTealTheme";
const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

interface CustomVerimeterGaugeProps {
  score: number; // -1 to 1
}

const CustomVerimeterGauge: React.FC<CustomVerimeterGaugeProps> = ({
  score,
}) => {
  const normalized = ((score + 1) / 2) * 180; // 0–180 deg
  const needleAngle = normalized - 90; // SVG starts at 0° = right

  return (
    <Box position="relative" w="300px" h="300px">
      {/* Background dial (the brass gear image) */}
      <Box
        as="img"
        src={`${API_BASE_URL}/assets/images/textures/gear-frame3.png`}
        alt="Gauge Frame"
        position="absolute"
        top={0}
        left={0}
        w="100%"
        h="100%"
        zIndex={1}
      />

      {/* Glass dome effect */}
      <Box
        position="absolute"
        top={0}
        left={0}
        w="100%"
        h="100%"
        borderRadius="full"
        bg="radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), transparent 70%)"
        zIndex={3}
        pointerEvents="none"
      />

      {/* SVG gauge arc and needle */}
      <svg
        width="300"
        height="300"
        viewBox="0 0 300 300"
        style={{ zIndex: 2, position: "relative" }}
      >
        <g transform="translate(150,150)">
          {/* Gauge segments */}
          {[...Array(5)].map((_, i) => {
            const start = (Math.PI * (i * 36 - 90)) / 180;
            const end = (Math.PI * ((i + 1) * 36 - 90)) / 180;
            const x1 = 100 * Math.cos(start);
            const y1 = 100 * Math.sin(start);
            const x2 = 100 * Math.cos(end);
            const y2 = 100 * Math.sin(end);
            const largeArc = end - start > Math.PI ? 1 : 0;

            const colors = [
              "#8B0000",
              "#D2691E",
              "#F4E2D8",
              "#4ECDC4",
              "#FFD700",
            ];
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A 100 100 0 ${largeArc} 1 ${x2} ${y2}`}
                stroke={colors[i]}
                strokeWidth={20}
                fill="none"
              />
            );
          })}

          {/* Needle */}
          <defs>
            <radialGradient id="brassGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFD700" />
              <stop offset="100%" stopColor="#B08D57" />
            </radialGradient>
          </defs>

          <polygon
            points="-5,0 0,-10 90,0 0,10"
            fill="url(#brassGradient)"
            stroke="#333"
            strokeWidth="1"
            transform={`rotate(${needleAngle})`}
          />
        </g>
      </svg>

      {/* Center text */}
      <Center
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        zIndex={4}
      >
        <Text
          fontSize="2xl"
          fontWeight="bold"
          color="#FFD700"
          textShadow="0 0 4px rgba(0,0,0,0.8)"
        >
          {(score * 100).toFixed(0)}%
        </Text>
      </Center>
    </Box>
  );
};

export default CustomVerimeterGauge;
