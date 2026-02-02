// src/components/modals/ClaimEvaluationModal.tsx
import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  FormControl,
  FormLabel,
  Textarea,
  Input,
  Switch,
  Button,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Text,
  VStack,
  Select,
  useToast,
} from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import {
  fetchClaimSources,
  fetchReferencesWithClaimsForTask,
  fetchAllReferences,
  submitClaimEvaluation,
} from "../../services/useDashboardAPI";
import ReferenceModal from "./ReferenceModal";

interface ClaimEvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  claim: Claim;
  onSaveVerification: (verification: {
    claim_id: number;
    veracity_score: number;
    confidence_level: number;
    is_refuted: boolean;
    notes: string;
  }) => void;
}

const ClaimEvaluationModal: React.FC<ClaimEvaluationModalProps> = ({
  isOpen,
  onClose,
  claim,
  onSaveVerification,
}) => {
  const [veracityScore, setVeracityScore] = useState<number>(0);
  const [confidenceLevel, setConfidenceLevel] = useState<number>(0.5);
  const [isRefuted, setIsRefuted] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [selectedReferenceId, setSelectedReferenceId] = useState<number | null>(
    null
  );
  const [linkedReferenceIds, setLinkedReferenceIds] = useState<number[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const toast = useToast();

  const handleSave = async () => {
    if (!claim) return;

    if (!selectedReferenceId || !notes.trim()) {
      toast({
        title: "Missing information",
        description: "Please select a reference and provide justification.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    await submitClaimEvaluation({
      claim_id: claim.claim_id,
      reference_id: selectedReferenceId,
      evaluation_text: notes,
    });

    onSaveVerification({
      claim_id: claim.claim_id,
      veracity_score: veracityScore,
      confidence_level: confidenceLevel,
      is_refuted: isRefuted,
      notes,
    });

    toast({
      title: "Claim evaluated",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
    onClose();
  };

  useEffect(() => {
    if (claim?.content_id) {
      fetchReferencesWithClaimsForTask(claim.content_id).then((refs) => {
        setReferences(refs);
      });
    }
  }, [claim]);

  useEffect(() => {
    if (claim?.claim_id) {
      fetchClaimSources(claim.claim_id).then((sources) => {
        const ids = sources.map((s) => s.reference_content_id);
        setLinkedReferenceIds(ids);
      });
    }
  }, [claim]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent className="mr-modal">
          <ModalHeader className="mr-modal-header">Evaluate Claim</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={2} fontWeight="semibold">
              {claim?.claim_text}
            </Text>

            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel>Veracity Score (0 = false, 1 = true)</FormLabel>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={veracityScore}
                  onChange={setVeracityScore}
                >
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
                <Text textAlign="center">
                  Score: {veracityScore.toFixed(1)}
                </Text>
              </FormControl>

              <FormControl>
                <FormLabel>Confidence Level</FormLabel>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={confidenceLevel}
                  onChange={setConfidenceLevel}
                >
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
                <Text textAlign="center">
                  Confidence: {confidenceLevel.toFixed(1)}
                </Text>
              </FormControl>

              <FormControl display="flex" alignItems="center">
                <FormLabel htmlFor="refuted" mb="0">
                  Mark as misleading or refuted:
                </FormLabel>
                <Switch
                  id="refuted"
                  isChecked={isRefuted}
                  onChange={(e) => setIsRefuted(e.target.checked)}
                  colorScheme="red"
                />
              </FormControl>

              <FormControl>
                <FormLabel>Notes / Justification</FormLabel>
                <Textarea
                  className="mr-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why do you rate it this way? Include sources or reasoning."
                />
                <FormLabel>Select a Primary Source</FormLabel>
                <Select
                  placeholder="Choose a reference"
                  value={selectedReferenceId ?? ""}
                  onChange={(e) =>
                    setSelectedReferenceId(Number(e.target.value))
                  }
                >
                  {references.map((ref) => (
                    <option
                      key={ref.reference_content_id}
                      value={ref.reference_content_id}
                    >
                      {ref.content_name}
                    </option>
                  ))}
                </Select>
                {references.length === 0 && (
                  <Text color="red.500" mt={2}>
                    ⚠️ You must link at least one source to Evaluate this claim.
                  </Text>
                )}
              </FormControl>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button
              onClick={() => setIsReferenceModalOpen(true)}
              mr={3}
              colorScheme="blue"
            >
              Add Reference
            </Button>

            <Button className="mr-button" colorScheme="blue" onClick={handleSave}>
              Submit Evaluation
            </Button>
            <Button onClick={onClose} ml={3}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {isReferenceModalOpen && (
        <ReferenceModal
          isOpen={isReferenceModalOpen}
          onClose={() => setIsReferenceModalOpen(false)}
          claimId={claim.claim_id}
        />
      )}
    </>
  );
};

export default ClaimEvaluationModal;
