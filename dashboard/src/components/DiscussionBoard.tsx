// src/components/DiscussionBoard.tsx
import React, { useEffect, useState } from "react";
import {
  Tabs,
  TabList,
  Tab,
  Box,
  Text,
  VStack,
  Tooltip,
  Card,
  CardBody,
  Button,
} from "@chakra-ui/react";
import DiscussionCard from "./DiscussionCard";
import DiscussionComposer from "./DiscussionComposer";
import { Claim, DiscussionEntry } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchDiscussionEntries,
} from "../services/useDashboardAPI";
import { useAuthStore } from "../store/useAuthStore"; // 🆕 auth store
import { Link as RouterLink } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

interface DiscussionBoardProps {
  contentId: number;
}

const DiscussionBoard: React.FC<DiscussionBoardProps> = ({ contentId }) => {
  const [entries, setEntries] = useState<DiscussionEntry[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [linkedClaimId, setLinkedClaimId] = useState<number | null>(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState<number>(0);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  /* 🆕 read-only test */
  const user = useAuthStore((s) => s.user);
  const readOnly = !user || user.can_post === false;

  /* fetch entries + claims once per contentId */
  useEffect(() => {
    const load = async () => {
      const [allEntries, allClaims] = await Promise.all([
        fetchDiscussionEntries(contentId),
        fetchClaimsForTask(contentId, viewerId),
      ]);
      setEntries(allEntries);
      setClaims(allClaims);
    };
    load();
  }, [contentId]);

  const handleNewEntry = (entry: DiscussionEntry) =>
    setEntries((prev) => [...prev, entry]);

  /* filter + groups */
  const filteredEntries = entries.filter((e) => {
    if (linkedClaimId === null) return true;
    if (linkedClaimId === -1) return !e.linked_claim_id;
    return e.linked_claim_id === linkedClaimId;
  });
  const proEntries = filteredEntries.filter((e) => e.side === "pro");
  const conEntries = filteredEntries.filter((e) => e.side === "con");

  return (
    <Card mt={6} bg="stat2Gradient">
      <CardBody px={6} py={4}>
        {/* ---------------- Tabs for claim filter ---------------- */}
        <Tabs
          colorScheme="blue"
          size="sm"
          variant="soft-rounded"
          index={selectedTabIndex}
          onChange={(index) => {
            setSelectedTabIndex(index);
            if (index === 0) setLinkedClaimId(null); // All
            else if (index === 1) setLinkedClaimId(-1); // No Claim
            else setLinkedClaimId(claims[index - 2]?.claim_id ?? null);
          }}
        >
          <TabList overflowX="auto" whiteSpace="nowrap" maxW="100%">
            <Tab>🗂️ All</Tab>
            <Tab>❓ No Claim</Tab>
            {claims.map((claim) => (
              <Tooltip
                key={claim.claim_id}
                label={claim.claim_text}
                hasArrow
                placement="top"
              >
                <Tab maxW="150px" textOverflow="ellipsis" overflow="hidden">
                  {claim.claim_text}
                </Tab>
              </Tooltip>
            ))}
          </TabList>
        </Tabs>

        {/* ---------------- Selected claim banner ---------------- */}
        {linkedClaimId && linkedClaimId > 0 && (
          <Box mt={3} p={3} bg="gray.700" color="white" borderRadius="md">
            <Text fontWeight="bold">Claim:</Text>
            <Text>
              {claims.find((c) => c.claim_id === linkedClaimId)?.claim_text}
            </Text>
          </Box>
        )}

        {/* ---------------- Composer (only if allowed) ----------- */}
        {!readOnly && (
          <Box mt={6}>
            <DiscussionComposer
              contentId={contentId}
              linkedClaimId={
                linkedClaimId && linkedClaimId > 0 ? linkedClaimId : undefined
              }
              onSubmit={handleNewEntry}
            />
          </Box>
        )}

        {readOnly && (
          <Box
            border="1px solid"
            borderColor="yellow.300"
            bg="yellow.50"
            p={4}
            mb={4}
            borderRadius="md"
            textAlign="center"
          >
            <Text mb={2} color="gray.700">
              You’re in read-only demo mode. Log in to join the discussion.
            </Text>
            <Button as={RouterLink} to="/login" colorScheme="teal" size="sm">
              Log In
            </Button>
          </Box>
        )}

        {/* ---------------- Entry lists -------------------------- */}
        <Box mt={6}>
          <Box
            display="flex"
            flexDirection={{ base: "column", md: "row" }}
            gap={6}
          >
            <Box flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="green.400" mb={2}>
                ✅ Supporting
              </Text>
              <VStack spacing={4} align="stretch">
                {proEntries.map((entry) => (
                  <DiscussionCard key={entry.id} entry={entry} />
                ))}
              </VStack>
            </Box>
            <Box flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="red.400" mb={2}>
                ❌ Challenging
              </Text>
              <VStack spacing={4} align="stretch">
                {conEntries.map((entry) => (
                  <DiscussionCard key={entry.id} entry={entry} />
                ))}
              </VStack>
            </Box>
          </Box>
        </Box>
      </CardBody>
    </Card>
  );
};

export default DiscussionBoard;
