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
  useToast,
  HStack,
  Tooltip,
} from "@chakra-ui/react";
import SelectReferenceModal from "./SelectReferenceModal"; // New modal for selecting references
import ScrapeReferenceModal from "../ScrapeReferenceModal"; // New modal for scraping references
import { useTaskStore } from "../../store/useTaskStore"; // ✅ Import store
import { useShallow } from "zustand/react/shallow";

const ReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
}> = ({ isOpen, onClose, taskId }) => {
  const { fetchReferences, deleteReferenceFromTask } = useTaskStore();
  const references = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );
  const toast = useToast();
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);
  const addReference = useTaskStore((state) => state.addReferenceToTask); // ✅ Get function from store

  const setSelectedTask = useTaskStore((state) => state.setSelectedTask);

  const handleOpenSelectModal = () => {
    setSelectedTask(taskId); // ✅ Store taskId in Zustand
    setIsSelectOpen(true);
  };
  useEffect(() => {
    if (isOpen) {
      fetchReferences(Number(taskId)); // 🔥 Always fetch latest references when modal opens
    }
  }, [isOpen, taskId]); // ✅ Triggers a fresh fetch every time modal opens

  const handleDeleteReference = async (referenceId: number) => {
    await deleteReferenceFromTask(taskId, referenceId);

    toast({
      title: "Reference Removed!",
      description: "The reference has been successfully removed from the task.",
      status: "warning",
      duration: 3000,
      isClosable: true,
    });
  };
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
                  <HStack
                    key={ref.reference_content_id}
                    w="100%"
                    justifyContent="space-between"
                  >
                    <Tooltip
                      label={ref.content_name}
                      aria-label="Full reference name"
                      hasArrow
                    >
                      <Link
                        href={ref.url}
                        isExternal
                        color="blue.500"
                        isTruncated
                        maxWidth="-moz-max-content"
                      >
                        🔗 {ref.content_name}
                      </Link>
                    </Tooltip>
                    <Button
                      size="xs"
                      colorScheme="red"
                      onClick={() =>
                        handleDeleteReference(ref.reference_content_id)
                      }
                    >
                      🗑️ Remove
                    </Button>
                  </HStack>
                ))
              ) : (
                <Text>No references found.</Text>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            {/* ✅ New Buttons for Selecting/Scraping References */}
            <Button colorScheme="blue" onClick={handleOpenSelectModal}>
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
          onSelect={(referenceId) => addReference(taskId, referenceId)} // ✅ Calls store directly!
        />
      )}
      {isScrapeOpen && (
        <ScrapeReferenceModal
          isOpen={isScrapeOpen}
          onClose={() => setIsScrapeOpen(false)}
          taskId={taskId.toString()}

          // Pass new reference back
        />
      )}
    </>
  );
};

export default ReferenceModal;
