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
} from "@chakra-ui/react";
import {
  Claim,
  LitReference,
  ReferenceWithClaims,
} from "../../../../shared/entities/types";
import {
  fetchClaimSources,
  fetchReferencesWithClaimsForTask,
} from "../../services/useDashboardAPI";
import ReferenceModal from "./ReferenceModal";

interface ClaimVerificationModalProps {
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

const ClaimVerificationModal: React.FC<ClaimVerificationModalProps> = ({
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

  const handleSave = () => {
    if (!claim) return;
    onSaveVerification({
      claim_id: claim.claim_id,
      veracity_score: veracityScore,
      confidence_level: confidenceLevel,
      is_refuted: isRefuted,
      notes,
    });
    onClose();
  };

  useEffect(() => {
    if (claim?.content_id) {
      fetchReferencesWithClaimsForTask(claim.content_id).then((refs) => {
        // 🔮 In the future you might filter by `ref.is_primary_source`
        const usableReferences = refs; // or refs.filter((ref) => ref.is_primary_source)

        if (usableReferences.length === 0) {
          console.warn("⚠️ No references found for this claim.");
        }

        setReferences(usableReferences);
      });
    }
  }, [claim]);

  useEffect(() => {
    if (claim?.claim_id) {
      fetchClaimSources(claim.claim_id).then((sources) => {
        // Extract the reference_content_ids from the claim_sources table
        const ids = sources.map((s) => s.reference_content_id);
        setLinkedReferenceIds(ids);
      });
    }
  }, [claim]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Verify Claim</ModalHeader>
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
                    ⚠️ You must link at least one source to verify this claim.
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

            <Button colorScheme="blue" onClick={handleSave}>
              Save Verification
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

export default ClaimVerificationModal;
