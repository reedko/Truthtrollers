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
  linkSelection?: {
    active: boolean;
    source?: Pick<Claim, "claim_id" | "claim_text"> | null;
  };
  onPickTargetForLink?: (target: Claim) => void;
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
  linkSelection,
  onPickTargetForLink,
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
        background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
        backdropFilter="blur(20px)"
        border="1px solid rgba(0, 162, 255, 0.4)"
        color="rgba(0, 162, 255, 1)"
        height="50px"
        px={3}
        py={2}
        borderRadius="12px"
        boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        position="relative"
        overflow="hidden"
        transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
        _hover={{
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
          transform: "translateY(-2px)"
        }}
        onClick={() => {
          setEditingClaim(null);
          setIsClaimModalOpen(true);
        }}
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="20px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, transparent 100%)"
          pointerEvents="none"
        />
        <Text position="relative" zIndex={1}>+ Add Claim</Text>
      </Box>

      {claims.length === 0 ? (
        <Text>No claims found.</Text>
      ) : (
        claims.map((claim) => (
          <Box
            key={claim.claim_id}
            ref={(el) => (claimRefs.current[claim.claim_id] = el)}
            background={hoveredClaimId === claim.claim_id ? "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.2))" : "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"}
            backdropFilter="blur(20px)"
            color={hoveredClaimId === claim.claim_id ? "#ffffff" : "#f1f5f9"}
            px={3}
            py={2}
            borderRadius="12px"
            border={
              linkSelection?.active ? "2px dashed #38A169" : "1px solid rgba(167, 139, 250, 0.4)"
            }
            boxShadow={
              hoveredClaimId === claim.claim_id
                ? "0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px rgba(167, 139, 250, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)"
                : "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(167, 139, 250, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
            }
            _hover={
              linkSelection?.active
                ? { bg: "green.100", color: "black", cursor: "pointer" }
                : {
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(167, 139, 250, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                    transform: "translateY(-2px)"
                  }
            }
            width="100%"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            cursor="pointer"
            position="relative"
            overflow="hidden"
            transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
            onClick={() => {
              if (linkSelection?.active) {
                onPickTargetForLink?.(claim);
                return;
              }
              setSelectedClaim(claim);
              setIsClaimViewModalOpen(true);
            }}
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="20px"
              height="100%"
              background="linear-gradient(90deg, rgba(167, 139, 250, 0.4) 0%, transparent 100%)"
              pointerEvents="none"
            />
            <Tooltip
              label={claim.claim_text}
              hasArrow
              isDisabled={!!draggingClaim}
            >
              <Text flex="1" noOfLines={1} position="relative" zIndex={1}>
                {claim.claim_text}
              </Text>
            </Tooltip>
            <HStack spacing={2} position="relative" zIndex={1}>
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
