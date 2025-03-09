import React, { useState, useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
} from "@chakra-ui/react";

interface ClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (claimText: string, claimId?: number) => void;
  editingClaim?: { claim_text: string; claim_id: number } | null;
}

const ClaimModal: React.FC<ClaimModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingClaim,
}) => {
  const [claimText, setClaimText] = useState("");

  useEffect(() => {
    if (editingClaim) {
      setClaimText(editingClaim.claim_text);
    } else {
      setClaimText(""); // Reset input for new claim
    }
  }, [editingClaim]);

  const handleSave = () => {
    if (editingClaim) {
      onSave(claimText, editingClaim.claim_id);
    } else {
      onSave(claimText);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{editingClaim ? "Edit Claim" : "Add Claim"}</ModalHeader>
        <ModalBody>
          <Textarea
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
            placeholder="Enter claim text..."
          />
        </ModalBody>
        <ModalFooter>
          <Button
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
      </ModalContent>
    </Modal>
  );
};

export default ClaimModal;
