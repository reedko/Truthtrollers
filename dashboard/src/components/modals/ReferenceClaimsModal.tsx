import React, { useEffect, useRef } from "react";
import {
  Modal,
  ModalOverlay,
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
import { Search2Icon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import { Global, css } from "@emotion/react";
import { motion } from "framer-motion";
import { ModalContent as ChakraModalContent } from "@chakra-ui/react";
const MotionCard = motion(ChakraModalContent);
/* ────────────────────────────────────────────────────────── */
/* Types */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  reference: ReferenceWithClaims | null;
  setDraggingClaim: (
    claim: Pick<Claim, "claim_id" | "claim_text"> | null
  ) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onVerifyClaim?: (claim: Claim) => void;
}
/* ────────────────────────────────────────────────────────── */

const ReferenceClaimsModal: React.FC<Props> = (props) => {
  const {
    isOpen,
    onClose,
    reference,
    setDraggingClaim,
    draggingClaim,
    onVerifyClaim,
  } = props;

  /* Tooltip follows cursor while dragging */
  const tipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (tipRef.current && draggingClaim) {
        tipRef.current.style.left = `${e.clientX + 10}px`;
        tipRef.current.style.top = `${e.clientY + 10}px`;
      }
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, [draggingClaim]);

  /* ------------------------------------------------------------------ */
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      /* ↓↓↓  KEY LINES  ↓↓↓ */
      blockScrollOnMount={false} /* keep body scrollable              */
      scrollBehavior="inside" /* ModalBody scrolls, not backdrop   */
      trapFocus={false} /* allow clicks to pass backdrop     */
    >
      {/* Backdrop lets wheel/touch fall through */}
      <ModalOverlay bg="blackAlpha.700" pointerEvents="none" />
      <Global
        styles={css`
          /* full-viewport flex box that hugs the right  */
          .chakra-modal__content-container {
            pointer-events: none; /* let wheel/touch through */
          }
          /* the actual card stays interactive */
          .chakra-modal__content {
            pointer-events: auto;
          }
        `}
      />
      {/* Modal card (white box) */}
      <MotionCard
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

        <ModalBody maxH="70vh" overflowY="auto">
          <VStack align="start" spacing={4}>
            <Box>
              <Text fontWeight="bold">Title:</Text>
              <Text>{reference?.content_name}</Text>
            </Box>

            <Box>
              <Text fontWeight="bold">Source URL:</Text>
              <Text color="blue.500" wordBreak="break-all">
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

              {reference?.claims && (
                <VStack align="start" spacing={2}>
                  {(typeof reference.claims === "string"
                    ? JSON.parse(reference.claims)
                    : reference.claims
                  ).map((claim: Claim) => (
                    <HStack key={claim.claim_id} align="start">
                      <Box
                        flex="1"
                        bg="black"
                        color="blue.300"
                        px={2}
                        py={1}
                        borderRadius="md"
                        border="1px solid blue"
                        _hover={{ bg: "blue.200", color: "black" }}
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
                      />
                    </HStack>
                  ))}
                </VStack>
              )}
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button onClick={onClose}>Close</Button>
        </ModalFooter>
      </MotionCard>

      {/* Floating tooltip while dragging */}
      {draggingClaim && (
        <Box
          ref={tipRef}
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
