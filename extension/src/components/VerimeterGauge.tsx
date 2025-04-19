import React from "react";
import { Box, Text } from "@chakra-ui/react";
import ReactSpeedometer from "react-d3-speedometer";
import { steampunkTealTheme } from "./themes/steampunkTealTheme";

interface VerimeterGaugeProps {
  score: number; // -1 to 1
}

const VerimeterGauge: React.FC<VerimeterGaugeProps> = ({ score }) => {
  const value = score * 100;

  return (
    <Box
      position="relative"
      w="240px"
      h="255px"
      border="4px solid"
      borderColor={steampunkTealTheme.colors.brass}
      borderRadius="lg"
      overflow="hidden"
      boxShadow="lg"
    >
      {/* Overlay with background image */}
      <Box
        position="absolute"
        top="0"
        left="0"
        w="100%"
        h="100%"
        backgroundImage={`url(${steampunkTealTheme.textures.trollOverlay})`}
        backgroundSize="contain"
        backgroundRepeat="no-repeat"
        backgroundPosition="center"
        zIndex="1"
        opacity={0.3}
        pointerEvents="none"
      />

      {/* Gauge */}
      <Box
        position="absolute"
        top="0"
        left="0"
        zIndex="0"
        w="100%"
        h="100%"
        display="flex"
        justifyContent="center"
        alignItems="center"
        opacity={0.7}
      >
        <ReactSpeedometer
          minValue={-100}
          maxValue={100}
          value={value}
          width={185}
          height={170}
          segments={5}
          ringWidth={25}
          needleHeightRatio={0.85}
          customSegmentLabels={steampunkTealTheme.segmentLabels}
          customSegmentStops={[-100, -40, -20, 20, 40, 100]}
          segmentColors={steampunkTealTheme.segmentColors2}
          needleColor={steampunkTealTheme.colors.highlight}
          currentValueText=""
          valueTextFontSize="0px"
        />
      </Box>

      {/* Value Text */}
      <Box
        position="absolute"
        top="75%" // Adjust as needed
        left="50%"
        transform="translate(-50%, -50%)"
        zIndex="2"
        color={steampunkTealTheme.colors.brass}
        fontFamily="papyrus"
        fontSize="38px"
        fontWeight="bold"
        pointerEvents="none"
      >
        {(score * 100).toFixed(0)}%
      </Box>

      {/* Title */}
      <Box
        position="absolute"
        bottom="210px"
        width="100%"
        textAlign="center"
        zIndex="2"
      >
        <Text
          fontSize="24px"
          fontWeight="bold"
          fontFamily="papyrus"
          color={steampunkTealTheme.colors.brass}
        >
          VERIMETER
        </Text>
      </Box>
    </Box>
  );
};

export default VerimeterGauge;
