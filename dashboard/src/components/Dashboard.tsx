// Updated VisionDashboard.tsx
import {
  Box,
  Grid,
  Heading,
  Text,
  VStack,
  Card,
  CardHeader,
  CardBody,
  Button,
  HStack,
  Flex,
} from "@chakra-ui/react";

import { useEffect, useMemo } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { useDashboardStore } from "../store/useDashboardStore";

import AssignedTaskGrid from "./AssignedTaskGrid";
import ClaimProgressChart from "./ClaimProgressChart";
import ClaimBoard from "./ClaimBoard";
import UnifiedHeader from "./UnifiedHeader";
import TopStatsPanel from "./TopStatsPanel";
import MultiLineChart from "./MultiLineChart";
import TaskProjectsPanel from "./TaskProjectsPanel";

const VisionDashboard: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedTasks = useTaskStore((s) => s.assignedTasks);
  const fetchClaims = useTaskStore((s) => s.fetchClaims);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

  useEffect(() => {
    if (user?.user_id) {
      fetchTasksForUser(user.user_id);
    }
  }, [user?.user_id]);

  useEffect(() => {
    const safeAssignedTasks = Array.isArray(assignedTasks) ? assignedTasks : [];
    const tasksToCheck = selectedTask ? [selectedTask] : safeAssignedTasks;
    tasksToCheck.forEach((task) => {
      fetchClaims(task.content_id);
    });
  }, [assignedTasks, selectedTask]);

  const verificationTasks = useMemo(() => {
    const tasksToCheck = selectedTask
      ? [selectedTask]
      : Array.isArray(assignedTasks)
      ? assignedTasks
      : [];
    const result: any[] = [];
    for (const task of tasksToCheck) {
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
          });
        }
      }
    }
    return result;
  }, [assignedTasks, selectedTask, claimsByTask, claimReferences]);

  const tasksToRender = selectedTask
    ? [selectedTask]
    : Array.isArray(assignedTasks)
    ? assignedTasks
    : [];

  return (
    <Box p={6} minH="100vh">
      <Card>
        <CardBody>
          <TopStatsPanel
            tasks={tasksToRender}
            claimsByTask={claimsByTask}
            claimReferences={claimReferences}
            username={user?.username || ""}
          />
        </CardBody>
      </Card>

      {selectedTask && (
        <Card mb={6} mt={6}>
          <CardBody>
            <UnifiedHeader />
          </CardBody>
        </Card>
      )}

      <Grid templateColumns={{ base: "1fr", md: "2fr 1fr" }} gap={6}>
        <VStack spacing={6} align="stretch" width="full">
          <Flex width="full" gap={4} align="start">
            <Box maxW="425px" flexShrink={0}>
              <Card bg="stackGradient">
                <CardHeader>
                  <HStack>
                    <Heading size="md" color="teal.200">
                      Assigned Tasks
                    </Heading>
                    <Button
                      size="sm"
                      colorScheme="teal"
                      variant="outline"
                      onClick={() => setSelectedTask(null)}
                    >
                      Show All
                    </Button>
                  </HStack>
                </CardHeader>
                <CardBody>
                  <AssignedTaskGrid tasks={tasksToRender} />
                </CardBody>
              </Card>
            </Box>

            <VStack>
              <Box flex="1">
                <Card width="600px" height="100%" bg="stat2Gradient">
                  <CardBody>
                    <MultiLineChart />
                  </CardBody>
                </Card>
              </Box>
              <Card width="600px" height="145px">
                <CardHeader>
                  <Heading size="md" color="teal.200" mb={-10}>
                    Trending Topics
                  </Heading>
                </CardHeader>
                <CardBody>
                  <Text color="gray.300">
                    🔥 Spike in vaccine misinformation
                  </Text>
                  <Text color="gray.300">
                    📈 Claim #5842 cited by 19 users today
                  </Text>
                  <Text color="gray.300">
                    💬 “5G causes COVID” trending again
                  </Text>
                </CardBody>
              </Card>
            </VStack>
          </Flex>

          <Flex gap={4} align="start" width="100%">
            <Box width="1000px" flexShrink={0}>
              <TaskProjectsPanel />
            </Box>
          </Flex>
        </VStack>

        <VStack spacing={6} align="stretch">
          <Card bg="statGradient">
            <CardHeader>
              <Heading size="md" color="teal.200">
                Your Claim Activity
              </Heading>
            </CardHeader>
            <CardBody>
              <ClaimProgressChart
                assignedTasks={tasksToRender}
                claimsByTask={claimsByTask}
                claimReferences={claimReferences}
              />
            </CardBody>
          </Card>

          <Box flex="1">
            <Card height="100%" bg="gray.900">
              <CardHeader>
                <Heading size="md" color="teal.200">
                  Claims to Evaluate
                </Heading>
              </CardHeader>
              <CardBody>
                <ClaimBoard
                  tasks={tasksToRender}
                  claimsByTask={claimsByTask}
                  claimReferences={claimReferences}
                  selectedTask={selectedTask}
                />
              </CardBody>
            </Card>
          </Box>
        </VStack>
      </Grid>
    </Box>
  );
};

export default VisionDashboard;
