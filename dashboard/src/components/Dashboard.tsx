import {
  Box,
  Grid,
  Heading,
  VStack,
  Text,
  useToast,
  Divider,
} from "@chakra-ui/react";
import { useEffect, useMemo } from "react";

import UnifiedHeader from "./UnifiedHeader";
import ClaimProgressChart from "./ClaimProgressChart";
import AssignedTaskGrid from "./AssignedTaskGrid";
import DashboardSection from "./DashboardSection";

import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import ClaimBoard from "./ClaimBoard";

const Dashboard: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedTasks = useTaskStore((s) => s.content);
  const tasks = useTaskStore((s) => s.content);
  const fetchClaims = useTaskStore((s) => s.fetchClaims);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);
  const selectedTask = useTaskStore((s) => s.selectedTask); // ✅ Get selected task

  console.log("Assigned tasks", assignedTasks);
  console.log(user, ":users");
  // Fetch claims for assigned tasks
  useEffect(() => {
    if (user?.user_id) {
      fetchTasksForUser(user.user_id);
    }
  }, [user?.user_id]);

  useEffect(() => {
    assignedTasks.forEach((task) => {
      fetchClaims(task.content_id);
    });
  }, [assignedTasks]);
  console.log("Sample task.users:", tasks[0]?.users);
  // Build list of verification microtasks
  const verificationTasks = useMemo<
    {
      id: string;
      title: string;
      description: string;
      status: "urgent" | "pending" | "complete";
      actionLink?: string;
    }[]
  >(() => {
    const result: {
      id: string;
      title: string;
      description: string;
      status: "urgent" | "pending" | "complete";
      actionLink?: string;
    }[] = [];

    for (const task of assignedTasks) {
      const claims = claimsByTask[task.content_id] || [];

      for (const claim of claims) {
        const refs = claimReferences[claim.claim_id] || [];

        const needsVerification =
          refs.length === 0 || refs.some((r) => r.supportLevel < 0.5);

        if (needsVerification) {
          result.push({
            id: `verify-claim-${claim.claim_id}`,
            title: "Verify Claim",
            description: claim.claim_text,
            status: refs.length === 0 ? "urgent" : "pending",
            actionLink: `/workspace?focus=${claim.claim_id}`,
          });
        }
      }
    }

    return result;
  }, [assignedTasks, claimsByTask, claimReferences]);

  return (
    <>
      <Heading size="lg" mb={4}>
        Welcome, {user?.username} 👋
      </Heading>
      <Text mb={6} fontSize="md">
        Here's your Truthtroller dashboard. Track your tasks, verify claims, and
        rate references.
      </Text>

      <Box p={4}>
        <UnifiedHeader />

        <Grid templateColumns={{ base: "1fr", md: "2fr 1fr" }} gap={6}>
          {/* === LEFT PANEL === */}
          <VStack align="start" spacing={6}>
            <Heading size="md">Assigned Tasks</Heading>
            <AssignedTaskGrid tasks={assignedTasks} />

            <Heading size="md">Your Claim Activity</Heading>
            <ClaimProgressChart />
          </VStack>

          {/* === RIGHT PANEL === */}
          <VStack align="start" spacing={6}>
            <ClaimBoard />

            <Box>
              <Heading size="md" mb={2}>
                Trending Topics
              </Heading>
              <Box p={3} bg="gray.700" borderRadius="md">
                <Text>🔥 Spike in vaccine misinformation</Text>
                <Text>📈 Claim #5842 cited by 19 users today</Text>
                <Text>💬 “5G causes COVID” trending again</Text>
              </Box>
            </Box>
          </VStack>
        </Grid>

        {/* === CONDITIONAL: Task-specific Section === */}
        {selectedTask && (
          <Box mt={10} p={4} borderWidth="1px" borderRadius="lg" bg="gray.800">
            <Heading size="md" mb={4}>
              📌 Selected Task: {selectedTask.content_name}
            </Heading>
            <Text mb={2}>
              <strong>Progress:</strong> {selectedTask.progress}
            </Text>
            <Text mb={2}>
              <strong>Topic:</strong> {selectedTask.topic}
            </Text>
            <Text mb={2}>
              <strong>Subtopic:</strong> {selectedTask.subtopic}
            </Text>
            <Text mb={2}>
              <strong>Source:</strong> {selectedTask.media_source}
            </Text>
            <Text mb={2}>
              <strong>URL:</strong> {selectedTask.url}
            </Text>
            <Divider my={4} />
            <Text fontSize="sm" color="gray.400">
              More task-specific widgets (like references, claims,
              author/publisher info) can go here.
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
};

export default Dashboard;
