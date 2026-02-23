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
  useColorModeValue,
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
  onReferenceClick: (ref: ReferenceWithClaims, e: React.MouseEvent) => void;
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
  const [failedReferenceIds, setFailedReferenceIds] = useState<Set<number>>(
    new Set(),
  );
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [retryUrl, setRetryUrl] = useState("");

  // Color mode values
  const defaultBg = useColorModeValue(
    "linear-gradient(135deg, rgba(148, 163, 184, 0.2), rgba(203, 213, 225, 0.3))",
    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
  );
  const defaultColor = useColorModeValue("gray.700", "#f1f5f9");
  const borderColor = useColorModeValue(
    "rgba(148, 163, 184, 0.3)",
    "rgba(59, 130, 246, 0.4)",
  );

  // Reference card shadows - must be called at top level, not inside map
  const refBoxShadow = useColorModeValue(
    "0 2px 8px rgba(94, 234, 212, 0.2)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const refHoverShadow = useColorModeValue(
    "0 4px 12px rgba(94, 234, 212, 0.3)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );

  // Fetch failed references when component mounts or taskId changes
  useEffect(() => {
    if (taskId) {
      fetchFailedReferences(taskId).then((failedRefs) => {
        const ids = new Set(failedRefs.map((ref) => ref.content_id));
        setFailedReferenceIds(ids);
        console.log(
          `📋 Found ${failedRefs.length} failed references for task ${taskId}:`,
          failedRefs,
        );
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
        <Box
          as="button"
          background={defaultBg}
          backdropFilter="blur(20px)"
          border={`1px solid ${borderColor}`}
          color={useColorModeValue("teal.600", "rgba(0, 162, 255, 1)")}
          height="50px"
          width="100%"
          px={3}
          py={2}
          borderRadius="12px"
          boxShadow={useColorModeValue(
            "0 2px 8px rgba(94, 234, 212, 0.2)",
            "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          )}
          position="relative"
          overflow="hidden"
          transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
          _hover={{
            boxShadow: useColorModeValue(
              "0 4px 12px rgba(94, 234, 212, 0.3)",
              "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
            ),
            transform: "translateY(-2px)",
          }}
          onClick={() => setIsReferenceModalOpen(true)}
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="20px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, transparent 100%)"
            pointerEvents="none"
          />
          <Text position="relative" zIndex={1}>
            + Add Reference
          </Text>
        </Box>

        {references.length === 0 ? (
          <Text>No References Found</Text>
        ) : (
          references.map((ref) => (
            <Box
              key={ref.reference_content_id}
              data-ref-id={ref.reference_content_id} // 👈 for measuring
              border={`1px solid ${borderColor}`}
              background={defaultBg}
              backdropFilter="blur(20px)"
              color={defaultColor}
              px={3}
              py={2}
              borderRadius="12px"
              boxShadow={refBoxShadow}
              width="100%"
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              cursor="pointer"
              mb={0} // 👈 no extra margin here
              position="relative"
              overflow="hidden"
              transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
              _hover={{
                boxShadow: refHoverShadow,
                transform: "translateY(-2px)",
              }}
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                width="20px"
                height="100%"
                background="linear-gradient(90deg, rgba(59, 130, 246, 0.4) 0%, transparent 100%)"
                pointerEvents="none"
              />
              <VStack
                align="start"
                flex="1"
                spacing={0}
                position="relative"
                zIndex={1}
              >
                <HStack spacing={2} width="100%" position="relative" zIndex={1}>
                  <Tooltip label={ref.content_name} hasArrow>
                    <Text
                      flex="1"
                      noOfLines={1}
                      onClick={(e) => {
                        onReferenceClick(ref, e);
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
              <HStack spacing={2} position="relative" zIndex={1}>
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
                    newTitle,
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
