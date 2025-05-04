// VisionDashboard.tsx (Refactored Layout)
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
    if (user?.user_id) fetchTasksForUser(user.user_id);
  }, [user?.user_id]);

  useEffect(() => {
    const tasks = selectedTask ? [selectedTask] : assignedTasks || [];
    tasks.forEach((task) => fetchClaims(task.content_id));
  }, [assignedTasks, selectedTask]);

  const tasksToRender = selectedTask ? [selectedTask] : assignedTasks || [];

  return (
    <Box p={6} minH="100vh">
      <Card w="100%" bg="transparent" boxShadow="none">
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

      <Flex
        direction={{ base: "column", lg: "row" }}
        gap={6}
        wrap="wrap"
        w="100%"
      >
        {/* Left Column */}
        <VStack spacing={6} align="stretch" flex="1 1 60%">
          <Flex wrap="wrap" gap={4} width="100%" align="stretch">
            <Box flex={{ base: "1 1 100%", md: "1 1 45%" }} minW="260px">
              <Card height="100%" bg="stackGradient">
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

            <Box flex={{ base: "1 1 100%", md: "1 1 50%" }} minW="300px">
              <VStack spacing={4} align="stretch">
                <Card height="100%" bg="stat2Gradient">
                  <CardBody>
                    <MultiLineChart />
                  </CardBody>
                </Card>

                <Card height="145px">
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
            </Box>
          </Flex>

          <Flex width="100%" wrap="wrap" gap={4}>
            <Box flex="1 1 100%" minW="300px">
              <TaskProjectsPanel />
            </Box>
          </Flex>
        </VStack>

        {/* Right Column */}
        <VStack spacing={6} align="stretch" flex="1 1 35%" minW="300px">
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
        </VStack>
      </Flex>
    </Box>
  );
};

export default VisionDashboard;
