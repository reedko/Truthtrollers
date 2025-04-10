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
  Flex,
  Tooltip,
  useDisclosure,
} from "@chakra-ui/react";
import { PublisherRating } from "../../../../shared/entities/types";
import React from "react";

interface ViewRatingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ratings: PublisherRating[];
}

const getBiasEmoji = (score: number) => {
  if (score <= -5 || score >= 5) return "🔴";
  return "🟢";
};

const getVeracityEmoji = (score: number) => {
  if (score > 5) return "🟢";
  if (score < 0) return "🔴";
  return "⚪";
};

const ViewRatingsModal: React.FC<ViewRatingsModalProps> = ({
  isOpen,
  onClose,
  ratings,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>All Ratings</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {ratings.map((r, i) => (
              <HStack
                key={i}
                spacing={4}
                borderWidth="1px"
                borderRadius="md"
                p={3}
                bg="gray.50"
              >
                <Box flex="1">
                  <Tooltip label={r.topic_name} hasArrow>
                    <Text fontWeight="semibold" color="gray.500">
                      {r.source}{" "}
                      <Text as="span" fontSize="sm" color="gray.500">
                        ({r.topic_name})
                      </Text>
                    </Text>
                  </Tooltip>
                </Box>
                <Badge
                  px={2}
                  borderRadius="md"
                  bg="gray.700"
                  color="purple.300"
                >
                  <Flex align="center">
                    <Text>{getBiasEmoji(r.bias_score)}</Text>
                    <Text ml={2}>{r.bias_score?.toFixed(1)}</Text>
                  </Flex>
                </Badge>
                <Badge px={2} borderRadius="md" bg="gray.700" color="green.300">
                  <Flex align="center">
                    <Text>{getVeracityEmoji(r.veracity_score)}</Text>
                    <Text ml={2}>{r.veracity_score?.toFixed(1)}</Text>
                  </Flex>
                </Badge>
              </HStack>
            ))}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ViewRatingsModal;
