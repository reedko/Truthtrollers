import React, { useEffect, useState } from "react";
import {
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Box,
  Text,
  VStack,
  Tooltip,
  Spinner,
  Card,
  CardBody,
} from "@chakra-ui/react";
import DiscussionCard from "./DiscussionCard";
import DiscussionComposer from "./DiscussionComposer";
import { Claim, DiscussionEntry } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchDiscussionEntries,
} from "../services/useDashboardAPI";

interface DiscussionBoardProps {
  contentId: number;
}

const DiscussionBoard: React.FC<DiscussionBoardProps> = ({ contentId }) => {
  const [entries, setEntries] = useState<DiscussionEntry[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [linkedClaimId, setLinkedClaimId] = useState<number | null>(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState<number>(0);

  useEffect(() => {
    const load = async () => {
      const [allEntries, allClaims] = await Promise.all([
        fetchDiscussionEntries(contentId),
        fetchClaimsForTask(contentId),
      ]);
      setEntries(allEntries);
      setClaims(allClaims);
    };
    load();
  }, [contentId]);

  const handleNewEntry = (entry: DiscussionEntry) => {
    setEntries((prev) => [...prev, entry]);
  };

  const filteredEntries = entries.filter((e) => {
    if (linkedClaimId === null) return true; // "All"
    if (linkedClaimId === -1) return !e.linked_claim_id; // "No Claim"
    return e.linked_claim_id === linkedClaimId;
  });

  const proEntries = filteredEntries.filter((e) => e.side === "pro");
  const conEntries = filteredEntries.filter((e) => e.side === "con");

  return (
    <Card mt={6} bg="stat2Gradient">
      <CardBody px={6} py={4}>
        <Tabs
          colorScheme="blue"
          size="sm"
          variant="soft-rounded"
          index={selectedTabIndex}
          onChange={(index) => {
            setSelectedTabIndex(index);
            if (index === 0) setLinkedClaimId(null);
            else if (index === 1) setLinkedClaimId(-1);
            else setLinkedClaimId(claims[index - 2]?.claim_id ?? null);
          }}
        >
          <TabList overflowX="auto" whiteSpace="nowrap" maxW="100%">
            <Tab key="all">🗂️ All</Tab>
            <Tab key="none">❓ No Claim</Tab>
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

        {linkedClaimId && linkedClaimId > 0 && (
          <Box mt={3} p={3} bg="gray.700" color="white" borderRadius="md">
            <Text fontWeight="bold">Claim:</Text>
            <Text>
              {claims.find((c) => c.claim_id === linkedClaimId)?.claim_text}
            </Text>
          </Box>
        )}

        <Box mt={6}>
          <DiscussionComposer
            contentId={contentId}
            linkedClaimId={
              linkedClaimId && linkedClaimId > 0 ? linkedClaimId : undefined
            }
            onSubmit={handleNewEntry}
          />
        </Box>

        <Box mt={6}>
          <Box
            display="flex"
            flexDirection={{ base: "column", md: "row" }}
            gap={6}
            alignItems="flex-start"
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
