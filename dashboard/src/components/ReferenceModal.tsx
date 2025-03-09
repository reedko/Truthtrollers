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
  VStack,
  Text,
  Link,
  Box,
} from "@chakra-ui/react";
import axios from "axios";
import SelectReferenceModal from "./SelectReferenceModal"; // New modal for selecting references
import ScrapeReferenceModal from "./ScrapeReferenceModal"; // New modal for scraping references

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const ReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  onSave: (referenceId: number) => void;
}> = ({ isOpen, onClose, taskId, onSave }) => {
  const [references, setReferences] = useState<
    { reference_content_id: number; content_name: string; url: string }[]
  >([]);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);

  useEffect(() => {
    const fetchReferences = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/content/${taskId}/source-references`
        );
        setReferences(response.data);
      } catch (error) {
        console.error("❌ Error fetching references:", error);
      }
    };

    if (isOpen) fetchReferences();
  }, [isOpen, taskId]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Manage References</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="start" spacing={3}>
              {/* ✅ Show Existing References */}
              <Text fontWeight="bold">Existing References:</Text>
              {references.length > 0 ? (
                references.map((ref) => (
                  <Box key={ref.reference_content_id} w="100%">
                    <Link href={ref.url} isExternal color="blue.500">
                      🔗 {ref.content_name}
                    </Link>
                  </Box>
                ))
              ) : (
                <Text>No references found.</Text>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            {/* ✅ New Buttons for Selecting/Scraping References */}
            <Button colorScheme="blue" onClick={() => setIsSelectOpen(true)}>
              Select from List
            </Button>
            <Button
              colorScheme="green"
              onClick={() => setIsScrapeOpen(true)}
              ml={3}
            >
              Scrape New Reference
            </Button>
            <Button colorScheme="red" onClick={onClose} ml={3}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ✅ Modals for Selecting & Scraping References */}
      {isSelectOpen && (
        <SelectReferenceModal
          isOpen={isSelectOpen}
          onClose={() => setIsSelectOpen(false)}
          onSelect={onSave} // Pass selected reference back
        />
      )}
      {isScrapeOpen && (
        <ScrapeReferenceModal
          isOpen={isScrapeOpen}
          onClose={() => setIsScrapeOpen(false)}
          onScrape={onSave} // Pass new reference back
        />
      )}
    </>
  );
};

export default ReferenceModal;
