// src/components/MultiLineChart.tsx
import { Box, Heading, useColorModeValue } from "@chakra-ui/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const data = [
  { name: "Day 1", verified: 4, pending: 8 },
  { name: "Day 2", verified: 6, pending: 6 },
  { name: "Day 3", verified: 9, pending: 5 },
  { name: "Day 4", verified: 12, pending: 4 },
  { name: "Day 5", verified: 14, pending: 2 },
];

const MultiLineChart = () => {
  const headingColor = useColorModeValue("teal.600", "teal.200");
  const gridColor = useColorModeValue("#cbd5e0", "#2D3748");
  const axisColor = useColorModeValue("#4a5568", "#A0AEC0");
  const verifiedColor = useColorModeValue("#38a169", "#38B2AC");
  const pendingColor = useColorModeValue("#e53e3e", "#E53E3E");

  return (
    <Box w="100%" h="280px" p={4}>
      <Heading size="md" color={headingColor} mb={3}>
        Claim Status Over Time
      </Heading>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" stroke={axisColor} />
          <YAxis stroke={axisColor} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="verified"
            stroke={verifiedColor}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="pending"
            stroke={pendingColor}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default MultiLineChart;
