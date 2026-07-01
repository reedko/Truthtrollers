/**
 * Content Rating Evaluation Page
 *
 * Peer review system for evaluating user-assembled evidence chains
 * 2+ approvals needed for content rating approval
 */

import React, { useState, useEffect } from "react";
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Button,
  Text,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Grid,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Spinner,
  Textarea,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  SliderMark,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Icon,
  Flex,
  Divider,
  Avatar,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Progress,
  Link,
} from "@chakra-ui/react";
import {
  FiUser,
  FiAward,
  FiThumbsUp,
  FiThumbsDown,
  FiCheckCircle,
  FiClock,
  FiLink,
  FiExternalLink,
} from "react-icons/fi";
import { api } from "../services/api";
import { useSearchParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

interface ContentRating {
  content_rating_id: number;
  content_id: number;
  user_id: number;
  username: string;
  email: string;
  content_url: string;
  approval_status: string;
  votes_approve: number;
  votes_reject: number;
  total_votes: number;
  avg_evaluation_score: number;
  submitted_at: string;
  created_at: string;
  claim_link_count: number;
  user_role: string;
  user_veracity: number;
  already_evaluated: boolean;
}

interface ClaimLink {
  claim_link_id: number;
  source_claim_id: number;
  target_claim_id: number;
  relationship: string;
  support_level: number;
  notes: string;
  source_claim_text: string;
  target_claim_text: string;
  source_url: string;
  author_name: string;
  publisher_name: string;
  created_at: string;
}

interface Evaluation {
  evaluation_id: number;
  evaluator_user_id: number;
  evaluator_username: string;
  evaluator_role: string;
  score: number;
  vote: string;
  notes: string;
  created_at: string;
}

interface ContentRatingDetail {
  content_rating: ContentRating;
  claim_links: ClaimLink[];
  evaluations: Evaluation[];
  can_evaluate: boolean;
}

interface UserReputation {
  veracity_rating: number;
  total_points: number;
  content_ratings_submitted: number;
  content_ratings_approved: number;
  content_ratings_rejected: number;
  approval_rate: number;
  avg_content_score: number;
  weighted_avg_content_score?: number;
  reputation_confidence?: number;
  evaluator_activity_score?: number;
  evaluations_given?: number;
}

const RatingEvaluationPage: React.FC = () => {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  // When navigating from EvaluationTaskPanel, ?userId pre-filters the list
  const preselectedUserId = searchParams.get("userId")
    ? Number(searchParams.get("userId"))
    : null;
  const {
    isOpen: isEvalModalOpen,
    onOpen: onOpenEvalModal,
    onClose: onCloseEvalModal,
  } = useDisclosure();
  const {
    isOpen: isDetailModalOpen,
    onOpen: onOpenDetailModal,
    onClose: onCloseDetailModal,
  } = useDisclosure();
  const {
    isOpen: isRepModalOpen,
    onOpen: onOpenRepModal,
    onClose: onCloseRepModal,
  } = useDisclosure();

  const [loading, setLoading] = useState(false);
  const [contentRatings, setContentRatings] = useState<ContentRating[]>([]);
  const [selectedRating, setSelectedRating] =
    useState<ContentRatingDetail | null>(null);
  const [userReputation, setUserReputation] = useState<UserReputation | null>(
    null,
  );
  const [evaluatorRole, setEvaluatorRole] = useState<any>(null);

  // Evaluation form
  const [evaluationScore, setEvaluationScore] = useState(0);
  const [evaluationNotes, setEvaluationNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadPendingRatings();
  }, []);

  const loadPendingRatings = async () => {
    setLoading(true);
    try {
      const response = await api.get(
        `${API_BASE_URL}/api/content-rating/pending`,
      );

      if (response.data.success) {
        setContentRatings(response.data.data.ratings);
        setEvaluatorRole(response.data.data.evaluator_role);
      }
    } catch (error: any) {
      console.error("Error loading pending ratings:", error);
      toast({
        title: "Error",
        description:
          error.response?.data?.error || "Failed to load pending ratings",
        status: "error",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadRatingDetails = async (contentRatingId: number) => {
    setLoading(true);
    try {
      const response = await api.get(
        `${API_BASE_URL}/api/content-rating/${contentRatingId}`,
      );

      if (response.data.success) {
        setSelectedRating(response.data.data);
        onOpenDetailModal();
      }
    } catch (error: any) {
      console.error("Error loading rating details:", error);
      toast({
        title: "Error",
        description:
          error.response?.data?.error || "Failed to load rating details",
        status: "error",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadUserReputation = async (userId: number) => {
    try {
      const response = await api.get(
        `${API_BASE_URL}/api/content-rating/user/${userId}/reputation`,
      );

      if (response.data.success) {
        setUserReputation(response.data.data.reputation);
        onOpenRepModal();
      }
    } catch (error: any) {
      console.error("Error loading reputation:", error);
      toast({
        title: "Error",
        description: error.response?.data?.error || "Failed to load reputation",
        status: "error",
        duration: 5000,
      });
    }
  };

  const openEvaluationModal = () => {
    setEvaluationScore(0);
    setEvaluationNotes("");
    onCloseDetailModal();
    onOpenEvalModal();
  };

  const submitEvaluation = async () => {
    if (!selectedRating) return;

    setSubmitting(true);
    try {
      const response = await api.post(
        `${API_BASE_URL}/api/content-rating/evaluate`,
        {
          content_rating_id: selectedRating.content_rating.content_rating_id,
          score: evaluationScore,
          notes: evaluationNotes,
        },
      );

      if (response.data.success) {
        const { vote, new_status, votes_approve, votes_reject } =
          response.data.data;

        toast({
          title: "Evaluation Submitted!",
          description: `You voted to ${vote}. Status: ${new_status} (${votes_approve} approve, ${votes_reject} reject)`,
          status: "success",
          duration: 5000,
        });

        onCloseEvalModal();
        loadPendingRatings();
      }
    } catch (error: any) {
      console.error("Error submitting evaluation:", error);
      toast({
        title: "Error",
        description:
          error.response?.data?.error || "Failed to submit evaluation",
        status: "error",
        duration: 5000,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge colorScheme="green">
            <Icon as={FiCheckCircle} mr={1} />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge colorScheme="red">
            <Icon as={FiThumbsDown} mr={1} />
            Rejected
          </Badge>
        );
      case "pending":
        return (
          <Badge colorScheme="yellow">
            <Icon as={FiClock} mr={1} />
            Pending
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getVeracityColor = (score: number) => {
    if (score >= 75) return "green";
    if (score >= 60) return "blue";
    if (score >= 45) return "yellow";
    return "red";
  };

  const getRoleBadgeColor = (roleName: string) => {
    switch (roleName) {
      case "super_admin":
        return "purple";
      case "admin":
        return "red";
      case "moderator":
        return "orange";
      case "trusted":
        return "blue";
      default:
        return "gray";
    }
  };

  const getRelationshipBadge = (relationship: string) => {
    switch (relationship) {
      case "support":
        return <Badge colorScheme="green">Supports</Badge>;
      case "refute":
        return <Badge colorScheme="red">Refutes</Badge>;
      case "nuance":
        return <Badge colorScheme="purple">Nuances</Badge>;
      default:
        return <Badge>{relationship}</Badge>;
    }
  };

  return (
    <>
      <Box className="mr-container" minH="100vh">
        <div className="mr-content">
          <Container maxW="container.xl" py={8}>
            <VStack spacing={8} align="stretch">
              {/* Header */}
              <Box
                className="mr-card mr-card-blue"
                bg="transparent"
                p={6}
                position="relative"
                borderRadius="16px"
              >
                <VStack
                  align="start"
                  spacing={2}
                  position="relative"
                  zIndex={1}
                >
                  <HStack justify="space-between" w="full">
                    <Heading
                      className="mr-heading"
                      size="lg"
                      color="var(--mr-green)"
                    >
                      Content Rating Evaluation Center
                    </Heading>
                    <Icon as={FiAward} boxSize={10} color="var(--mr-blue)" />
                  </HStack>
                  <Text className="mr-text-secondary">
                    Evaluate evidence chains from users with same or lower role
                    level
                  </Text>
                  <Text className="mr-text-muted" fontSize="sm">
                    💡 2 approvals needed to pass • 2 rejections to fail
                  </Text>
                  {evaluatorRole && (
                    <Badge
                      colorScheme={getRoleBadgeColor(evaluatorRole.name)}
                      fontSize="md"
                    >
                      Your Role: {evaluatorRole.name}
                    </Badge>
                  )}
                </VStack>
              </Box>

              {/* Pending Content Ratings */}
              <Box
                className="mr-card mr-card-blue"
                bg="transparent"
                p={6}
                position="relative"
                borderRadius="16px"
              >
                <Box position="relative" zIndex={1}>
                  <HStack justify="space-between" align="center" mb={4}>
                    <Heading size="md" className="mr-heading">
                      Pending Evidence Chains
                    </Heading>
                    {preselectedUserId && (
                      <HStack spacing={2}>
                        <Badge
                          colorScheme="purple"
                          fontSize="xs"
                          px={2}
                          py={1}
                        >
                          Filtered: user #{preselectedUserId}
                        </Badge>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="var(--mr-purple)"
                          onClick={() =>
                            window.history.replaceState(
                              {},
                              "",
                              "/evaluate-ratings",
                            )
                          }
                        >
                          ✕ Clear filter
                        </Button>
                      </HStack>
                    )}
                  </HStack>

                  {loading ? (
                    <Flex justify="center" p={12}>
                      <Spinner size="xl" color="var(--mr-blue)" />
                    </Flex>
                  ) : contentRatings.length > 0 ? (
                    <Grid
                      templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }}
                      gap={6}
                    >
                      {contentRatings
                        .filter((r) =>
                          preselectedUserId ? r.user_id === preselectedUserId : true,
                        )
                        .map((rating) => (
                        <Card
                          key={rating.content_rating_id}
                          className="mr-card mr-card-blue"
                          bg="rgba(139, 92, 246, 0.1)"
                          borderRadius="12px"
                          borderLeft="4px solid var(--mr-purple)"
                          border="1px solid var(--mr-purple-border)"
                          transition="border-color 0.2s"
                          _hover={{ borderColor: "var(--mr-purple)" }}
                        >
                          <CardHeader>
                            <HStack justify="space-between">
                              <HStack>
                                <Avatar name={rating.username} size="sm" />
                                <VStack align="start" spacing={0}>
                                  <Text
                                    fontWeight="bold"
                                    color="var(--mr-blue)"
                                  >
                                    @{rating.username}
                                  </Text>
                                  <Badge
                                    colorScheme={getRoleBadgeColor(
                                      rating.user_role,
                                    )}
                                    size="sm"
                                  >
                                    {rating.user_role}
                                  </Badge>
                                </VStack>
                              </HStack>
                              <VStack align="end" spacing={0}>
                                <Badge
                                  colorScheme={getVeracityColor(
                                    rating.user_veracity,
                                  )}
                                >
                                  Veracity: {rating.user_veracity?.toFixed(0)}
                                </Badge>
                                {rating.already_evaluated && (
                                  <Badge colorScheme="gray" size="sm">
                                    Already Voted
                                  </Badge>
                                )}
                              </VStack>
                            </HStack>
                          </CardHeader>

                          <CardBody>
                            <VStack align="stretch" spacing={3}>
                              <Box>
                                <Text fontSize="sm" color="gray.400" mb={1}>
                                  Content:
                                </Text>
                                {rating.content_url ? (
                                  <Link
                                    href={rating.content_url}
                                    isExternal
                                    color="blue.400"
                                    fontSize="sm"
                                    fontWeight="bold"
                                    noOfLines={2}
                                  >
                                    <Icon as={FiExternalLink} mr={1} />
                                    {rating.content_url}
                                  </Link>
                                ) : (
                                  <Text fontWeight="bold">
                                    Content ID: {rating.content_id}
                                  </Text>
                                )}
                              </Box>

                              <Divider />

                              <Grid templateColumns="repeat(3, 1fr)" gap={3}>
                                <Stat size="sm">
                                  <StatLabel fontSize="xs">
                                    Evidence Links
                                  </StatLabel>
                                  <StatNumber fontSize="2xl">
                                    <Icon as={FiLink} mr={1} />
                                    {rating.claim_link_count}
                                  </StatNumber>
                                </Stat>
                                <Stat size="sm">
                                  <StatLabel fontSize="xs">Approvals</StatLabel>
                                  <StatNumber fontSize="2xl" color="green.400">
                                    {rating.votes_approve}
                                  </StatNumber>
                                </Stat>
                                <Stat size="sm">
                                  <StatLabel fontSize="xs">Rejects</StatLabel>
                                  <StatNumber fontSize="2xl" color="red.400">
                                    {rating.votes_reject}
                                  </StatNumber>
                                </Stat>
                              </Grid>

                              {rating.avg_evaluation_score !== null && (
                                <Box>
                                  <Text fontSize="sm" color="gray.400">
                                    Avg Score:
                                  </Text>
                                  <Progress
                                    value={
                                      ((rating.avg_evaluation_score + 99) /
                                        198) *
                                      100
                                    }
                                    colorScheme={
                                      rating.avg_evaluation_score >= 0
                                        ? "green"
                                        : "red"
                                    }
                                    size="sm"
                                  />
                                  <Text fontSize="xs" textAlign="center" mt={1}>
                                    {rating.avg_evaluation_score?.toFixed(0)}
                                  </Text>
                                </Box>
                              )}

                              <HStack spacing={2}>
                                <Button
                                  className="mr-button"
                                  size="sm"
                                  flex={1}
                                  onClick={() =>
                                    loadRatingDetails(rating.content_rating_id)
                                  }
                                >
                                  View Evidence Chain
                                </Button>
                                <Button
                                  className="mr-button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    loadUserReputation(rating.user_id)
                                  }
                                >
                                  <Icon as={FiUser} />
                                </Button>
                              </HStack>
                            </VStack>
                          </CardBody>
                        </Card>
                      ))}
                    </Grid>
                  ) : (
                    <Box
                      textAlign="center"
                      py={12}
                      className="mr-card"
                      bg="transparent"
                      borderRadius="16px"
                    >
                      <Icon
                        as={FiCheckCircle}
                        boxSize={16}
                        color="gray.400"
                        mb={4}
                      />
                      <Text className="mr-text-secondary" fontSize="lg">
                        No pending content ratings to evaluate
                      </Text>
                      <Text className="mr-text-muted" fontSize="sm">
                        All evidence chains are caught up!
                      </Text>
                    </Box>
                  )}
                </Box>
              </Box>
            </VStack>
          </Container>
        </div>
      </Box>

      {/* Detail Modal - View Evidence Chain */}
      <Modal isOpen={isDetailModalOpen} onClose={onCloseDetailModal} size="6xl">
        <ModalOverlay bg="blackAlpha.700" />
        <ModalContent
          className="mr-card mr-card-green"
          bg="transparent"
          maxH="90vh"
          borderRadius="16px"
          position="relative"
        >
          <div className="mr-glow-bar mr-glow-bar-green" />
          <div className="mr-scanlines" />
          <ModalHeader
            className="mr-heading"
            color="var(--mr-green)"
            position="relative"
            zIndex={1}
          >
            Evidence Chain Review
          </ModalHeader>
          <ModalCloseButton zIndex={10} />
          <ModalBody overflowY="auto" position="relative" zIndex={1}>
            {selectedRating && (
              <VStack spacing={6} align="stretch">
                {/* Header Info */}
                <Card
                  className="mr-card mr-card-purple"
                  bg="transparent"
                  borderRadius="12px"
                  position="relative"
                >
                  <div className="mr-glow-bar mr-glow-bar-purple" />
                  <div className="mr-scanlines" />
                  <CardBody position="relative" zIndex={1}>
                    <Grid
                      templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
                      gap={4}
                    >
                      <Box>
                        <Text fontSize="sm" color="gray.400">
                          Submitted By:
                        </Text>
                        <HStack>
                          <Avatar
                            name={selectedRating.content_rating.username}
                            size="sm"
                          />
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="bold">
                              @{selectedRating.content_rating.username}
                            </Text>
                            <Badge
                              colorScheme={getRoleBadgeColor(
                                selectedRating.content_rating.user_role,
                              )}
                            >
                              {selectedRating.content_rating.user_role}
                            </Badge>
                          </VStack>
                        </HStack>
                      </Box>
                      <Box>
                        <Text fontSize="sm" color="gray.400">
                          Content:
                        </Text>
                        {selectedRating.content_rating.content_url ? (
                          <Link
                            href={selectedRating.content_rating.content_url}
                            isExternal
                            color="blue.400"
                            fontSize="sm"
                            fontWeight="bold"
                          >
                            <Icon as={FiExternalLink} mr={1} />
                            {selectedRating.content_rating.content_url}
                          </Link>
                        ) : (
                          <Text fontWeight="bold">
                            Content ID:{" "}
                            {selectedRating.content_rating.content_id}
                          </Text>
                        )}
                      </Box>
                    </Grid>
                    <Divider my={3} />
                    <HStack spacing={6}>
                      <Stat size="sm">
                        <StatLabel>Status</StatLabel>
                        <StatNumber>
                          {getStatusBadge(
                            selectedRating.content_rating.approval_status,
                          )}
                        </StatNumber>
                      </Stat>
                      <Stat size="sm">
                        <StatLabel>Votes</StatLabel>
                        <StatNumber>
                          <Badge colorScheme="green" mr={2}>
                            {selectedRating.content_rating.votes_approve} ✓
                          </Badge>
                          <Badge colorScheme="red">
                            {selectedRating.content_rating.votes_reject} ✗
                          </Badge>
                        </StatNumber>
                      </Stat>
                    </HStack>
                  </CardBody>
                </Card>

                {/* Evidence Chain (Claim Links) */}
                <Box>
                  <Heading size="sm" mb={3} className="mr-heading">
                    Evidence Chain ({selectedRating.claim_links.length} links)
                  </Heading>
                  <VStack spacing={3} align="stretch">
                    {selectedRating.claim_links.map((link) => (
                      <Card
                        key={link.claim_link_id}
                        bg="rgba(0, 162, 255, 0.05)"
                        borderRadius="8px"
                        borderLeft="4px solid var(--mr-blue)"
                        border="1px solid var(--mr-blue-border)"
                      >
                        <CardBody>
                          <Grid templateColumns="auto 1fr" gap={4}>
                            <Box textAlign="center">
                              {getRelationshipBadge(link.relationship)}
                              {link.support_level !== null && (
                                <Text fontSize="xs" color="gray.400" mt={1}>
                                  Level: {link.support_level}
                                </Text>
                              )}
                            </Box>
                            <VStack align="stretch" spacing={2}>
                              <Box>
                                <Text fontSize="xs" color="gray.400">
                                  Case Claim:
                                </Text>
                                <Text fontSize="sm">
                                  {link.target_claim_text}
                                </Text>
                              </Box>
                              <Divider />
                              <Box>
                                <Text fontSize="xs" color="gray.400">
                                  Source Claim:
                                </Text>
                                <Text fontSize="sm" fontWeight="bold">
                                  {link.source_claim_text}
                                </Text>
                              </Box>
                              {(link.author_name ||
                                link.publisher_name ||
                                link.source_url) && (
                                <Box>
                                  <Text fontSize="xs" color="gray.400">
                                    From:
                                  </Text>
                                  {(link.author_name ||
                                    link.publisher_name) && (
                                    <Text fontSize="sm">
                                      {link.author_name}
                                      {link.author_name &&
                                        link.publisher_name &&
                                        " • "}
                                      {link.publisher_name}
                                    </Text>
                                  )}
                                  {link.source_url && (
                                    <Link
                                      href={link.source_url}
                                      isExternal
                                      color="blue.400"
                                      fontSize="xs"
                                    >
                                      <Icon as={FiExternalLink} mr={1} />
                                      {link.source_url}
                                    </Link>
                                  )}
                                </Box>
                              )}
                              {link.notes && (
                                <Box bg="gray.800" p={2} borderRadius="md">
                                  <Text fontSize="xs" color="gray.400">
                                    Notes:
                                  </Text>
                                  <Text fontSize="sm">{link.notes}</Text>
                                </Box>
                              )}
                            </VStack>
                          </Grid>
                        </CardBody>
                      </Card>
                    ))}
                  </VStack>
                </Box>

                {/* Previous Evaluations */}
                {selectedRating.evaluations.length > 0 && (
                  <Box>
                    <Heading size="sm" mb={3} className="mr-heading">
                      Previous Evaluations ({selectedRating.evaluations.length})
                    </Heading>
                    <VStack spacing={2} align="stretch">
                      {selectedRating.evaluations.map((evaluation) => (
                        <Card
                          key={evaluation.evaluation_id}
                          bg="rgba(139, 92, 246, 0.05)"
                          borderRadius="8px"
                          borderLeft="4px solid var(--mr-purple)"
                          border="1px solid var(--mr-purple-border)"
                        >
                          <CardBody>
                            <HStack justify="space-between">
                              <HStack>
                                <Avatar
                                  name={evaluation.evaluator_username}
                                  size="sm"
                                />
                                <VStack align="start" spacing={0}>
                                  <Text fontSize="sm" fontWeight="bold">
                                    @{evaluation.evaluator_username}
                                  </Text>
                                  <Badge
                                    size="xs"
                                    colorScheme={getRoleBadgeColor(
                                      evaluation.evaluator_role,
                                    )}
                                  >
                                    {evaluation.evaluator_role}
                                  </Badge>
                                </VStack>
                              </HStack>
                              <HStack>
                                <Badge
                                  colorScheme={
                                    evaluation.vote === "approve"
                                      ? "green"
                                      : "red"
                                  }
                                  fontSize="md"
                                  px={3}
                                >
                                  {evaluation.vote === "approve"
                                    ? "✓ Approve"
                                    : "✗ Reject"}
                                </Badge>
                                <Badge fontSize="lg">
                                  {evaluation.score > 0 ? "+" : ""}
                                  {evaluation.score}
                                </Badge>
                              </HStack>
                            </HStack>
                            {evaluation.notes && (
                              <Box mt={2} p={2} bg="gray.800" borderRadius="md">
                                <Text fontSize="sm">{evaluation.notes}</Text>
                              </Box>
                            )}
                          </CardBody>
                        </Card>
                      ))}
                    </VStack>
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter position="relative" zIndex={1}>
            <HStack spacing={3}>
              <Button
                className="mr-button"
                variant="ghost"
                onClick={onCloseDetailModal}
              >
                Close
              </Button>
              {selectedRating?.can_evaluate && (
                <Button
                  className="mr-button"
                  onClick={openEvaluationModal}
                  leftIcon={<FiAward />}
                >
                  Evaluate This Evidence Chain
                </Button>
              )}
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Evaluation Modal */}
      <Modal isOpen={isEvalModalOpen} onClose={onCloseEvalModal} size="xl">
        <ModalOverlay bg="blackAlpha.700" />
        <ModalContent
          className="mr-card mr-card-yellow"
          bg="transparent"
          borderRadius="16px"
          position="relative"
        >
          <div className="mr-glow-bar mr-glow-bar-yellow" />
          <div className="mr-scanlines" />
          <ModalHeader
            className="mr-heading"
            color="var(--mr-green)"
            position="relative"
            zIndex={1}
          >
            Submit Your Evaluation
          </ModalHeader>
          <ModalCloseButton zIndex={10} />
          <ModalBody position="relative" zIndex={1}>
            <VStack spacing={6} align="stretch">
              <Box>
                <HStack justify="space-between" mb={4}>
                  <Text fontWeight="bold">Evaluation Score:</Text>
                  <Badge
                    colorScheme={evaluationScore >= 0 ? "green" : "red"}
                    fontSize="xl"
                    px={4}
                    py={1}
                  >
                    {evaluationScore > 0 ? "+" : ""}
                    {evaluationScore}
                  </Badge>
                </HStack>

                <Slider
                  value={evaluationScore}
                  onChange={setEvaluationScore}
                  min={-99}
                  max={99}
                  step={1}
                  mb={8}
                >
                  <SliderMark value={-99} mt={3} fontSize="sm" color="gray.400">
                    -99
                  </SliderMark>
                  <SliderMark
                    value={0}
                    mt={3}
                    ml={-2}
                    fontSize="sm"
                    color="gray.400"
                  >
                    0
                  </SliderMark>
                  <SliderMark
                    value={99}
                    mt={3}
                    ml={-6}
                    fontSize="sm"
                    color="gray.400"
                  >
                    +99
                  </SliderMark>
                  <SliderTrack bg="gray.600">
                    <SliderFilledTrack
                      bg={evaluationScore >= 0 ? "green.400" : "red.400"}
                    />
                  </SliderTrack>
                  <SliderThumb boxSize={6} />
                </Slider>

                <VStack
                  align="stretch"
                  spacing={2}
                  fontSize="sm"
                  color="gray.400"
                  mb={4}
                >
                  <Text>• Score ≥ 0 = Vote to APPROVE</Text>
                  <Text>• Score &lt; 0 = Vote to REJECT</Text>
                  <Text>
                    • 2 approvals needed for approval, 2 rejects for rejection
                  </Text>
                  <Text>
                    • Higher positive score = More points for user if approved
                  </Text>
                </VStack>
              </Box>

              <Box>
                <Text fontWeight="bold" mb={2}>
                  Notes:
                </Text>
                <Textarea
                  value={evaluationNotes}
                  onChange={(e) => setEvaluationNotes(e.target.value)}
                  placeholder="Explain your evaluation: Good sources? Missing evidence? Biased? etc..."
                  rows={4}
                  className="mr-glow-bar"
                />
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter position="relative" zIndex={1}>
            <HStack spacing={3}>
              <Button
                className="mr-button"
                variant="ghost"
                onClick={onCloseEvalModal}
              >
                Cancel
              </Button>
              <Button
                className="mr-button"
                onClick={submitEvaluation}
                isLoading={submitting}
                leftIcon={
                  evaluationScore >= 0 ? <FiThumbsUp /> : <FiThumbsDown />
                }
              >
                {evaluationScore >= 0 ? "Approve" : "Reject"} (
                {evaluationScore > 0 ? "+" : ""}
                {evaluationScore})
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* User Reputation Modal */}
      <Modal isOpen={isRepModalOpen} onClose={onCloseRepModal} size="lg">
        <ModalOverlay bg="blackAlpha.700" />
        <ModalContent
          className="mr-card mr-card-purple"
          bg="transparent"
          borderRadius="16px"
          position="relative"
        >
          <div className="mr-glow-bar mr-glow-bar-purple" />
          <div className="mr-scanlines" />
          <ModalHeader
            className="mr-heading"
            color="var(--mr-purple)"
            position="relative"
            zIndex={1}
          >
            User Track Record
          </ModalHeader>
          <ModalCloseButton zIndex={10} />
          <ModalBody position="relative" zIndex={1}>
            {userReputation && (
              <VStack spacing={6} align="stretch">
                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                  <Stat>
                    <StatLabel color="gray.400">Veracity Rating</StatLabel>
                    <StatNumber className="mr-green-text" fontSize="4xl">
                      {userReputation.veracity_rating?.toFixed(1) || 50}/100
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel color="gray.400">Total Points</StatLabel>
                    <StatNumber className="mr-blue-text">
                      {userReputation.total_points?.toFixed(0) || 0}
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel color="gray.400">Submitted</StatLabel>
                    <StatNumber className="mr-text-primary">
                      {userReputation.content_ratings_submitted || 0}
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel color="gray.400">Approval Rate</StatLabel>
                    <StatNumber className="mr-green-text">
                      {userReputation.approval_rate?.toFixed(0) || 0}%
                    </StatNumber>
                    <StatHelpText>
                      {userReputation.content_ratings_approved || 0} approved,{" "}
                      {userReputation.content_ratings_rejected || 0} rejected
                    </StatHelpText>
                  </Stat>
                </Grid>

                <Divider />

                <Box>
                  <Text fontWeight="bold" mb={2}>
                    Approval Rate
                  </Text>
                  <Progress
                    value={userReputation.approval_rate || 0}
                    colorScheme="green"
                    size="lg"
                  />
                </Box>

                <Box>
                  <Text fontWeight="bold" mb={2}>
                    Weighted Approved Score
                  </Text>
                  <Progress
                    value={
                      (((userReputation.weighted_avg_content_score ??
                        userReputation.avg_content_score) +
                        99) /
                        198) *
                      100
                    }
                    colorScheme="blue"
                    size="lg"
                  />
                  <Text textAlign="center" fontSize="sm" mt={1}>
                    {(
                      userReputation.weighted_avg_content_score ??
                      userReputation.avg_content_score ??
                      0
                    ).toFixed(1)}{" "}
                    / 99
                  </Text>
                  <Text textAlign="center" fontSize="xs" color="gray.400" mt={1}>
                    Raw average:{" "}
                    {(userReputation.avg_content_score ?? 0).toFixed(1)} / 99
                  </Text>
                </Box>

                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                  <Stat>
                    <StatLabel color="gray.400">Confidence</StatLabel>
                    <StatNumber className="mr-text-primary">
                      {(userReputation.reputation_confidence ?? 0).toFixed(0)}%
                    </StatNumber>
                    <StatHelpText>Approved-volume weight</StatHelpText>
                  </Stat>
                  <Stat>
                    <StatLabel color="gray.400">Reviewer Activity</StatLabel>
                    <StatNumber className="mr-text-primary">
                      {(userReputation.evaluator_activity_score ?? 0).toFixed(0)}%
                    </StatNumber>
                    <StatHelpText>
                      {userReputation.evaluations_given ?? 0} evaluations given
                    </StatHelpText>
                  </Stat>
                </Grid>

                <Box>
                  <Text fontWeight="bold" mb={2}>
                    Reputation Confidence
                  </Text>
                  <Progress
                    value={userReputation.reputation_confidence ?? 0}
                    colorScheme="purple"
                    size="lg"
                  />
                </Box>
              </VStack>
            )}
          </ModalBody>
          <ModalFooter position="relative" zIndex={1}>
            <Button className="mr-button" onClick={onCloseRepModal}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default RatingEvaluationPage;
