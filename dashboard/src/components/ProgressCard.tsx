// src/components/Beacon/ProgressCard.tsx
import React from "react";
import { Box, VStack, HStack, Text, Center } from "@chakra-ui/react";
import TruthGauge from "./ModernArcGauge";
import MiniVoteArcGauge from "./MiniVoteArcGauge";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";

interface ProgressCardProps {
  ProgressScore: number;
  totalClaims: number;
  totalReferences: number;
  verifiedClaims: number;
  verifiedReferences: number;
}

const ProgressCard: React.FC<ProgressCardProps> = ({
  ProgressScore,
  totalClaims,
  totalReferences,
  verifiedClaims,
  verifiedReferences,
}) => {
  return (
    <Box
      className="mr-card mr-card-purple"
      p={5}
      w="100%" // 👈 obey wrapper (no fixed 250px)
      h="405px"
      position="relative"
    >
      <div className="mr-glow-bar mr-glow-bar-purple" />
      <div className="mr-scanlines" />
      <Center>
        <Text className="mr-badge mr-badge-purple" fontSize="md" mb={3}>
          Progress Gauges
        </Text>
      </Center>

      <VStack spacing={6}>
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
            Progress
          </Text>
          <Center>
            <TruthGauge
              score={ProgressScore}
              label="PROGRESS"
              size={{ w: 150, h: 82 }}
              normalize={true}
            />
          </Center>
        </Box>

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
            Progress Counts
          </Text>
        </Box>

        <VStack>
          <HStack spacing={6} mt={3} justify="center">
            <MiniVoteArcGauge
              label="Total Claims"
              value={totalClaims}
              total={totalClaims}
              color={tealGaugeTheme.colors.green}
              size={{ w: 90, h: 70 }}
            />
            <MiniVoteArcGauge
              label="Total References"
              value={totalReferences}
              total={totalReferences}
              color={tealGaugeTheme.colors.red}
              size={{ w: 90, h: 70 }}
            />
          </HStack>
          <HStack spacing={6} mt={3} justify="center">
            <MiniVoteArcGauge
              label="Verified Claims"
              value={verifiedClaims}
              total={totalClaims}
              color={tealGaugeTheme.colors.green}
              size={{ w: 90, h: 70 }}
            />
            <MiniVoteArcGauge
              label="Verified References"
              value={verifiedReferences}
              total={totalReferences}
              color={tealGaugeTheme.colors.red}
              size={{ w: 90, h: 70 }}
            />
          </HStack>
        </VStack>
      </VStack>
    </Box>
  );
};

export default ProgressCard;
