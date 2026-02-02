import {
  Box,
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
import { useEffect } from "react";
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

  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <Text color="white" p={6}>
        Initializing user session...
      </Text>
    );
  }

  if (!user?.user_id) {
    return (
      <Text color="white" p={6}>
        Please log in...
      </Text>
    );
  }

  useEffect(() => {
    if (user?.user_id) {
      console.log(
        "🎯 VisionDashboard mounted — fetching for user",
        user.user_id
      );
      fetchTasksForUser(user.user_id);
    }
  }, [user?.user_id]);

  useEffect(() => {
    const tasks = selectedTask ? [selectedTask] : assignedTasks || [];
    tasks.forEach((task) => fetchClaims(task.content_id));
  }, [assignedTasks, selectedTask]);

  const tasksToRender = selectedTask ? [selectedTask] : assignedTasks || [];

  if (!user?.user_id) {
    return (
      <Text color="white" p={6}>
        Loading your dashboard...
      </Text>
    );
  }

  return (
    <Box className="mr-container" p={6} minH="100vh">
      <div className="mr-content">
        <Box w="100%">
          <TopStatsPanel
            tasks={tasksToRender}
            claimsByTask={claimsByTask}
            claimReferences={claimReferences}
            username={user?.username || ""}
          />
        </Box>

        {selectedTask && (
          <Box className="mr-card mr-card-blue" mb={6} mt={6} p={4} position="relative">
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
            <UnifiedHeader />
          </Box>
        )}

      <Flex
        direction={{ base: "column", lg: "row" }}
        gap={6}
        wrap="wrap"
        w="100%"
      >
        <VStack spacing={6} align="stretch" flex="1 1 60%">
          <Flex wrap="wrap" gap={4} width="100%" align="stretch">
            <Box flex={{ base: "1 1 100%", md: "1 1 45%" }} minW="260px">
              <Box className="mr-card mr-card-blue" height="100%" p={4} position="relative">
                <div className="mr-glow-bar mr-glow-bar-blue" />
                <div className="mr-scanlines" />
                <Box mb={4}>
                  <HStack>
                    <Heading size="md" className="mr-heading">
                      Assigned Tasks
                    </Heading>
                    <Button
                      className="mr-button"
                      size="sm"
                      onClick={() => setSelectedTask(null)}
                    >
                      Show All
                    </Button>
                  </HStack>
                </Box>
                <AssignedTaskGrid tasks={tasksToRender} />
              </Box>
            </Box>

            <Box flex={{ base: "1 1 100%", md: "1 1 50%" }} minW="300px">
              <VStack spacing={4} align="stretch">
                <Box className="mr-card mr-card-green" height="100%" p={4} position="relative">
                  <div className="mr-glow-bar mr-glow-bar-green" />
                  <div className="mr-scanlines" />
                  <MultiLineChart />
                </Box>

                <Box className="mr-card mr-card-yellow" height="145px" p={4} position="relative">
                  <div className="mr-glow-bar mr-glow-bar-yellow" />
                  <div className="mr-scanlines" />
                  <Heading size="md" className="mr-heading" mb={2}>
                    Trending Topics
                  </Heading>
                  <VStack align="start" spacing={1}>
                    <Text className="mr-text-secondary">
                      🔥 Spike in vaccine misinformation
                    </Text>
                    <Text className="mr-text-secondary">
                      📈 Claim #5842 cited by 19 users today
                    </Text>
                    <Text className="mr-text-secondary">
                      💬 "5G causes COVID" trending again
                    </Text>
                  </VStack>
                </Box>
              </VStack>
            </Box>
          </Flex>

          <Flex width="100%" wrap="wrap" gap={4}>
            <Box flex="1 1 100%" minW="300px">
              <TaskProjectsPanel />
            </Box>
          </Flex>
        </VStack>

        <VStack spacing={6} align="stretch" flex="1 1 35%" minW="300px">
          <Box className="mr-card mr-card-purple" p={4} position="relative">
            <div className="mr-glow-bar mr-glow-bar-purple" />
            <div className="mr-scanlines" />
            <Heading size="md" className="mr-heading" mb={4}>
              Your Claim Activity
            </Heading>
            <ClaimProgressChart
              assignedTasks={tasksToRender}
              claimsByTask={claimsByTask}
              claimReferences={claimReferences}
            />
          </Box>

          <Box className="mr-card mr-card-red" height="100%" p={4} position="relative">
            <div className="mr-glow-bar mr-glow-bar-red" />
            <div className="mr-scanlines" />
            <Heading size="md" className="mr-heading" mb={4}>
              Claims to Evaluate
            </Heading>
            <ClaimBoard
              tasks={tasksToRender}
              claimsByTask={claimsByTask}
              claimReferences={claimReferences}
              selectedTask={selectedTask}
            />
          </Box>
        </VStack>
      </Flex>
      </div>
    </Box>
  );
};

export default VisionDashboard;
