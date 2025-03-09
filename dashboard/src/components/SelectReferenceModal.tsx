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
  Input,
  VStack,
  Text,
  HStack,
  Tooltip,
} from "@chakra-ui/react";
import { fetchAllReferences } from "../services/useWorkspaceData";

const SelectReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSelect: (referenceId: number) => void;
}> = ({ isOpen, onClose, onSelect }) => {
  const [references, setReferences] = useState<
    { content_id: number; content_name: string; url: string }[]
  >([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1); // ✅ Track current page
  const [hasMore, setHasMore] = useState(true); // ✅ Track if more data exists

  useEffect(() => {
    const loadReferences = async () => {
      setIsSearching(true);
      const data = await fetchAllReferences("all", 1); // ✅ Fetch first page
      setReferences(data);
      setIsSearching(false);
    };

    if (isOpen) loadReferences();
  }, [isOpen]);

  // ✅ Search API Call
  const handleSearch = async () => {
    if (searchTerm.length < 3) return;
    setIsSearching(true);
    setPage(1); // ✅ Reset to first page on new search
    const searchResults = await fetchAllReferences(searchTerm, 1);
    setReferences(searchResults);
    setHasMore(searchResults.length === 50); // ✅ If fewer than 50, no more pages
    setIsSearching(false);
  };

  // ✅ Fetch More References
  const handleLoadMore = async () => {
    const nextPage = page + 1;
    const newReferences = await fetchAllReferences(
      searchTerm || "all",
      nextPage
    );

    if (newReferences.length > 0) {
      setReferences((prevRefs) => {
        const uniqueRefs = [
          ...prevRefs,
          ...newReferences.filter(
            (newRef: {
              content_id: number;
              content_name: string;
              url: string;
            }) =>
              !prevRefs.some(
                (prevRef) => prevRef.content_id === newRef.content_id
              )
          ),
        ];
        return uniqueRefs;
      });

      setPage(nextPage);
    }

    setHasMore(newReferences.length === 50);
  };

  const handleSelect = async (referenceId: number) => {
    await onSelect(referenceId);
    onClose();
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
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyUp={(e) => e.key === "Enter" && handleSearch()} // 🔍 Press Enter to search
            mb={3}
          />

          <VStack align="start" spacing={2} maxHeight="400px" overflowY="auto">
            {isSearching ? (
              <Text>Searching...</Text>
            ) : (
              references.map((ref) => (
                <Tooltip
                  label={ref.content_name}
                  aria-label="Full reference name"
                  hasArrow
                >
                  <Button
                    key={ref.content_id}
                    onClick={() => handleSelect(ref.content_id)}
                    variant="outline"
                    width="100%"
                    textAlign="left"
                    colorScheme="blue"
                    justifyContent="flex-start"
                    textOverflow="ellipsis"
                    onContextMenu={(e) => {
                      e.preventDefault(); // ✅ Prevents default right-click menu
                      window.open(ref.url, "_blank"); // ✅ Opens in a new tab
                    }}
                  >
                    {ref.content_name}
                  </Button>
                </Tooltip>
              ))
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          {/* ✅ Load More Button (only if more results exist) */}
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
