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

  const triangleLeft = (color: string) => (
    <Box
      w="0"
      h="0"
      borderTop="5px solid transparent"
      borderBottom="5px solid transparent"
      borderLeft={`8px solid ${color}`}
      filter={`drop-shadow(0 0 2px ${color})`}
    />
  );

  const triangleRight = (color: string) => (
    <Box
      w="0"
      h="0"
      borderTop="5px solid transparent"
      borderBottom="5px solid transparent"
      borderRight={`8px solid ${color}`}
      filter={`drop-shadow(0 0 2px ${color})`}
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
      className="mr-card mr-card-blue"
      bg="rgba(3,10,24,0.78)"
      border="1px solid rgba(113,219,255,0.22)"
      borderRadius="24px"
      p={4}
      zIndex={10}
      boxShadow="0 18px 54px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
      fontSize="sm"
      width="320px"
      overflow="visible"
    >
      <Text fontSize="11px" fontWeight="900" letterSpacing="0.12em" color="#71dbff" textTransform="uppercase" mb={3}>
        Legend
      </Text>

      <Flex justify="space-between" gap={5}>
        <Box>
          <Text fontSize="10px" fontWeight="800" color="var(--mr-text-primary)" mb={1}>
            Nodes
          </Text>
          <HStack spacing={2}>
            {colorCircle("#fab1a0")} <Text color="var(--mr-text-muted)">Author</Text>
          </HStack>
          <HStack spacing={2}>
            {colorCircle("#6c5ce7")} <Text color="var(--mr-text-muted)">Case</Text>
          </HStack>
          <HStack spacing={2}>
            {colorCircle("#00b894")} <Text color="var(--mr-text-muted)">Source</Text>
          </HStack>
          <HStack spacing={2}>
            {triangleLeft("#f59e0b")} <Text color="var(--mr-text-muted)" fontSize="xs">Case Claim</Text>
          </HStack>
          <HStack spacing={2}>
            {triangleRight("#ec4899")} <Text color="var(--mr-text-muted)" fontSize="xs">Source Claim</Text>
          </HStack>
        </Box>

        <Box>
          <Text fontSize="10px" fontWeight="800" color="var(--mr-text-primary)" mb={1}>
            Links
          </Text>
          <HStack spacing={2}>
            {colorLine("#f33")} <Text color="var(--mr-text-muted)">Refutes</Text>
          </HStack>
          <HStack spacing={2}>
            {colorLine("#0f6")} <Text color="var(--mr-text-muted)">Supports</Text>
          </HStack>
          <HStack spacing={2}>
            {colorLine("#39f")} <Text color="var(--mr-text-muted)">Neutral</Text>
          </HStack>
        </Box>
      </Flex>
      <Text fontSize="10px" mt={3} color="var(--mr-text-muted)" textAlign="center">
        Hold Shift and scroll to zoom the graph.
      </Text>
    </Box>
  );
};

export default GraphLegend;
