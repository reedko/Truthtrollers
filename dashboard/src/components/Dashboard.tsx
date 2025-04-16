import {
  Box,
  Grid,
  Heading,
  Text,
  VStack,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Card,
  CardHeader,
  CardBody,
  Button,
  HStack,
  Flex,
  GridItem,
} from "@chakra-ui/react";
import StatCard from "./StatCard";
import { useEffect, useMemo } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import AssignedTaskGrid from "./AssignedTaskGrid";
import ClaimProgressChart from "./ClaimProgressChart";
import ClaimBoard from "./ClaimBoard";
import UnifiedHeader from "./UnifiedHeader";
import VisionTheme from "./themes/VisionTheme";
import TopStatsPanel from "./TopStatsPanel";
import GlowGaugeTestHarness from "./TestHarness";
import MultiLineChart from "./MultiLineChart";
import TaskProjectsPanel from "./TaskProjectsPanel";

const VisionDashboard: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedTasks = useTaskStore((s) => s.content);
  const fetchClaims = useTaskStore((s) => s.fetchClaims);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

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

  const verificationTasks = useMemo(() => {
    const result: any[] = [];
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
          });
        }
      }
    }
    return result;
  }, [assignedTasks, claimsByTask, claimReferences]);

  return (
    <Box p={6} minH="100vh">
      <Card>
        <CardBody>
          <TopStatsPanel />
        </CardBody>
      </Card>

      <Card mb={6} mt={6}>
        <CardBody>
          <UnifiedHeader />
        </CardBody>
      </Card>

      <Grid templateColumns={{ base: "1fr", md: "2fr 1fr" }} gap={6}>
        <VStack spacing={6} align="stretch" width="full">
          <Flex width="full" gap={4} align="start">
            {/* Left: Fixed Width Assigned Tasks */}
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
                  <AssignedTaskGrid tasks={assignedTasks} />
                </CardBody>
              </Card>
            </Box>

            {/* Right: Fill remaining space with Chart */}
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
          </Flex>{" "}
          <Flex gap={4} align="start" width="100%">
            {/* Left: TaskProjectsPanel */}
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
              <ClaimProgressChart />
            </CardBody>
          </Card>
          {/* Right: ClaimBoard */}
          <Box flex="1">
            <Card height="100%" bg="gray.900">
              <CardHeader>
                <Heading size="md" color="teal.200">
                  Claims to Evaluate
                </Heading>
              </CardHeader>
              <CardBody>
                <ClaimBoard />
              </CardBody>
            </Card>
          </Box>
        </VStack>
      </Grid>
    </Box>
  );
};

export default VisionDashboard;
