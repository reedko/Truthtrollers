// src/components/GlowGaugeTestHarness.tsx
import { Box, Heading, VStack } from "@chakra-ui/react";
import GlowGauge from "./ModernCircleGauge";
import BareGauge from "./BareGauge";

const GlowGaugeTestHarness = () => {
  return (
    <Box
      bg="gray.900"
      minH="100vh"
      p={8}
      display="flex"
      justifyContent="center"
      alignItems="center"
    >
      <VStack spacing={6}>
        <Heading size="lg" color="teal.300">
          GlowGauge Test
        </Heading>

        <Box
          bg="gray.800"
          borderRadius="xl"
          p={6}
          boxShadow="lg"
          width="300px"
          height="300px"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <BareGauge score={0.75} label={"DUMBSHOIT"} />
        </Box>
      </VStack>
    </Box>
  );
};

export default GlowGaugeTestHarness;
