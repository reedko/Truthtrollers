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
  compact?: boolean;
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
  compact?: boolean;
}> = ({ label, value, total, color, compact = false }) => {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const safeTotal = total > 0 ? total : 1;
      setPercent((value / safeTotal) * 100);
    }, 100);
    return () => clearTimeout(timeout);
  }, [value, total]);

  return (
    <VStack spacing={compact ? 0 : 1} align="center">
      {/* Vertical Bar */}
      <Box
        position="relative"
        w={compact ? "12px" : "24px"}
        h={compact ? "50px" : "100px"}
        bg="whiteAlpha.200"
        borderRadius={compact ? "sm" : "md"}
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
        {!compact && (
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
        )}
      </Box>

      {/* Number below */}
      <Text
        fontSize={compact ? "7px" : "lg"}
        fontWeight="bold"
        color="var(--mr-text-primary)"
        className="mr-text-glow"
        lineHeight="1"
      >
        {value}
      </Text>
      {/* Label below number in compact mode */}
      {compact && (
        <Text
          fontSize="5px"
          color="var(--mr-text-secondary)"
          lineHeight="1"
          textTransform="uppercase"
        >
          {label.slice(0, 3)}
        </Text>
      )}
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
  compact = false,
}) => {
  return (
    <Box
      className="mr-card mr-card-purple"
      p={compact ? 1 : 4}
      w="100%"
      h={compact ? "130px" : "405px"}
      position="relative"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
    >
      <div className="mr-glow-bar mr-glow-bar-purple" />
      <div className="mr-scanlines" />

      <Center mb={compact ? 0 : 2}>
        <Text
          className="mr-badge mr-badge-purple"
          fontSize={compact ? "7px" : "sm"}
          lineHeight={compact ? "1" : "normal"}
        >
          Case Statistics
        </Text>
      </Center>

      <VStack spacing={compact ? 1 : 3} flex={1} justify="space-around">
        {/* Top Row - Claims and References (hide in compact) */}
        {!compact && (
          <>
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
          </>
        )}

        {/* Three Vertical Gauges */}
        <HStack spacing={compact ? 1 : 6} justify="center" w="100%" align="center">
          {compact && (
            <VStack spacing={0} align="center" mr={1}>
              <Text
                fontSize="14px"
                fontWeight="black"
                color="var(--mr-purple)"
                lineHeight="1"
                className="mr-text-glow"
              >
                {totalClaimLinks}
              </Text>
              <Text
                fontSize="5px"
                fontWeight="bold"
                color="var(--mr-text-secondary)"
                lineHeight="1"
                textTransform="uppercase"
                textAlign="center"
              >
                Links
              </Text>
            </VStack>
          )}
          <VerticalGauge
            label="SUPPORTS"
            value={verifiedClaims}
            total={totalClaimLinks}
            color="var(--mr-green)"
            compact={compact}
          />
          <VerticalGauge
            label="NUANCED"
            value={nuancedLinks}
            total={totalClaimLinks}
            color="var(--mr-yellow)"
            compact={compact}
          />
          <VerticalGauge
            label="REFUTES"
            value={verifiedReferences}
            total={totalClaimLinks}
            color="var(--mr-red)"
            compact={compact}
          />
        </HStack>
      </VStack>
    </Box>
  );
};

export default ProgressCard;
