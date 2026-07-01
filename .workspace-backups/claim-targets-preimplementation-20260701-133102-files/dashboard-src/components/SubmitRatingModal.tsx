/**
 * Submit Rating Modal
 *
 * Allows users to curate their evidence chain by selecting from:
 * - Their own claim_links (all of them, pre-select ones for this content)
 * - Other users' claim_links for this content
 * Then submit as a content_rating for peer review
 */

import React, { useState, useEffect, useMemo, useCallback, memo } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Badge,
  Divider,
  Icon,
  useToast,
  Stat,
  StatLabel,
  StatNumber,
  StatGroup,
  Card,
  CardBody,
  Link,
  Spinner,
  Flex,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Checkbox,
  Input,
  InputGroup,
  InputLeftElement,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Avatar,
} from "@chakra-ui/react";
import {
  FiAward,
  FiLink,
  FiCheckCircle,
  FiAlertCircle,
  FiExternalLink,
  FiSearch,
  FiUser,
} from "react-icons/fi";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";

import { ClaimLinker as ClaimLink } from "../../../shared/entities/types";

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

// Memoized individual claim link component to prevent re-renders
const ClaimLinkItem = memo(
  ({
    link,
    isSelected,
    onToggle,
    getRelationshipBadge,
  }: {
    link: ClaimLink;
    isSelected: boolean;
    onToggle: (id: number) => void;
    getRelationshipBadge: (rel: string) => JSX.Element;
  }) => {
    return (
      <Box
        className={isSelected ? "mr-card mr-card-green" : "mr-card mr-card-blue"}
        bg="transparent"
        cursor="pointer"
        onClick={() => onToggle(link.claim_link_id)}
        mb={3}
        borderRadius="12px"
        transition="all 0.2s"
        position="relative"
        _hover={{
          borderColor: "var(--mr-purple)",
        }}
      >
        <div className={isSelected ? "mr-glow-bar mr-glow-bar-green" : "mr-glow-bar mr-glow-bar-blue"} />
        <div className="mr-scanlines" />
        <Box p={5} position="relative" zIndex={1}>
          <HStack align="start" spacing={4}>
            <Checkbox
              isChecked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onToggle(link.claim_link_id);
              }}
              colorScheme="green"
              size="lg"
              mt={1}
            />
            <VStack align="stretch" spacing={3} flex={1}>
              <HStack justify="space-between">
                <HStack>
                  {getRelationshipBadge(link.relationship)}
                  {link.support_level !== null && (
                    <Badge className="mr-badge mr-badge-blue">
                      Support: {link.support_level > 0 ? "+" : ""}
                      {link.support_level}
                    </Badge>
                  )}
                </HStack>
                {!link.is_mine && link.username && (
                  <HStack>
                    <Icon as={FiUser} boxSize={3} color="gray.400" />
                    <Text fontSize="sm" color="gray.400">
                      @{link.username}
                    </Text>
                  </HStack>
                )}
              </HStack>

              <Box
                className="mr-card mr-card-purple"
                bg="transparent"
                p={3}
                borderRadius="md"
                position="relative"
              >
                <div className="mr-glow-bar mr-glow-bar-purple" />
                <Box position="relative" zIndex={1}>
                  <Text fontSize="xs" color="gray.400" mb={1} fontWeight="bold">
                    CASE CLAIM (Target):
                  </Text>
                  <Text fontSize="md" lineHeight="1.6">
                    {link.target_claim_text || "[No claim text]"}
                  </Text>
                </Box>
              </Box>

              <Flex justify="center">
                <Icon as={FiLink} boxSize={5} color="var(--mr-green)" />
              </Flex>

              <Box
                className="mr-card mr-card-blue"
                bg="transparent"
                p={3}
                borderRadius="md"
                position="relative"
              >
                <div className="mr-glow-bar mr-glow-bar-blue" />
                <Box position="relative" zIndex={1}>
                  <HStack justify="space-between" mb={1}>
                    <Text fontSize="xs" color="gray.400" fontWeight="bold">
                      SOURCE CLAIM (Evidence):
                    </Text>
                    {link.source_url && (
                      <Link
                        href={link.source_url}
                        isExternal
                        fontSize="xs"
                        color="blue.400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Icon as={FiExternalLink} mr={1} />
                        View Source
                      </Link>
                    )}
                  </HStack>
                  <Text fontSize="md" fontWeight="bold" lineHeight="1.6">
                    {link.source_claim_text || "[No claim text]"}
                  </Text>
                  {(link.author_name || link.publisher_name) && (
                    <HStack mt={2} color="gray.500" fontSize="sm">
                      {link.author_name && <Text>{link.author_name}</Text>}
                      {link.author_name && link.publisher_name && <Text>•</Text>}
                      {link.publisher_name && <Text>{link.publisher_name}</Text>}
                    </HStack>
                  )}
                </Box>
              </Box>

              {link.notes && (
                <Box
                  className="mr-card mr-card-yellow"
                  bg="transparent"
                  p={3}
                  borderRadius="md"
                  position="relative"
                >
                  <div className="mr-glow-bar mr-glow-bar-yellow" />
                  <Box position="relative" zIndex={1}>
                    <Text fontSize="xs" color="gray.400" mb={1} fontWeight="bold">
                      NOTES:
                    </Text>
                    <Text fontSize="sm" color="gray.300">
                      {link.notes}
                    </Text>
                  </Box>
                </Box>
              )}
            </VStack>
          </HStack>
        </Box>
      </Box>
    );
  },
);

ClaimLinkItem.displayName = "ClaimLinkItem";

interface SubmitRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  contentId: number;
  contentUrl?: string;
  contentTitle?: string;
  onSuccess?: () => void;
}

const SubmitRatingModal: React.FC<SubmitRatingModalProps> = ({
  isOpen,
  onClose,
  contentId,
  contentUrl,
  contentTitle,
  onSuccess,
}) => {
  const toast = useToast();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // My claim links (all of them)
  const [myClaimLinks, setMyClaimLinks] = useState<ClaimLink[]>([]);

  // My claim links filtered for this content only
  const [myContentClaimLinks, setMyContentClaimLinks] = useState<ClaimLink[]>(
    [],
  );

  // Other users' claim links for this content
  const [otherClaimLinks, setOtherClaimLinks] = useState<ClaimLink[]>([]);

  // Selected claim_link_ids
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<number>>(
    new Set(),
  );

  // Search filter with debounce
  const [searchFilter, setSearchFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  // Pagination for lazy loading
  const [showMyLinksCount, setShowMyLinksCount] = useState(20);
  const [showOtherLinksCount, setShowOtherLinksCount] = useState(20);

  // Debounce search to reduce re-renders - use useRef to prevent recreating timeout
  const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setSearchFilter(searchInput);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput]);

  useEffect(() => {
    if (isOpen && contentId) {
      loadData();
    }
  }, [isOpen, contentId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const userId = user?.user_id;

      if (!userId) {
        toast({
          title: "Not logged in",
          description: "You must be logged in to submit ratings",
          status: "error",
          duration: 5000,
        });
        setLoading(false);
        return;
      }

      // Load my claim links (all of them)
      const myLinksResponse = await api.get(
        `${API_BASE_URL}/api/claim-links/my-links?userId=${userId}`,
      );

      if (myLinksResponse.data.success) {
        const allLinks: ClaimLink[] =
          myLinksResponse.data.data.claim_links || [];
        console.log("📋 My claim links (total):", allLinks.length, "links");
        console.log("📝 Sample link data:", allLinks[0]);
        setMyClaimLinks(
          allLinks.map((l: ClaimLink) => ({ ...l, is_mine: true })),
        );

        // Filter to only links for this content and pre-select them
        const contentLinkIds = await getClaimLinksForContent(allLinks);
        console.log("✅ Links for this content:", contentLinkIds.length);

        // Filter myClaimLinks to only show the ones for this content
        const contentLinks = allLinks.filter((l) =>
          contentLinkIds.includes(l.claim_link_id),
        );
        console.log("🎯 Content links filtered:", contentLinks.length);
        console.log("📝 Sample content link:", contentLinks[0]);
        setMyContentClaimLinks(
          contentLinks.map((l: ClaimLink) => ({ ...l, is_mine: true })),
        );

        setSelectedLinkIds(new Set(contentLinkIds));
      }

      // Load other users' claim links for this content
      const otherLinksResponse = await api.get(
        `${API_BASE_URL}/api/claim-links/content/${contentId}/all-users?userId=${userId}`,
      );

      if (otherLinksResponse.data.success) {
        const links = otherLinksResponse.data.data.claim_links || [];
        setOtherClaimLinks(
          links.map((l: ClaimLink) => ({ ...l, is_mine: false })),
        );
      }

      // Check if already submitted
      const ratingResponse = await api.get(
        `${API_BASE_URL}/api/content-rating/my-rating/${contentId}`,
      );

      if (
        ratingResponse.data.success &&
        ratingResponse.data.data.content_rating
      ) {
        const rating = ratingResponse.data.data.content_rating;
        if (rating.completed && rating.approval_status === "pending") {
          setAlreadySubmitted(true);
        }
      }
    } catch (error: any) {
      console.error("Error loading claim links:", error);
      if (error.response?.status !== 404) {
        toast({
          title: "Error",
          description:
            error.response?.data?.error || "Failed to load claim links",
          status: "error",
          duration: 5000,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper: Get claim_link_ids that belong to this content
  const getClaimLinksForContent = async (links: ClaimLink[]) => {
    try {
      const userId = user?.user_id;
      // Get all claims for this content using the existing endpoint (scope=all to include all claims)
      const claimsResponse = await api.get(
        `${API_BASE_URL}/api/claims/${contentId}?viewerId=${userId || ""}&scope=all`,
      );

      if (claimsResponse.data && Array.isArray(claimsResponse.data)) {
        const contentClaimIds = new Set(
          claimsResponse.data.map((c: any) => c.claim_id),
        );

        // Filter links where target_claim_id is in this content
        return links
          .filter((link) => contentClaimIds.has(link.target_claim_id))
          .map((link) => link.claim_link_id);
      }
    } catch (error) {
      console.error("Error loading content claims:", error);
    }
    return [];
  };

  const toggleLinkSelection = useCallback((linkId: number) => {
    setSelectedLinkIds((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(linkId)) {
        newSelected.delete(linkId);
      } else {
        newSelected.add(linkId);
      }
      return newSelected;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (selectedLinkIds.size === 0) {
      toast({
        title: "No Evidence Links Selected",
        description: "Select at least one claim link before submitting",
        status: "warning",
        duration: 5000,
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post(
        `${API_BASE_URL}/api/content-rating/submit`,
        {
          content_id: contentId,
          claim_link_ids: Array.from(selectedLinkIds),
        },
      );

      if (response.data.success) {
        toast({
          title: "Submitted for Review!",
          description: `Your evidence chain with ${selectedLinkIds.size} links has been submitted for peer evaluation`,
          status: "success",
          duration: 5000,
        });

        onSuccess?.();
        onClose();
      }
    } catch (error: any) {
      console.error("Error submitting rating:", error);
      toast({
        title: "Error",
        description: error.response?.data?.error || "Failed to submit rating",
        status: "error",
        duration: 5000,
      });
    } finally {
      setSubmitting(false);
    }
  }, [selectedLinkIds, contentId, toast, onSuccess, onClose]);

  const getRelationshipBadge = useCallback((relationship: string) => {
    switch (relationship) {
      case "support":
        return <Badge className="mr-badge mr-badge-green">Supports</Badge>;
      case "refute":
        return <Badge className="mr-badge mr-badge-red">Refutes</Badge>;
      case "nuance":
        return <Badge className="mr-badge mr-badge-purple">Nuances</Badge>;
      default:
        return <Badge className="mr-badge mr-badge-blue">{relationship}</Badge>;
    }
  }, []);

  // Memoize filtered lists with pagination - OPTIMIZED to prevent recalculation
  const filteredMyLinks = useMemo(() => {
    if (searchFilter === "") {
      return myContentClaimLinks.slice(0, showMyLinksCount);
    }
    const lowerSearch = searchFilter.toLowerCase();
    const filtered = myContentClaimLinks.filter(
      (link) =>
        link.source_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.target_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.relationship?.toLowerCase().includes(lowerSearch),
    );
    return filtered.slice(0, showMyLinksCount);
  }, [myContentClaimLinks, searchFilter, showMyLinksCount]);

  const filteredOtherLinks = useMemo(() => {
    if (searchFilter === "") {
      return otherClaimLinks.slice(0, showOtherLinksCount);
    }
    const lowerSearch = searchFilter.toLowerCase();
    const filtered = otherClaimLinks.filter(
      (link) =>
        link.source_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.target_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.relationship?.toLowerCase().includes(lowerSearch),
    );
    return filtered.slice(0, showOtherLinksCount);
  }, [otherClaimLinks, searchFilter, showOtherLinksCount]);

  const totalMyLinks = useMemo(() => {
    if (searchFilter === "") return myContentClaimLinks.length;
    const lowerSearch = searchFilter.toLowerCase();
    return myContentClaimLinks.filter(
      (link) =>
        link.source_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.target_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.relationship?.toLowerCase().includes(lowerSearch),
    ).length;
  }, [myContentClaimLinks, searchFilter]);

  const totalOtherLinks = useMemo(() => {
    if (searchFilter === "") return otherClaimLinks.length;
    const lowerSearch = searchFilter.toLowerCase();
    return otherClaimLinks.filter(
      (link) =>
        link.source_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.target_claim_text?.toLowerCase().includes(lowerSearch) ||
        link.relationship?.toLowerCase().includes(lowerSearch),
    ).length;
  }, [otherClaimLinks, searchFilter]);

  // Memoize counts to prevent re-filtering on every render
  const selectedCount = selectedLinkIds.size;
  const mySelectedCount = useMemo(
    () =>
      myContentClaimLinks.filter((l) => selectedLinkIds.has(l.claim_link_id))
        .length,
    [myContentClaimLinks, selectedLinkIds],
  );
  const otherSelectedCount = useMemo(
    () =>
      otherClaimLinks.filter((l) => selectedLinkIds.has(l.claim_link_id))
        .length,
    [otherClaimLinks, selectedLinkIds],
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
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
          <HStack>
            <Icon as={FiAward} boxSize={6} />
            <Text>Curate Your Evidence Chain</Text>
          </HStack>
        </ModalHeader>
        <ModalCloseButton zIndex={10} />

        <ModalBody position="relative" zIndex={1}>
          <VStack spacing={6} align="stretch">
            {/* Content Info */}
            <Box
              className="mr-card mr-card-blue"
              bg="transparent"
              p={4}
              borderRadius="12px"
              position="relative"
            >
              <div className="mr-glow-bar mr-glow-bar-blue" />
              <div className="mr-scanlines" />
              <Box position="relative" zIndex={1}>
                <Text fontSize="sm" className="mr-text-secondary" mb={2}>
                  Content:
                </Text>
                {contentUrl ? (
                  <Link
                    href={contentUrl}
                    isExternal
                    color="blue.400"
                    fontWeight="bold"
                  >
                    <Icon as={FiExternalLink} mr={1} />
                    {contentTitle || contentUrl}
                  </Link>
                ) : (
                  <Text fontWeight="bold">Content ID: {contentId}</Text>
                )}
              </Box>
            </Box>

            {/* Loading State */}
            {loading && (
              <Flex justify="center" py={8}>
                <Spinner size="xl" className="mr-blue-text" />
              </Flex>
            )}

            {/* Already Submitted Warning */}
            {!loading && alreadySubmitted && (
              <Alert
                status="info"
                bg="rgba(0, 162, 255, 0.1)"
                borderRadius="8px"
                borderLeft="4px solid var(--mr-blue)"
              >
                <AlertIcon />
                <Box>
                  <AlertTitle>Already Submitted</AlertTitle>
                  <AlertDescription>
                    You've already submitted this evidence chain for review.
                    It's pending evaluation.
                  </AlertDescription>
                </Box>
              </Alert>
            )}

            {!loading && (
              <>
                {/* Statistics */}
                <StatGroup
                  className="mr-card mr-card-purple"
                  bg="transparent"
                  p={4}
                  borderRadius="12px"
                  position="relative"
                >
                  <div className="mr-glow-bar mr-glow-bar-purple" />
                  <div className="mr-scanlines" />
                  <Stat position="relative" zIndex={1}>
                    <StatLabel className="mr-text-secondary">
                      Selected Links
                    </StatLabel>
                    <StatNumber color="var(--mr-green)">
                      <Icon as={FiCheckCircle} mr={2} />
                      {selectedCount}
                    </StatNumber>
                  </Stat>
                  <Stat position="relative" zIndex={1}>
                    <StatLabel className="mr-text-secondary">
                      My Links
                    </StatLabel>
                    <StatNumber color="var(--mr-blue)">
                      {mySelectedCount}
                    </StatNumber>
                  </Stat>
                  <Stat position="relative" zIndex={1}>
                    <StatLabel className="mr-text-secondary">
                      Borrowed Links
                    </StatLabel>
                    <StatNumber color="var(--mr-purple)">
                      {otherSelectedCount}
                    </StatNumber>
                  </Stat>
                </StatGroup>

                {/* Search Filter */}
                <InputGroup>
                  <InputLeftElement>
                    <Icon as={FiSearch} color="gray.400" />
                  </InputLeftElement>
                  <Input
                    placeholder="Search claim links..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    bg="rgba(15, 23, 42, 0.6)"
                    borderColor="var(--mr-blue-border)"
                    _hover={{ borderColor: "var(--mr-blue)" }}
                    _focus={{
                      borderColor: "var(--mr-blue)",
                      boxShadow: "0 0 0 1px var(--mr-blue)",
                    }}
                  />
                </InputGroup>

                {/* Tabs: My Links / Other Users' Links */}
                <Box className="mr-card mr-card-purple" bg="transparent" borderRadius="12px" p={4} position="relative">
                  <div className="mr-glow-bar mr-glow-bar-purple" />
                  <div className="mr-scanlines" />
                  <Tabs colorScheme="green" variant="enclosed" position="relative" zIndex={1}>
                    <TabList borderColor="var(--mr-purple-border)">
                      <Tab
                        _selected={{
                          color: "var(--mr-green)",
                          borderColor: "var(--mr-green)",
                          borderBottomColor: "transparent",
                          bg: "rgba(34, 197, 94, 0.1)"
                        }}
                        _hover={{ color: "var(--mr-blue)" }}
                      >
                        My Claim Links for This Content (
                        {myContentClaimLinks.length})
                      </Tab>
                      <Tab
                        _selected={{
                          color: "var(--mr-purple)",
                          borderColor: "var(--mr-purple)",
                          borderBottomColor: "transparent",
                          bg: "rgba(139, 92, 246, 0.1)"
                        }}
                        _hover={{ color: "var(--mr-blue)" }}
                      >
                        Other Users' Links for This Content (
                        {otherClaimLinks.length})
                      </Tab>
                    </TabList>

                  <TabPanels>
                    {/* My Links Tab */}
                    <TabPanel px={0}>
                      {myContentClaimLinks.length === 0 ? (
                        <Alert
                          status="warning"
                          bg="rgba(234, 179, 8, 0.1)"
                          borderRadius="8px"
                          borderLeft="4px solid var(--mr-yellow)"
                        >
                          <AlertIcon />
                          <Box>
                            <AlertTitle>
                              No Claim Links for This Content
                            </AlertTitle>
                            <AlertDescription>
                              Create claim links for this content using
                              Workspace, Claim Duel, or Claim Focus. You have{" "}
                              {myClaimLinks.length} total claim links across all
                              content.
                            </AlertDescription>
                          </Box>
                        </Alert>
                      ) : (
                        <VStack
                          spacing={3}
                          align="stretch"
                          minH="400px"
                          overflowY="auto"
                        >
                          {filteredMyLinks.map((link) => (
                            <ClaimLinkItem
                              key={link.claim_link_id}
                              link={link}
                              isSelected={selectedLinkIds.has(
                                link.claim_link_id,
                              )}
                              onToggle={toggleLinkSelection}
                              getRelationshipBadge={getRelationshipBadge}
                            />
                          ))}
                          {filteredMyLinks.length < totalMyLinks && (
                            <Button
                              className="mr-button"
                              onClick={() =>
                                setShowMyLinksCount((prev) => prev + 20)
                              }
                              variant="outline"
                              w="full"
                            >
                              Load More ({totalMyLinks - filteredMyLinks.length} remaining)
                            </Button>
                          )}
                        </VStack>
                      )}
                    </TabPanel>

                    {/* Other Users' Links Tab */}
                    <TabPanel px={0}>
                      {otherClaimLinks.length === 0 ? (
                        <Alert
                          status="info"
                          bg="rgba(0, 162, 255, 0.1)"
                          borderRadius="8px"
                          borderLeft="4px solid var(--mr-blue)"
                        >
                          <AlertIcon />
                          <Box>
                            <AlertDescription>
                              No other users have created claim links for this
                              content yet
                            </AlertDescription>
                          </Box>
                        </Alert>
                      ) : (
                        <VStack
                          spacing={3}
                          align="stretch"
                          minH="400px"
                          overflowY="auto"
                        >
                          {filteredOtherLinks.map((link) => (
                            <ClaimLinkItem
                              key={link.claim_link_id}
                              link={link}
                              isSelected={selectedLinkIds.has(
                                link.claim_link_id,
                              )}
                              onToggle={toggleLinkSelection}
                              getRelationshipBadge={getRelationshipBadge}
                            />
                          ))}
                          {filteredOtherLinks.length < totalOtherLinks && (
                            <Button
                              className="mr-button"
                              onClick={() =>
                                setShowOtherLinksCount((prev) => prev + 20)
                              }
                              variant="outline"
                              w="full"
                            >
                              Load More ({totalOtherLinks - filteredOtherLinks.length} remaining)
                            </Button>
                          )}
                        </VStack>
                      )}
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </Box>

                {/* Info Box */}
                {selectedCount > 0 && (
                  <Alert
                    status="info"
                    bg="rgba(74, 222, 128, 0.1)"
                    borderRadius="8px"
                    borderLeft="4px solid var(--mr-green)"
                  >
                    <AlertIcon as={FiCheckCircle} />
                    <Box fontSize="sm">
                      <AlertDescription>
                        Your evidence chain will be peer-reviewed by users with
                        same or higher role. 2 approvals needed to pass. You'll
                        earn points based on quality.
                      </AlertDescription>
                    </Box>
                  </Alert>
                )}
              </>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter position="relative" zIndex={1}>
          <HStack spacing={3}>
            <Button className="mr-button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!alreadySubmitted && selectedCount > 0 && (
              <Button
                className="mr-button"
                onClick={handleSubmit}
                isLoading={submitting}
                leftIcon={<FiAward />}
              >
                Submit {selectedCount} Link{selectedCount !== 1 ? "s" : ""} for
                Review
              </Button>
            )}
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SubmitRatingModal;
