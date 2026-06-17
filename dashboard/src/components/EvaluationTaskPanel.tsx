/**
 * EvaluationTaskPanel
 *
 * Shows the top 3 users with pending claim ratings that the current user can evaluate.
 * Sits in the UserDashboard sidebar in place of the old "Evaluate Users" static stub.
 *
 * Data: GET /api/evaluation/users-with-ratings (role-filtered server-side)
 * CTA:  Navigate to /evaluate-ratings?userId=X so the page can pre-select that user
 */

import React, { useEffect, useState } from "react";
import {
  Box,
  Heading,
  VStack,
  HStack,
  SimpleGrid,
  Text,
  Badge,
  Button,
  Spinner,
  Avatar,
  Tooltip,
  Link,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import {
  fetchUsersWithPendingRatings,
  PendingEvalUser,
} from "../services/useDashboardAPI";

export const EvaluationTaskPanel: React.FC = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<PendingEvalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchUsersWithPendingRatings()
      .then((result) => {
        setUsers(result.users.slice(0, 5));
        setLoading(false);
      })
      .catch((err) => {
        console.error("[EvaluationTaskPanel] Failed to load:", err);
        setError(true);
        setLoading(false);
      });
  }, []);

  const honestyColor = (score: number | null) => {
    if (score === null) return "var(--mr-text-muted)";
    if (score >= 70) return "var(--mr-green)";
    if (score >= 40) return "var(--mr-yellow)";
    return "var(--mr-red, #f66)";
  };

  return (
    <Box className="mr-card mr-card-purple" p={6} position="relative">
      <div className="mr-glow-bar mr-glow-bar-purple" />
      <div className="mr-scanlines" />

      <Box position="relative" zIndex={1}>
        <HStack justify="space-between" mb={1}>
          <Heading size="md" className="mr-heading">
            Evaluate User Ratings
          </Heading>
          <Link
            fontSize="xs"
            color="var(--mr-purple)"
            cursor="pointer"
            onClick={() => navigate("/evaluate-ratings")}
            _hover={{ textDecoration: "underline" }}
          >
            View all →
          </Link>
        </HStack>
        <Text className="mr-text-muted" fontSize="xs" mb={4}>
          Peer-review evidence chains submitted by other users. Score each chain and vote to approve or reject.
        </Text>

        {loading ? (
          <HStack justify="center" py={4}>
            <Spinner size="sm" color="var(--mr-purple)" />
            <Text className="mr-text-muted" fontSize="xs">
              Loading…
            </Text>
          </HStack>
        ) : error ? (
          <Text className="mr-text-muted" fontSize="xs" textAlign="center" py={3}>
            Could not load pending evaluations
          </Text>
        ) : users.length === 0 ? (
          <Box
            className="mr-card mr-card-purple"
            p={3}
            textAlign="center"
          >
            <Text className="mr-text-muted" fontSize="xs">
              🎉 No pending evaluations right now
            </Text>
          </Box>
        ) : (
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3, xl: 5 }} spacing={3}>
            {users.map((u) => (
              <Box
                key={u.user_id}
                className="mr-card mr-card-purple"
                p={3}
                position="relative"
                _hover={{ transform: "translateY(-2px)" }}
                transition="all 0.2s"
              >
                <HStack justify="space-between" align="start">
                  {/* Left: avatar + name + role */}
                  <HStack spacing={2} flex={1} minW={0}>
                    <Avatar
                      size="xs"
                      name={u.username}
                      bg="purple.600"
                      color="white"
                      flexShrink={0}
                    />
                    <VStack align="start" spacing={0} minW={0}>
                      <Text
                        className="mr-text-primary"
                        fontSize="xs"
                        fontWeight="bold"
                        noOfLines={1}
                      >
                        {u.username}
                      </Text>
                      <HStack spacing={1}>
                        <Badge
                          fontSize="2xs"
                          bg="var(--mr-purple-border)"
                          color="var(--mr-purple)"
                        >
                          {u.role_name}
                        </Badge>
                        <Tooltip label="Pending claim ratings" placement="top">
                          <Badge
                            fontSize="2xs"
                            bg="var(--mr-blue-border, rgba(100,160,255,0.15))"
                            color="var(--mr-blue)"
                          >
                            {u.pending_count} pending
                          </Badge>
                        </Tooltip>
                      </HStack>
                    </VStack>
                  </HStack>

                  {/* Right: honesty score + button */}
                  <VStack align="end" spacing={1} flexShrink={0}>
                    <Tooltip label="Average honesty score" placement="top">
                      <Text
                        fontSize="xs"
                        fontWeight="bold"
                        color={honestyColor(u.avg_honesty_score)}
                      >
                        {u.avg_honesty_score !== null
                          ? `${Math.round(u.avg_honesty_score)}%`
                          : "—"}
                      </Text>
                    </Tooltip>
                    <Button
                      size="xs"
                      fontSize="2xs"
                      bg="var(--mr-purple-border)"
                      color="var(--mr-purple)"
                      _hover={{ bg: "var(--mr-purple)", color: "black" }}
                      onClick={() =>
                        navigate(`/evaluate-ratings?userId=${u.user_id}`)
                      }
                    >
                      Evaluate →
                    </Button>
                  </VStack>
                </HStack>
              </Box>
            ))}
          </SimpleGrid>
        )}
      </Box>
    </Box>
  );
};

export default EvaluationTaskPanel;
