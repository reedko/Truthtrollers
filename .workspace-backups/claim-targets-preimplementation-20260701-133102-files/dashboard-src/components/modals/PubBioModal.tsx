// src/components/modals/PubBioModal.tsx
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Textarea,
  Button,
  useToast,
} from "@chakra-ui/react";
import { useState } from "react";

interface PubBioModalProps {
  isOpen: boolean;
  onClose: () => void;
  publisherId: number;
  currentBio: string;
  onSave: (newBio: string) => Promise<void>;
}

const PubBioModal: React.FC<PubBioModalProps> = ({
  isOpen,
  onClose,
  publisherId,
  currentBio,
  onSave,
}) => {
  const [bio, setBio] = useState(currentBio || "");
  const toast = useToast();

  const handleSave = async () => {
    try {
      await onSave(bio);
      toast({
        title: "Bio Updated",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      onClose();
    } catch {
      toast({
        title: "Error updating bio",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">Edit Publisher Description</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Textarea
            className="mr-input"
            value={bio}
            onChange={(e) => setBio(e.target.value || "")}
            placeholder="Enter publisher description..."
          />
        </ModalBody>
        <ModalFooter>
          <Button className="mr-button" mr={3} onClick={handleSave}>
            Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PubBioModal;
