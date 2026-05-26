import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
  HStack,
  Box,
  Text,
  Badge,
  Divider,
} from "@chakra-ui/react";
import { PublisherRating } from "../../../../shared/entities/types";
import React from "react";

interface ViewRatingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ratings: PublisherRating[];
}

const confidenceColor = (c?: string) => {
  switch (c) {
    case "high":   return "green";
    case "medium": return "yellow";
    case "low":    return "orange";
    default:       return "gray";
  }
};

const biasColor = (label?: string) => {
  if (!label) return "gray";
  const l = label.toLowerCase();
  if (l.includes("left"))  return "blue";
  if (l.includes("right")) return "red";
  if (l.includes("center") || l.includes("least")) return "green";
  return "gray";
};

const ViewRatingsModal: React.FC<ViewRatingsModalProps> = ({
  isOpen,
  onClose,
  ratings,
}) => {
  const sourced = ratings.filter(r => r.user_id == null);
  const userEntered = ratings.filter(r => r.user_id != null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">Publisher Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <VStack spacing={5} align="stretch">

            {/* ── Sourced ratings (AllSides, Ad Fontes, etc.) ── */}
            {sourced.length > 0 && (
              <Box>
                <Text fontWeight="bold" fontSize="sm" mb={2} color="gray.400" textTransform="uppercase" letterSpacing="wider">
                  Sourced Ratings
                </Text>
                <VStack spacing={3} align="stretch">
                  {sourced.map((r, i) => (
                    <Box key={i} borderWidth="1px" borderRadius="md" p={3} bg="gray.50">
                      <HStack justify="space-between" mb={1}>
                        <Badge colorScheme="purple" fontSize="sm" px={2}>{r.source}</Badge>
                        {r.confidence && (
                          <Badge colorScheme={confidenceColor(r.confidence)} variant="outline" fontSize="xs">
                            {r.confidence} confidence
                          </Badge>
                        )}
                      </HStack>

                      {r.rating_label && (
                        <HStack mt={1} spacing={2}>
                          <Badge colorScheme={biasColor(r.rating_label)} px={2} py={1} fontSize="sm">
                            {r.rating_label}
                          </Badge>
                          {r.rating_type && (
                            <Text fontSize="xs" color="gray.500">{r.rating_type}</Text>
                          )}
                        </HStack>
                      )}

                      <HStack mt={2} spacing={4}>
                        {r.bias_score != null && (
                          <Text fontSize="sm">
                            <Text as="span" color="gray.500">Bias: </Text>
                            <Text as="span" fontWeight="semibold">{r.bias_score.toFixed(1)}</Text>
                          </Text>
                        )}
                        {r.veracity_score != null && (
                          <Text fontSize="sm">
                            <Text as="span" color="gray.500">Veracity: </Text>
                            <Text as="span" fontWeight="semibold">{r.veracity_score.toFixed(1)}</Text>
                          </Text>
                        )}
                      </HStack>

                      {r.evidence_quote && (
                        <Text fontSize="xs" color="gray.500" mt={2} fontStyle="italic" noOfLines={3}>
                          "{r.evidence_quote}"
                        </Text>
                      )}
                    </Box>
                  ))}
                </VStack>
              </Box>
            )}

            {sourced.length > 0 && userEntered.length > 0 && <Divider />}

            {/* ── User-entered ratings ── */}
            {userEntered.length > 0 && (
              <Box>
                <Text fontWeight="bold" fontSize="sm" mb={2} color="gray.400" textTransform="uppercase" letterSpacing="wider">
                  User Ratings
                </Text>
                <VStack spacing={3} align="stretch">
                  {userEntered.map((r, i) => (
                    <HStack key={i} spacing={4} borderWidth="1px" borderRadius="md" p={3} bg="gray.50">
                      <Box flex="1">
                        <Text fontWeight="semibold" fontSize="sm">
                          {r.source || "—"}
                          {r.topic_name && (
                            <Text as="span" fontSize="xs" color="gray.500" ml={1}>({r.topic_name})</Text>
                          )}
                        </Text>
                      </Box>
                      <Badge px={2} borderRadius="md" bg="gray.700" color="purple.300">
                        Bias {r.bias_score?.toFixed(1)}
                      </Badge>
                      <Badge px={2} borderRadius="md" bg="gray.700" color="green.300">
                        Veracity {r.veracity_score?.toFixed(1)}
                      </Badge>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            )}

            {ratings.length === 0 && (
              <Text color="gray.500" textAlign="center" py={4}>No ratings yet.</Text>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ViewRatingsModal;
