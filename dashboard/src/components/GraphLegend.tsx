// components/GraphLegend.tsx
import { Box, Flex, Text, HStack, useColorMode } from "@chakra-ui/react";

const GraphLegend = () => {
  const { colorMode } = useColorMode();

  const colorCircle = (color: string, small?: boolean) => (
    <Box
      width={small ? "7px" : "14px"}
      height={small ? "7px" : "14px"}
      borderRadius="full"
      bg={color}
      border="1px solid"
      borderColor={colorMode === "dark" ? "gray.700" : "gray.400"}
    />
  );

  const colorLine = (color: string) => (
    <Box
      height="4px"
      width="24px"
      borderRadius="2px"
      bg={color}
      border="1px solid"
      borderColor={colorMode === "dark" ? "gray.700" : "gray.400"}
    />
  );

  return (
    <Box
      position="absolute"
      top="20px"
      left="12px"
      bg={colorMode === "dark"
        ? "radial-gradient(circle at 75% 80%, rgba(136, 230, 196, 0.31), rgb(2, 0, 36))"
        : "linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(241, 245, 249, 0.98) 100%)"}
      border="2px solid"
      borderColor={colorMode === "dark" ? "gray.600" : "gray.300"}
      borderRadius="md"
      p={4}
      zIndex={10}
      boxShadow={colorMode === "dark" ? "lg" : "0 4px 16px rgba(71, 85, 105, 0.25)"}
      fontSize="sm"
      width="320px"
    >
      <Text fontWeight="bold" mb={2} color={colorMode === "dark" ? "gray.100" : "gray.800"}>
        🧬 Legend
      </Text>

      <Flex justify="space-between" mb={2} gap={4}>
        <Box>
          <Text fontWeight="semibold" mb={1} color={colorMode === "dark" ? "gray.100" : "gray.800"}>
            Nodes
          </Text>
          <HStack>
            {colorCircle("#fab1a0")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Author</Text>
          </HStack>
          <HStack>
            {colorCircle("#6c5ce7")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Case</Text>
          </HStack>
          <HStack>
            {colorCircle("#00b894")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Source</Text>
          </HStack>
          <HStack>
            {colorCircle("#f59e0b", true)} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"} fontSize="xs">Case Claim</Text>
          </HStack>
          <HStack>
            {colorCircle("#ec4899", true)} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"} fontSize="xs">Source Claim</Text>
          </HStack>
        </Box>

        <Box>
          <Text fontWeight="semibold" mb={1} color={colorMode === "dark" ? "gray.100" : "gray.800"}>
            Links
          </Text>
          <HStack>
            {colorLine("#f33")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Refutes</Text>
          </HStack>
          <HStack>
            {colorLine("#0f6")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Supports</Text>
          </HStack>
          <HStack>
            {colorLine("#39f")} <Text color={colorMode === "dark" ? "gray.200" : "gray.700"}>Neutral</Text>
          </HStack>
        </Box>
      </Flex>
      <Text fontSize="sm" mt={2} color={colorMode === "dark" ? "gray.200" : "gray.700"} textAlign="center">
        💡 Tip: Hold <strong>Shift</strong> and scroll to zoom the graph.
      </Text>
    </Box>
  );
};

export default GraphLegend;
