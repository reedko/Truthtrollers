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
  updatePublisherRating,
} from "../../services/useDashboardAPI";

interface PubRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  publisherId: number;
  onRatingsUpdate: (publisherId: number, updated: PublisherRating[]) => void;
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
  const [savedRatingIds, setSavedRatingIds] = useState<number[]>([]);
  const [biasInputs, setBiasInputs] = useState<{ [id: number]: string }>({});
  const [veracityInputs, setVeracityInputs] = useState<{
    [id: number]: string;
  }>({});

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
      const biasInit: { [id: number]: string } = {};
      const veracityInit: { [id: number]: string } = {};
      ratings.forEach((r: PublisherRating) => {
        if (r.publisher_rating_id) {
          biasInit[r.publisher_rating_id] = r.bias_score?.toString() || "";
          veracityInit[r.publisher_rating_id] = r.bias_score?.toString() || "";
        }
      });
      setBiasInputs(biasInit);
      setVeracityInputs(veracityInit);
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
        publisher_rating_id: 0,
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
  const handleSaveSingle = async (rating: PublisherRating) => {
    if (!rating.publisher_rating_id) {
      toast({
        title: "Missing Rating ID",
        description: "This rating cannot be saved because it has no ID.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      await updatePublisherRating(rating.publisher_rating_id, rating);

      // ✅ Fetch the full updated list of ratings
      const updated = await fetchPublisherRatings(publisherId);
      onRatingsUpdate?.(publisherId, updated);

      toast({
        title: "Rating Updated",
        description: "Rating successfully saved.",
        status: "success",
        duration: 2000,
        isClosable: true,
      });

      setSavedRatingIds((prev) => [...prev, rating.publisher_rating_id]);
      setTimeout(() => {
        setSavedRatingIds((prev) =>
          prev.filter((id) => id !== rating.publisher_rating_id)
        );
      }, 3000);
    } catch (err) {
      console.error(err);
      toast({
        title: "Update Failed",
        description: "Unable to save the rating.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleSave = async () => {
    await updatePublisherRatings(publisherId, localRatings);
    const updated = await fetchPublisherRatings(publisherId);
    onRatingsUpdate?.(publisherId, updated);
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
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">Publisher Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {localRatings.map((rating, index) => (
              <VStack
                key={rating.publisher_rating_id || rating.topic_id}
                border="1px solid #ccc"
                borderRadius="md"
                p={3}
                align="stretch"
              >
                <HStack>
                  <Input
                    className="mr-input"
                    placeholder="Source"
                    value={rating.source ?? ""}
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
                    className="mr-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="Bias Score"
                    value={biasInputs[rating.publisher_rating_id] ?? ""}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      if (/^-?\d*\.?\d*$/.test(newVal)) {
                        setBiasInputs((prev) => ({
                          ...prev,
                          [rating.publisher_rating_id]: newVal,
                        }));
                        const parsed = parseFloat(newVal);
                        updateRating(
                          index,
                          "bias_score",
                          isNaN(parsed) ? 0 : parsed
                        );
                      }
                    }}
                  />
                  <Input
                    className="mr-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="Veracity Score"
                    value={veracityInputs[rating.publisher_rating_id] ?? ""}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      if (/^-?\d*\.?\d*$/.test(newVal)) {
                        setVeracityInputs((prev) => ({
                          ...prev,
                          [rating.publisher_rating_id]: newVal,
                        }));
                        const parsed = parseFloat(newVal);
                        updateRating(
                          index,
                          "veracity_score",
                          isNaN(parsed) ? 0 : parsed
                        );
                      }
                    }}
                  />
                </HStack>
                <Input
                  className="mr-input"
                  placeholder="URL (optional)"
                  value={rating.url ?? ""}
                  onChange={(e) => updateRating(index, "url", e.target.value)}
                />
                <Input
                  className="mr-input"
                  placeholder="Notes (optional)"
                  value={rating.notes ?? ""}
                  onChange={(e) => updateRating(index, "notes", e.target.value)}
                />
                <Button
                  colorScheme="green"
                  size="sm"
                  onClick={() => handleSaveSingle(rating)}
                >
                  ✅ Save
                </Button>
                {savedRatingIds.includes(rating.publisher_rating_id) && (
                  <Text fontSize="sm" color="green.600" fontWeight="bold">
                    ✅ Saved!
                  </Text>
                )}
              </VStack>
            ))}
            <Button onClick={addNewRating} colorScheme="blue">
              ➕ Add Rating
            </Button>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} mr={3}>
            Close
          </Button>
          <Button className="mr-button" colorScheme="green" onClick={handleSave}>
            Save All
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PubRatingModal;
