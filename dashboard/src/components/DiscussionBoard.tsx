// src/components/DiscussionBoard.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Text,
  VStack,
  Tooltip,
  Card,
  CardBody,
  Button,
  HStack,
  Badge,
  Flex,
} from "@chakra-ui/react";
import DiscussionCard from "./DiscussionCard";
import DiscussionComposer from "./DiscussionComposer";
import { Claim, DiscussionEntry } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchDiscussionEntries,
} from "../services/useDashboardAPI";
import { useAuthStore } from "../store/useAuthStore";
import { Link as RouterLink } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import ClaimCard from "./ClaimCard";

interface DiscussionBoardProps {
  contentId: number;
}

const DiscussionBoard: React.FC<DiscussionBoardProps> = ({ contentId }) => {
  const [entries, setEntries] = useState<DiscussionEntry[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [linkedClaimId, setLinkedClaimId] = useState<number | null>(null);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const user = useAuthStore((s) => s.user);
  const readOnly = !user || user.can_post === false;

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
  }, [contentId, viewerId]);

  const handleNewEntry = (entry: DiscussionEntry) =>
    setEntries((prev) => [...prev, entry]);

  // counts per-claim
  const claimCounts = useMemo(() => {
    const map: Record<number, { total: number; pro: number; con: number }> = {};
    for (const c of claims) map[c.claim_id] = { total: 0, pro: 0, con: 0 };
    for (const e of entries) {
      if (!e.linked_claim_id) continue;
      const slot =
        map[e.linked_claim_id] ||
        (map[e.linked_claim_id] = { total: 0, pro: 0, con: 0 });
      slot.total += 1;
      if (e.side === "pro") slot.pro += 1;
      if (e.side === "con") slot.con += 1;
    }
    return map;
  }, [claims, entries]);

  // filtering
  const filteredEntries = entries.filter((e) => {
    if (linkedClaimId === null) return true;
    if (linkedClaimId === -1) return !e.linked_claim_id;
    return e.linked_claim_id === linkedClaimId;
  });
  const proEntries = filteredEntries.filter((e) => e.side === "pro");
  const conEntries = filteredEntries.filter((e) => e.side === "con");

  // summary chips
  const totalReplies = filteredEntries.length;
  const totalSources = new Set(
    filteredEntries.flatMap((e) => e.source_urls || [])
  ).size;

  return (
    <Card mt={6} bg="stat2Gradient">
      <CardBody px={6} py={4}>
        {/* --------- Claim Pills Row --------- */}
        <Flex gap={2} overflowX="auto" pb={2}>
          <Button
            size="sm"
            variant={linkedClaimId === null ? "solid" : "outline"}
            colorScheme="blue"
            onClick={() => setLinkedClaimId(null)}
            flexShrink={0}
          >
            🗂️ All
          </Button>
          <Button
            size="sm"
            variant={linkedClaimId === -1 ? "solid" : "outline"}
            onClick={() => setLinkedClaimId(-1)}
            flexShrink={0}
          >
            ❓ No Claim
          </Button>

          {claims.map((c) => (
            <Box key={c.claim_id} flexShrink={0}>
              <ClaimCard
                variant="pill"
                claimId={c.claim_id}
                claimText={c.claim_text}
                supportLevel={0}
                notes=""
                viewerId={viewerId}
                sourceClaim={{ ...c }}
                targetClaim={{ ...c, content_id: contentId }}
                onClickPill={() => setLinkedClaimId(c.claim_id)}
              />
              <HStack mt={1} spacing={2} justify="center">
                <Badge colorScheme="gray">
                  {claimCounts[c.claim_id]?.total || 0} replies
                </Badge>
                {claimCounts[c.claim_id]?.pro ? (
                  <Badge colorScheme="green">
                    {claimCounts[c.claim_id].pro} pro
                  </Badge>
                ) : null}
                {claimCounts[c.claim_id]?.con ? (
                  <Badge colorScheme="red">
                    {claimCounts[c.claim_id].con} con
                  </Badge>
                ) : null}
              </HStack>
            </Box>
          ))}
        </Flex>

        {/* --------- Selected claim banner --------- */}
        {linkedClaimId && linkedClaimId > 0 && (
          <Box mt={3} p={3} bg="gray.700" color="white" borderRadius="md">
            <Text fontWeight="bold">Claim:</Text>
            <Text>
              {claims.find((c) => c.claim_id === linkedClaimId)?.claim_text}
            </Text>
          </Box>
        )}

        {/* --------- Composer --------- */}
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

        {/* --------- Summary Chips --------- */}
        <HStack mt={4} spacing={3}>
          <Badge colorScheme="purple">🔥 {totalReplies} replies</Badge>
          <Badge colorScheme="cyan">🔗 {totalSources} sources</Badge>
        </HStack>

        {/* --------- Lists with subtle motion --------- */}
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
                  <Box
                    key={entry.id}
                    transition="all 120ms ease"
                    _hover={{ transform: "translateY(-2px)" }}
                  >
                    <DiscussionCard entry={entry} />
                  </Box>
                ))}
              </VStack>
            </Box>
            <Box flex={1}>
              <Text fontSize="lg" fontWeight="bold" color="red.400" mb={2}>
                ❌ Challenging
              </Text>
              <VStack spacing={4} align="stretch">
                {conEntries.map((entry) => (
                  <Box
                    key={entry.id}
                    transition="all 120ms ease"
                    _hover={{ transform: "translateY(-2px)" }}
                  >
                    <DiscussionCard entry={entry} />
                  </Box>
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
