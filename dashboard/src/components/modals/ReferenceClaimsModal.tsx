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
  useBreakpointValue,
} from "@chakra-ui/react";
import { Search2Icon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import { Global, css } from "@emotion/react";
import { motion } from "framer-motion";
import { ModalContent as ChakraModalContent } from "@chakra-ui/react";

const MotionCard = motion(ChakraModalContent);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reference: ReferenceWithClaims | null;
  setDraggingClaim: (
    claim: Pick<Claim, "claim_id" | "claim_text"> | null
  ) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onVerifyClaim?: (claim: Claim) => void;
  onStartLink?: (claim: Pick<Claim, "claim_id" | "claim_text">) => void;
}

const ReferenceClaimsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  reference,
  setDraggingClaim,
  draggingClaim,
  onVerifyClaim,
  onStartLink,
}) => {
  const isMobile = useBreakpointValue({ base: true, md: false });

  // Tooltip follows cursor while dragging
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      blockScrollOnMount={false}
      scrollBehavior="inside"
      trapFocus={false}
      isCentered={!isMobile}
      closeOnOverlayClick={false}
    >
      <ModalOverlay bg="blackAlpha.100" pointerEvents="none" />
      <Global
        styles={css`
          .chakra-modal__content-container {
            pointer-events: none;
          }
          .chakra-modal__content {
            pointer-events: auto;
          }
        `}
      />

      <MotionCard
        as={motion.div}
        initial={{ x: isMobile ? 0 : "100%", opacity: isMobile ? 1 : 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: isMobile ? 0 : "100%", opacity: isMobile ? 1 : 0 }}
        transition={{ duration: 0.6 }}
        position="fixed"
        right={isMobile ? 0 : "2rem"}
        left={isMobile ? 0 : "auto"}
        top={isMobile ? 0 : "5%"}
        bottom={isMobile ? 0 : "auto"}
        w={isMobile ? "100vw" : "min(720px, 92vw)"}
        maxW={isMobile ? "100vw" : "92vw"}
        h={isMobile ? "100dvh" : "auto"}
        maxH={isMobile ? "100dvh" : "85vh"}
        borderRadius={isMobile ? 0 : "xl"}
        userSelect="none"
        boxShadow="2xl"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        pt={isMobile ? "env(safe-area-inset-top)" : undefined}
        pb={isMobile ? "env(safe-area-inset-bottom)" : undefined}
        sx={{
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          boxSizing: "border-box",
        }}
      >
        {/* Sticky header with extra right padding so title never sits under the X */}
        <ModalHeader
          position={isMobile ? "sticky" : "static"}
          top={0}
          zIndex={2}
          bg="chakra-body-bg"
          px={{ base: 4, md: 6 }}
          py={{ base: 3, md: 4 }}
          borderBottomWidth={isMobile ? "1px" : 0}
          pr={{ base: "calc(env(safe-area-inset-right) + 56px)", md: 6 }}
        >
          <Text noOfLines={2}>
            {reference?.content_name || "Reference Claims"}
          </Text>
        </ModalHeader>

        {/* BIGGER, NOTCH-SAFE CLOSE BUTTON */}
        <ModalCloseButton
          size={isMobile ? "lg" : "md"}
          zIndex={3}
          top={{ base: "calc(env(safe-area-inset-top) + 8px)", md: 3 }}
          right={{ base: "calc(env(safe-area-inset-right) + 8px)", md: 3 }}
          bg={isMobile ? "blackAlpha.600" : undefined}
          _hover={{ bg: isMobile ? "blackAlpha.700" : undefined }}
          color={isMobile ? "white" : undefined}
          borderRadius="full"
          onClick={onClose}
        />

        <ModalBody
          px={{ base: 4, md: 6 }}
          py={{ base: 3, md: 4 }}
          overflowY="auto"
          flex="1 1 auto"
        >
          <VStack align="start" spacing={4}>
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
                    <HStack key={claim.claim_id} align="start" w="100%">
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
                      <Button
                        size="sm"
                        onClick={() =>
                          onStartLink?.({
                            claim_id: claim.claim_id,
                            claim_text: claim.claim_text,
                          })
                        }
                      >
                        Link
                      </Button>
                    </HStack>
                  ))}
                </VStack>
              )}
            </Box>
          </VStack>
        </ModalBody>

        {/* Sticky footer is another easy Close target on phones */}
        <ModalFooter
          position={isMobile ? "sticky" : "static"}
          bottom={0}
          zIndex={2}
          bg="chakra-body-bg"
          px={{ base: 4, md: 6 }}
          py={{ base: 3, md: 4 }}
          borderTopWidth={isMobile ? "1px" : 0}
        >
          <Button
            onClick={onClose}
            w={{ base: "100%", md: "auto" }}
            colorScheme="purple"
          >
            Close
          </Button>
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
