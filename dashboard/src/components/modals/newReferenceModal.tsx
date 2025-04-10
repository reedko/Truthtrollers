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
  useToast,
  HStack,
  Tooltip,
} from "@chakra-ui/react";
import SelectReferenceModal from "./SelectReferenceModal";
import ScrapeReferenceModal from "../ScrapeReferenceModal";
import { useTaskStore } from "../../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import {
  addClaimSource,
  deleteClaimSource,
  fetchClaimSources,
} from "../../services/useDashboardAPI";
import {
  LitReference,
  ReferenceWithClaims,
} from "../../../../shared/entities/types";

interface ReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId?: number;
  claimId?: number;
  usePersonalRefs?: boolean;
  personalRefs?: LitReference[];
  onSelectReference?: (ref: ReferenceWithClaims) => void;
}

const ReferenceModal: React.FC<ReferenceModalProps> = ({
  isOpen,
  onClose,
  taskId,
  claimId,
  usePersonalRefs = false,
  personalRefs = [],
  onSelectReference,
}) => {
  const { fetchReferences, deleteReferenceFromTask } = useTaskStore();
  const toast = useToast();

  const zustandReferences = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );

  const addReference = useTaskStore((state) => state.addReferenceToTask);
  const setSelectedTask = useTaskStore((state) => state.setSelectedTask);

  const [claimReferences, setClaimReferences] = useState<LitReference[]>([]);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);

  const handleOpenSelectModal = () => {
    if (typeof taskId === "number") {
      setSelectedTask(taskId);
    }
    setIsSelectOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    if (claimId) {
      fetchClaimSources(claimId).then((refs) => setClaimReferences(refs));
    } else if (typeof taskId === "number") {
      fetchReferences(taskId);
    }
  }, [isOpen, taskId, claimId]);

  // 🔀 Master source of references to show
  const activeReferences: LitReference[] =
    usePersonalRefs || onSelectReference
      ? personalRefs
      : claimId
      ? claimReferences
      : zustandReferences;

  const handleDeleteReference = async (id: number) => {
    if (typeof taskId === "number") {
      await deleteReferenceFromTask(taskId, id);
      toast({
        title: "Reference Removed from Task!",
        description: "The reference was removed from the task.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
    } else if (typeof claimId === "number") {
      await deleteClaimSource(id);
      toast({
        title: "Reference Unlinked from Claim!",
        description: "The reference was removed from this claim.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      const updated = await fetchClaimSources(claimId);
      setClaimReferences(updated);
    }
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
              <Text fontWeight="bold">Existing References:</Text>
              {activeReferences.length > 0 ? (
                activeReferences.map((ref) => (
                  <HStack
                    key={ref.reference_content_id}
                    w="100%"
                    justifyContent="space-between"
                  >
                    <Tooltip label={ref.content_name} hasArrow>
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
                      onClick={() => {
                        if (typeof claimId === "number") {
                          if ("claim_source_id" in ref && ref.claim_source_id) {
                            handleDeleteReference(ref.claim_source_id);
                          }
                        } else if (typeof taskId === "number") {
                          handleDeleteReference(ref.reference_content_id);
                        }
                      }}
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
            <Button colorScheme="blue" onClick={handleOpenSelectModal} mr={1}>
              Select from List
            </Button>
            <Button
              colorScheme="green"
              onClick={() => setIsScrapeOpen(true)}
              ml={2}
            >
              Scrape New Reference
            </Button>
            <Button colorScheme="red" onClick={onClose} ml={3}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {isSelectOpen && (
        <SelectReferenceModal
          isOpen={isSelectOpen}
          onClose={() => setIsSelectOpen(false)}
          claimId={claimId}
          onSelect={
            claimId
              ? async (referenceId) => {
                  await addClaimSource(claimId, referenceId);
                }
              : onSelectReference
              ? async (referenceId) => {
                  // Optionally return a mock reference or reload list
                }
              : undefined
          }
          onRefresh={
            claimId
              ? () =>
                  fetchClaimSources(claimId).then((refs) =>
                    setClaimReferences(refs)
                  )
              : undefined
          }
        />
      )}

      {isScrapeOpen && (
        <ScrapeReferenceModal
          isOpen={isScrapeOpen}
          onClose={() => setIsScrapeOpen(false)}
          taskId={taskId?.toString() || ""}
        />
      )}
    </>
  );
};

export default ReferenceModal;
