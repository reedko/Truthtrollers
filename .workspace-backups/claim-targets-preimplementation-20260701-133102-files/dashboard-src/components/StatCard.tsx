import { HStack, Spacer, Stat, StatLabel, StatNumber, Box } from "@chakra-ui/react";

interface StatCardProps {
  label: string;
  value: number | string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => (
  <Box className="mr-card mr-card-blue" p={2} px={3} py={1} w="full" position="relative">
    <div className="mr-glow-bar mr-glow-bar-blue" />
    <div className="mr-scanlines" />
    <Stat>
      <HStack>
        <StatLabel className="mr-metric-label">{label}</StatLabel>
        <Spacer />
        <StatNumber className="mr-metric-value">{value}</StatNumber>
      </HStack>
    </Stat>
  </Box>
);

export default StatCard;
