import React, { useState, useEffect } from "react";
import {
  VStack,
  Heading,
  Button,
  HStack,
  Tooltip,
  Box,
  Text,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  IconButton,
  Badge,
} from "@chakra-ui/react";
import {
  LitReference,
  ReferenceWithClaims,
  FailedReference,
} from "../../../shared/entities/types";
import ReferenceModal from "./modals/ReferenceModal";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ScrapeReferenceModal from "./ScrapeReferenceModal";
import { fetchFailedReferences } from "../services/useDashboardAPI";

interface ReferenceListProps {
  references: ReferenceWithClaims[];
  onEditReference: (referenceId: number, title: string) => void;
  onDeleteReference: (referenceId: number) => void;
  taskId: number;
  onReferenceClick: (ref: ReferenceWithClaims) => void;
  selectedReference: ReferenceWithClaims | null; // 👈 add this!
  onUpdateReferences?: () => void; // ✅ new
}

const ReferenceList: React.FC<ReferenceListProps> = ({
  references,
  onEditReference,
  onDeleteReference,
  taskId,
  onReferenceClick,
  selectedReference,
  onUpdateReferences,
}) => {
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingReference, setEditingReference] =
    useState<ReferenceWithClaims | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [failedReferenceIds, setFailedReferenceIds] = useState<Set<number>>(new Set());
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [retryUrl, setRetryUrl] = useState("");

  // Fetch failed references when component mounts or taskId changes
  useEffect(() => {
    if (taskId) {
      fetchFailedReferences(taskId).then((failedRefs) => {
        const ids = new Set(failedRefs.map(ref => ref.content_id));
        setFailedReferenceIds(ids);
        console.log(`📋 Found ${failedRefs.length} failed references for task ${taskId}:`, failedRefs);
      });
    }
  }, [taskId, references]);

  // Check if a reference is failed
  const isFailedReference = (refId: number) => failedReferenceIds.has(refId);

  return (
    <>
      <VStack
        align="start"
        spacing={2}
        borderLeft="1px solid gray"
        alignSelf="flex-start"
        pl={4}
        width="100%"
      >
        <Heading size="sm">References</Heading>

        {/* 🔥 Button to Open ReferenceModal */}
        <Button
          colorScheme="blue"
          onClick={() => setIsReferenceModalOpen(true)}
        >
          + Add Reference
        </Button>

        {references.length === 0 ? (
          <Text>No References Found</Text>
        ) : (
          references.map((ref) => (
            <Box
              key={ref.reference_content_id}
              data-ref-id={ref.reference_content_id} // 👈 for measuring
              border="1px solid #90caf9"
              bg="black"
              color="#90caf9"
              px={3}
              py={2}
              borderRadius="md"
              width="100%"
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              cursor="pointer"
              mb={0} // 👈 no extra margin here
            >
              <VStack align="start" flex="1" spacing={0}>
                <HStack spacing={2} width="100%">
                  <Tooltip label={ref.content_name} hasArrow>
                    <Text
                      flex="1"
                      noOfLines={1}
                      onClick={() => {
                        onReferenceClick(ref);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (ref.url) window.open(ref.url, "_blank");
                      }}
                    >
                      {ref.content_name}
                    </Text>
                  </Tooltip>
                  {isFailedReference(ref.reference_content_id) && (
                    <Button
                      size="xs"
                      colorScheme="orange"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRetryUrl(ref.url || "");
                        setIsScrapeModalOpen(true);
                      }}
                    >
                      Retry Scrape
                    </Button>
                  )}
                </HStack>
              </VStack>
              <HStack spacing={2}>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Edit"
                  onClick={() => {
                    setEditingReference(ref);
                    setNewTitle(ref.content_name);
                    setIsEditModalOpen(true);
                  }}
                >
                  ✏️
                </Button>
                <IconButton
                  size="sm"
                  colorScheme="red"
                  aria-label="Delete"
                  icon={<span>🗑️</span>}
                  onClick={() => onDeleteReference(ref.reference_content_id)}
                />
              </HStack>
            </Box>
          ))
        )}
      </VStack>

      {/* 🔥 Reference Modal for Adding References */}
      <ReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        taskId={taskId} // Pass actual taskId from parent
        onUpdateReferences={onUpdateReferences}
      />

      {/* 🔥 Modal for Editing Reference Title */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Reference Title</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter new title"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="green"
              onClick={() => {
                if (editingReference) {
                  onEditReference(
                    editingReference?.reference_content_id as number,
                    newTitle
                  );
                  setIsEditModalOpen(false);
                }
              }}
              isDisabled={!newTitle.trim()}
            >
              Save
            </Button>
            <Button onClick={() => setIsEditModalOpen(false)} ml={2}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 🔥 Scrape Reference Modal for Retrying Failed Scrapes */}
      <ScrapeReferenceModal
        isOpen={isScrapeModalOpen}
        onClose={() => {
          setIsScrapeModalOpen(false);
          setRetryUrl("");
        }}
        taskId={taskId.toString()}
        onUpdateReferences={onUpdateReferences}
        initialUrl={retryUrl}
      />
    </>
  );
};

export default ReferenceList;
