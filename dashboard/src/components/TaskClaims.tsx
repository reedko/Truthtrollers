import React, { useState } from "react";
import {
  VStack,
  Heading,
  Button,
  Text,
  HStack,
  Tooltip,
  Box,
} from "@chakra-ui/react";
import { Claim } from "../../../shared/entities/types";
import ClaimModal from "./ClaimModal";

interface TaskClaimsProps {
  claims: Claim[];
  onAddClaim: (claimText: string) => void;
  onEditClaim: (claim: Claim) => void;
  onDeleteClaim: (claimId: number) => void;
  onDropReferenceClaim: (taskClaimId: number, referenceClaimId: number) => void;
}

const TaskClaims: React.FC<TaskClaimsProps> = ({
  claims,
  onAddClaim,
  onEditClaim,
  onDeleteClaim,
  onDropReferenceClaim,
}) => {
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);

  return (
    <VStack
      align="start"
      spacing={2}
      borderRight="1px solid gray"
      pr={4}
      overflowY="auto"
      maxHeight="800px"
    >
      <Heading size="sm">Claims</Heading>

      {/* 🔥 Button to Open ClaimModal */}
      <Button colorScheme="blue" onClick={() => setIsClaimModalOpen(true)}>
        + Add Claim
      </Button>

      {claims.length === 0 ? (
        <Text>No claims found.</Text>
      ) : (
        claims.map((claim) => (
          <Box
            key={claim.claim_id ?? Math.random()} // ✅ Ensures no duplicate keys
            p={2}
            bg="white"
            border="1px solid gray"
            borderRadius="md"
            onDragOver={(e) => e.preventDefault()} // Allow drop
            onDrop={(e) => {
              const draggedClaimId = e.dataTransfer.getData("claimId");
              if (draggedClaimId && claim.claim_id) {
                onDropReferenceClaim(claim.claim_id, parseInt(draggedClaimId));
              }
            }}
          >
            <HStack>
              <Tooltip label={claim.claim_text} hasArrow>
                <Text>{claim.claim_text.slice(0, 50)}...</Text>
              </Tooltip>

              {/* Edit Claim Button */}
              <Button size="xs" onClick={() => onEditClaim(claim)}>
                ✏️ Edit
              </Button>

              {/* Delete Claim Button */}
              <Button
                size="xs"
                colorScheme="red"
                onClick={() => claim.claim_id && onDeleteClaim(claim.claim_id)}
              >
                🗑️ Delete
              </Button>
            </HStack>
          </Box>
        ))
      )}

      {/* 🔥 Claim Modal for Adding Claims */}
      <ClaimModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        onSave={(claimText) => {
          onAddClaim(claimText);
          setIsClaimModalOpen(false);
        }}
      />
    </VStack>
  );
};

export default TaskClaims;
