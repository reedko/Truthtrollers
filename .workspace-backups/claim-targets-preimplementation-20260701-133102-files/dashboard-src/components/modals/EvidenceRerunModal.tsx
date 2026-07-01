/**
 * Evidence Re-run Modal
 * Minority Report styled modal for re-running evidence search on a claim
 */

import React, { useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Spinner,
  Alert,
  AlertIcon,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Badge,
} from "@chakra-ui/react";
import { Claim } from "../../../../shared/entities/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface EvidenceRerunModalProps {
  isOpen: boolean;
  onClose: () => void;
  claim: Claim;
  contentId: number;
}

const EvidenceRerunModal: React.FC<EvidenceRerunModalProps> = ({
  isOpen,
  onClose,
  claim,
  contentId,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"standard" | "deep" | "incremental" | "balanced">("standard");
  const toast = useToast();

  const handleRunEvidence = async () => {
    setIsRunning(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/content/${contentId}/claims/${claim.claim_id}/evidence/rerun`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("jwt")}`,
        },
        body: JSON.stringify({
          mode: selectedMode,
          claim_text: claim.claim_text,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to run evidence search");
      }

      const data = await response.json();

      toast({
        title: "Evidence Search Complete",
        description: `Found ${data.evidence_count || 0} new evidence sources`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      onClose();
    } catch (error) {
      console.error("Evidence search error:", error);
      toast({
        title: "Evidence Search Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay bg="rgba(0, 0, 0, 0.4)" backdropFilter="blur(2px)" />
      <ModalContent
        bg="linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95))"
        backdropFilter="blur(20px)"
        border="1px solid"
        borderColor="rgba(0, 162, 255, 0.4)"
        borderRadius="12px"
        boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        overflow="hidden"
        position="relative"
      >
        {/* Glow bar on left edge */}
        <Box
          position="absolute"
          top={0}
          left={0}
          width="20px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
          pointerEvents="none"
          zIndex={0}
        />

        {/* Scanlines overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
          pointerEvents="none"
          borderRadius="12px"
          zIndex={1}
        />

        <ModalHeader
          color="#00a2ff"
          fontWeight="200"
          letterSpacing="4px"
          textTransform="uppercase"
          fontSize="lg"
          textShadow="0 0 20px rgba(0, 162, 255, 0.8)"
          position="relative"
          zIndex={2}
        >
          🔬 Evidence Re-Run
        </ModalHeader>
        <ModalCloseButton color="#00a2ff" _hover={{ bg: "rgba(0, 162, 255, 0.2)" }} zIndex={2} />

        <ModalBody position="relative" zIndex={2}>
          <VStack spacing={6} align="stretch">
            {/* Claim Display */}
            <Box
              p={4}
              bg="rgba(0, 162, 255, 0.1)"
              border="1px solid"
              borderColor="rgba(0, 162, 255, 0.3)"
              borderRadius="8px"
              position="relative"
            >
              <Text fontSize="xs" color="#94a3b8" letterSpacing="1px" mb={2} textTransform="uppercase">
                Target Claim
              </Text>
              <Text color="#f1f5f9" fontWeight="300" lineHeight="1.6">
                {claim.claim_text}
              </Text>
            </Box>

            {/* Mode Selection */}
            <Box>
              <Text fontSize="sm" color="#00a2ff" fontWeight="600" mb={3} letterSpacing="1px">
                SEARCH MODE
              </Text>
              <Tabs
                variant="unstyled"
                index={selectedMode === "standard" ? 0 : selectedMode === "deep" ? 1 : selectedMode === "balanced" ? 2 : 3}
                onChange={(index) => {
                  const modes: Array<"standard" | "deep" | "balanced" | "incremental"> = ["standard", "deep", "balanced", "incremental"];
                  setSelectedMode(modes[index]);
                }}
              >
                <TabList gap={2} flexWrap="wrap">
                  <Tab
                    _selected={{
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      color: "#00a2ff",
                    }}
                    bg="rgba(0, 162, 255, 0.05)"
                    border="1px solid"
                    borderColor="rgba(0, 162, 255, 0.3)"
                    borderRadius="6px"
                    color="#94a3b8"
                    fontSize="xs"
                    fontWeight="600"
                    letterSpacing="1px"
                    px={4}
                    py={2}
                  >
                    STANDARD
                  </Tab>
                  <Tab
                    _selected={{
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      color: "#00a2ff",
                    }}
                    bg="rgba(0, 162, 255, 0.05)"
                    border="1px solid"
                    borderColor="rgba(0, 162, 255, 0.3)"
                    borderRadius="6px"
                    color="#94a3b8"
                    fontSize="xs"
                    fontWeight="600"
                    letterSpacing="1px"
                    px={4}
                    py={2}
                  >
                    DEEP SCAN
                  </Tab>
                  <Tab
                    _selected={{
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      color: "#00a2ff",
                    }}
                    bg="rgba(0, 162, 255, 0.05)"
                    border="1px solid"
                    borderColor="rgba(0, 162, 255, 0.3)"
                    borderRadius="6px"
                    color="#94a3b8"
                    fontSize="xs"
                    fontWeight="600"
                    letterSpacing="1px"
                    px={4}
                    py={2}
                  >
                    BALANCED
                  </Tab>
                  <Tab
                    _selected={{
                      bg: "rgba(0, 162, 255, 0.2)",
                      borderColor: "#00a2ff",
                      color: "#00a2ff",
                    }}
                    bg="rgba(0, 162, 255, 0.05)"
                    border="1px solid"
                    borderColor="rgba(0, 162, 255, 0.3)"
                    borderRadius="6px"
                    color="#94a3b8"
                    fontSize="xs"
                    fontWeight="600"
                    letterSpacing="1px"
                    px={4}
                    py={2}
                  >
                    INCREMENTAL
                  </Tab>
                </TabList>

                <TabPanels>
                  <TabPanel px={0}>
                    <VStack align="start" spacing={2} mt={3}>
                      <Badge colorScheme="blue" fontSize="xs">
                        ~30-60 seconds
                      </Badge>
                      <Text fontSize="sm" color="#94a3b8" fontWeight="300">
                        Standard evidence search using current prompts and parameters.
                      </Text>
                    </VStack>
                  </TabPanel>
                  <TabPanel px={0}>
                    <VStack align="start" spacing={2} mt={3}>
                      <Badge colorScheme="purple" fontSize="xs">
                        ~2-5 minutes
                      </Badge>
                      <Text fontSize="sm" color="#94a3b8" fontWeight="300">
                        Deep scan with expanded search queries and additional source verification.
                      </Text>
                    </VStack>
                  </TabPanel>
                  <TabPanel px={0}>
                    <VStack align="start" spacing={2} mt={3}>
                      <Badge colorScheme="orange" fontSize="xs">
                        ~1-2 minutes
                      </Badge>
                      <Text fontSize="sm" color="#94a3b8" fontWeight="300">
                        <strong>Balanced search:</strong> Find 3 supporting, 3 refuting, and 3 nuance sources for this claim.
                      </Text>
                    </VStack>
                  </TabPanel>
                  <TabPanel px={0}>
                    <VStack align="start" spacing={2} mt={3}>
                      <Badge colorScheme="green" fontSize="xs">
                        ~10-20 seconds
                      </Badge>
                      <Text fontSize="sm" color="#94a3b8" fontWeight="300">
                        Only search for new evidence, keeping existing sources unchanged.
                      </Text>
                    </VStack>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Box>

            {/* Info Alert */}
            <Alert
              status="info"
              variant="left-accent"
              bg="rgba(0, 162, 255, 0.05)"
              borderColor="rgba(0, 162, 255, 0.3)"
              borderRadius="6px"
            >
              <AlertIcon color="#00a2ff" />
              <Text fontSize="sm" color="#f1f5f9" fontWeight="300">
                This will search for new evidence sources and link them to this claim.
              </Text>
            </Alert>
          </VStack>
        </ModalBody>

        <ModalFooter position="relative" zIndex={2}>
          <Button
            variant="ghost"
            mr={3}
            onClick={onClose}
            color="#94a3b8"
            _hover={{ bg: "rgba(0, 162, 255, 0.1)" }}
            isDisabled={isRunning}
          >
            Cancel
          </Button>
          <Button
            bg="linear-gradient(135deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0.6) 100%)"
            border="1px solid"
            borderColor="rgba(0, 162, 255, 0.6)"
            color="#fff"
            fontWeight="600"
            letterSpacing="1px"
            boxShadow="0 6px 20px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 162, 255, 0.3)"
            _hover={{
              bg: "linear-gradient(135deg, rgba(0, 162, 255, 0.5) 0%, rgba(0, 162, 255, 0.7) 100%)",
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4)",
            }}
            _active={{
              transform: "translateY(1px)",
            }}
            onClick={handleRunEvidence}
            isLoading={isRunning}
            loadingText="Scanning..."
          >
            {isRunning ? <Spinner size="sm" mr={2} /> : "🔬"} Run Evidence Search
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default EvidenceRerunModal;
