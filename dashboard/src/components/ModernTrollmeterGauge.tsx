// src/components/Beacon/ModernTrollmeterGauge.tsx
import React from "react";
import { Box, Text, Center } from "@chakra-ui/react";
import ReactSpeedometer from "react-d3-speedometer";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";

const ModernTrollmeterGauge: React.FC<{
  score: number;
  pro: number;
  con: number;
}> = ({ score, pro, con }) => {
  const percent = Math.round(score * 100);

  return (
    <Box
      bg="#0d1117"
      borderRadius="lg"
      p={4}
      w={["100%", "320px"]}
      boxShadow="0 0 20px rgba(44, 122, 123, 0.3)"
    >
      <Center mb={3}>
        <Text fontSize="lg" fontWeight="bold" color="#2C7A7B">
          Trollmeter
        </Text>
      </Center>
      <ReactSpeedometer
        minValue={-100}
        maxValue={100}
        value={(score - 0.5) * 200} // normalized to -100 to 100
        segments={5}
        segmentColors={["#ff4d4f", "#ffa940", "#faad14", "#a0d911", "#52c41a"]}
        needleColor="#FFD700"
        needleHeightRatio={0.8}
        ringWidth={30}
        currentValueText={`${percent}% crowd support`}
        valueTextFontSize="18px"
        height={200}
        customSegmentLabels={tealGaugeTheme.segmentLabels}
      />
      <Center mt={2}>
        <Text fontSize="sm" color="gray.400">
          {pro} agree · {con} disagree
        </Text>
      </Center>
    </Box>
  );
};

export default ModernTrollmeterGauge;
