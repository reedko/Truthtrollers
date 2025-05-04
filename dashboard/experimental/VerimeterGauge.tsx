import React from "react";
import { Box, Text, Center, useColorModeValue } from "@chakra-ui/react";
import ReactSpeedometer, {
  CustomSegmentLabelPosition,
} from "react-d3-speedometer";
import { steampunkTealTheme } from "./experimental/steampunkTealTheme";

interface VerimeterGaugeProps {
  score: number; // -1 to 1
}

const VerimeterGauge: React.FC<VerimeterGaugeProps> = ({ score }) => {
  const labelColor = useColorModeValue("gray.700", "gray.100");
  const value = ((score + 1) / 2) * 100; // Normalize -1 to 1 → 0 to 100

  return (
    <Box
      w={"420px"}
      h={"450px"}
      p={4}
      position="relative"
      borderRadius="lg"
      border="4px solid"
      borderColor={steampunkTealTheme.colors.brass}
      boxShadow="lg"
    >
      {/* Overlay */}
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

      {/* Title */}
      <Center zIndex={2} position="relative">
        <Text
          fontSize="30px"
          fontWeight="bold"
          fontFamily="papyrus"
          color={steampunkTealTheme.colors.brass}
          mt={-1}
          mb={-1}
        >
          VERIMETER
        </Text>
      </Center>

      {/* Gauge */}
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
          value={value}
          segments={10}
          segmentColors={steampunkTealTheme.segmentColors2}
          customSegmentStops={[-100, -60, -20, 20, 60, 100]}
          customSegmentLabels={steampunkTealTheme.segmentLabels}
          needleHeightRatio={0.9}
          ringWidth={40}
          needleColor={steampunkTealTheme.colors.highlight}
          valueTextFontSize="0px"
          currentValueText=""
          height={Math.floor(140)} // dynamic gauge height
        />
      </Box>

      {/* Value Text */}
      <Center mt={4} ml={4}>
        <Text
          fontFamily="papyrus"
          fontSize="45px"
          fontWeight="bold"
          zIndex={1}
          color={steampunkTealTheme.colors.brass}
        >
          {(score * 100).toFixed(0)}%
        </Text>
      </Center>
    </Box>
  );
};

export default VerimeterGauge;
