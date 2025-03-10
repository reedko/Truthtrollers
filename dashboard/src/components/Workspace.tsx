import React, { useEffect, useState } from "react";
import {
  Box,
  Grid,
  Heading,
  VStack,
  Text,
  Button,
  HStack,
  useColorModeValue,
  Tooltip,
} from "@chakra-ui/react";
import { Claim, LitReference } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchReferencesForTask,
  createClaim,
  updateClaim,
  deleteClaim,
} from "../services/useDashboardAPI";
import ClaimModal from "./ClaimModal";

interface WorkspaceProps {
  contentId: number;
}

const Workspace: React.FC<WorkspaceProps> = ({ contentId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [references, setReferences] = useState<LitReference[]>([]);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);

  const handleCreateClaim = async (claimText: string) => {
    const newClaim = await createClaim(claimText, contentId);
    if (newClaim) setClaims([...claims, newClaim]);
  };

  const handleUpdateClaim = async (claimText: string, claimId?: number) => {
    if (claimId === undefined) {
      console.error("⚠️ Attempted to update a claim without a valid claimId.");
      return;
    }

    await updateClaim(claimText, claimId ? claimId : 0);
    setClaims(
      claims.map((claim) =>
        claim.claim_id === claimId ? { ...claim, claim_text: claimText } : claim
      )
    );
  };

  const handleDeleteClaim = async (claimId: number) => {
    await deleteClaim(claimId);
    setClaims(claims.filter((claim) => claim.claim_id !== claimId));
  };

  useEffect(() => {
    if (!contentId) return;
    const loadClaims = async () => {
      const claimsData = await fetchClaimsForTask(contentId);
      setClaims(claimsData);
    };
    loadClaims();
  }, [contentId]);

  // ✅ Background adapts to light/dark mode
  const bgColor = useColorModeValue("gray.50", "gray.800");
  const borderColor = useColorModeValue("gray.300", "gray.600");

  useEffect(() => {
    const loadReferences = async () => {
      const refs = await fetchReferencesForTask(contentId);
      setReferences(refs);
    };
    loadReferences();
  }, [contentId]);

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={bgColor}
      borderColor={borderColor}
      height="900px" // 🔥 3x taller
      overflow="hidden"
    >
      <Heading size="md" mb={2}>
        Claim Analysis
      </Heading>

      <Grid templateColumns="2fr 2fr 1fr" gap={4} height="100%">
        {/* Left Column: Claims */}
        <VStack
          align="start"
          spacing={2}
          borderRight="1px solid"
          borderColor={borderColor}
          pr={4}
          overflowY="auto" // 🔥 Allow scrolling if needed
          maxHeight="800px"
        >
          <Heading size="sm">Claims</Heading>

          {/* New Claim Button */}
          <Button colorScheme="blue" onClick={() => setIsClaimModalOpen(true)}>
            + Add Claim
          </Button>

          {claims.length === 0 ? (
            <Text>No claims found.</Text>
          ) : (
            claims.map((claim) => (
              <HStack key={claim.claim_id} width="100%" spacing={2}>
                {/* Selectable Claim */}
                <Tooltip label={claim.claim_text} hasArrow>
                  <Button
                    key={claim.claim_id}
                    variant={
                      selectedClaim?.claim_id === claim.claim_id
                        ? "solid"
                        : "outline"
                    }
                    colorScheme="blue"
                    onClick={() => {
                      console.log("Selected claim:", claim);
                      setSelectedClaim(claim);
                    }}
                    width="100%"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap" // ✅ Truncates long text
                  >
                    {claim.claim_text}
                  </Button>
                </Tooltip>
                {/* Edit Button */}
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingClaim(claim);
                    setIsClaimModalOpen(true);
                  }}
                >
                  ✏️
                </Button>

                {/* Delete Button */}
                <Button
                  size="sm"
                  colorScheme="red"
                  onClick={() => handleDeleteClaim(claim.claim_id)}
                >
                  🗑️
                </Button>
              </HStack>
            ))
          )}
        </VStack>

        {/* Middle Column: Support / Refutation */}
        {/* Middle Column: Support / Refutation */}
        <VStack
          align="center"
          spacing={2}
          borderRight="1px solid"
          borderColor={borderColor}
          pr={4}
          overflowY="auto"
          maxHeight="800px"
        >
          <Heading size="sm">Support / Refutation</Heading>
          {selectedClaim ? (
            selectedClaim.references && selectedClaim.references.length > 0 ? (
              selectedClaim.references.map((ref) => (
                <HStack
                  key={ref.reference_content_id ?? Math.random()}
                  spacing={4}
                >
                  <Text>{ref.content_name || "Unnamed Reference"}</Text>
                  <Text color={ref.support_level > 0 ? "green.500" : "red.500"}>
                    {ref.support_level > 0
                      ? `+${ref.support_level}`
                      : `${ref.support_level}`}
                  </Text>
                </HStack>
              ))
            ) : (
              <Text>No references linked to this claim yet.</Text>
            )
          ) : (
            <Text>Select a claim to see relationships</Text>
          )}
        </VStack>

        {/* Right Column: References */}
        <VStack align="start" spacing={2} overflowY="auto" maxHeight="800px">
          <Heading size="sm">References</Heading>
          {references.length > 0 ? (
            references.map((ref) => (
              <Text key={ref.reference_content_id}>
                <a href={ref.url} target="_blank" rel="noopener noreferrer">
                  🔗 {ref.content_name}
                </a>
              </Text>
            ))
          ) : (
            <Text>No references available.</Text>
          )}
        </VStack>
      </Grid>
      {/* ✅ Place the modal right after the claims column (outside Grid) */}
      <ClaimModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        onSave={editingClaim ? handleUpdateClaim : handleCreateClaim}
        editingClaim={editingClaim}
      />
    </Box>
  );
};

export default Workspace;
