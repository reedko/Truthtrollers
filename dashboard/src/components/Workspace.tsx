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
} from "@chakra-ui/react";
import { Claim, LitReference } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchReferencesForTask,
} from "../services/useWorkspaceData";

interface WorkspaceProps {
  contentId: number;
}

const Workspace: React.FC<WorkspaceProps> = ({ contentId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [references, setReferences] = useState<LitReference[]>([]);

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
          {claims.length === 0 ? (
            <Text>No claims found.</Text>
          ) : (
            claims.map((claim) => (
              <Button
                key={claim.claim_id}
                variant={
                  selectedClaim?.claim_id === claim.claim_id
                    ? "solid"
                    : "outline"
                }
                colorScheme="blue"
                onClick={() => setSelectedClaim(claim)}
                width="100%" // Full width
              >
                {claim.claim_text}
              </Button>
            ))
          )}
        </VStack>

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
            selectedClaim.references.map((ref) => (
              <HStack key={ref.reference_content_id} spacing={4}>
                <Text>{ref.content_name}</Text>
                <Text color={ref.support_level > 0 ? "green.500" : "red.500"}>
                  {ref.support_level > 0
                    ? `+${ref.support_level}`
                    : `${ref.support_level}`}
                </Text>
              </HStack>
            ))
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
    </Box>
  );
};

export default Workspace;
