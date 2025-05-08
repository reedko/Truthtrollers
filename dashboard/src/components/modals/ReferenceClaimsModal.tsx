// src/components/modals/ReferenceClaimsModal.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Text,
  VStack,
  Box,
  Divider,
  IconButton,
  HStack,
} from "@chakra-ui/react";
import { ModalContent as ChakraModalContent } from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import ClaimEvaluationModal from "./ClaimEvaluationModal";
import { Search2Icon } from "@chakra-ui/icons";
import { motion } from "framer-motion";
interface ReferenceClaimsModalProps {
  isOpen: boolean;
  onClose: () => void;
  reference: ReferenceWithClaims | null;
  setDraggingClaim: (
    claim: Pick<Claim, "claim_id" | "claim_text"> | null
  ) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onVerifyClaim?: (claim: Claim) => void;
}
const MotionModalContent = motion(ChakraModalContent);
const ReferenceClaimsModal: React.FC<ReferenceClaimsModalProps> = ({
  isOpen,
  onClose,
  reference,
  setDraggingClaim,
  draggingClaim,
  onVerifyClaim,
}) => {
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const claimsArray =
    typeof reference?.claims === "string"
      ? JSON.parse(reference.claims)
      : reference?.claims || [];

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (tooltipRef.current && draggingClaim) {
        tooltipRef.current.style.left = `${e.clientX + 10}px`;
        tooltipRef.current.style.top = `${e.clientY + 10}px`;
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [draggingClaim]);

  useEffect(() => {
    let cachedY = 0;
    if (isOpen) {
      cachedY = window.scrollY;
      setTimeout(() => window.scrollTo({ top: cachedY }), 100);
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      isCentered
      size="xl"
      blockScrollOnMount={false} // ✅ prevent body scroll lock
      preserveScrollBarGap={true} // ✅ avoid layout shift
      trapFocus={false}
      scrollBehavior="inside" // ✅ allow internal modal scroll
    >
      <ModalOverlay />
      <MotionModalContent
        as={motion.div}
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ duration: 0.6 }} // 👈 Adjust speed here (default is ~0.2)
        position="fixed"
        right="2rem"
        top="5%"
        maxHeight="90vh"
        userSelect="none"
        boxShadow="2xl"
      >
        <ModalHeader>Reference Details</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start" spacing={4}>
            <Box>
              <Text fontWeight="bold">Title:</Text>
              <Text>{reference?.content_name}</Text>
            </Box>

            <Box>
              <Text fontWeight="bold">Source URL:</Text>
              <Text color="blue.500" wordBreak="break-word">
                <a
                  href={reference?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {reference?.url}
                </a>
              </Text>
            </Box>

            <Box>
              <Text fontWeight="bold">Topic:</Text>
              <Text>{reference?.topic || "N/A"}</Text>
            </Box>

            <Divider />

            <Box w="100%">
              <Text fontWeight="bold" mb={2}>
                Associated Claims:
              </Text>
              {claimsArray.length > 0 ? (
                <VStack align="start" spacing={2}>
                  {claimsArray.map((claim: Claim, index: number) => (
                    <HStack>
                      <Box
                        key={claim.claim_id ?? index}
                        pl={2}
                        border="1px solid blue"
                        borderRadius="md"
                        w="100%"
                        bg="black"
                        color="blue.300"
                        _hover={{
                          bg: "blue.200",
                          color: "black",
                          cursor: "grab",
                        }}
                        px={2}
                        py={1}
                        onMouseDown={() => setDraggingClaim(claim)}
                        onMouseUp={() => setDraggingClaim(null)}
                      >
                        {claim.claim_text}
                      </Box>
                      <IconButton
                        size="sm"
                        colorScheme="purple"
                        aria-label="Verify claim"
                        icon={<Search2Icon />}
                        onClick={() => onVerifyClaim?.(claim)}
                        ml={2}
                      />
                    </HStack>
                  ))}
                </VStack>
              ) : (
                <Text>No claims associated with this reference.</Text>
              )}
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Close</Button>
        </ModalFooter>
      </MotionModalContent>

      {/* 🔥 Floating Tooltip Claim Preview */}
      {draggingClaim && (
        <Box
          ref={tooltipRef}
          position="fixed"
          pointerEvents="none"
          zIndex={2000}
          px={4}
          py={2}
          bg="blue.300"
          color="black"
          borderRadius="md"
          boxShadow="lg"
          maxW="300px"
          fontSize="sm"
        >
          {draggingClaim.claim_text}
        </Box>
      )}
    </Modal>
  );
};

export default ReferenceClaimsModal;
