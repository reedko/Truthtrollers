// src/components/TaskClaims.tsx
import React, { useEffect, useRef } from "react";
import {
  VStack,
  Heading,
  Box,
  Text,
  HStack,
  IconButton,
  Tooltip,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { Claim } from "../../../shared/entities/types";
import ClaimModal from "./modals/ClaimModal";

interface TaskClaimsProps {
  claims: Claim[];
  onAddClaim: (newClaim: Claim) => Promise<void>;
  onEditClaim: (updatedClaim: Claim) => Promise<void>;
  onDeleteClaim: (claimId: number) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onDropReferenceClaim: (
    sourceClaim: Pick<Claim, "claim_id" | "claim_text">,
    targetClaim: Claim
  ) => void;
  taskId: number;
  hoveredClaimId: number | null;
  setHoveredClaimId: (id: number | null) => void;
  selectedClaim: Claim | null;
  setSelectedClaim: (claim: Claim | null) => void;
  isClaimModalOpen: boolean;
  setIsClaimModalOpen: (open: boolean) => void;
  isClaimViewModalOpen: boolean;
  setIsClaimViewModalOpen: (open: boolean) => void;
  editingClaim: Claim | null;
  setEditingClaim: (claim: Claim | null) => void;
  onVerifyClaim: (claim: Claim) => void;
}

const TaskClaims: React.FC<TaskClaimsProps> = ({
  claims,
  onAddClaim,
  onEditClaim,
  onDeleteClaim,
  draggingClaim,
  onDropReferenceClaim,
  hoveredClaimId,
  setHoveredClaimId,
  selectedClaim,
  setSelectedClaim,
  isClaimModalOpen,
  setIsClaimModalOpen,
  isClaimViewModalOpen,
  setIsClaimViewModalOpen,
  editingClaim,
  setEditingClaim,
  onVerifyClaim,
  taskId,
}) => {
  const claimRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingClaim) return;

      for (const claim of claims) {
        const box = claimRefs.current[claim.claim_id];
        if (box) {
          const rect = box.getBoundingClientRect();
          const isInside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;

          if (isInside) {
            setHoveredClaimId(claim.claim_id);
            return;
          }
        }
      }

      setHoveredClaimId(null);
    };

    const handleMouseUp = () => {
      if (draggingClaim && hoveredClaimId !== null) {
        const targetClaim = claims.find((c) => c.claim_id === hoveredClaimId);
        if (targetClaim) {
          onDropReferenceClaim(draggingClaim, targetClaim);
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [claims, draggingClaim, hoveredClaimId]);

  return (
    <VStack
      align="start"
      spacing={2}
      borderRight="1px solid gray"
      pr={4}
      alignSelf="flex-start"
      //overflowY="auto"
      //maxHeight="800px"
      width="100%"
    >
      <Heading size="sm">Claims</Heading>

      <Box
        as="button"
        bg="blue.600"
        color="white"
        height="50px"
        px={3}
        py={2}
        borderRadius="md"
        onClick={() => {
          setEditingClaim(null);
          setIsClaimModalOpen(true);
        }}
      >
        + Add Claim
      </Box>

      {claims.length === 0 ? (
        <Text>No claims found.</Text>
      ) : (
        claims.map((claim) => (
          <Box
            key={claim.claim_id}
            ref={(el) => (claimRefs.current[claim.claim_id] = el)}
            border="1px solid #90caf9"
            bg={hoveredClaimId === claim.claim_id ? "blue.200" : "black"}
            color={hoveredClaimId === claim.claim_id ? "black" : "#90caf9"}
            px={3}
            py={2}
            borderRadius="md"
            width="100%"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            cursor="pointer"
            onClick={() => {
              setSelectedClaim(claim);
              setIsClaimViewModalOpen(true);
            }}
          >
            <Tooltip label={claim.claim_text} hasArrow>
              <Text flex="1" noOfLines={1}>
                {claim.claim_text}
              </Text>
            </Tooltip>
            <HStack spacing={2}>
              <IconButton
                size="sm"
                aria-label="Edit"
                icon={<span>✏️</span>}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingClaim(claim);
                  setIsClaimModalOpen(true);
                }}
              />
              <IconButton
                size="sm"
                colorScheme="purple"
                aria-label="Verify"
                icon={<SearchIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  onVerifyClaim(claim);
                }}
              />
              <IconButton
                size="sm"
                colorScheme="red"
                aria-label="Delete"
                icon={<span>🗑️</span>}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClaim(claim.claim_id);
                }}
              />
            </HStack>
          </Box>
        ))
      )}

      <ClaimModal
        isOpen={isClaimModalOpen}
        onClose={() => {
          setIsClaimModalOpen(false);
          setEditingClaim(null);
        }}
        editingClaim={editingClaim}
        onSave={(claim: Claim) => {
          if (claim.claim_id) {
            onEditClaim(claim);
          } else {
            onAddClaim({ ...claim, content_id: taskId });
          }
          setEditingClaim(null);
        }}
      />
      <ClaimModal
        isOpen={isClaimViewModalOpen}
        onClose={() => setIsClaimViewModalOpen(false)}
        editingClaim={selectedClaim}
        readOnly
      />
    </VStack>
  );
};

export default TaskClaims;
