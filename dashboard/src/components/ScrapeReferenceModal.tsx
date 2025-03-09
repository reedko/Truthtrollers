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
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { scrapeAndAddReference } from "../services/useWorkspaceData";

const ScrapeReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onScrape: (referenceId: number) => void;
}> = ({ isOpen, onClose, onScrape }) => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleScrape = async () => {
    if (!url.trim()) {
      setErrorMessage("Please enter a valid URL.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    const newReference = await scrapeAndAddReference(url);
    setIsLoading(false);

    if (newReference) {
      onScrape(newReference.reference_content_id);
      onClose();
    } else {
      setErrorMessage("❌ Failed to scrape reference.");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Scrape New Reference</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={3}>
            <Input
              placeholder="Enter article URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {errorMessage && <Text color="red.500">{errorMessage}</Text>}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button
            colorScheme="blue"
            onClick={handleScrape}
            isLoading={isLoading}
          >
            Scrape & Add
          </Button>
          <Button colorScheme="red" onClick={onClose} ml={3}>
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ScrapeReferenceModal;
