// src/components/modals/AuthRatingModal.tsx
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
import { AuthorRating, Topic } from "../../../../shared/entities/types";
import {
  fetchAuthorRatings,
  updateAuthorRatings,
  fetchRatingTopics,
  updateAuthorRating,
} from "../../services/useDashboardAPI";

interface AuthRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorId: number;
  onRatingsUpdate: (authorId: number, updated: AuthorRating[]) => void;
}

const AuthRatingModal: React.FC<AuthRatingModalProps> = ({
  isOpen,
  onClose,
  authorId,
  onRatingsUpdate,
}) => {
  const toast = useToast();
  const [localRatings, setLocalRatings] = useState<AuthorRating[]>([]);
  const [allTopics, setAllTopics] = useState<{ [key: number]: string }>({});
  const [savedRatingIds, setSavedRatingIds] = useState<number[]>([]);
  const [biasInputs, setBiasInputs] = useState<{ [id: number]: string }>({});
  const [veracityInputs, setVeracityInputs] = useState<{
    [id: number]: string;
  }>({});

  useEffect(() => {
    const load = async () => {
      const [ratings, topics] = await Promise.all([
        fetchAuthorRatings(authorId),
        fetchRatingTopics(),
      ]); // No destructure
      setLocalRatings(ratings);
      console.log(topics);
      // Set all topics for the dropdown
      const topicMap = Object.fromEntries(
        topics.map((t: Topic) => [t.topic_id, t.topic_name])
      );
      setAllTopics(topicMap);
      const biasInit: { [id: number]: string } = {};
      const veracityInit: { [id: number]: string } = {};
      ratings.forEach((r: AuthorRating) => {
        if (r.author_rating_id) {
          biasInit[r.author_rating_id] = r.bias_score?.toString() || "";
          veracityInit[r.author_rating_id] = r.bias_score?.toString() || "";
        }
      });
      setBiasInputs(biasInit);
      setVeracityInputs(veracityInit);
    };

    if (isOpen && authorId) {
      load();
    }
  }, [isOpen, authorId]);

  const updateRating = <K extends keyof AuthorRating>(
    index: number,
    key: K,
    value: AuthorRating[K]
  ) => {
    const updated = [...localRatings];
    updated[index] = { ...updated[index], [key]: value };
    setLocalRatings(updated);
  };

  const addNewRating = () => {
    setLocalRatings((prev) => [
      ...prev,
      {
        author_rating_id: 0,
        author_id: authorId,
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
  const handleSaveSingle = async (rating: AuthorRating) => {
    try {
      if (rating.author_rating_id === 0) {
        // This is a new rating — call insert/update logic
        await updateAuthorRating(0, rating);
      } else {
        // Existing rating — update by ID
        await updateAuthorRating(rating.author_rating_id, rating);
      }

      const updated = await fetchAuthorRatings(authorId);
      onRatingsUpdate?.(authorId, updated);

      toast({
        title: "Rating Saved",
        description: "Author rating saved successfully.",
        status: "success",
        duration: 2000,
        isClosable: true,
      });

      // ✅ Mark it as saved
      setSavedRatingIds((prev) => [
        ...prev,
        rating.author_rating_id || Date.now(), // temp fallback if 0
      ]);
      setTimeout(() => {
        setSavedRatingIds((prev) =>
          prev.filter((id) => id !== rating.author_rating_id)
        );
      }, 3000);
    } catch (err) {
      console.error(err);
      toast({
        title: "Save Failed",
        description: "Unable to save this rating.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleSave = async () => {
    await updateAuthorRatings(authorId, localRatings);
    const updated = await fetchAuthorRatings(authorId);
    onRatingsUpdate?.(authorId, updated);
    toast({
      title: "Ratings saved",
      description: "Changes to author ratings have been saved.",
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
        <ModalHeader className="mr-modal-header">Author Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {localRatings.map((rating, index) => (
              <VStack
                key={rating.author_rating_id || rating.topic_id}
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
                    value={biasInputs[rating.author_rating_id] ?? ""}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      if (/^-?\d*\.?\d*$/.test(newVal)) {
                        setBiasInputs((prev) => ({
                          ...prev,
                          [rating.author_rating_id]: newVal,
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
                    value={veracityInputs[rating.author_rating_id] ?? ""}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      if (/^-?\d*\.?\d*$/.test(newVal)) {
                        setVeracityInputs((prev) => ({
                          ...prev,
                          [rating.author_rating_id]: newVal,
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
                {savedRatingIds.includes(rating.author_rating_id) && (
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

export default AuthRatingModal;
