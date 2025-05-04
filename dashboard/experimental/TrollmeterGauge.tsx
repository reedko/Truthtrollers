// src/components/Beacon/TrollmeterGauge.tsx
import React from "react";
import { Box, Text, Center, HStack, VStack } from "@chakra-ui/react";
import ReactSpeedometer from "react-d3-speedometer";
import { steampunkTealTheme } from "./experimental/steampunkTealTheme";
import { CustomSegmentLabelPosition } from "react-d3-speedometer";

interface TrollmeterGaugeProps {
  score: number; // 0 to 1 — 1 = full support, 0 = total refutation
  pro: number;
  con: number;
}

const TrollmeterGauge: React.FC<TrollmeterGaugeProps> = ({
  score,
  pro,
  con,
}) => {
  const percent = Math.round(score * 100);

  return (
    <Box
      w={"420px"}
      p={4}
      position="relative"
      borderRadius="lg"
      border="4px solid"
      borderColor={steampunkTealTheme.colors.brass}
      boxShadow="lg"
      height={"450px"}
    >
      {" "}
      <Box
        position="absolute"
        top={0}
        left={0}
        w="100%"
        h="100%"
        width={300}
        height={200}
        margin="0 auto"
        display="flex"
        alignItems="center"
        justifyContent="center"
        transform="translate(18.5%, 61%) scale(2.2)" // scale it up
        backgroundImage={`url(${steampunkTealTheme.textures.trollOverlay})`}
        backgroundSize="contain"
        backgroundRepeat="no-repeat"
        backgroundPosition="center"
        pointerEvents="none"
        opacity={1}
        zIndex={0}
      />
      <Center zIndex={0} position="relative">
        <Text
          fontSize="30px"
          fontWeight="bold"
          fontFamily={"papyrus"}
          color={steampunkTealTheme.colors.brass}
          mb={-1}
          mt={-1}
        >
          TROLLMETER
        </Text>
      </Center>
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        h="200px"
        position="relative"
        zIndex={0}
        opacity={0.4}
      >
        <ReactSpeedometer
          minValue={-100}
          maxValue={100}
          value={percent}
          segments={5}
          segmentColors={steampunkTealTheme.segmentColors}
          customSegmentStops={[-100, -60, -20, 20, 60, 100]}
          customSegmentLabels={steampunkTealTheme.segmentLabels}
          needleHeightRatio={0.8}
          ringWidth={40}
          needleColor={steampunkTealTheme.colors.highlight}
          valueTextFontSize="0"
          currentValueText="" //{`${(score * 100).toFixed(0)}%`}
          height={140}
        />
      </Box>
      {/* Crowd Numbers */}
      <Center mt={1}>
        <VStack spacing={0}>
          <Text
            fontFamily={"papyrus"}
            zIndex={1}
            fontSize="40px"
            fontWeight="bold"
            color={steampunkTealTheme.colors.brass}
          >
            {(score * 100).toFixed(0)}%
          </Text>
          <Text
            mt={-2}
            zIndex={1}
            fontFamily={"papyrus"}
            fontSize="20px"
            fontWeight="bold"
            color={steampunkTealTheme.colors.brass}
          >
            {pro} agree · {con} disagree
          </Text>
        </VStack>
      </Center>
    </Box>
  );
};

export default TrollmeterGauge;
