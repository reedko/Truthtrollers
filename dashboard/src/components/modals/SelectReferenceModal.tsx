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
import debounce from "lodash.debounce"; // ✅ Prevents API spam

interface SelectReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (referenceId: number) => Promise<void>; // optional override
  onRefresh?: () => Promise<void>; // optional refresh for caller
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
  const addReferenceToTask = useTaskStore(
    (state: TaskStoreState) => state.addReferenceToTask
  );
  const taskId = useTaskStore((state: TaskStoreState) => state.selectedTaskId);
  const toast = useToast();
  const hasFetched = useRef(false); // ✅ Prevents double-fetching

  useEffect(() => {
    if (isOpen && !hasFetched.current) {
      hasFetched.current = true;
      loadReferences("all", 1);
    }
  }, [isOpen]);

  // ✅ Debounced search
  const handleSearch = debounce(async (query: string) => {
    if (query.length < 3) return;
    setIsSearching(true);
    setPage(1);
    const searchResults = await fetchAllReferences(query, 1);
    setReferences(searchResults);
    setHasMore(searchResults.length === 50);
    setIsSearching(false);
  }, 500);

  // ✅ Load references (search or normal)
  const loadReferences = async (query: string, pageNum: number) => {
    setIsSearching(true);
    const data = await fetchAllReferences(query, pageNum);
    if (pageNum === 1) {
      setReferences(data);
    } else {
      setReferences((prevRefs) => [
        ...prevRefs,
        ...data.filter(
          (newRef: { content_id: number; content_name: string; url: string }) =>
            !prevRefs.some(
              (prevRef) => prevRef.content_id === newRef.content_id
            )
        ),
      ]);
    }
    setPage(pageNum);
    setHasMore(data.length === 50);
    setIsSearching(false);
  };

  // ✅ Load more references (pagination)
  const handleLoadMore = async () => {
    await loadReferences(searchTerm || "all", page + 1);
  };

  // ✅ Select a reference and remove it from the list
  const handleSelect = async (referenceId: number) => {
    try {
      if (onSelect) {
        await onSelect(referenceId); // ✅ Add reference
        toast({
          title: "Reference Linked!",
          description: "Reference successfully linked.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
        if (onRefresh) await onRefresh(); // ✅ Tell parent to update
      } else if (claimId) {
        await addClaimSource(claimId, referenceId);
        toast({
          title: "Reference Linked!",
          description: "Reference successfully linked to claim.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } else if (taskId) {
        await addReferenceToTask(taskId, referenceId);
        toast({
          title: "Reference Added!",
          description: "Reference added to the task.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      }

      // Remove the selected ref and reload more
      setReferences((prev) =>
        prev.filter((ref) => ref.content_id !== referenceId)
      );
      loadReferences("all", 1);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to add reference.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      console.error("Reference link error:", err);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Select a Reference</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {/* ✅ Search Box */}
          <Input
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
              <Spinner size="md" />
            ) : references.length > 0 ? (
              references.map((ref) => (
                <Tooltip key={ref.content_id} label={ref.content_name} hasArrow>
                  <Button
                    onClick={() => handleSelect(ref.content_id)}
                    variant="outline"
                    width="100%"
                    textAlign="left"
                    colorScheme="blue"
                    justifyContent="flex-start"
                    textOverflow="ellipsis"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      window.open(ref.url, "_blank");
                    }}
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
              <Button onClick={handleLoadMore} mt={2} colorScheme="blue">
                Load More
              </Button>
            )}
            <Button colorScheme="red" onClick={onClose}>
              Close
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SelectReferenceModal;
