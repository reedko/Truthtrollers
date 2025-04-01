// src/components/modals/AuthRatingModal.tsx
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  VStack,
  HStack,
  Text,
  Select,
  NumberInput,
  NumberInputField,
  useToast,
} from "@chakra-ui/react";
import { useState } from "react";
import { AuthorRating } from "../../../../shared/entities/types";

interface AuthRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorId: number;
  ratings: AuthorRating[];
  onSave: (updated: AuthorRating[]) => Promise<void>;
}

const topics = [
  { id: 2401, name: "Vaccines" },
  { id: 2402, name: "Political" },
  { id: 2403, name: "Science" },
  { id: 2404, name: "Evidence-Based Medicine" },
  { id: 2405, name: "Alternative Medicine" },
  { id: 2406, name: "Vaccines (Alt)" },
  { id: 2407, name: "Economics" },
  { id: 2408, name: "Commerce" },
];

const AuthRatingModal: React.FC<AuthRatingModalProps> = ({
  isOpen,
  onClose,
  authorId,
  ratings,
  onSave,
}) => {
  const [localRatings, setLocalRatings] = useState<AuthorRating[]>(ratings);
  const toast = useToast();

  const updateRating = <K extends keyof AuthorRating>(
    index: number,
    key: K,
    value: AuthorRating[K]
  ) => {
    const updated = [...localRatings];
    updated[index] = { ...updated[index], [key]: value };
    setLocalRatings(updated);
  };

  const handleAddRating = () => {
    setLocalRatings([
      ...localRatings,
      {
        author_id: authorId, // 👈 You'll need this variable to be passed into the component
        source: "AdHoc", // or "Manual Entry"
        url: "",
        topic_id: 2402,
        topic_name: "Political",
        bias_score: 0,
        veracity_score: 0,
      },
    ]);
  };

  const handleSave = async () => {
    try {
      await onSave(localRatings);
      toast({
        title: "Ratings Updated",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to save ratings.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Edit Author Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="start">
            {localRatings.map((rating, index) => (
              <HStack key={index} spacing={3} w="100%">
                <Select
                  value={rating.topic_id}
                  onChange={(e) => {
                    const topic = topics.find(
                      (t) => t.id === parseInt(e.target.value)
                    );
                    if (topic) {
                      updateRating(index, "topic_id", topic.id);
                      updateRating(index, "topic_name", topic.name);
                    }
                  }}
                >
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </Select>
                <NumberInput
                  value={rating.bias_score}
                  min={-10}
                  max={10}
                  onChange={(val) =>
                    updateRating(index, "bias_score", parseFloat(val))
                  }
                >
                  <NumberInputField placeholder="Bias" />
                </NumberInput>
                <NumberInput
                  value={rating.veracity_score}
                  min={0}
                  max={10}
                  onChange={(val) =>
                    updateRating(index, "veracity_score", parseFloat(val))
                  }
                >
                  <NumberInputField placeholder="Veracity" />
                </NumberInput>
              </HStack>
            ))}
            <Button onClick={handleAddRating} size="sm">
              ➕ Add Rating
            </Button>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="blue" mr={3} onClick={handleSave}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default AuthRatingModal;
