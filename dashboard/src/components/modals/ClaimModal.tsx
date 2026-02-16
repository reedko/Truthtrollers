import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
  Input,
  FormControl,
  FormLabel,
  Box,
  Text,
} from "@chakra-ui/react";
import { Claim } from "../../../../shared/entities/types";

interface ClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (claim: Claim) => void;
  editingClaim?: Claim | null;
  readOnly?: boolean; // 👈 Add this
}

const ClaimModal: React.FC<ClaimModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingClaim,
  readOnly,
}) => {
  const [claimText, setClaimText] = useState("");
  const [veracityScore, setVeracityScore] = useState<number | "">("");
  const [confidenceLevel, setConfidenceLevel] = useState<number | "">("");

  useEffect(() => {
    if (editingClaim) {
      setClaimText(editingClaim.claim_text);
      setVeracityScore(editingClaim.veracity_score ?? "");
      setConfidenceLevel(editingClaim.confidence_level ?? "");
    } else {
      setClaimText("");
      setVeracityScore("");
      setConfidenceLevel("");
    }
  }, [editingClaim]);

  const handleSave = () => {
    const claimToSave: Claim = {
      claim_id: editingClaim?.claim_id ?? Math.floor(Math.random() * 100000),
      claim_text: claimText,
      veracity_score: veracityScore === "" ? 0 : veracityScore,
      confidence_level: confidenceLevel === "" ? 0 : confidenceLevel,
      last_verified: new Date().toISOString(),
      references: editingClaim?.references || [],
    };

    if (!readOnly && onSave) {
      onSave(claimToSave);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">
          {readOnly
            ? "Claim Details"
            : editingClaim
            ? "Edit Claim"
            : "Add Claim"}
        </ModalHeader>
        <ModalBody>
          {readOnly ? (
            <>
              <Box mb={3}>
                <Text fontWeight="bold" mb={2}>Claim:</Text>
                <Text
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                  overflowWrap="anywhere"
                  lineHeight="1.6"
                  maxH="300px"
                  overflowY="auto"
                >
                  {editingClaim?.claim_text || "—"}
                </Text>
              </Box>

              <Box mb={3}>
                <Text fontWeight="bold">Veracity Score:</Text>
                <Text>{editingClaim?.veracity_score ?? "—"}</Text>
              </Box>

              <Box>
                <Text fontWeight="bold">Confidence Level:</Text>
                <Text>{editingClaim?.confidence_level ?? "—"}</Text>
              </Box>
            </>
          ) : (
            <>
              <FormControl mb={3}>
                <FormLabel>Claim Text</FormLabel>
                <Textarea
                  className="mr-input"
                  value={claimText}
                  onChange={(e) => setClaimText(e.target.value)}
                  placeholder="Enter claim text..."
                />
              </FormControl>

              <FormControl mb={3}>
                <FormLabel>Veracity Score</FormLabel>
                <Input
                  className="mr-input"
                  type="number"
                  value={veracityScore}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") return setVeracityScore("");
                    setVeracityScore(Number(val));
                  }}
                  placeholder="Veracity Score"
                />
              </FormControl>

              <FormControl>
                <FormLabel>Confidence Level</FormLabel>
                <Input
                  className="mr-input"
                  type="number"
                  value={confidenceLevel}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") return setConfidenceLevel("");
                    setConfidenceLevel(Number(val));
                  }}
                  placeholder="Confidence Level"
                />
              </FormControl>
            </>
          )}
        </ModalBody>

        {!readOnly && (
          <ModalFooter>
            <Button
              className="mr-button"
              colorScheme="blue"
              onClick={handleSave}
              isDisabled={!claimText.trim()}
            >
              Save
            </Button>
            <Button onClick={onClose} ml={2}>
              Cancel
            </Button>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
};

export default ClaimModal;
