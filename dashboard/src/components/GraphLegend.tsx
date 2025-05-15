// components/GraphLegend.tsx
import { Box, Flex, Text, HStack } from "@chakra-ui/react";

const colorCircle = (color: string) => (
  <Box
    width="14px"
    height="14px"
    borderRadius="full"
    bg={color}
    border="1px solid #333"
  />
);

const colorLine = (color: string) => (
  <Box
    height="4px"
    width="24px"
    borderRadius="2px"
    bg={color}
    border="1px solid #222"
  />
);

const GraphLegend = () => {
  return (
    <Box
      position="absolute"
      top="20px"
      left="12px"
      bg="stackGradient"
      border="2px solid #ccc"
      borderRadius="md"
      p={4}
      zIndex={10}
      boxShadow="lg"
      fontSize="sm"
      width="280px"
    >
      <Text fontWeight="bold" mb={2}>
        🧬 Legend
      </Text>

      <Flex justify="space-between" mb={2}>
        <Box>
          <Text fontWeight="semibold" mb={1}>
            Nodes
          </Text>
          <HStack>
            {colorCircle("#fab1a0")} <Text>Author</Text>
          </HStack>
          <HStack>
            {colorCircle("#6c5ce7")} <Text>Task</Text>
          </HStack>
          <HStack>
            {colorCircle("#00b894")} <Text>Reference</Text>
          </HStack>
        </Box>

        <Box>
          <Text fontWeight="semibold" mb={1}>
            Links
          </Text>
          <HStack>
            {colorLine("#f33")} <Text>Refutes</Text>
          </HStack>
          <HStack>
            {colorLine("#0f6")} <Text>Supports</Text>
          </HStack>
          <HStack>
            {colorLine("#39f")} <Text>Neutral</Text>
          </HStack>
        </Box>
      </Flex>
      <Text fontSize="sm" mt={2} color="white" textAlign="center">
        💡 Tip: Hold <strong>Shift</strong> and scroll to zoom the graph.
      </Text>
    </Box>
  );
};

export default GraphLegend;
