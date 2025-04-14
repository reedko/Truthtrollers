// src/components/charts/ClaimProgressChart.tsx

import { Box, Heading } from "@chakra-ui/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from "recharts";
import { useTaskStore } from "../store/useTaskStore";

const ClaimProgressChart: React.FC = () => {
  const tasks = useTaskStore((s) => s.content);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);

  const data = tasks.map((task) => {
    const claims = claimsByTask[task.content_id] || [];

    let verified = 0;
    let unverified = 0;

    for (const claim of claims) {
      const refs = claimReferences[claim.claim_id] || [];
      const isVerified =
        refs.length > 0 && refs.every((r) => r.supportLevel >= 0.5);
      isVerified ? verified++ : unverified++;
    }

    return {
      name:
        task.content_name.slice(0, 15) +
        (task.content_name.length > 15 ? "…" : ""),
      verified,
      unverified,
    };
  });

  return (
    <Box w="100%">
      <Heading size="sm" mb={2}>
        Claim Verification Progress
      </Heading>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 50 }}>
          <XAxis type="number" />
          <YAxis dataKey="name" type="category" width={100} />
          <Tooltip />
          <Legend />
          <Bar dataKey="verified" stackId="a" fill="#38A169">
            <LabelList dataKey="verified" position="insideRight" fill="#fff" />
          </Bar>
          <Bar dataKey="unverified" stackId="a" fill="#E53E3E">
            <LabelList
              dataKey="unverified"
              position="insideRight"
              fill="#fff"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default ClaimProgressChart;
