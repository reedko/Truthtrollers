import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Text,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Box,
  useToast,
  Tooltip,
  HStack,
  Badge,
  FormLabel,
  Textarea,
} from "@chakra-ui/react";
import {
  addClaimLink,
  fetchContentScores,
  updateScoresForContent,
  fetchLiveVerimeterScore,
} from "../../services/useDashboardAPI";
import { Claim } from "../../../../shared/entities/types";
import { ClaimLink } from "../RelationshipMap";
import { useTaskStore } from "../../store/useTaskStore";
import { useVerimeterMode } from "../../contexts/VerimeterModeContext";

interface ClaimLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  targetClaim: Claim | null;
  isReadOnly?: boolean;
  claimLink?: ClaimLink | null;
  onLinkCreated?: () => void;
  verimeter_score?: number;
  initialNotes?: string; // AI-generated rationale to pre-fill notes
  initialRelationship?: "supports" | "refutes";
  initialSupportLevel?: number;
}

const ClaimLinkModal: React.FC<ClaimLinkModalProps> = ({
  isOpen,
  onClose,
  sourceClaim,
  targetClaim,
  isReadOnly,
  claimLink,
  onLinkCreated,
  verimeter_score,
  initialNotes,
  initialRelationship,
  initialSupportLevel,
}) => {
  const toast = useToast();
  const { mode, aiWeight } = useVerimeterMode();
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);
  const viewerId = useTaskStore((s) => s.viewingUserId);

  // Convert initial support level from -1 to 1 range to -100 to 100 range
  const initialLevel = initialSupportLevel !== undefined
    ? initialSupportLevel * 100
    : (initialRelationship === 'refutes' ? -50 : 50);

  const [supportLevel, setSupportLevel] = useState(initialLevel);
  const [notes, setNote] = useState(claimLink?.notes || initialNotes || "");
  const [verimeterScore, setLocalVerimeterScore] = useState<number | null>(
    claimLink?.verimeter_score ?? null,
  );

  useEffect(() => {
    const shouldFetch =
      isReadOnly &&
      isOpen &&
      targetClaim?.claim_id &&
      viewerId &&
      verimeterScore === null;

    if (shouldFetch) {
      fetchLiveVerimeterScore(targetClaim.claim_id, viewerId)
        .then((result) => {
          if (
            Array.isArray(result) &&
            typeof result[0]?.verimeter_score === "number"
          ) {
            setLocalVerimeterScore(result[0].verimeter_score);
          }
        })
        .catch((err) => {
          console.error("Error fetching verimeter score in modal:", err);
        });
    }
  }, [isReadOnly, isOpen, targetClaim?.claim_id, viewerId, verimeterScore]);

  // Helper function to determine relationship and color based on support level
  // STANDARDIZED THRESHOLDS: -15 to +15 is nuanced, outside is support/refute
  const getStanceInfo = (level: number) => {
    if (level > 15) {
      return { relationship: 'supports', label: 'Supports', color: 'green' };
    } else if (level < -15) {
      return { relationship: 'refutes', label: 'Refutes', color: 'red' };
    } else {
      return { relationship: 'related', label: 'Nuanced', color: 'yellow' };
    }
  };

  const stanceInfo = getStanceInfo(supportLevel);

  const handleSubmit = async () => {
    try {
      // Convert support level from -100 to 100 range to -1 to 1 for database storage
      const normalizedSupportLevel = supportLevel / 100;

      const response = await addClaimLink({
        source_claim_id: sourceClaim?.claim_id ?? 0,
        target_claim_id: targetClaim?.claim_id ?? 0,
        user_id: viewerId || 1, // Use current viewer, fallback to 1
        relationship: stanceInfo.relationship as 'supports' | 'refutes' | 'related',
        support_level: normalizedSupportLevel,
        notes: notes,
      });

      toast({
        title: "Claim link created",
        description: `${stanceInfo.label} (${supportLevel > 0 ? '+' : ''}${supportLevel})`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onLinkCreated?.();

      const contentId = targetClaim?.content_id ?? null;
      if (contentId) {
        await updateScoresForContent(contentId, viewerId);
        const scores = await fetchContentScores(contentId, viewerId, mode, aiWeight);
        setVerimeterScore(contentId, scores?.verimeterScore ?? null);
      }

      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to create link",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="claimLink">
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">
          {!isReadOnly ? "Create Claim Relationship" : "Claim Relationship"}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text fontWeight="bold" mb={2}>
            Source Claim:
          </Text>
          <Text mb={4}>{sourceClaim?.claim_text}</Text>

          <Text fontWeight="bold" mb={2}>
            Target Claim:
          </Text>
          <Text mb={4}>{targetClaim?.claim_text}</Text>

          <FormLabel mt={4}>Notes</FormLabel>
          {isReadOnly ? (
            <Text fontStyle="italic" p={2} borderRadius="md">
              {claimLink?.notes || "No notes provided."}
            </Text>
          ) : (
            <Textarea
              className="mr-input"
              placeholder="Optional notes about this link..."
              value={notes}
              onChange={(e) => setNote(e.target.value)}
            />
          )}

          {isReadOnly && claimLink ? (
            <Box mb={4} mt={2}>
              <FormLabel mb={1}>Relationship</FormLabel>
              <Text fontWeight="bold" fontSize="lg">
                {verimeterScore !== null ? (
                  <>
                    {verimeterScore > 0
                      ? "✅ Supports"
                      : verimeterScore < 0
                        ? "⛔ Refutes"
                        : "⚖️ Neutral"}{" "}
                    : {(verimeterScore * 1000).toFixed(0)}%
                  </>
                ) : (
                  <Text as="span" fontStyle="italic" color="gray.500">
                    loading...
                  </Text>
                )}
              </Text>
            </Box>
          ) : (
            <>
              <FormLabel mb={1}>Support Level (-100 to 100)</FormLabel>
              <HStack mb={2} justify="space-between">
                <Badge colorScheme={stanceInfo.color} fontSize="lg" px={3} py={1}>
                  {stanceInfo.label}
                </Badge>
                <Text fontWeight="bold" fontSize="lg">
                  {supportLevel > 0 ? '+' : ''}{supportLevel}
                </Text>
              </HStack>
              <Slider
                aria-label="support-slider"
                value={supportLevel}
                min={-100}
                max={100}
                step={1}
                onChange={(val) => setSupportLevel(val)}
                colorScheme={stanceInfo.color}
              >
                <SliderTrack bg="gray.200">
                  <SliderFilledTrack bg={`${stanceInfo.color}.400`} />
                </SliderTrack>
                <SliderThumb boxSize={6} />
              </Slider>
              <HStack mt={2} justify="space-between" fontSize="xs" color="gray.500">
                <Text>-100 Refute</Text>
                <Text>0 Nuanced</Text>
                <Text>+100 Support</Text>
              </HStack>
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {!isReadOnly ? (
            <>
              <Button
                className="mr-button"
                colorScheme="blue"
                mr={3}
                onClick={handleSubmit}
              >
                Create Link
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ClaimLinkModal;
