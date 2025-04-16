// src/components/MultiLineChart.tsx
import { Box, Heading } from "@chakra-ui/react";
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
  return (
    <Box w="100%" h="280px" p={4}>
      <Heading size="md" color="teal.200" mb={3}>
        Claim Status Over Time
      </Heading>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" />
          <XAxis dataKey="name" stroke="#A0AEC0" />
          <YAxis stroke="#A0AEC0" />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="verified"
            stroke="#38B2AC"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="pending"
            stroke="#E53E3E"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default MultiLineChart;
