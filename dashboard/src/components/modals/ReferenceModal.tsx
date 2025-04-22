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
  onSelectReference?: (ref: LitReference) => void;
  onUpdateReferences?: () => void; // ✅ New prop
}

const ReferenceModal: React.FC<ReferenceModalProps> = ({
  isOpen,
  onClose,
  taskId,
  claimId,
  usePersonalRefs = false,
  personalRefs = [],
  onSelectReference,
  onUpdateReferences,
}) => {
  const toast = useToast();

  const zustandReferences = useTaskStore(
    useShallow((state) => state.references[Number(taskId)] || [])
  );

  const { fetchReferences, deleteReferenceFromTask } = useTaskStore();
  const addReferenceToTask = useTaskStore((s) => s.addReferenceToTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

  const [claimReferences, setClaimReferences] = useState<LitReference[]>([]);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);

  // 🧠 Load references on open
  useEffect(() => {
    if (!isOpen) return;

    if (claimId) {
      fetchClaimSources(claimId).then(setClaimReferences);
    } else if (typeof taskId === "number") {
      fetchReferences(taskId);
      onUpdateReferences?.();
    }
  }, [isOpen, claimId, taskId]);

  // 🔀 Choose which list to use
  const activeReferences: LitReference[] = usePersonalRefs
    ? personalRefs
    : claimId
    ? claimReferences
    : zustandReferences;

  // 🗑️ Handle delete
  const handleDeleteReference = async (id: number) => {
    try {
      if (typeof taskId === "number") {
        await deleteReferenceFromTask(taskId, id);
        toast({
          title: "Reference Removed from Task!",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
        fetchReferences(taskId); // refresh list
        onUpdateReferences?.();
      } else if (typeof claimId === "number") {
        await deleteClaimSource(id);
        const updated = await fetchClaimSources(claimId);
        setClaimReferences(updated);
        toast({
          title: "Reference Unlinked from Claim!",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (err) {
      toast({
        title: "Error removing reference",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      console.error(err);
    }
  };

  // 📚 Select from global list
  const handleOpenSelectModal = () => {
    console.log("Opening select modal with taskId:", taskId);
    if (typeof taskId === "number") setSelectedTask(taskId);
    setIsSelectOpen(true);
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
                      {onSelectReference ? (
                        <Button
                          variant="ghost"
                          colorScheme="blue"
                          size="sm"
                          onClick={() => {
                            onSelectReference(ref);
                            onClose();
                          }}
                        >
                          ➕ Cite: {ref.content_name}
                        </Button>
                      ) : (
                        <Link
                          href={ref.url}
                          isExternal
                          color="blue.500"
                          isTruncated
                          maxWidth="-moz-max-content"
                        >
                          🔗 {ref.content_name}
                        </Link>
                      )}
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

      {/* 🔍 SelectReferenceModal */}
      {isSelectOpen && (
        <SelectReferenceModal
          isOpen={isSelectOpen}
          onClose={() => setIsSelectOpen(false)}
          claimId={claimId}
          onSelect={
            claimId
              ? async (refId) => {
                  await addClaimSource(claimId, refId);
                }
              : onSelectReference
              ? async (refId) => {
                  const ref = zustandReferences.find(
                    (r) => r.reference_content_id === refId
                  );
                  if (ref) {
                    onSelectReference(ref);
                  }
                }
              : async (refId) => {
                  if (taskId) await addReferenceToTask(taskId, refId);
                  fetchReferences(taskId!);
                  onUpdateReferences?.();
                }
          }
          onRefresh={
            claimId
              ? () => fetchClaimSources(claimId).then(setClaimReferences)
              : taskId
              ? () => fetchReferences(taskId)
              : undefined
          }
        />
      )}

      {/* 🧪 ScrapeReferenceModal */}
      {isScrapeOpen && (
        <ScrapeReferenceModal
          isOpen={isScrapeOpen}
          onClose={() => setIsScrapeOpen(false)}
          taskId={taskId?.toString() || ""}
          onUpdateReferences={onUpdateReferences}
        />
      )}
    </>
  );
};

export default ReferenceModal;
