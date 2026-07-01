// src/components/Beacon/TrollSupportBar.tsx
import { Box, Flex, Text, VStack } from "@chakra-ui/react";

interface TrollSupportBarProps {
  value: number;
  label: string;
  color?: string;
}

const TrollSupportBar: React.FC<TrollSupportBarProps> = ({
  value,
  label,
  color = "#999",
}) => {
  const ghostLeft = value - 1;
  const ghostRight = value + 1;

  return (
    <VStack spacing={1} align="center" w="100%">
      <Text fontWeight="bold" fontSize="sm">
        {label}
      </Text>

      {/* Bar with ticks and value */}
      <Box
        position="relative"
        w="200px"
        h="32px"
        bg={color}
        borderRadius="10px"
        overflow="hidden"
        boxShadow="inset 0 0 4px rgba(0,0,0,0.4)"
      >
        {/* Tick marks */}
        <Flex
          position="absolute"
          top="6px"
          left="0"
          w="100%"
          h="20px"
          justify="space-between"
          zIndex={1}
        >
          {[...Array(5)].map((_, idx) => (
            <Box
              key={idx}
              w="1px"
              h="16px"
              bg="blackAlpha.600"
              borderRadius="1px"
            />
          ))}
        </Flex>

        {/* Center needle */}
        <Box
          position="absolute"
          top="2px"
          left="50%"
          transform="translateX(-50%)"
          w="2px"
          h="28px"
          bg="black"
          zIndex={2}
        />

        {/* Number labels inside bar */}
        <Flex
          w="100%"
          h="100%"
          align="center"
          justify="space-around"
          zIndex={3}
          position="relative"
        >
          <Text color="whiteAlpha.600" fontSize="sm">
            {ghostLeft}
          </Text>
          <Text color="white" fontSize="md" fontWeight="bold">
            {value}
          </Text>
          <Text color="whiteAlpha.600" fontSize="sm">
            {ghostRight}
          </Text>
        </Flex>
      </Box>
    </VStack>
  );
};

export default TrollSupportBar;
