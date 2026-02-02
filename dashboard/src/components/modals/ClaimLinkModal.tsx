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
  Switch,
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

interface ClaimLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  targetClaim: Claim | null;
  isReadOnly?: boolean;
  claimLink?: ClaimLink | null;
  onLinkCreated?: () => void;
  verimeter_score?: number;
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
}) => {
  const toast = useToast();
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);
  const viewerId = useTaskStore((s) => s.viewingUserId);

  const [supportLevel, setSupportLevel] = useState(0);
  const [relationship, setRelationship] = useState<"supports" | "refutes">(
    "supports",
  );
  const [notes, setNote] = useState(claimLink?.notes || "");
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

  const handleSubmit = async () => {
    try {
      const response = await addClaimLink({
        source_claim_id: sourceClaim?.claim_id ?? 0,
        target_claim_id: targetClaim?.claim_id ?? 0,
        user_id: 1,
        relationship,
        support_level: supportLevel,
        notes: notes,
      });

      toast({
        title: "Claim link created",
        description: `Link: ${relationship} (${supportLevel})`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onLinkCreated?.();

      const contentId = targetClaim?.content_id ?? null;
      if (contentId) {
        await updateScoresForContent(contentId, viewerId);
        const scores = await fetchContentScores(contentId, viewerId);
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
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="lg">
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
              <FormLabel mb={1}>Relationship:</FormLabel>
              <HStack mb={4}>
                <Tooltip label="Does this support or refute the claim?">
                  <Switch
                    isChecked={relationship === "supports"}
                    onChange={(e) =>
                      setRelationship(e.target.checked ? "supports" : "refutes")
                    }
                    colorScheme="green"
                  />
                </Tooltip>
                <Text>{relationship}</Text>
              </HStack>

              <FormLabel mb={1}>Support Level</FormLabel>
              <Slider
                aria-label="support-slider"
                defaultValue={0}
                min={-1}
                max={1}
                step={0.1}
                onChange={(val) => setSupportLevel(val)}
              >
                <SliderTrack>
                  <SliderFilledTrack />
                </SliderTrack>
                <SliderThumb />
              </Slider>
              <Box mt={2} textAlign="center">
                <Text>Level: {supportLevel.toFixed(1)}</Text>
              </Box>
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
