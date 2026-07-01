// src/components/UserDashboard.tsx
// Clean, functional dashboard showing user's work queue
import React, { useEffect, useState } from "react";
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Card,
  CardBody,
  Badge,
  Button,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  SimpleGrid,
  useToast,
  Grid,
  GridItem,
  Image,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import VisionTheme from "./themes/VisionTheme";
import ClaimProgressChart from "./ClaimProgressChart";
import { fetchBulkClaimsAndReferences } from "../services/useDashboardAPI";
import { EvaluationTaskPanel } from "./EvaluationTaskPanel";
import SourceCrest from "./SourceCrest";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";
import SourceDetailModal from "./modals/SourceDetailModal";
import type { Publisher } from "../../../shared/entities/types";

interface Task {
  content_id: number;
  content_name: string;
  url: string;
  thumbnail: string | null;
  media_source: string | null;
  created_at: string;
  claimCount?: number;
  evaluatedCount?: number;
}

interface UserStats {
  tasksEvaluated: number;
  claimsEvaluated: number;
  ratingsGiven: number;
  honestyScore: number;
}

const UserDashboard: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const toast = useToast();
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedTasks = useTaskStore((s) => s.assignedTasks);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const publishersByTask = useTaskStore((s) => s.publishers);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<UserStats>({
    tasksEvaluated: 0,
    claimsEvaluated: 0,
    ratingsGiven: 0,
    honestyScore: 0,
  });
  const [loading, setLoading] = useState(true);
  const [claimsLoaded, setClaimsLoaded] = useState(false);
  const [sourceDetailPublisher, setSourceDetailPublisher] = useState<Publisher | null>(null);

  useEffect(() => {
    if (user?.user_id) {
      fetchUserTasks();
      fetchUserStats();
      fetchTasksForUser(user.user_id, false);
    }
  }, [user?.user_id, fetchTasksForUser]);

  // Fetch claims and claim references for all assigned tasks IN ONE BULK CALL
  useEffect(() => {
    const fetchClaimsAndReferences = async () => {
      if (claimsLoaded || assignedTasks.length === 0 || !viewerId) return;

      const startTime = Date.now();
      console.log("[UserDashboard] Bulk fetching claims and references for", assignedTasks.length, "tasks, viewerId:", viewerId);

      try {
        // Fetch ALL claims and references in ONE call
        const taskIds = assignedTasks.map((task) => task.content_id);
        const result = await fetchBulkClaimsAndReferences(taskIds, viewerId);

        console.log("[UserDashboard] Bulk fetch completed in", Date.now() - startTime, "ms");
        console.log("[UserDashboard] Received:",
          Object.keys(result.claimsByTask).length, "tasks with claims,",
          Object.keys(result.claimReferences).length, "claims with references"
        );

        // Update the store with the fetched data
        useTaskStore.setState({
          claimsByTask: { ...useTaskStore.getState().claimsByTask, ...result.claimsByTask },
          claimReferences: { ...useTaskStore.getState().claimReferences, ...result.claimReferences }
        });

        setClaimsLoaded(true);
      } catch (error) {
        console.error("[UserDashboard] Error fetching claims:", error);
      }
    };

    fetchClaimsAndReferences();
  }, [assignedTasks.length, claimsLoaded, viewerId]);

  const fetchUserTasks = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/user-tasks/${user?.user_id}`
      );
      const data = await response.json();
      setTasks(data || []);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
      toast({
        title: "Error loading tasks",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkComplete = async (contentId: number) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/mark-task-complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contentId,
            userId: user?.user_id,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to mark task complete");
      }

      toast({
        title: "Case marked complete!",
        description: "The extension will now show this case when you visit the URL",
        status: "success",
        duration: 4000,
      });

      // Remove the task from the local list
      setTasks(tasks.filter((t) => t.content_id !== contentId));
    } catch (error) {
      console.error("Failed to mark task complete:", error);
      toast({
        title: "Error marking task complete",
        status: "error",
        duration: 3000,
      });
    }
  };

  const fetchUserStats = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/user-stats/${user?.user_id}`
      );
      const data = await response.json();
      if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  if (!user?.user_id) {
    return (
      <Box p={8}>
        <Text className="mr-text-primary">Please log in to view your dashboard.</Text>
      </Box>
    );
  }

  return (
    <>
    <Box className="mr-container" p={6} minH="100vh">
      <div className="mr-content">
        <Box w="100%" maxW="1400px" mx="auto">

          {/* Welcome Hero Section */}
          <Grid
            templateColumns={{
              base: "1fr",
              lg: "1fr 2fr",
            }}
            gap={6}
            mb={6}
          >
            {/* Left Column: Welcome + Trending Topics */}
            <GridItem>
              <VStack spacing={6} height="100%" className="user-dashboard-stats">
                {/* Welcome Card */}
                <Card
                  height="240px"
                  borderRadius="2xl"
                  overflow="hidden"
                  boxShadow="xl"
                  bg="stackGradient"
                  position="relative"
                  width="100%"
                >
                  <CardBody
                    display="flex"
                    flexDirection="row"
                    justifyContent="space-between"
                    alignItems="center"
                    height="100%"
                    px={6}
                    py={4}
                    bgGradient="linear(to-r, rgba(0,0,0,0.6), rgba(0,0,0,0.2))"
                  >
                    <Box maxW="55%">
                      <Heading size="md" mb={2} color="teal.200">
                        Welcome, {user.username} 👋
                      </Heading>
                      <Text fontSize="sm" color="gray.200" mb={3}>
                        Track tasks, verify claims, rate references
                      </Text>
                      <HStack spacing={4}>
                        <VStack align="start" spacing={0}>
                          <Text fontSize="xs" color="gray.400">TASKS</Text>
                          <Text fontSize="xl" fontWeight="bold" color="teal.200">
                            {assignedTasks.length}
                          </Text>
                        </VStack>
                        <VStack align="start" spacing={0}>
                          <Text fontSize="xs" color="gray.400">ACCURACY</Text>
                          <Text fontSize="xl" fontWeight="bold" color="green.300">
                            {stats.honestyScore}%
                          </Text>
                        </VStack>
                      </HStack>
                    </Box>

                    <Box
                      maxW="180px"
                      height="100%"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <img
                        src={`${VisionTheme.textures.backgroundImage}`}
                        alt="The Truth is Sweet"
                        style={{ maxHeight: "100%", maxWidth: "100%" }}
                      />
                    </Box>
                  </CardBody>
                </Card>

                {/* Trending Topics */}
                <Box className="mr-card mr-card-yellow" flex="1" p={4} position="relative" width="100%">
                  <div className="mr-glow-bar mr-glow-bar-yellow" />
                  <div className="mr-scanlines" />
                  <Box position="relative" zIndex={1}>
                    <Heading size="sm" className="mr-heading" mb={3}>
                      Trending Topics
                    </Heading>
                    <VStack align="start" spacing={2}>
                      <Text className="mr-text-secondary" fontSize="sm">
                        🔥 Spike in vaccine misinformation
                      </Text>
                      <Text className="mr-text-secondary" fontSize="sm">
                        📈 Claim #5842 cited by 19 users today
                      </Text>
                      <Text className="mr-text-secondary" fontSize="sm">
                        💬 "5G causes COVID" trending again
                      </Text>
                    </VStack>
                  </Box>
                </Box>
              </VStack>
            </GridItem>

            {/* Claim Activity Chart */}
            <GridItem>
              <Box className="mr-card mr-card-purple claim-activity-chart" p={4} position="relative" height="100%">
                <div className="mr-glow-bar mr-glow-bar-purple" />
                <div className="mr-scanlines" />
                <Box position="relative" zIndex={1}>
                  <Heading size="md" className="mr-heading" mb={4}>
                    Your Claim Activity
                  </Heading>
                  <ClaimProgressChart
                    assignedTasks={assignedTasks}
                    claimsByTask={claimsByTask}
                    claimReferences={claimReferences}
                  />
                </Box>
              </Box>
            </GridItem>
          </Grid>

          {/* ── Workflow Task Lanes ──────────────────────────────────────── */}
          <VStack spacing={6} align="stretch">

          {/* Lane 1 — Build Evidence Links */}
          <Box className="mr-card mr-card-blue assigned-tasks-section" position="relative" p={6}>
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
            <Box position="relative" zIndex={1}>
              <HStack justify="space-between" mb={1}>
                <Heading size="md" className="mr-heading">
                  Build Evidence Links
                </Heading>
                <Badge bg="var(--mr-blue-border)" color="var(--mr-blue)" fontSize="xs" px={2}>
                  {assignedTasks.length} cases
                </Badge>
              </HStack>
              <Text className="mr-text-muted" fontSize="xs" mb={4}>
                Select a case and open it in Workspace or CaseFocus to add supporting &amp; refuting evidence.
              </Text>
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3, xl: 4 }} spacing={6} maxH="700px" overflowY="auto" px={2}>
                    {assignedTasks.length === 0 ? (
                      <Box gridColumn="span 2" textAlign="center" py={8}>
                        <Text className="mr-text-secondary" fontSize="lg" mb={3}>
                          No tasks assigned yet
                        </Text>
                        <Text className="mr-text-muted" fontSize="sm" mb={4}>
                          Go to the Tasks page to get some work assigned!
                        </Text>
                        <Button
                          className="mr-button"
                          size="sm"
                          onClick={() => navigate("/tasks")}
                        >
                          Browse Tasks →
                        </Button>
                      </Box>
                    ) : (
                      assignedTasks.map((task) => {
                        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

                        return (
                          <Box
                            key={task.content_id}
                            className="mr-card mr-card-blue"
                            position="relative"
                            borderRadius="xl"
                            overflow="hidden"
                            aspectRatio="2.5/3.5"
                            maxW="220px"
                            minH="280px"
                            _hover={{
                              transform: "translateY(-8px) scale(1.02)",
                              boxShadow: "0 12px 48px var(--mr-blue-glow)",
                            }}
                            transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                            cursor="pointer"
                          >
                            <div className="mr-glow-bar mr-glow-bar-blue" />

                            {/* Card Content */}
                            <VStack
                              align="stretch"
                              spacing={0}
                              height="100%"
                              position="relative"
                              zIndex={1}
                              p={3}
                            >
                              {/* Thumbnail - Top Section */}
                              <Box
                                flex="1"
                                mb={2}
                                borderRadius="lg"
                                overflow="hidden"
                                bg="var(--mr-bg-tertiary)"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                              >
                                {task.thumbnail ? (
                                  <Image
                                    src={`${API_BASE_URL}/api/image/content/${task.content_id}`}
                                    alt={task.content_name}
                                    w="100%"
                                    h="100%"
                                    objectFit="cover"
                                    fallback={
                                      <Box
                                        w="100%"
                                        h="100%"
                                        bg="var(--mr-purple-border)"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                      >
                                        <Text fontSize="4xl" color="var(--mr-purple)" fontWeight="bold">
                                          {task.media_source?.[0] || "T"}
                                        </Text>
                                      </Box>
                                    }
                                  />
                                ) : (
                                  <Box
                                    w="100%"
                                    h="100%"
                                    bg="var(--mr-purple-border)"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                  >
                                    <Text fontSize="4xl" color="var(--mr-purple)" fontWeight="bold">
                                      {task.media_source?.[0] || "T"}
                                    </Text>
                                  </Box>
                                )}
                              </Box>

                              {/* Title */}
                              <Text
                                className="mr-text-primary"
                                fontSize="xs"
                                fontWeight="bold"
                                noOfLines={2}
                                minH="32px"
                                mb={1}
                                textAlign="center"
                              >
                                {task.content_name}
                              </Text>

                              {/* Source Badge + Crest */}
                              {(() => {
                                const pub = publishersByTask[task.content_id]?.[0];
                                const profile = normalizeSourceProfile({
                                  publisher_name: pub?.publisher_name ?? task.media_source ?? undefined,
                                  media_source: task.media_source ?? undefined,
                                  source_type: pub?.source_type ?? undefined,
                                });
                                return (
                                  <HStack justify="center" spacing={2} mb={2} flexWrap="wrap">
                                    <SourceCrest
                                      publisherName={pub?.publisher_name ?? task.media_source ?? ""}
                                      sourceType={profile.sourceType}
                                      reliability={profile.reliability}
                                      admiraltyCode={pub?.admiralty_code ?? undefined}
                                      alignment={pub?.alignment_marker ? {
                                        marker: pub.alignment_marker,
                                        label: pub.alignment_marker === "GOV" ? "Government source" : "Institutionally aligned",
                                        riskScore: pub.alignment_risk_score,
                                      } : null}
                                      size="sm"
                                      onClick={(e) => { e?.stopPropagation(); if (pub) setSourceDetailPublisher(pub); }}
                                    />
                                    {task.media_source && (
                                      <Badge
                                        fontSize="2xs"
                                        bg="var(--mr-purple-border)"
                                        color="var(--mr-purple)"
                                        textAlign="center"
                                      >
                                        {task.media_source}
                                      </Badge>
                                    )}
                                  </HStack>
                                );
                              })()}

                              {/* Destination Buttons */}
                              <VStack spacing={1} w="100%">
                                <Button
                                  className="mr-button"
                                  size="xs"
                                  w="100%"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTask(task);
                                    navigate("/workspace");
                                  }}
                                  bg="var(--mr-blue)"
                                  color="black"
                                  _hover={{ bg: "var(--mr-blue-border)", transform: "scale(1.05)" }}
                                  fontSize="2xs"
                                  fontWeight="bold"
                                >
                                  Workspace →
                                </Button>
                                <Button
                                  className="mr-button"
                                  size="xs"
                                  w="100%"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTask(task);
                                    navigate("/casefocus");
                                  }}
                                  bg="var(--mr-purple-border)"
                                  color="var(--mr-purple)"
                                  _hover={{ bg: "var(--mr-purple)", color: "black", transform: "scale(1.05)" }}
                                  fontSize="2xs"
                                  fontWeight="bold"
                                >
                                  CaseFocus →
                                </Button>
                              </VStack>
                            </VStack>
                          </Box>
                        );
                      })
                    )}
                  </SimpleGrid>
            </Box>
          </Box>

          {/* Lane 2 — Evaluate User Ratings (peer review) */}
          <EvaluationTaskPanel />

          {/* Lane 3 — Check Source Credibility */}
          <Box className="mr-card mr-card-yellow" position="relative" p={6}>
            <div className="mr-glow-bar mr-glow-bar-yellow" />
            <div className="mr-scanlines" />
            <Box position="relative" zIndex={1}>
              <HStack justify="space-between" mb={1}>
                <Heading size="md" className="mr-heading">
                  Check Source Credibility
                </Heading>
              </HStack>
              <Text className="mr-text-muted" fontSize="xs" mb={4}>
                Rate authors and publishers, check bias and veracity. Use Molecule to visualise the source graph.
              </Text>
              <HStack spacing={4} flexWrap="wrap">
                <Button
                  className="mr-button"
                  size="sm"
                  bg="var(--mr-yellow-border, rgba(255,200,0,0.15))"
                  color="var(--mr-yellow, #f5c518)"
                  _hover={{ bg: "var(--mr-yellow, #f5c518)", color: "black" }}
                  onClick={() => navigate("/credibility")}
                >
                  Rate Authors &amp; Publishers →
                </Button>
                <Button
                  className="mr-button"
                  size="sm"
                  bg="var(--mr-green-border, rgba(0,255,160,0.15))"
                  color="var(--mr-green)"
                  _hover={{ bg: "var(--mr-green)", color: "black" }}
                  onClick={() => navigate("/molecule")}
                >
                  Open Molecule View →
                </Button>
              </HStack>
            </Box>
          </Box>

          </VStack>
          {/* ── End Workflow Task Lanes ───────────────────────────────────── */}

          {/* Legacy Task Tabs — hidden, kept until safe to delete */}
          <Box className="mr-card mr-card-blue" position="relative" p={6} display="none">
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
            <Box position="relative" zIndex={1}>
              <Tabs colorScheme="blue" variant="enclosed">
                <TabList borderColor="var(--mr-blue-border)">
                  <Tab
                    className="mr-text-primary"
                    _selected={{
                      bg: "var(--mr-blue-border)",
                      color: "var(--mr-blue)",
                      borderColor: "var(--mr-blue)"
                    }}
                  >
                    Tasks to Evaluate ({tasks.length})
                  </Tab>
                  <Tab
                    className="mr-text-primary"
                    _selected={{
                      bg: "var(--mr-green-border)",
                      color: "var(--mr-green)",
                      borderColor: "var(--mr-green)"
                    }}
                  >
                    Claims to Review
                  </Tab>
                  <Tab
                    className="mr-text-primary"
                    _selected={{
                      bg: "var(--mr-purple-border)",
                      color: "var(--mr-purple)",
                      borderColor: "var(--mr-purple)"
                    }}
                  >
                    Rate Other Users
                  </Tab>
                  <Tab
                    className="mr-text-primary"
                    _selected={{
                      bg: "var(--mr-yellow-border)",
                      color: "var(--mr-yellow)",
                      borderColor: "var(--mr-yellow)"
                    }}
                  >
                    Authors to Assess
                  </Tab>
                </TabList>

                <TabPanels>
                  {/* Tasks Tab */}
                  <TabPanel>
                    <VStack spacing={4} align="stretch">
                      <HStack justify="space-between" mb={2}>
                        <Heading size="md" className="mr-heading">Tasks Needing Evaluation</Heading>
                        <Badge
                          colorScheme="blue"
                          fontSize="md"
                          px={3}
                          py={1}
                          bg="var(--mr-blue-border)"
                          color="var(--mr-blue)"
                        >
                          {tasks.length} pending
                        </Badge>
                      </HStack>

                      {loading ? (
                        <Text className="mr-text-secondary">Loading tasks...</Text>
                      ) : tasks.length === 0 ? (
                        <Box textAlign="center" py={12}>
                          <Text className="mr-text-secondary" fontSize="lg" mb={2}>
                            No tasks to evaluate right now. Great job!
                          </Text>
                          <Text className="mr-text-muted" fontSize="sm">
                            Check back later for new assignments
                          </Text>
                        </Box>
                      ) : (
                        <VStack spacing={3} align="stretch">
                          {tasks.map((task) => (
                            <Box
                              key={task.content_id}
                              className="mr-card mr-card-blue"
                              p={4}
                              position="relative"
                              cursor="pointer"
                              onClick={() => navigate(`/workspace/${task.content_id}`)}
                              _hover={{
                                transform: "translateY(-4px)",
                                boxShadow: "0 12px 48px var(--mr-blue-glow)",
                              }}
                              transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                            >
                              <div className="mr-glow-bar mr-glow-bar-blue" />
                              <HStack justify="space-between" position="relative" zIndex={1}>
                                <VStack align="start" spacing={2} flex={1}>
                                  <HStack spacing={3}>
                                    <Heading size="sm" className="mr-heading" noOfLines={1}>
                                      {task.content_name}
                                    </Heading>
                                    {task.media_source && (
                                      <Badge
                                        colorScheme="purple"
                                        fontSize="xs"
                                        bg="var(--mr-purple-border)"
                                        color="var(--mr-purple)"
                                      >
                                        {task.media_source}
                                      </Badge>
                                    )}
                                  </HStack>
                                  <Text className="mr-text-secondary" fontSize="sm" noOfLines={1}>
                                    {task.url}
                                  </Text>
                                  <HStack spacing={4} fontSize="xs" className="mr-text-muted">
                                    <Text>{task.claimCount || 0} claims</Text>
                                    <Text>{task.evaluatedCount || 0} evaluated</Text>
                                  </HStack>
                                </VStack>
                                <HStack spacing={2}>
                                  <Button
                                    className="mr-button"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkComplete(task.content_id);
                                    }}
                                    bg="var(--mr-green-border)"
                                    color="var(--mr-green)"
                                    _hover={{
                                      bg: "var(--mr-green)",
                                      color: "black",
                                    }}
                                  >
                                    ✓ Complete
                                  </Button>
                                  <Button
                                    className="mr-button"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/workspace/${task.content_id}`);
                                    }}
                                    bg="var(--mr-blue-border)"
                                    color="var(--mr-blue)"
                                    _hover={{
                                      bg: "var(--mr-blue)",
                                      color: "black",
                                    }}
                                  >
                                    Evaluate →
                                  </Button>
                                </HStack>
                              </HStack>
                            </Box>
                          ))}
                        </VStack>
                      )}
                    </VStack>
                  </TabPanel>

                  {/* Claims Tab */}
                  <TabPanel>
                    <VStack spacing={4} align="stretch" py={8}>
                      <Heading size="md" className="mr-heading">Claims to Review</Heading>
                      <Text className="mr-text-secondary">
                        Review extracted claims and their supporting evidence
                      </Text>
                      <Box textAlign="center" py={12}>
                        <Text className="mr-text-muted" mb={6} fontSize="lg">
                          Select a task to see its claims
                        </Text>
                        <Button
                          className="mr-button"
                          onClick={() => navigate("/workspace")}
                          bg="var(--mr-green-border)"
                          color="var(--mr-green)"
                          _hover={{
                            bg: "var(--mr-green)",
                            color: "black",
                          }}
                          size="lg"
                        >
                          Go to Workspace →
                        </Button>
                      </Box>
                    </VStack>
                  </TabPanel>

                  {/* Rate Other Users Tab */}
                  <TabPanel>
                    <VStack spacing={4} align="stretch" py={8}>
                      <Heading size="md" className="mr-heading">Evaluate Rating Performance</Heading>
                      <Text className="mr-text-secondary">
                        Review your rating history and see how you compare to AI assessments
                      </Text>
                      <Box textAlign="center" py={12}>
                        <VStack spacing={6}>
                          <Box className="mr-card mr-card-purple" p={6} maxW="400px">
                            <div className="mr-glow-bar mr-glow-bar-purple" />
                            <VStack spacing={4} position="relative" zIndex={1}>
                              <Text className="mr-text-primary" fontSize="lg" fontWeight="bold">
                                Your Performance Stats
                              </Text>
                              <SimpleGrid columns={2} spacing={6} w="100%">
                                <VStack spacing={0}>
                                  <Text className="mr-text-muted" fontSize="xs">AVG SCORE</Text>
                                  <Text className="mr-text-primary" fontSize="2xl" fontWeight="bold" color="var(--mr-green)">
                                    {stats.honestyScore}
                                  </Text>
                                </VStack>
                                <VStack spacing={0}>
                                  <Text className="mr-text-muted" fontSize="xs">RATINGS</Text>
                                  <Text className="mr-text-primary" fontSize="2xl" fontWeight="bold" color="var(--mr-blue)">
                                    {stats.ratingsGiven}
                                  </Text>
                                </VStack>
                              </SimpleGrid>
                            </VStack>
                          </Box>
                          <Button
                            className="mr-button"
                            onClick={() => navigate("/evaluate-ratings")}
                            bg="var(--mr-purple-border)"
                            color="var(--mr-purple)"
                            _hover={{
                              bg: "var(--mr-purple)",
                              color: "black",
                            }}
                            size="lg"
                          >
                            View Detailed History →
                          </Button>
                        </VStack>
                      </Box>
                    </VStack>
                  </TabPanel>

                  {/* Authors Tab */}
                  <TabPanel>
                    <VStack spacing={4} align="stretch" py={8}>
                      <Heading size="md" className="mr-heading">Authors to Assess</Heading>
                      <Text className="mr-text-secondary">
                        Evaluate author credibility and track record
                      </Text>
                      <Box textAlign="center" py={12}>
                        <Text className="mr-text-muted" fontSize="lg">
                          Author assessment coming soon
                        </Text>
                      </Box>
                    </VStack>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Box>
          </Box>

        </Box>
      </div>

    </Box>

      {sourceDetailPublisher && (() => {
        const profile = normalizeSourceProfile({ publisher_name: sourceDetailPublisher.publisher_name });
        return (
          <SourceDetailModal
            isOpen={!!sourceDetailPublisher}
            onClose={() => setSourceDetailPublisher(null)}
            publisherId={sourceDetailPublisher.publisher_id}
            publisherName={sourceDetailPublisher.publisher_name}
            sourceType={profile.sourceType}
            reliability={profile.reliability}
          />
        );
      })()}
    </>
  );
};

export default UserDashboard;
