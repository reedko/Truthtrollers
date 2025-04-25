// Updated UserConsensusBar: tighter layout for ticks, thinner bars
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import React, { useEffect, useState } from "react";
import "./UserConsensusBar.css";

interface UserConsensusBarProps {
  trueCount: number;
  falseCount: number;
  total: number;
}

const UserConsensusBar: React.FC<UserConsensusBarProps> = ({
  trueCount,
  falseCount,
  total,
}) => {
  const [truePercent, setTruePercent] = useState(0);
  const [falsePercent, setFalsePercent] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const safeTotal = total > 0 ? total : 1;
      setTruePercent((trueCount / safeTotal) * 100);
      setFalsePercent((falseCount / safeTotal) * 100);
    }, 100);

    return () => clearTimeout(timeout);
  }, [trueCount, falseCount, total]);

  const isTrueWinner = truePercent > falsePercent;
  const isFalseWinner = falsePercent > truePercent;

  const renderVerticalLabel = (text: string) => (
    <VStack spacing={0} zIndex={1} pointerEvents="none">
      {text.split("").map((char, idx) => (
        <Text
          key={idx}
          fontSize="2xs"
          fontWeight="bold"
          color="white"
          lineHeight="1"
        >
          {char}
        </Text>
      ))}
    </VStack>
  );

  return (
    <Box ml={"40px"}>
      <VStack
        spacing={4}
        align="center"
        h="140px"
        justify="center"
        mt={"-10px"}
      >
        <Text fontSize="2xs" color="gray.400" mb={1} ml={"-10px"}>
          USER CONSENSUS
        </Text>

        <HStack spacing={3} align="center" h="100px" w="90px">
          {/* FALSE Bar */}
          <Box
            position="relative"
            w="20px"
            h="100%"
            bg="gray.700"
            borderRadius="md"
            overflow="hidden"
            className={isFalseWinner ? "pulsing-glow false" : ""}
          >
            <Box
              position="absolute"
              bottom="0"
              left="0"
              w="full"
              h={`${falsePercent.toFixed(1)}%`}
              bg="red.400"
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
              {renderVerticalLabel("FALSE")}
            </Box>
          </Box>

          {/* TRUE Bar */}
          <Box
            position="relative"
            w="20px"
            h="100%"
            bg="gray.700"
            borderRadius="md"
            overflow="hidden"
            className={isTrueWinner ? "pulsing-glow true" : ""}
          >
            <Box
              position="absolute"
              bottom="0"
              left="0"
              w="full"
              h={`${truePercent.toFixed(1)}%`}
              bg="green.400"
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
              {renderVerticalLabel("TRUE")}
            </Box>
          </Box>
        </HStack>
      </VStack>
    </Box>
  );
};

export default UserConsensusBar;
