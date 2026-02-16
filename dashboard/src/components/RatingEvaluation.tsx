// src/components/RatingEvaluation.tsx
// Page for viewing rating history and performance with Minority Report styling
import React, { useEffect, useState } from "react";
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  SimpleGrid,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Progress,
  useToast,
  Button,
  Grid,
  GridItem,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";
import TruthGauge from "./ModernArcGauge";
import GlowGauge from "./ModernCircleGauge";

interface RatingRecord {
  user_claim_rating_id: number;
  reference_claim_id: number;
  task_claim_id: number;
  user_quality_rating: number;
  ai_quality_rating: number | null;
  ai_stance: string | null;
  honesty_score: number | null;
  created_at: string;
}

interface PerformanceStats {
  totalRatings: number;
  averageHonestyScore: number;
  perfectScores: number;
  closeCalls: number;
  significantGaps: number;
}

const RatingEvaluation: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const toast = useToast();

  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [stats, setStats] = useState<PerformanceStats>({
    totalRatings: 0,
    averageHonestyScore: 0,
    perfectScores: 0,
    closeCalls: 0,
    significantGaps: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.user_id) {
      fetchRatingHistory();
    }
  }, [user?.user_id]);

  const fetchRatingHistory = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/user-rating-history/${user?.user_id}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch rating history");
      }

      const data = await response.json();
      setRatings(data || []);

      if (data && data.length > 0) {
        const totalRatings = data.length;
        const ratingsWithScores = data.filter((r: RatingRecord) => r.honesty_score !== null);

        const averageHonestyScore = ratingsWithScores.length > 0
          ? ratingsWithScores.reduce((sum: number, r: RatingRecord) => sum + (r.honesty_score || 0), 0) / ratingsWithScores.length
          : 0;

        const perfectScores = data.filter((r: RatingRecord) => r.honesty_score === 100).length;

        const closeCalls = data.filter((r: RatingRecord) => {
          if (!r.ai_quality_rating) return false;
          const gap = Math.abs(r.user_quality_rating - r.ai_quality_rating);
          return gap <= 10;
        }).length;

        const significantGaps = data.filter((r: RatingRecord) => {
          if (!r.ai_quality_rating) return false;
          const gap = Math.abs(r.user_quality_rating - r.ai_quality_rating);
          return gap > 30;
        }).length;

        setStats({
          totalRatings,
          averageHonestyScore: Math.round(averageHonestyScore),
          perfectScores,
          closeCalls,
          significantGaps,
        });
      }
    } catch (error) {
      console.error("Failed to fetch rating history:", error);
      toast({
        title: "Error loading ratings",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const getStanceColor = (stance: string | null) => {
    switch (stance) {
      case "support":
        return "var(--mr-green)";
      case "refute":
        return "var(--mr-red)";
      case "nuance":
        return "var(--mr-purple)";
      case "insufficient":
        return "var(--mr-text-muted)";
      default:
        return "var(--mr-text-muted)";
    }
  };

  if (!user?.user_id) {
    return (
      <Container maxW="container.xl" py={8}>
        <Text className="mr-text-primary">Please log in to view your rating history.</Text>
      </Container>
    );
  }

  // Normalize for gauges
  const honestyNormalized = stats.averageHonestyScore / 100;
  const perfectScoreRatio = stats.totalRatings > 0 ? stats.perfectScores / stats.totalRatings : 0;
  const closeCallsRatio = stats.totalRatings > 0 ? stats.closeCalls / stats.totalRatings : 0;

  return (
    <Box className="mr-container" p={6} minH="100vh">
      <div className="mr-content">
        <Box w="100%" maxW="1400px" mx="auto">

          {/* Header */}
          <Box className="mr-card mr-card-blue" p={6} position="relative" mb={6}>
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
            <VStack align="start" spacing={4} position="relative" zIndex={1}>
              <Button
                className="mr-button"
                onClick={() => navigate("/dashboard")}
                bg="var(--mr-blue-border)"
                color="var(--mr-blue)"
                _hover={{
                  bg: "var(--mr-blue)",
                  color: "black",
                }}
                size="sm"
              >
                ← Back to Dashboard
              </Button>
              <Box>
                <Heading size="xl" className="mr-heading" mb={2}>
                  Rating Performance Analysis
                </Heading>
                <Text className="mr-text-secondary" fontSize="lg">
                  Track your accuracy and compare with AI assessments
                </Text>
              </Box>
            </VStack>
          </Box>

          {/* Performance Overview */}
          <Grid
            templateColumns={{
              base: "1fr",
              md: "repeat(2, 1fr)",
              lg: "1fr 1fr 1fr",
            }}
            gap={6}
            mb={6}
          >
            {/* Average Honesty Score Gauge */}
            <GridItem>
              <Box className="mr-card mr-card-green" p={6} position="relative" height="100%">
                <div className="mr-glow-bar mr-glow-bar-green" />
                <div className="mr-scanlines" />
                <VStack position="relative" zIndex={1} spacing={4} height="100%" justify="center">
                  <Heading size="sm" className="mr-heading">
                    Average Honesty Score
                  </Heading>
                  <TruthGauge
                    score={honestyNormalized}
                    label="Accuracy"
                    size={{ w: "100%", h: 160 }}
                  />
                  <VStack spacing={0}>
                    <Text className="mr-text-primary" fontSize="3xl" fontWeight="bold" color="var(--mr-green)">
                      {stats.averageHonestyScore}
                    </Text>
                    <Text className="mr-text-muted" fontSize="xs">
                      OUT OF 100
                    </Text>
                  </VStack>
                </VStack>
              </Box>
            </GridItem>

            {/* Perfect Scores Gauge */}
            <GridItem>
              <Box className="mr-card mr-card-purple" p={6} position="relative" height="100%">
                <div className="mr-glow-bar mr-glow-bar-purple" />
                <div className="mr-scanlines" />
                <VStack position="relative" zIndex={1} spacing={4} height="100%" justify="center">
                  <Heading size="sm" className="mr-heading">
                    Perfect Scores
                  </Heading>
                  <GlowGauge
                    score={perfectScoreRatio * 2 - 1}
                    label="Excellence"
                    size={{ w: 160, h: 140 }}
                    normalize={false}
                  />
                  <VStack spacing={0}>
                    <Text className="mr-text-primary" fontSize="3xl" fontWeight="bold" color="var(--mr-purple)">
                      {stats.perfectScores}
                    </Text>
                    <Text className="mr-text-muted" fontSize="xs">
                      100/100 RATINGS
                    </Text>
                  </VStack>
                </VStack>
              </Box>
            </GridItem>

            {/* Close Calls Gauge */}
            <GridItem>
              <Box className="mr-card mr-card-yellow" p={6} position="relative" height="100%">
                <div className="mr-glow-bar mr-glow-bar-yellow" />
                <div className="mr-scanlines" />
                <VStack position="relative" zIndex={1} spacing={4} height="100%" justify="center">
                  <Heading size="sm" className="mr-heading">
                    Close Calls
                  </Heading>
                  <GlowGauge
                    score={closeCallsRatio * 2 - 1}
                    label="Precision"
                    size={{ w: 160, h: 140 }}
                    normalize={false}
                  />
                  <VStack spacing={0}>
                    <Text className="mr-text-primary" fontSize="3xl" fontWeight="bold" color="var(--mr-yellow)">
                      {stats.closeCalls}
                    </Text>
                    <Text className="mr-text-muted" fontSize="xs">
                      WITHIN 10 POINTS
                    </Text>
                  </VStack>
                </VStack>
              </Box>
            </GridItem>
          </Grid>

          {/* Additional Stats */}
          <Grid
            templateColumns={{
              base: "1fr",
              md: "repeat(2, 1fr)",
            }}
            gap={6}
            mb={6}
          >
            <GridItem>
              <Box className="mr-card mr-card-blue" p={6} position="relative">
                <div className="mr-glow-bar mr-glow-bar-blue" />
                <div className="mr-scanlines" />
                <HStack position="relative" zIndex={1} spacing={8} justify="space-around">
                  <VStack spacing={0}>
                    <Text className="mr-text-muted" fontSize="xs">TOTAL RATINGS</Text>
                    <Text className="mr-text-primary" fontSize="4xl" fontWeight="bold" color="var(--mr-blue)">
                      {stats.totalRatings}
                    </Text>
                  </VStack>
                  <VStack spacing={0}>
                    <Text className="mr-text-muted" fontSize="xs">LARGE GAPS</Text>
                    <Text className="mr-text-primary" fontSize="4xl" fontWeight="bold" color="var(--mr-red)">
                      {stats.significantGaps}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            </GridItem>

            <GridItem>
              <Box className="mr-card mr-card-purple" p={6} position="relative">
                <div className="mr-glow-bar mr-glow-bar-purple" />
                <div className="mr-scanlines" />
                <VStack align="start" spacing={3} position="relative" zIndex={1}>
                  <Heading size="sm" className="mr-heading">Quick Insights</Heading>
                  {stats.averageHonestyScore >= 80 && (
                    <HStack>
                      <Badge bg="var(--mr-green-border)" color="var(--mr-green)" fontSize="xs">
                        EXCELLENT
                      </Badge>
                      <Text className="mr-text-secondary" fontSize="sm">
                        Highly consistent with AI assessments
                      </Text>
                    </HStack>
                  )}
                  {stats.averageHonestyScore < 60 && (
                    <HStack>
                      <Badge bg="var(--mr-yellow-border)" color="var(--mr-yellow)" fontSize="xs">
                        IMPROVE
                      </Badge>
                      <Text className="mr-text-secondary" fontSize="sm">
                        Review evidence more carefully
                      </Text>
                    </HStack>
                  )}
                  {stats.perfectScores > 5 && (
                    <HStack>
                      <Badge bg="var(--mr-purple-border)" color="var(--mr-purple)" fontSize="xs">
                        ACHIEVEMENT
                      </Badge>
                      <Text className="mr-text-secondary" fontSize="sm">
                        {stats.perfectScores} perfect scores!
                      </Text>
                    </HStack>
                  )}
                  {stats.totalRatings === 0 && (
                    <Text className="mr-text-secondary" fontSize="sm">
                      No ratings yet - start evaluating to see your stats!
                    </Text>
                  )}
                </VStack>
              </Box>
            </GridItem>
          </Grid>

          {/* Rating History Table */}
          <Box className="mr-card mr-card-blue" position="relative" p={6}>
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
            <Box position="relative" zIndex={1}>
              <Heading size="md" className="mr-heading" mb={4}>
                Rating History
              </Heading>

              {loading ? (
                <Text className="mr-text-secondary">Loading rating history...</Text>
              ) : ratings.length === 0 ? (
                <Box textAlign="center" py={12}>
                  <Text className="mr-text-secondary" fontSize="lg" mb={4}>
                    You haven't rated any claims yet
                  </Text>
                  <Button
                    className="mr-button"
                    onClick={() => navigate("/dashboard")}
                    bg="var(--mr-blue-border)"
                    color="var(--mr-blue)"
                    _hover={{
                      bg: "var(--mr-blue)",
                      color: "black",
                    }}
                    size="lg"
                  >
                    Start Evaluating Tasks →
                  </Button>
                </Box>
              ) : (
                <Box overflowX="auto">
                  <Table variant="simple" size="sm">
                    <Thead>
                      <Tr borderBottom="1px solid var(--mr-blue-border)">
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">Date</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">Your Rating</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">AI Rating</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">Difference</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">AI Stance</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">Honesty Score</Th>
                        <Th className="mr-text-muted" borderColor="var(--mr-blue-border)">Performance</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {ratings.map((rating) => {
                        const difference = rating.ai_quality_rating
                          ? Math.abs(rating.user_quality_rating - rating.ai_quality_rating)
                          : null;

                        return (
                          <Tr
                            key={rating.user_claim_rating_id}
                            borderBottom="1px solid rgba(0, 162, 255, 0.1)"
                            _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}
                          >
                            <Td borderColor="transparent">
                              <Text className="mr-text-secondary" fontSize="sm">
                                {new Date(rating.created_at).toLocaleDateString()}
                              </Text>
                            </Td>
                            <Td borderColor="transparent">
                              <Badge bg="var(--mr-blue-border)" color="var(--mr-blue)">
                                {rating.user_quality_rating}
                              </Badge>
                            </Td>
                            <Td borderColor="transparent">
                              {rating.ai_quality_rating !== null ? (
                                <Badge bg="var(--mr-purple-border)" color="var(--mr-purple)">
                                  {rating.ai_quality_rating}
                                </Badge>
                              ) : (
                                <Text className="mr-text-muted" fontSize="sm">N/A</Text>
                              )}
                            </Td>
                            <Td borderColor="transparent">
                              {difference !== null ? (
                                <Badge
                                  bg={
                                    difference <= 10 ? "var(--mr-green-border)" :
                                    difference <= 30 ? "var(--mr-yellow-border)" : "var(--mr-red-border)"
                                  }
                                  color={
                                    difference <= 10 ? "var(--mr-green)" :
                                    difference <= 30 ? "var(--mr-yellow)" : "var(--mr-red)"
                                  }
                                >
                                  ±{difference}
                                </Badge>
                              ) : (
                                <Text className="mr-text-muted" fontSize="sm">—</Text>
                              )}
                            </Td>
                            <Td borderColor="transparent">
                              {rating.ai_stance ? (
                                <Badge
                                  fontSize="xs"
                                  bg={`${getStanceColor(rating.ai_stance)}33`}
                                  color={getStanceColor(rating.ai_stance)}
                                >
                                  {rating.ai_stance}
                                </Badge>
                              ) : (
                                <Text className="mr-text-muted" fontSize="sm">—</Text>
                              )}
                            </Td>
                            <Td borderColor="transparent">
                              {rating.honesty_score !== null ? (
                                <Badge
                                  bg={
                                    rating.honesty_score >= 90 ? "var(--mr-green-border)" :
                                    rating.honesty_score >= 70 ? "var(--mr-yellow-border)" : "var(--mr-red-border)"
                                  }
                                  color={
                                    rating.honesty_score >= 90 ? "var(--mr-green)" :
                                    rating.honesty_score >= 70 ? "var(--mr-yellow)" : "var(--mr-red)"
                                  }
                                >
                                  {rating.honesty_score}
                                </Badge>
                              ) : (
                                <Text className="mr-text-muted" fontSize="sm">—</Text>
                              )}
                            </Td>
                            <Td borderColor="transparent">
                              <Box width="80px">
                                {rating.honesty_score !== null ? (
                                  <Progress
                                    value={rating.honesty_score}
                                    size="sm"
                                    sx={{
                                      "& > div": {
                                        backgroundColor:
                                          rating.honesty_score >= 90 ? "var(--mr-green)" :
                                          rating.honesty_score >= 70 ? "var(--mr-yellow)" : "var(--mr-red)",
                                      },
                                    }}
                                    bg="rgba(0, 162, 255, 0.1)"
                                  />
                                ) : (
                                  <Progress value={0} size="sm" bg="rgba(0, 162, 255, 0.1)" />
                                )}
                              </Box>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </Box>
              )}
            </Box>
          </Box>

        </Box>
      </div>
    </Box>
  );
};

export default RatingEvaluation;
