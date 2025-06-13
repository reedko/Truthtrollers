import React, { useRef, useState } from "react";
import {
  Box,
  Heading,
  IconButton,
  Button,
  Text,
  VStack,
  Divider,
  HStack,
} from "@chakra-ui/react";
import { CloseIcon, Search2Icon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";

// Types for props
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

const DraggableReferenceClaimsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  reference,
  setDraggingClaim,
  draggingClaim,
  onVerifyClaim,
}) => {
  // Position state for the floating box
  const [position, setPosition] = useState({ x: 920, y: 100 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Start drag on header
  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    document.body.style.userSelect = "none";
  };
  // Move
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    setPosition({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    });
  };
  // Stop drag
  const onMouseUp = () => {
    setDragging(false);
    document.body.style.userSelect = "";
  };

  React.useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line
  }, [dragging]);

  // Tooltip for dragging claims
  const tipRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const move = (e: MouseEvent) => {
      if (tipRef.current && draggingClaim) {
        tipRef.current.style.left = `${e.clientX + 10}px`;
        tipRef.current.style.top = `${e.clientY + 10}px`;
      }
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, [draggingClaim]);

  // If not open, render nothing!
  if (!isOpen) return null;

  return (
    <>
      <Box
        position="fixed"
        left={position.x}
        top={position.y}
        zIndex={2500}
        w={["90vw", "500px"]}
        maxW="95vw"
        bg="gray.900"
        color="white"
        borderRadius="xl"
        boxShadow="2xl"
        border="2px solid #333"
        p={0}
        cursor={dragging ? "grabbing" : "default"}
        userSelect="none"
      >
        {/* DRAG HANDLE */}
        <Box
          onMouseDown={onMouseDown}
          cursor="grab"
          bg="gray.800"
          px={4}
          py={2}
          borderTopRadius="xl"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
        >
          <Heading size="sm" mb={0} color="teal.200">
            Reference Details
          </Heading>
          <IconButton
            aria-label="Close"
            icon={<CloseIcon />}
            size="sm"
            onClick={onClose}
          />
        </Box>

        <Box p={4} maxH="70vh" overflowY="auto">
          <VStack align="start" spacing={4}>
            <Box>
              <Text fontWeight="bold">Title:</Text>
              <Text>{reference?.content_name}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold">Source URL:</Text>
              <Text color="blue.300" wordBreak="break-all">
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
        </Box>
        <Box
          p={4}
          borderBottomRadius="xl"
          borderTop="1px solid #333"
          display="flex"
          justifyContent="flex-end"
        >
          <Button onClick={onClose}>Close</Button>
        </Box>
      </Box>
      {/* Floating tooltip while dragging */}
      {draggingClaim && (
        <Box
          ref={tipRef}
          position="fixed"
          pointerEvents="none"
          zIndex={3000}
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
    </>
  );
};

export default DraggableReferenceClaimsModal;
