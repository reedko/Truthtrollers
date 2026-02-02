import React from "react";
import {
  Box,
  Text,
  VStack,
  HStack,
  Progress,
  Grid,
  GridItem,
  Flex,
} from "@chakra-ui/react";

// Mock data for demo
const TIERS = [
  { name: "Myth Buster", badge: "🔍", minPoints: 0, color: "#60a5fa" },
  { name: "Data Diver", badge: "📊", minPoints: 1000, color: "#a78bfa" },
  { name: "Master of Truth", badge: "⚖️", minPoints: 5000, color: "#fbbf24" },
  { name: "Oh Wise One", badge: "🧙", minPoints: 10000, color: "#4ade80" },
];

const CURRENT_USER = {
  username: "TruthSeeker42",
  points: 12450,
  tier: "Oh Wise One",
  badge: "🧙",
  truthScore: 98.5,
};

const USERS_TO_RATE = [
  { id: 1, username: "FactChecker99", tier: "Master of Truth", badge: "⚖️", truthScore: 87.2 },
  { id: 2, username: "ScienceGuru", tier: "Data Diver", badge: "📊", truthScore: 92.8 },
  { id: 3, username: "LogicMaster", tier: "Oh Wise One", badge: "🧙", truthScore: 95.4 },
  { id: 4, username: "EvidenceHunter", tier: "Master of Truth", badge: "⚖️", truthScore: 89.6 },
  { id: 5, username: "ReasonRebel", tier: "Data Diver", badge: "📊", truthScore: 84.3 },
];

const ASSIGNED_TASKS = [
  { id: 1, title: "Evaluate COVID-19 Vaccine Claims", points: 150, difficulty: "Hard" },
  { id: 2, title: "Review Climate Change Evidence", points: 200, difficulty: "Expert" },
  { id: 3, title: "Assess Political Statement Accuracy", points: 100, difficulty: "Medium" },
  { id: 4, title: "Verify Scientific Paper Claims", points: 175, difficulty: "Hard" },
  { id: 5, title: "Fact-Check Social Media Posts", points: 75, difficulty: "Easy" },
];

const LevelPage: React.FC = () => {
  const currentTierIndex = TIERS.findIndex((t) => t.name === CURRENT_USER.tier);
  const currentTier = TIERS[currentTierIndex];
  const nextTier = TIERS[currentTierIndex + 1];
  const pointsInCurrentTier = CURRENT_USER.points - currentTier.minPoints;
  const pointsToNext = nextTier
    ? nextTier.minPoints - CURRENT_USER.points
    : 0;
  const progressPercent = nextTier
    ? ((CURRENT_USER.points - currentTier.minPoints) /
        (nextTier.minPoints - currentTier.minPoints)) *
      100
    : 100;

  return (
    <Box p={6} minH="100vh">
      <VStack spacing={6} align="stretch" maxW="1400px" mx="auto">
        {/* Hero Card - Current User Status */}
        <Box
          className="mr-card mr-card-green"
          p={6}
          position="relative"
          overflow="hidden"
        >
          <div className="mr-glow-bar mr-glow-bar-green" />
          <div className="mr-scanlines" />

          <VStack spacing={4} align="stretch" position="relative" zIndex={2}>
            <HStack justify="space-between" align="center">
              <HStack spacing={4}>
                <Text fontSize="6xl">{CURRENT_USER.badge}</Text>
                <VStack align="start" spacing={1}>
                  <Text
                    className="mr-text-primary"
                    fontSize="2xl"
                    fontWeight="bold"
                  >
                    {CURRENT_USER.username}
                  </Text>
                  <HStack>
                    <Text className="mr-badge mr-badge-green" px={3} py={1}>
                      {CURRENT_USER.tier}
                    </Text>
                    <Text className="mr-text-secondary" fontSize="lg">
                      {CURRENT_USER.points.toLocaleString()} Points
                    </Text>
                  </HStack>
                </VStack>
              </HStack>

              <Box
                className="mr-card"
                p={4}
                minW="200px"
                textAlign="center"
              >
                <Text className="mr-text-secondary" fontSize="sm" mb={1}>
                  Truth Score
                </Text>
                <Text
                  fontSize="4xl"
                  fontWeight="bold"
                  color="#4ade80"
                  textShadow="0 0 20px rgba(74, 222, 128, 0.5)"
                >
                  {CURRENT_USER.truthScore}%
                </Text>
              </Box>
            </HStack>

            {nextTier && (
              <Box mt={4}>
                <HStack justify="space-between" mb={2}>
                  <Text className="mr-text-secondary" fontSize="sm">
                    Progress to {nextTier.name} {nextTier.badge}
                  </Text>
                  <Text className="mr-text-secondary" fontSize="sm">
                    {pointsToNext.toLocaleString()} points remaining
                  </Text>
                </HStack>
                <Progress
                  value={progressPercent}
                  size="lg"
                  borderRadius="full"
                  bg="rgba(0, 0, 0, 0.4)"
                  sx={{
                    "& > div": {
                      background: `linear-gradient(90deg, ${currentTier.color}, ${nextTier.color})`,
                      boxShadow: `0 0 20px ${nextTier.color}`,
                    },
                  }}
                />
              </Box>
            )}
          </VStack>
        </Box>

        {/* All Tiers Overview */}
        <Box
          className="mr-card mr-card-blue"
          p={6}
          position="relative"
          overflow="hidden"
        >
          <div className="mr-glow-bar mr-glow-bar-blue" />
          <div className="mr-scanlines" />

          <Box position="relative" zIndex={2}>
            <Text
              className="mr-text-primary"
              fontSize="xl"
              fontWeight="bold"
              mb={4}
            >
              📊 Ranking Tiers
            </Text>

            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
              gap={4}
            >
              {TIERS.map((tier, index) => {
                const isCurrentTier = tier.name === CURRENT_USER.tier;
                const isUnlocked = CURRENT_USER.points >= tier.minPoints;

                return (
                  <GridItem key={tier.name}>
                    <Box
                      className="mr-card"
                      p={4}
                      textAlign="center"
                      border={isCurrentTier ? "2px solid" : "1px solid"}
                      borderColor={
                        isCurrentTier
                          ? tier.color
                          : "rgba(100, 116, 139, 0.3)"
                      }
                      background={
                        isCurrentTier
                          ? `${tier.color}20`
                          : "rgba(0, 0, 0, 0.3)"
                      }
                      opacity={isUnlocked ? 1 : 0.5}
                      position="relative"
                      overflow="hidden"
                    >
                      {isCurrentTier && (
                        <Box
                          position="absolute"
                          top={0}
                          left={0}
                          w="full"
                          h="2px"
                          background={tier.color}
                          boxShadow={`0 0 10px ${tier.color}`}
                        />
                      )}
                      <Text fontSize="4xl" mb={2}>
                        {tier.badge}
                      </Text>
                      <Text
                        className="mr-text-primary"
                        fontWeight="bold"
                        mb={1}
                      >
                        {tier.name}
                      </Text>
                      <Text className="mr-text-secondary" fontSize="xs">
                        {tier.minPoints.toLocaleString()}+ points
                      </Text>
                      {isCurrentTier && (
                        <Text
                          fontSize="xs"
                          color={tier.color}
                          mt={2}
                          fontWeight="bold"
                          textTransform="uppercase"
                          letterSpacing="wider"
                        >
                          Current Tier
                        </Text>
                      )}
                    </Box>
                  </GridItem>
                );
              })}
            </Grid>
          </Box>
        </Box>

        <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={6}>
          {/* Users to Rate */}
          <GridItem>
            <Box
              className="mr-card mr-card-purple"
              p={6}
              position="relative"
              overflow="hidden"
              h="full"
            >
              <div className="mr-glow-bar mr-glow-bar-purple" />
              <div className="mr-scanlines" />

              <Box position="relative" zIndex={2}>
                <Text
                  className="mr-text-primary"
                  fontSize="xl"
                  fontWeight="bold"
                  mb={4}
                >
                  👥 Rate Other Users
                </Text>

                <VStack spacing={3} align="stretch">
                  {USERS_TO_RATE.map((user) => (
                    <Box
                      key={user.id}
                      className="mr-card"
                      p={3}
                      cursor="pointer"
                      transition="all 0.3s ease"
                      _hover={{
                        background: "rgba(139, 92, 246, 0.1)",
                        transform: "translateX(4px)",
                      }}
                    >
                      <HStack justify="space-between">
                        <HStack spacing={3}>
                          <Text fontSize="2xl">{user.badge}</Text>
                          <VStack align="start" spacing={0}>
                            <Text
                              className="mr-text-primary"
                              fontWeight="bold"
                            >
                              {user.username}
                            </Text>
                            <Text className="mr-text-secondary" fontSize="xs">
                              {user.tier}
                            </Text>
                          </VStack>
                        </HStack>

                        <VStack spacing={0} align="end">
                          <Text
                            className="mr-text-primary"
                            fontSize="lg"
                            fontWeight="bold"
                          >
                            {user.truthScore}%
                          </Text>
                          <Text className="mr-text-secondary" fontSize="xs">
                            Truth Score
                          </Text>
                        </VStack>
                      </HStack>
                    </Box>
                  ))}
                </VStack>
              </Box>
            </Box>
          </GridItem>

          {/* Assigned Tasks */}
          <GridItem>
            <Box
              className="mr-card mr-card-yellow"
              p={6}
              position="relative"
              overflow="hidden"
              h="full"
            >
              <div className="mr-glow-bar mr-glow-bar-yellow" />
              <div className="mr-scanlines" />

              <Box position="relative" zIndex={2}>
                <Text
                  className="mr-text-primary"
                  fontSize="xl"
                  fontWeight="bold"
                  mb={4}
                >
                  🎯 Tasks to Level Up
                </Text>

                <VStack spacing={3} align="stretch">
                  {ASSIGNED_TASKS.map((task) => {
                    const difficultyColor =
                      task.difficulty === "Expert"
                        ? "#ef4444"
                        : task.difficulty === "Hard"
                        ? "#f59e0b"
                        : task.difficulty === "Medium"
                        ? "#eab308"
                        : "#4ade80";

                    return (
                      <Box
                        key={task.id}
                        className="mr-card"
                        p={3}
                        cursor="pointer"
                        transition="all 0.3s ease"
                        _hover={{
                          background: "rgba(234, 179, 8, 0.1)",
                          transform: "translateX(4px)",
                        }}
                      >
                        <VStack align="stretch" spacing={2}>
                          <HStack justify="space-between">
                            <Text
                              className="mr-text-primary"
                              fontWeight="bold"
                              flex={1}
                              noOfLines={2}
                            >
                              {task.title}
                            </Text>
                          </HStack>

                          <HStack justify="space-between">
                            <HStack spacing={2}>
                              <Box
                                px={2}
                                py={1}
                                borderRadius="md"
                                background={`${difficultyColor}20`}
                                border="1px solid"
                                borderColor={difficultyColor}
                              >
                                <Text
                                  fontSize="xs"
                                  fontWeight="bold"
                                  color={difficultyColor}
                                >
                                  {task.difficulty}
                                </Text>
                              </Box>
                            </HStack>

                            <HStack spacing={1}>
                              <Text
                                className="mr-text-primary"
                                fontSize="lg"
                                fontWeight="bold"
                                color="#fbbf24"
                              >
                                +{task.points}
                              </Text>
                              <Text className="mr-text-secondary" fontSize="xs">
                                pts
                              </Text>
                            </HStack>
                          </HStack>
                        </VStack>
                      </Box>
                    );
                  })}
                </VStack>

                <Box
                  mt={4}
                  p={3}
                  background="rgba(234, 179, 8, 0.1)"
                  borderRadius="md"
                  border="1px solid rgba(234, 179, 8, 0.3)"
                >
                  <HStack justify="space-between">
                    <Text className="mr-text-secondary" fontSize="sm">
                      Complete all tasks to earn
                    </Text>
                    <Text
                      className="mr-text-primary"
                      fontSize="xl"
                      fontWeight="bold"
                      color="#fbbf24"
                    >
                      +700 pts
                    </Text>
                  </HStack>
                </Box>
              </Box>
            </Box>
          </GridItem>
        </Grid>
      </VStack>
    </Box>
  );
};

export default LevelPage;
