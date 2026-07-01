// src/components/modals/ClaimEvaluationModal.tsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  FormControl,
  FormLabel,
  Textarea,
  Input,
  Switch,
  Button,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Text,
  VStack,
  Select,
  useToast,
  Box,
  List,
  ListItem,
} from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import {
  fetchClaimSources,
  fetchReferencesWithClaimsForTask,
  fetchAllReferences,
  submitClaimEvaluation,
} from "../../services/useDashboardAPI";
import ReferenceModal from "./ReferenceModal";

interface ClaimEvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  claim: Claim;
  onSaveVerification: (verification: {
    claim_id: number;
    veracity_score: number;
    confidence_level: number;
    is_refuted: boolean;
    notes: string;
  }) => void;
}

const ClaimEvaluationModal: React.FC<ClaimEvaluationModalProps> = ({
  isOpen,
  onClose,
  claim,
  onSaveVerification,
}) => {
  const [veracityScore, setVeracityScore] = useState<number>(0);
  const [confidenceLevel, setConfidenceLevel] = useState<number>(0.5);
  const [isRefuted, setIsRefuted] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [selectedReferenceId, setSelectedReferenceId] = useState<number | null>(
    null
  );
  const [linkedReferenceIds, setLinkedReferenceIds] = useState<number[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const handleSave = async () => {
    if (!claim) return;

    if (!selectedReferenceId || !notes.trim()) {
      toast({
        title: "Missing information",
        description: "Please select a reference and provide justification.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    await submitClaimEvaluation({
      claim_id: claim.claim_id,
      reference_id: selectedReferenceId,
      evaluation_text: notes,
    });

    onSaveVerification({
      claim_id: claim.claim_id,
      veracity_score: veracityScore,
      confidence_level: confidenceLevel,
      is_refuted: isRefuted,
      notes,
    });

    toast({
      title: "Claim evaluated",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
    onClose();
  };

  useEffect(() => {
    if (claim?.content_id) {
      fetchReferencesWithClaimsForTask(claim.content_id)
        .then((refs) => {
          setReferences(refs);
        })
        .catch((error) => {
          console.error("Error fetching references for task:", error);
          setReferences([]); // Set empty array on error
        });
    }
  }, [claim]);

  useEffect(() => {
    if (claim?.claim_id) {
      fetchClaimSources(claim.claim_id)
        .then((sources) => {
          const ids = sources.map((s) => s.reference_content_id);
          setLinkedReferenceIds(ids);
        })
        .catch((error) => {
          console.error("Error fetching claim sources:", error);
          setLinkedReferenceIds([]); // Set empty array on error
        });
    }
  }, [claim]);

  // Filter references based on search term (search in name and claims)
  const filteredReferences = useMemo(() => {
    if (!searchTerm.trim()) {
      return references;
    }

    const lowerSearch = searchTerm.toLowerCase();
    return references.filter((ref) => {
      // Search in reference name
      if (ref.content_name?.toLowerCase().includes(lowerSearch)) {
        return true;
      }

      // Search in claims text within this reference
      if (ref.claims && Array.isArray(ref.claims)) {
        return ref.claims.some((claim: any) =>
          claim?.claim_text?.toLowerCase().includes(lowerSearch)
        );
      }

      return false;
    });
  }, [references, searchTerm]);

  const selectedReference = references.find(
    (ref) => ref.reference_content_id === selectedReferenceId
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent className="mr-modal">
          <ModalHeader className="mr-modal-header">Evaluate Claim</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={2} fontWeight="semibold">
              {claim?.claim_text}
            </Text>

            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel>Veracity Score (0 = false, 1 = true)</FormLabel>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={veracityScore}
                  onChange={setVeracityScore}
                >
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
                <Text textAlign="center">
                  Score: {veracityScore.toFixed(1)}
                </Text>
              </FormControl>

              <FormControl>
                <FormLabel>Confidence Level</FormLabel>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={confidenceLevel}
                  onChange={setConfidenceLevel}
                >
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
                <Text textAlign="center">
                  Confidence: {confidenceLevel.toFixed(1)}
                </Text>
              </FormControl>

              <FormControl display="flex" alignItems="center">
                <FormLabel htmlFor="refuted" mb="0">
                  Mark as misleading or refuted:
                </FormLabel>
                <Switch
                  id="refuted"
                  isChecked={isRefuted}
                  onChange={(e) => setIsRefuted(e.target.checked)}
                  colorScheme="red"
                />
              </FormControl>

              <FormControl>
                <FormLabel>Notes / Justification</FormLabel>
                <Textarea
                  className="mr-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why do you rate it this way? Include sources or reasoning."
                />
                <FormLabel mt={4}>Select a Primary Source</FormLabel>
                <Box position="relative" ref={dropdownRef}>
                  <Input
                    placeholder="Search sources by name or claims text..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    mb={2}
                  />

                  {selectedReference && (
                    <Box
                      p={2}
                      bg="blue.50"
                      borderRadius="md"
                      mb={2}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Text fontSize="sm" fontWeight="medium">
                        Selected: {selectedReference.content_name}
                      </Text>
                      <Button
                        size="xs"
                        colorScheme="red"
                        variant="ghost"
                        onClick={() => {
                          setSelectedReferenceId(null);
                          setSearchTerm("");
                        }}
                      >
                        Clear
                      </Button>
                    </Box>
                  )}

                  {showDropdown && filteredReferences.length > 0 && (
                    <Box
                      position="absolute"
                      top="100%"
                      left={0}
                      right={0}
                      bg="white"
                      border="1px solid"
                      borderColor="gray.200"
                      borderRadius="md"
                      maxH="300px"
                      overflowY="auto"
                      zIndex={1000}
                      boxShadow="lg"
                    >
                      <List spacing={0}>
                        {filteredReferences.map((ref) => {
                          const claimsInRef = Array.isArray(ref.claims)
                            ? ref.claims
                            : [];
                          const matchingClaims = searchTerm.trim()
                            ? claimsInRef.filter((claim: any) =>
                                claim?.claim_text
                                  ?.toLowerCase()
                                  .includes(searchTerm.toLowerCase())
                              )
                            : [];

                          return (
                            <ListItem
                              key={ref.reference_content_id}
                              p={3}
                              cursor="pointer"
                              _hover={{ bg: "gray.100" }}
                              borderBottom="1px solid"
                              borderColor="gray.100"
                              onClick={() => {
                                setSelectedReferenceId(ref.reference_content_id);
                                setSearchTerm("");
                                setShowDropdown(false);
                              }}
                            >
                              <Text fontWeight="semibold" fontSize="sm">
                                {ref.content_name}
                              </Text>
                              {ref.url && (
                                <Text fontSize="xs" color="gray.600" noOfLines={1}>
                                  {ref.url}
                                </Text>
                              )}
                              {matchingClaims.length > 0 && (
                                <Box mt={2} pl={2} borderLeft="2px solid" borderColor="blue.300">
                                  <Text fontSize="xs" color="blue.600" fontWeight="medium">
                                    Matching claims:
                                  </Text>
                                  {matchingClaims.slice(0, 2).map((claim: any, idx: number) => (
                                    <Text
                                      key={idx}
                                      fontSize="xs"
                                      color="gray.700"
                                      noOfLines={2}
                                      mt={1}
                                    >
                                      "{claim.claim_text}"
                                    </Text>
                                  ))}
                                  {matchingClaims.length > 2 && (
                                    <Text fontSize="xs" color="gray.500" mt={1}>
                                      +{matchingClaims.length - 2} more matching claims
                                    </Text>
                                  )}
                                </Box>
                              )}
                              {claimsInRef.length > 0 && matchingClaims.length === 0 && (
                                <Text fontSize="xs" color="gray.500" mt={1}>
                                  {claimsInRef.length} claim(s) in this source
                                </Text>
                              )}
                            </ListItem>
                          );
                        })}
                      </List>
                    </Box>
                  )}

                  {showDropdown && filteredReferences.length === 0 && searchTerm.trim() && (
                    <Box
                      position="absolute"
                      top="100%"
                      left={0}
                      right={0}
                      bg="white"
                      border="1px solid"
                      borderColor="gray.200"
                      borderRadius="md"
                      p={4}
                      zIndex={1000}
                      boxShadow="lg"
                    >
                      <Text color="gray.500" fontSize="sm">
                        No sources found matching "{searchTerm}"
                      </Text>
                    </Box>
                  )}
                </Box>

                {references.length === 0 && (
                  <Text color="red.500" mt={2}>
                    ⚠️ You must link at least one source to Evaluate this claim.
                  </Text>
                )}
              </FormControl>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button
              onClick={() => setIsReferenceModalOpen(true)}
              mr={3}
              colorScheme="blue"
            >
              Add Source
            </Button>

            <Button className="mr-button" colorScheme="blue" onClick={handleSave}>
              Submit Evaluation
            </Button>
            <Button onClick={onClose} ml={3}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {isReferenceModalOpen && (
        <ReferenceModal
          isOpen={isReferenceModalOpen}
          onClose={() => setIsReferenceModalOpen(false)}
          claimId={claim.claim_id}
        />
      )}
    </>
  );
};

export default ClaimEvaluationModal;
