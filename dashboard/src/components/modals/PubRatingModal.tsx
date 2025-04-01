// src/components/modals/PubRatingModal.tsx
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
  Input,
  VStack,
  HStack,
  Select,
  Text,
  useToast,
} from "@chakra-ui/react";
import { PublisherRating, Topic } from "../../../../shared/entities/types";
import {
  fetchPublisherRatings,
  updatePublisherRatings,
  fetchRatingTopics,
} from "../../services/useDashboardAPI";

interface PubRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  publisherId: number;
  onRatingsUpdate: (updated: PublisherRating[]) => void;
}

const PubRatingModal: React.FC<PubRatingModalProps> = ({
  isOpen,
  onClose,
  publisherId,
  onRatingsUpdate,
}) => {
  const toast = useToast();
  const [localRatings, setLocalRatings] = useState<PublisherRating[]>([]);
  const [allTopics, setAllTopics] = useState<{ [key: number]: string }>({});

  useEffect(() => {
    const load = async () => {
      const [ratings, topics] = await Promise.all([
        fetchPublisherRatings(publisherId),
        fetchRatingTopics(),
      ]); // No destructure
      setLocalRatings(ratings);

      // Set all topics for the dropdown
      const topicMap = Object.fromEntries(
        topics.map((t: Topic) => [t.topic_id, t.topic_name])
      );
      setAllTopics(topicMap);
    };

    if (isOpen && publisherId) {
      load();
    }
  }, [isOpen, publisherId]);

  const updateRating = <K extends keyof PublisherRating>(
    index: number,
    key: K,
    value: PublisherRating[K]
  ) => {
    const updated = [...localRatings];
    updated[index] = { ...updated[index], [key]: value };
    setLocalRatings(updated);
  };

  const addNewRating = () => {
    setLocalRatings((prev) => [
      ...prev,
      {
        publisher_id: publisherId,
        topic_id: 2402,
        topic_name: "Political",
        source: "",
        bias_score: 0,
        veracity_score: 0,
        url: "",
        notes: "",
      },
    ]);
  };

  const handleSave = async () => {
    await updatePublisherRatings(publisherId, localRatings);
    const updated = await fetchPublisherRatings(publisherId);
    onRatingsUpdate?.([publisherId, updated]);
    toast({
      title: "Ratings saved",
      description: "Changes to publisher ratings have been saved.",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Publisher Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {localRatings.map((rating, index) => (
              <VStack
                key={index}
                border="1px solid #ccc"
                borderRadius="md"
                p={3}
                align="stretch"
              >
                <HStack>
                  <Input
                    placeholder="Source"
                    value={rating.source}
                    onChange={(e) =>
                      updateRating(index, "source", e.target.value)
                    }
                  />
                  <Select
                    placeholder="Topic"
                    value={rating.topic_id ?? ""}
                    onChange={(e) =>
                      updateRating(
                        index,
                        "topic_id",
                        parseInt(e.target.value, 10)
                      )
                    }
                  >
                    {Object.entries(allTopics).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </HStack>
                <HStack>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    placeholder="Bias Score"
                    value={rating.bias_score ?? ""}
                    onChange={(e) =>
                      updateRating(
                        index,
                        "bias_score",
                        parseFloat(e.target.value)
                      )
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Veracity Score"
                    value={rating.veracity_score ?? ""}
                    onChange={(e) =>
                      updateRating(
                        index,
                        "veracity_score",
                        parseFloat(e.target.value)
                      )
                    }
                  />
                </HStack>
                <Input
                  placeholder="URL (optional)"
                  value={rating.url}
                  onChange={(e) => updateRating(index, "url", e.target.value)}
                />
                <Input
                  placeholder="Notes (optional)"
                  value={rating.notes}
                  onChange={(e) => updateRating(index, "notes", e.target.value)}
                />
              </VStack>
            ))}
            <Button onClick={addNewRating} colorScheme="blue">
              ➕ Add Rating
            </Button>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} mr={3}>
            Cancel
          </Button>
          <Button colorScheme="green" onClick={handleSave}>
            Save All
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PubRatingModal;
