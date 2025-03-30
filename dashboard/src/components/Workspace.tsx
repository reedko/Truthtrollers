import React, { useEffect, useState } from "react";
import { Box, Grid, Heading, useColorModeValue } from "@chakra-ui/react";
import {
  fetchClaimsForTask,
  fetchReferencesWithClaimsForTask,
  updateReference,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";
import TaskClaims from "./TaskClaims";
import ReferenceList from "./ReferenceList";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import { addClaim, updateClaim } from "../services/useDashboardAPI";
import ClaimLinkModal from "./modals/ClaimLinkModal";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ClaimVerificationModal from "./modals/ClaimVerificationModal";

const Workspace: React.FC<{ contentId: number }> = ({ contentId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [refreshReferences, setRefreshReferences] = useState(false);
  const [sourceClaim, setSourceClaim] = useState<Pick<
    Claim,
    "claim_id" | "claim_text"
  > | null>(null);
  const [targetClaim, setTargetClaim] = useState<Claim | null>(null);
  const [draggingClaim, setDraggingClaim] = useState<Pick<
    Claim,
    "claim_id" | "claim_text"
  > | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [hoveredClaimId, setHoveredClaimId] = useState<number | null>(null);
  const [selectedReference, setSelectedReference] =
    useState<ReferenceWithClaims | null>(null);
  const [isReferenceClaimsModalOpen, setIsReferenceClaimsModalOpen] =
    useState(false);
  const [isClaimLinkModalOpen, setIsClaimLinkModalOpen] = useState(false);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [isClaimViewModalOpen, setIsClaimViewModalOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [verifyingClaim, setVerifyingClaim] = useState<Claim | null>(null);

  useEffect(() => {
    fetchClaimsForTask(contentId).then(setClaims);
  }, [contentId]);

  useEffect(() => {
    fetchReferencesWithClaimsForTask(contentId).then(setReferences);
  }, [contentId, refreshReferences]);

  const handleUpdateReference = async (
    referenceId: number,
    title: string
  ): Promise<void> => {
    await updateReference(referenceId, title);
    setRefreshReferences((prev) => !prev);
  };

  const handleDropReferenceClaim = (
    sourceClaim: Pick<Claim, "claim_id" | "claim_text">,
    targetClaim: Claim
  ) => {
    setSourceClaim(sourceClaim);
    setTargetClaim(targetClaim);
    setIsClaimLinkModalOpen(true);
    setDraggingClaim(null);
  };

  const handleVerifyClaim = (claim: Claim) => {
    setVerifyingClaim(claim);
    setIsVerificationModalOpen(true);
  };

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={useColorModeValue("gray.50", "gray.800")}
      borderColor="gray.300"
      height="900px"
      onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
    >
      <Heading size="md" mb={2}>
        Claim Analysis
      </Heading>
      <Grid templateColumns="2fr 2fr 2fr" gap={4} height="100%">
        <TaskClaims
          claims={claims}
          onAddClaim={async (newClaim: Claim) => {
            const saved = await addClaim({
              ...newClaim,
              content_id: contentId,
              relationship_type: "task",
            });
            setClaims([...claims, { ...newClaim, claim_id: saved.claimId }]);
          }}
          onEditClaim={async (updatedClaim: Claim) => {
            const saved = await updateClaim(updatedClaim);
            setClaims(
              claims.map((c) =>
                c.claim_id === updatedClaim.claim_id ? updatedClaim : c
              )
            );
          }}
          onDeleteClaim={(claimId) =>
            setClaims(claims.filter((claim) => claim.claim_id !== claimId))
          }
          onVerifyClaim={(claim) => {
            setVerifyingClaim(claim);
            setIsVerificationModalOpen(true);
          }}
          draggingClaim={draggingClaim}
          onDropReferenceClaim={handleDropReferenceClaim}
          taskId={contentId}
          hoveredClaimId={hoveredClaimId}
          setHoveredClaimId={setHoveredClaimId}
          selectedClaim={selectedClaim}
          setSelectedClaim={setSelectedClaim}
          isClaimModalOpen={isClaimModalOpen}
          setIsClaimModalOpen={setIsClaimModalOpen}
          isClaimViewModalOpen={isClaimViewModalOpen}
          setIsClaimViewModalOpen={setIsClaimViewModalOpen}
          editingClaim={editingClaim}
          setEditingClaim={setEditingClaim}
        />

        <Box>{/* Middle column reserved */}</Box>

        <ReferenceList
          references={references}
          onEditReference={handleUpdateReference}
          onDeleteReference={(refId) =>
            deleteReferenceFromTask(contentId, refId)
          }
          taskId={contentId}
          onReferenceClick={(ref) => {
            setSelectedReference(ref);
            setIsReferenceClaimsModalOpen(true);
          }}
          selectedReference={selectedReference}
        />
      </Grid>

      {selectedReference && (
        <ReferenceClaimsModal
          isOpen={isReferenceClaimsModalOpen}
          onClose={() => setIsReferenceClaimsModalOpen(false)}
          reference={selectedReference}
          setDraggingClaim={setDraggingClaim}
          draggingClaim={draggingClaim}
          onVerifyClaim={handleVerifyClaim}
        />
      )}

      <ClaimLinkModal
        isOpen={isClaimLinkModalOpen}
        onClose={() => setIsClaimLinkModalOpen(false)}
        sourceClaim={sourceClaim}
        targetClaim={targetClaim}
      />
      {verifyingClaim && (
        <ClaimVerificationModal
          isOpen={isVerificationModalOpen}
          onClose={() => setIsVerificationModalOpen(false)}
          claim={verifyingClaim}
          onSaveVerification={(verification) => {
            console.log("🧪 Verification saved:", verification);
            // TODO: Save to database or update local state
            setIsVerificationModalOpen(false);
          }}
        />
      )}
    </Box>
  );
};

export default Workspace;
