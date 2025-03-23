import React, { useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Text,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Box,
  useToast,
  Tooltip,
  HStack,
  Switch,
  FormLabel,
} from "@chakra-ui/react";
import { addClaimLink } from "../../services/useDashboardAPI";
import { Claim } from "../../../../shared/entities/types";

interface ClaimLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  targetClaim: Claim | null;
}

const ClaimLinkModal: React.FC<ClaimLinkModalProps> = ({
  isOpen,
  onClose,
  sourceClaim,
  targetClaim,
}) => {
  const toast = useToast();
  const [supportLevel, setSupportLevel] = useState(0);
  const [relationship, setRelationship] = useState<"supports" | "refutes">(
    "supports"
  );

  const handleSubmit = async () => {
    try {
      const response = await addClaimLink({
        source_claim_id: sourceClaim?.claim_id ?? 0,
        target_claim_id: targetClaim?.claim_id ?? 0,
        user_id: 1,
        relationship,
        support_level: supportLevel,
      });
      toast({
        title: "Claim link created",
        description: `Link: ${relationship} (${supportLevel})`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to create link",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Create Claim Relationship</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text fontWeight="bold" mb={2}>
            Source Claim:
          </Text>
          <Text mb={4}>{sourceClaim?.claim_text}</Text>

          <Text fontWeight="bold" mb={2}>
            Target Claim:
          </Text>
          <Text mb={4}>{targetClaim?.claim_text}</Text>

          <FormLabel mb={1}>Relationship:</FormLabel>
          <HStack mb={4}>
            <Tooltip label="Does this support or refute the claim?">
              <Switch
                isChecked={relationship === "supports"}
                onChange={(e) =>
                  setRelationship(e.target.checked ? "supports" : "refutes")
                }
                colorScheme="green"
              />
            </Tooltip>
            <Text>{relationship}</Text>
          </HStack>

          <FormLabel mb={1}>Support Level</FormLabel>
          <Slider
            aria-label="support-slider"
            defaultValue={0}
            min={-1}
            max={1}
            step={0.1}
            onChange={(val) => setSupportLevel(val)}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
          <Box mt={2} textAlign="center">
            <Text>Level: {supportLevel.toFixed(1)}</Text>
          </Box>
        </ModalBody>

        <ModalFooter>
          <Button colorScheme="blue" mr={3} onClick={handleSubmit}>
            Create Link
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ClaimLinkModal;
