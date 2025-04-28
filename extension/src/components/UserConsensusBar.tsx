// UserConsensusBar.tsx
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
    <Box ml="45px">
      <VStack spacing={2} align="center" h="180px" justify="center" mt="-10px">
        <Text fontSize="md" color="white" mb={5} ml={"-45px"}>
          CROWD
        </Text>

        <HStack spacing={2} align="center" h="120px" w="100px" mt="-10px">
          {/* FALSE VStack */}
          <VStack spacing={1} align="center">
            {/* FALSE Bar */}
            <Box
              position="relative"
              w="20px"
              h="100px"
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

            {/* FALSE Numbers */}
            <VStack spacing={0} align="center" mt="0px">
              <Text
                fontSize="sm"
                fontWeight="bold"
                color={isFalseWinner ? "red.300" : "gray.300"}
              >
                {falseCount}
              </Text>
              <Box h="1px" w="70%" bg="white" my="0px" />
              <Text fontSize="sm" color="gray.400">
                {total}
              </Text>
            </VStack>
          </VStack>

          {/* TRUE VStack */}
          <VStack spacing={1} align="center">
            {/* TRUE Bar */}
            <Box
              position="relative"
              w="20px"
              h="100px"
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

            {/* TRUE Numbers */}
            <VStack spacing={0} align="center" mt="0px">
              <Text
                fontSize="sm"
                fontWeight="bold"
                color={isTrueWinner ? "green.300" : "gray.300"}
              >
                {trueCount}
              </Text>
              <Box h="1px" w="70%" bg="white" my="1px" />
              <Text fontSize="sm" color="gray.400">
                {total}
              </Text>
            </VStack>
          </VStack>
        </HStack>
      </VStack>
    </Box>
  );
};

export default UserConsensusBar;
