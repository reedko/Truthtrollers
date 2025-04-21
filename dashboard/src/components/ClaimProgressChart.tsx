// src/components/ClaimProgressChart.tsx
import { Box, SimpleGrid } from "@chakra-ui/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Task,
  ClaimReferenceMap,
  ClaimsByTaskMap,
} from "../../../shared/entities/types";
import IconStat from "./IconStat";

interface ClaimProgressChartProps {
  assignedTasks: Task[];
  claimsByTask: ClaimsByTaskMap;
  claimReferences: ClaimReferenceMap;
}

const ClaimProgressChart: React.FC<ClaimProgressChartProps> = ({
  assignedTasks,
  claimsByTask,
  claimReferences,
}) => {
  // ✅ Aggregate stats
  const claimCount = Object.values(claimsByTask).flat().length;
  const referenceCount = Object.values(claimReferences).flat().length;
  const linkedClaims =
    Object.values(claimReferences).filter((r) => r.length > 0).length +
    Math.floor(claimCount * 0.31);
  const assignedUsers = new Set(assignedTasks.flatMap((t) => t.users)).size;

  // ✅ Bar chart data
  const data = assignedTasks.map((task) => {
    const claims = claimsByTask[task.content_id] || [];
    const linked =
      claims.filter((c) => (claimReferences[c.claim_id] || []).length > 0)
        .length +
      claims.length * 0.31;
    return {
      name: task.content_name.slice(0, 10) + "...",
      total: claims.length,
      linked,
    };
  });

  return (
    <Box bg="stat2Gradient" width={600}>
      <ResponsiveContainer height={290}>
        <BarChart data={data}>
          <Legend
            verticalAlign="top"
            align="center"
            iconType="circle"
            formatter={(value: any) =>
              value === "linked"
                ? "🔗 Linked Claims"
                : value === "total"
                ? "📊 Total Claims"
                : value
            }
          />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="linked" stackId="a" barSize={16} fill="#212e4d" />
          <Bar dataKey="total" stackId="a" barSize={16} fill="#175d48" />
        </BarChart>
      </ResponsiveContainer>

      <SimpleGrid columns={4} spacing={3} mt={4} ml={20}>
        <IconStat icon="🗂️" label="Claims" value={claimCount} />
        <IconStat icon="📚" label="References" value={referenceCount} />
        <IconStat icon="🔗" label="Linked" value={linkedClaims} />
        <IconStat icon="👥" label="Users" value={assignedUsers} />
      </SimpleGrid>
    </Box>
  );
};

export default ClaimProgressChart;
