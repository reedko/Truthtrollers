import { HStack, Spacer, Stat, StatLabel, StatNumber } from "@chakra-ui/react";
import React from "react";

interface StatCardProps {
  label: string;
  value: number | string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => (
  <Stat
    p={2}
    px={3}
    py={1}
    borderRadius="2xl"
    shadow="md"
    color="white"
    bg="cardGradient"
    w="full"
  >
    <HStack>
      <StatLabel>{label}</StatLabel>
      <Spacer />
      <StatNumber>{value}</StatNumber>
    </HStack>
  </Stat>
);

export default StatCard;
