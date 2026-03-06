// src/components/Beacon/ProgressCard.tsx
import React, { useEffect, useState } from "react";
import { Box, VStack, HStack, Text, Center } from "@chakra-ui/react";

interface ProgressCardProps {
  ProgressScore: number;
  totalClaims: number;
  totalReferences: number;
  verifiedClaims: number;
  verifiedReferences: number;
  totalClaimLinks?: number;
  nuancedLinks?: number;
}

const renderVerticalLabel = (text: string) => (
  <VStack spacing={0} zIndex={1} pointerEvents="none">
    {text.split("").map((char, idx) => (
      <Text
        key={idx}
        as="span"
        display="block"
        fontSize="2xs"
        fontWeight="bold"
        color="white"
        lineHeight="1"
        m={0}
        p={0}
      >
        {char}
      </Text>
    ))}
  </VStack>
);

const VerticalGauge: React.FC<{
  label: string;
  value: number;
  total: number;
  color: string;
}> = ({ label, value, total, color }) => {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const safeTotal = total > 0 ? total : 1;
      setPercent((value / safeTotal) * 100);
    }, 100);
    return () => clearTimeout(timeout);
  }, [value, total]);

  return (
    <VStack spacing={1} align="center">
      {/* Vertical Bar */}
      <Box
        position="relative"
        w="24px"
        h="100px"
        bg="whiteAlpha.200"
        borderRadius="md"
        overflow="hidden"
        border="1px solid"
        borderColor="whiteAlpha.300"
      >
        <Box
          position="absolute"
          bottom="0"
          left="0"
          w="full"
          h={`${Math.min(percent, 100).toFixed(1)}%`}
          bg={color}
          transition="height 0.8s ease"
        />
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          display="flex"
          flexDir="column"
          alignItems="center"
        >
          {renderVerticalLabel(label)}
        </Box>
      </Box>

      {/* Number below */}
      <Text
        fontSize="lg"
        fontWeight="bold"
        color="var(--mr-text-primary)"
        className="mr-text-glow"
      >
        {value}
      </Text>
    </VStack>
  );
};

const ProgressCard: React.FC<ProgressCardProps> = ({
  ProgressScore,
  totalClaims,
  totalReferences,
  verifiedClaims,
  verifiedReferences,
  totalClaimLinks = 0,
  nuancedLinks = 0,
}) => {
  return (
    <Box
      className="mr-card mr-card-purple"
      p={4}
      w="100%"
      h="405px"
      position="relative"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
    >
      <div className="mr-glow-bar mr-glow-bar-purple" />
      <div className="mr-scanlines" />

      <Center mb={2}>
        <Text className="mr-badge mr-badge-purple" fontSize="sm">
          Claim Statistics
        </Text>
      </Center>

      <VStack spacing={3} flex={1} justify="space-around">
        {/* Top Row - Claims and References */}
        <HStack spacing={4} justify="center" w="100%">
          <Box textAlign="center">
            <Text
              fontSize="3xl"
              fontWeight="bold"
              color="var(--mr-cyan)"
              lineHeight="1"
              className="mr-text-glow"
            >
              {totalClaims}
            </Text>
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              color="var(--mr-text-secondary)"
              mt={1}
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Total Claims
            </Text>
          </Box>
          <Box textAlign="center">
            <Text
              fontSize="3xl"
              fontWeight="bold"
              color="var(--mr-blue)"
              lineHeight="1"
              className="mr-text-glow"
            >
              {totalReferences}
            </Text>
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              color="var(--mr-text-secondary)"
              mt={1}
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Total Refs
            </Text>
          </Box>
        </HStack>

        {/* Claim Links */}
        <Box textAlign="center" py={2}>
          <Text
            fontSize="4xl"
            fontWeight="black"
            color="var(--mr-purple)"
            lineHeight="1"
            className="mr-text-glow"
          >
            {totalClaimLinks}
          </Text>
          <Text
            fontSize="xs"
            fontWeight="bold"
            color="var(--mr-text-primary)"
            mt={1}
            textTransform="uppercase"
            letterSpacing="widest"
          >
            Claim Links
          </Text>
        </Box>

        {/* Three Vertical Gauges */}
        <HStack spacing={6} justify="center" w="100%">
          <VerticalGauge
            label="SUPPORTS"
            value={verifiedClaims}
            total={totalClaimLinks}
            color="var(--mr-green)"
          />
          <VerticalGauge
            label="NUANCED"
            value={nuancedLinks}
            total={totalClaimLinks}
            color="var(--mr-yellow)"
          />
          <VerticalGauge
            label="REFUTES"
            value={verifiedReferences}
            total={totalClaimLinks}
            color="var(--mr-red)"
          />
        </HStack>
      </VStack>
    </Box>
  );
};

export default ProgressCard;
