// src/components/modals/AuthBioModal.tsx
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
  useToast,
} from "@chakra-ui/react";
import { useState } from "react";

interface AuthBioModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorId: number;
  currentBio?: string;
  onSave: (bio: string) => Promise<void>;
}

const AuthBioModal: React.FC<AuthBioModalProps> = ({
  isOpen,
  onClose,
  authorId,
  currentBio = "",
  onSave,
}) => {
  const [bio, setBio] = useState(currentBio);
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
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update bio.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">Edit Author Bio</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Textarea
            className="mr-input"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Edit author biography here..."
          />
        </ModalBody>
        <ModalFooter>
          <Button className="mr-button" onClick={handleSave} mr={3}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default AuthBioModal;
