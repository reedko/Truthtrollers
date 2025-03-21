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
  // onDropReferenceClaim: (taskClaimId: number, refClaimId: number) => void;
  taskId: number;
}

const TaskClaims: React.FC<TaskClaimsProps> = ({
  claims,
  onAddClaim,
  onEditClaim,
  onDeleteClaim,
  //onDropReferenceClaim,
  taskId,
}) => {
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);

  return (
    <VStack
      align="start"
      spacing={2}
      borderRight="1px solid gray"
      pr={4}
      overflowY="auto"
      maxHeight="800px"
      width="100%"
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
          <HStack key={claim.claim_id} width="100%" spacing={2}>
            <Tooltip label={claim.claim_text} hasArrow>
              <Button
                variant={
                  selectedClaim?.claim_id === claim.claim_id
                    ? "solid"
                    : "outline"
                }
                colorScheme="blue"
                onClick={() => setSelectedClaim(claim)}
                width="100%"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {claim.claim_text}
              </Button>
            </Tooltip>

            {/* Edit Button */}
            <Button size="sm" onClick={() => onEditClaim(claim)}>
              ✏️
            </Button>

            {/* Delete Button */}
            <Button
              size="sm"
              colorScheme="red"
              onClick={() => onDeleteClaim(claim.claim_id)}
            >
              🗑️
            </Button>
          </HStack>
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
