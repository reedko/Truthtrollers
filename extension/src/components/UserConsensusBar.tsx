import { Box, Flex, Text, VStack } from "@chakra-ui/react";
import React, { useEffect, useState } from "react";

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

  return (
    <VStack spacing={2} w="100%" align="stretch">
      {/* Header */}
      <Text
        fontSize="md"
        fontWeight="bold"
        color="gray.200"
        textAlign="center"
        mb={1}
      >
        USER RATINGS
      </Text>

      {/* TRUE */}
      <Box
        bg="cardGradient"
        borderRadius="lg"
        px={2}
        py={0}
        w="100%"
        overflow="hidden"
      >
        <Flex align="center" gap={0} w="100%" maxW="600px" mx="auto">
          <Text
            fontWeight="bold"
            w="60px"
            whiteSpace="nowrap"
            color="green.300"
          >
            TRUE
          </Text>
          <Box flex="1" bg="gray.700" borderRadius="md" overflow="hidden">
            <Box
              w={`${truePercent.toFixed(1)}%`}
              bg="green.400"
              height="12px"
              borderRadius="0"
              transition="width 0.8s ease"
            />
          </Box>
          <Text
            w="60px"
            textAlign="right"
            fontSize="sm"
            color="gray.300"
            whiteSpace="nowrap"
          >
            {trueCount} / {total}
          </Text>
        </Flex>
      </Box>

      {/* FALSE */}
      <Box
        bg="cardGradient"
        borderRadius="lg"
        px={2}
        py={0}
        w="100%"
        overflow="hidden"
      >
        <Flex align="center" gap={0} w="100%" maxW="600px" mx="auto">
          <Text fontWeight="bold" w="60px" whiteSpace="nowrap" color="red.300">
            FALSE
          </Text>
          <Box flex="1" bg="gray.700" borderRadius="md" overflow="hidden">
            <Box
              w={`${falsePercent.toFixed(1)}%`}
              bg="red.400"
              height="12px"
              borderRadius="0"
              transition="width 0.8s ease"
            />
          </Box>
          <Text
            w="60px"
            textAlign="right"
            fontSize="sm"
            color="gray.300"
            whiteSpace="nowrap"
          >
            {falseCount} / {total}
          </Text>
        </Flex>
      </Box>
    </VStack>
  );
};

export default UserConsensusBar;
