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
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import { Claim, LitReference } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchReferencesForTask,
  createClaim,
  updateClaim,
  deleteClaim,
  updateReference,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";
import ClaimModal from "./ClaimModal";
import ReferenceModal from "./ReferenceModal";

interface WorkspaceProps {
  contentId: number;
}

const Workspace: React.FC<WorkspaceProps> = ({ contentId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [references, setReferences] = useState<LitReference[]>([]);
  const [selectedReference, setSelectedReference] =
    useState<LitReference | null>(null);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [editingReference, setEditingReference] = useState<LitReference | null>(
    null
  );
  const [isEditingReference, setIsEditingReference] = useState(false);
  const [referenceTitle, setReferenceTitle] = useState("");
  const [isReferenceEditModalOpen, setIsReferenceEditModalOpen] =
    useState(false);
  const [refreshReferences, setRefreshReferences] = useState(false);

  useEffect(() => {
    if (!contentId) return;
    const loadClaims = async () => {
      const claimsData = await fetchClaimsForTask(contentId);
      setClaims(claimsData);
    };
    loadClaims();
  }, [contentId]);

  useEffect(() => {
    const loadReferences = async () => {
      const refs = await fetchReferencesForTask(contentId);
      setReferences(refs);
    };
    loadReferences();
  }, [contentId, refreshReferences]); // 🔥 Now watching refreshReferences

  const handleCreateClaim = async (claimText: string) => {
    const newClaim = await createClaim(claimText, contentId);
    if (newClaim) setClaims([...claims, newClaim]);
  };

  const handleOpenReference = (url: string) => {
    window.open(url, "_blank");
  };

  const handleUpdateClaim = async (claimId: number, claimText: string) => {
    await updateClaim(claimId, claimText);
    setClaims(
      claims.map((claim) =>
        claim.claim_id === claimId ? { ...claim, claim_text: claimText } : claim
      )
    );
    setEditingClaim(null);
    setIsClaimModalOpen(false);
  };
  const handleUpdateReference = async () => {
    if (editingReference && referenceTitle.trim()) {
      await updateReference(
        referenceTitle,
        editingReference.reference_content_id
      );
      setReferences(
        references.map((ref) =>
          ref.reference_content_id === editingReference.reference_content_id
            ? { ...ref, content_name: referenceTitle }
            : ref
        )
      );
      setRefreshReferences((prev) => !prev); // ✅ Ensure list refresh
      setEditingReference(null);
      setIsReferenceEditModalOpen(false);
      setReferenceTitle("");
    }
  };

  const bgColor = useColorModeValue("gray.50", "gray.800");
  const borderColor = useColorModeValue("gray.300", "gray.600");

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={bgColor}
      borderColor={borderColor}
      height="900px"
      overflow="hidden"
    >
      <Heading size="md" mb={2}>
        Claim Analysis
      </Heading>

      <Grid templateColumns="2fr 2fr 2fr" gap={4} height="100%">
        {/* Left Column: Claims */}
        <VStack
          align="start"
          spacing={2}
          borderRight="1px solid"
          borderColor={borderColor}
          pr={4}
          overflowY="auto"
          maxHeight="800px"
        >
          <Heading size="sm">Claims</Heading>
          <Button
            colorScheme="blue"
            onClick={() => {
              setEditingClaim(null);
              setIsClaimModalOpen(true);
            }}
          >
            + Add Claim
          </Button>
          {claims.length === 0 ? (
            <Text>No claims found.</Text>
          ) : (
            claims.map((claim) => (
              <HStack key={claim.claim_id} width="100%" spacing={2}>
                <Tooltip label={claim.claim_text} hasArrow>
                  <Button
                    variant={
                      selectedClaim?.claim_id === claim.claim_id
                        ? "solid"
                        : "outline"
                    }
                    colorScheme="blue"
                    onClick={() => setSelectedClaim(claim)}
                    width="100%"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                  >
                    {claim.claim_text}
                  </Button>
                </Tooltip>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingClaim(claim);
                    setIsClaimModalOpen(true);
                  }}
                >
                  ✏️
                </Button>
                <Button
                  size="sm"
                  colorScheme="red"
                  onClick={() => deleteClaim(claim.claim_id)}
                >
                  🗑️
                </Button>
              </HStack>
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

        {/* References Column */}
        <VStack
          align="start"
          spacing={2}
          borderRight="1px solid"
          borderColor={borderColor}
          pr={4}
          overflowY="auto"
          maxHeight="800px"
        >
          <Heading size="sm">References</Heading>
          <Button
            colorScheme="blue"
            onClick={() => setIsReferenceModalOpen(true)}
          >
            + Add Reference
          </Button>
          {references.length === 0 ? (
            <Text>No References Found</Text>
          ) : (
            references.map((ref) => (
              <HStack key={ref.reference_content_id} spacing={2} width="100%">
                <Tooltip label={ref.content_name} hasArrow>
                  <Button
                    variant={
                      selectedReference?.reference_content_id ===
                      ref.reference_content_id
                        ? "solid"
                        : "outline"
                    }
                    colorScheme="blue"
                    onClick={() => handleOpenReference(ref.url)}
                    width="100%"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                  >
                    {ref.content_name}
                  </Button>
                </Tooltip>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingReference(ref);
                    setReferenceTitle(ref.content_name);
                    setIsReferenceEditModalOpen(true);
                  }}
                >
                  Edit Title
                </Button>
                <Button
                  size="sm"
                  colorScheme="red"
                  onClick={
                    () => {
                      deleteReferenceFromTask(
                        contentId,
                        ref.reference_content_id
                      );
                      setRefreshReferences((prev) => !prev);
                    } // ✅ Trigger a re-fetch
                  }
                >
                  🗑️
                </Button>
              </HStack>
            ))
          )}{" "}
          {isEditingReference && (
            <Box>
              <Input
                value={referenceTitle}
                onChange={(e) => setReferenceTitle(e.target.value)}
                placeholder="Enter new title"
              />
              <Button
                colorScheme="green"
                onClick={handleUpdateReference}
                mt={2}
              >
                Save
              </Button>
            </Box>
          )}
        </VStack>
      </Grid>
      {/* Reference Edit Modal */}
      <Modal
        isOpen={isReferenceEditModalOpen}
        onClose={() => setIsReferenceEditModalOpen(false)}
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Reference Title</ModalHeader>
          <ModalBody>
            <Input
              value={referenceTitle}
              onChange={(e) => setReferenceTitle(e.target.value)}
              placeholder="Enter new title"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="green"
              onClick={handleUpdateReference}
              isDisabled={!referenceTitle.trim()}
            >
              Save
            </Button>
            <Button onClick={() => setIsReferenceEditModalOpen(false)} ml={2}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ClaimModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        onSave={(claimText) =>
          editingClaim
            ? handleUpdateClaim(editingClaim.claim_id, claimText)
            : handleCreateClaim(claimText)
        }
        editingClaim={editingClaim}
      />
      <ReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        taskId={contentId} // ✅ Keep this, since we need to know the task
      />
    </Box>
  );
};

export default Workspace;
