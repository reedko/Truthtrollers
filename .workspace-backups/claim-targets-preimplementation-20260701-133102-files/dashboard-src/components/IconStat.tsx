// src/components/IconStat.tsx
import {
  Box,
  Stat,
  StatLabel,
  StatNumber,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";

interface IconStatProps {
  label: string;
  value: string | number;
  icon: string; // emoji or string
}

const IconStat: React.FC<IconStatProps> = ({ label, value, icon }) => {
  return (
    <Stat
      p={4}
      borderRadius="xl"
      shadow="md"
      bg="cardGradient"
      color="white"
      w="100px"
      h="60px"
    >
      <HStack justify="space-between">
        <VStack>
          <StatLabel fontSize="sm" color="gray.300" mt={-2}>
            {label}
          </StatLabel>
          <Text fontSize="2xl" role="img" aria-label={label} mt={-2} ml={-5}>
            {icon}
          </Text>
        </VStack>
        <Box textAlign="right" ml={-5}>
          <StatNumber fontSize="lg">{value}</StatNumber>
        </Box>
      </HStack>
    </Stat>
  );
};

export default IconStat;
