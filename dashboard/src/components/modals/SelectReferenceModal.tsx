import React, { useEffect, useState, useRef } from "react";
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
  VStack,
  Text,
  HStack,
  Tooltip,
  useToast,
  Spinner,
} from "@chakra-ui/react";
import {
  addClaimSource,
  fetchAllReferences,
} from "../../services/useDashboardAPI";
import { TaskStoreState, useTaskStore } from "../../store/useTaskStore";
import debounce from "lodash.debounce";

interface SelectReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (referenceId: number) => Promise<void>;
  onRefresh?: () => Promise<void>;
  claimId?: number;
}

const SelectReferenceModal: React.FC<SelectReferenceModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  onRefresh,
  claimId,
}) => {
  const [references, setReferences] = useState<
    { content_id: number; content_name: string; url: string }[]
  >([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const toast = useToast();
  const taskId = useTaskStore((state: TaskStoreState) => state.selectedTaskId);
  const addReferenceToTask = useTaskStore((s) => s.addReferenceToTask);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (isOpen && !hasFetched.current) {
      hasFetched.current = true;
      loadReferences("all", 1);
    }
  }, [isOpen]);

  const handleSearch = debounce(async (query: string) => {
    if (query.length < 3) return;
    setIsSearching(true);
    setPage(1);
    const searchResults = await fetchAllReferences(query, 1);
    setReferences(searchResults);
    setHasMore(searchResults.length === 50);
    setIsSearching(false);
  }, 500);

  const loadReferences = async (query: string, pageNum: number) => {
    setIsSearching(true);
    const data = await fetchAllReferences(query, pageNum);
    if (pageNum === 1) {
      setReferences(data);
    } else {
      setReferences((prevRefs) => [
        ...prevRefs,
        ...data.filter(
          (ref: { content_id: number; content_name: string; url: string }) =>
            !prevRefs.some((r) => r.content_id === ref.content_id)
        ),
      ]);
    }
    setPage(pageNum);
    setHasMore(data.length === 50);
    setIsSearching(false);
  };

  const handleLoadMore = async () => {
    await loadReferences(searchTerm || "all", page + 1);
  };

  const handleSelect = async (referenceId: number) => {
    try {
      if (onSelect) {
        await onSelect(referenceId);
        toast({
          title: "Reference Selected!",
          description: "Reference added to your list.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
        if (onRefresh) await onRefresh();
      } else if (claimId) {
        await addClaimSource(claimId, referenceId);
        toast({
          title: "Reference Linked!",
          description: "Reference linked to this claim.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } else if (taskId) {
        await addReferenceToTask(taskId, referenceId);
        toast({
          title: "Reference Added!",
          description: "Reference added to task.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      }

      // Remove selected ref and reload first page
      setReferences((prev) =>
        prev.filter((ref) => ref.content_id !== referenceId)
      );
      loadReferences("all", 1);
    } catch (err) {
      console.error("Error linking reference:", err);
      toast({
        title: "Error",
        description: "Failed to add reference.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">Select a Reference</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Input
            className="mr-input"
            placeholder="Search references..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              handleSearch(e.target.value);
            }}
            mb={3}
          />
          <VStack align="start" spacing={2} maxHeight="400px" overflowY="auto">
            {isSearching ? (
              <Spinner />
            ) : references.length > 0 ? (
              references.map((ref) => (
                <Tooltip key={ref.content_id} label={ref.content_name} hasArrow>
                  <Button
                    variant="outline"
                    width="100%"
                    onClick={() => handleSelect(ref.content_id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      window.open(ref.url, "_blank");
                    }}
                    colorScheme="blue"
                    justifyContent="flex-start"
                    textOverflow="ellipsis"
                  >
                    {ref.content_name}
                  </Button>
                </Tooltip>
              ))
            ) : (
              <Text>No references found.</Text>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            {hasMore && (
              <Button className="mr-button" onClick={handleLoadMore} colorScheme="blue">
                Load More
              </Button>
            )}
            <Button onClick={onClose} colorScheme="red">
              Close
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SelectReferenceModal;
