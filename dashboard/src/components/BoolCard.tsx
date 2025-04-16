// src/components/Beacon/BoolCard.tsx

import React from "react";
import { Box, VStack, HStack, Text, Center } from "@chakra-ui/react";
import TruthGauge from "./ModernArcGauge";
import MiniVoteArcGauge from "./MiniVoteArcGauge";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";

interface BoolCardProps {
  verimeterScore: number;
  trollmeterScore: number;
  pro: number;
  con: number;
}

const BoolCard: React.FC<BoolCardProps> = ({
  verimeterScore,
  trollmeterScore,
  pro,
  con,
}) => {
  const totalVotes = pro + con;

  return (
    <Box
      bg="stat2Gradient"
      borderRadius="lg"
      boxShadow="2xl"
      p={5}
      w="250px"
      h="405px"
      position="relative"
      margin="10px"
    >
      {/* Title */}
      <Center>
        <Text fontWeight="bold" fontSize="md" color="white" mb={3}>
          Veracity Gauges
        </Text>
      </Center>

      <VStack spacing={6}>
        {/* Verimeter */}
        <Box w="100%">
          <Text
            fontSize="sm"
            fontWeight="semibold"
            color={tealGaugeTheme.colors.parchment}
            mb={1}
            textAlign="center"
            background="whiteAlpha.200"
            borderRadius="md"
            px={2}
          >
            Expert Rating
          </Text>
          <Center>
            <TruthGauge
              score={verimeterScore}
              label="VERIMETER"
              size={{ w: 150, h: 82 }}
            />
          </Center>
        </Box>

        {/* Trollmeter */}
        <Box w="100%">
          <Text
            fontSize="sm"
            fontWeight="semibold"
            color={tealGaugeTheme.colors.parchment}
            mb={1}
            textAlign="center"
            background="whiteAlpha.200"
            borderRadius="md"
            px={2}
          >
            Popular Vote
          </Text>
          <Center>
            <TruthGauge
              score={trollmeterScore}
              label="TROLLMETER"
              size={{ w: 150, h: 82 }}
            />
          </Center>
        </Box>

        {/* Tiny vote gauges */}
        <HStack spacing={6} mt={3} justify="center">
          <MiniVoteArcGauge
            label="Agree"
            value={pro}
            total={totalVotes}
            color={tealGaugeTheme.colors.green}
            size={{ w: 90, h: 70 }}
          />
          <MiniVoteArcGauge
            label="Disagree"
            value={con}
            total={totalVotes}
            color={tealGaugeTheme.colors.red}
            size={{ w: 90, h: 70 }}
          />
        </HStack>
      </VStack>
    </Box>
  );
};

export default BoolCard;
