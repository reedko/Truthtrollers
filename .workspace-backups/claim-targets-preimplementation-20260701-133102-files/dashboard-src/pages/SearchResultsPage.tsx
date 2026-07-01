// src/pages/SearchResultsPage.tsx
import React, { useEffect, useState } from "react";
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Spinner,
  Center,
  Container,
  Badge,
  Card,
  CardHeader,
  CardBody,
  Icon,
  Divider,
} from "@chakra-ui/react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import TaskGrid from "../components/TaskGrid";
import { Task } from "../entities/useTask";
import { useAuthStore } from "../store/useAuthStore";

interface Theme {
  rank: number;
  text: string;
  type: "supporting" | "opposing" | "neutral";
  confidence: number;
  claim_count: number;
  controversy: number;
  stakes: number;
  canonical_claim_id: number;
  bucket: "common" | "disputed" | "rare_significant" | "other";
}

interface SearchStats {
  total_claims: number;
  canonical_families: number;
  common_themes_count: number;
  key_disputed_count: number;
  rare_significant_count: number;
}

interface Buckets {
  common: Theme[];
  disputed: Theme[];
  rare_significant: Theme[];
}

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get("q");
  const shouldAnalyze = searchParams.get("analyze") === "true";
  const user = useAuthStore((s) => s.user);

  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [buckets, setBuckets] = useState<Buckets>({ common: [], disputed: [], rare_significant: [] });
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [analyzingThemes, setAnalyzingThemes] = useState(false);

  useEffect(() => {
    if (!query || !query.trim()) {
      navigate("/tasks");
      return;
    }

    const fetchResults = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get("/api/search-tasks", {
          params: { q: query, showInactive: false },
        });
        const searchResults = response.data || [];
        setResults(searchResults);

        // After getting results, analyze themes if enabled, we have results and a user
        if (shouldAnalyze && searchResults.length > 0 && user?.user_id) {
          analyzeSearchThemes(searchResults);
        }
      } catch (err: any) {
        console.error("Search failed:", err);
        setError("Related Case not Found");
      } finally {
        setLoading(false);
      }
    };

    const analyzeSearchThemes = async (searchResults: Task[]) => {
      try {
        console.log("🔍 Starting theme analysis for", searchResults.length, "results");
        setAnalyzingThemes(true);
        const contentIds = searchResults.map((r) => r.content_id);

        console.log("📤 Sending to /api/search-analysis:", { query, contentIds: contentIds.length, userId: user?.user_id });

        const response = await api.post("/api/search-analysis", {
          query,
          contentIds,
          userId: user?.user_id,
        });

        console.log("✅ Theme analysis response:", response.data);
        setThemes(response.data.themes || []);
        setBuckets(response.data.buckets || { common: [], disputed: [], rare_significant: [] });
        setStats(response.data.stats || null);
      } catch (err: any) {
        console.error("❌ Theme analysis failed:", err);
        console.error("Error details:", err.response?.data);
        // Don't show error to user, themes are optional
      } finally {
        setAnalyzingThemes(false);
      }
    };

    fetchResults();
  }, [query, navigate, user?.user_id, shouldAnalyze]);

  if (!query) {
    return null;
  }

  return (
    <Container maxW="100%" p={{ base: 2, md: 6 }}>
      <VStack align="stretch" spacing={6}>
        {/* Header */}
        <HStack justify="space-between" align="center" wrap="wrap">
          <VStack align="start" spacing={1}>
            <Heading size="lg" color="teal.300">
              Search Results
            </Heading>
            <HStack>
              <Text fontSize="md" color="gray.400">
                Results for:
              </Text>
              <Badge colorScheme="teal" fontSize="md" px={3} py={1}>
                "{query}"
              </Badge>
            </HStack>
          </VStack>
          {!loading && (
            <Text fontSize="md" color="gray.500">
              {results.length} {results.length === 1 ? "result" : "results"} found
            </Text>
          )}
        </HStack>

        {/* Loading State */}
        {loading && (
          <Center py={20}>
            <VStack spacing={4}>
              <Spinner size="xl" color="teal.400" thickness="4px" />
              <Text color="gray.400">Searching cases...</Text>
            </VStack>
          </Center>
        )}

        {/* Error State */}
        {error && !loading && (
          <Center py={20}>
            <VStack spacing={4}>
              <Text fontSize="xl" color="red.400">
                {error}
              </Text>
              <Text color="gray.500">Please try again or search for something else</Text>
            </VStack>
          </Center>
        )}

        {/* No Results */}
        {!loading && !error && results.length === 0 && (
          <Center py={20}>
            <VStack spacing={4}>
              <Text fontSize="xl" color="gray.400">
                Related Case not Found
              </Text>
              <Text color="gray.500">
                No cases found matching "{query}". Try searching with different keywords or check your spelling.
              </Text>
            </VStack>
          </Center>
        )}

        {/* Debug Info */}
        {!loading && results.length > 0 && stats && (
          <Box p={2} bg="gray.800" borderRadius="md" fontSize="xs">
            <Text>
              Debug: {stats.total_claims} claims → {stats.canonical_families} families |
              Common: {stats.common_themes_count}, Disputed: {stats.key_disputed_count},
              Rare: {stats.rare_significant_count} | userId={user?.user_id}
            </Text>
          </Box>
        )}

        {/* Thematic Analysis */}
        {!loading && !error && results.length > 0 && (
          <>
            {analyzingThemes && (
              <Card bg="blue.900" borderColor="blue.500" borderWidth="1px">
                <CardBody>
                  <HStack spacing={3}>
                    <Spinner size="sm" color="blue.400" />
                    <Text color="blue.200">
                      Analyzing claims to extract thematic questions and assertions...
                    </Text>
                  </HStack>
                </CardBody>
              </Card>
            )}

            {!analyzingThemes && themes.length > 0 && (
              <VStack align="stretch" spacing={4}>
                {/* Common Themes Bucket */}
                {buckets.common.length > 0 && (
                  <Card bg="blue.900" borderColor="blue.500" borderWidth="1px">
                    <CardHeader>
                      <Heading size="md" color="blue.200">
                        🔵 Common Themes
                      </Heading>
                      <Text fontSize="sm" color="blue.300" mt={1}>
                        Recurring assertions found across multiple claims ({buckets.common.length} themes)
                      </Text>
                    </CardHeader>
                    <CardBody>
                      <VStack align="stretch" spacing={3} divider={<Divider borderColor="blue.700" />}>
                        {buckets.common.map((theme, idx) => (
                          <Box key={idx}>
                            <HStack spacing={2} mb={1} wrap="wrap">
                              <Badge
                                colorScheme={theme.type === "supporting" ? "green" : theme.type === "opposing" ? "red" : "gray"}
                                fontSize="xs"
                              >
                                {theme.type === "supporting" ? "✅ Supporting" : theme.type === "opposing" ? "❌ Opposing" : "⚖️ Neutral"}
                              </Badge>
                              <Badge colorScheme="blue" fontSize="xs">
                                {theme.claim_count} claims
                              </Badge>
                              <Badge colorScheme="purple" fontSize="xs">
                                {Math.round(theme.confidence * 100)}% score
                              </Badge>
                            </HStack>
                            <Text color="white" fontSize="md" fontWeight="medium">
                              {theme.rank}. {theme.text}
                            </Text>
                          </Box>
                        ))}
                      </VStack>
                    </CardBody>
                  </Card>
                )}

                {/* Key Disputed Claims Bucket */}
                {buckets.disputed.length > 0 && (
                  <Card bg="red.900" borderColor="red.500" borderWidth="1px">
                    <CardHeader>
                      <Heading size="md" color="red.200">
                        🔴 Key Disputed Claims
                      </Heading>
                      <Text fontSize="sm" color="red.300" mt={1}>
                        Highly controversial assertions requiring fact-checking ({buckets.disputed.length} claims)
                      </Text>
                    </CardHeader>
                    <CardBody>
                      <VStack align="stretch" spacing={3} divider={<Divider borderColor="red.700" />}>
                        {buckets.disputed.map((theme, idx) => (
                          <Box key={idx}>
                            <HStack spacing={2} mb={1} wrap="wrap">
                              <Badge
                                colorScheme={theme.type === "supporting" ? "green" : theme.type === "opposing" ? "red" : "gray"}
                                fontSize="xs"
                              >
                                {theme.type === "supporting" ? "✅ Supporting" : theme.type === "opposing" ? "❌ Opposing" : "⚖️ Neutral"}
                              </Badge>
                              <Badge colorScheme="orange" fontSize="xs">
                                {Math.round(theme.controversy * 100)}% controversial
                              </Badge>
                              <Badge colorScheme="purple" fontSize="xs">
                                {Math.round(theme.confidence * 100)}% score
                              </Badge>
                            </HStack>
                            <Text color="white" fontSize="md" fontWeight="medium">
                              {theme.rank}. {theme.text}
                            </Text>
                          </Box>
                        ))}
                      </VStack>
                    </CardBody>
                  </Card>
                )}

                {/* Rare but Significant Claims Bucket */}
                {buckets.rare_significant.length > 0 && (
                  <Card bg="purple.900" borderColor="purple.500" borderWidth="1px">
                    <CardHeader>
                      <Heading size="md" color="purple.200">
                        🟣 Rare but Consequential
                      </Heading>
                      <Text fontSize="sm" color="purple.300" mt={1}>
                        Less frequent but high-stakes assertions worth investigating ({buckets.rare_significant.length} claims)
                      </Text>
                    </CardHeader>
                    <CardBody>
                      <VStack align="stretch" spacing={3} divider={<Divider borderColor="purple.700" />}>
                        {buckets.rare_significant.map((theme, idx) => (
                          <Box key={idx}>
                            <HStack spacing={2} mb={1} wrap="wrap">
                              <Badge
                                colorScheme={theme.type === "supporting" ? "green" : theme.type === "opposing" ? "red" : "gray"}
                                fontSize="xs"
                              >
                                {theme.type === "supporting" ? "✅ Supporting" : theme.type === "opposing" ? "❌ Opposing" : "⚖️ Neutral"}
                              </Badge>
                              <Badge colorScheme="yellow" fontSize="xs">
                                {Math.round(theme.stakes * 100)}% stakes
                              </Badge>
                              <Badge colorScheme="purple" fontSize="xs">
                                {Math.round(theme.confidence * 100)}% score
                              </Badge>
                            </HStack>
                            <Text color="white" fontSize="md" fontWeight="medium">
                              {theme.rank}. {theme.text}
                            </Text>
                          </Box>
                        ))}
                      </VStack>
                    </CardBody>
                  </Card>
                )}
              </VStack>
            )}
          </>
        )}

        {/* Results Grid */}
        {!loading && !error && results.length > 0 && (
          <Box>
            <TaskGrid content={results} redirectTo="/search" />
          </Box>
        )}
      </VStack>
    </Container>
  );
}
