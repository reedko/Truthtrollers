import React, { useEffect, useState, useRef } from "react";
import ClaimLinkOverlay from "./overlays/ClaimLinkOverlay";

import {
  Box,
  Card,
  CardBody,
  Grid,
  Heading,
  useColorModeValue,
} from "@chakra-ui/react";
import {
  fetchClaimsForTask,
  fetchReferencesWithClaimsForTask,
  updateReference,
  deleteReferenceFromTask,
  addClaim,
  updateClaim,
} from "../services/useDashboardAPI";
import TaskClaims from "./TaskClaims";
import ReferenceList from "./ReferenceList";
import {
  Claim,
  ClaimReference,
  ReferenceWithClaims,
} from "../../../shared/entities/types";
import ClaimLinkModal from "./modals/ClaimLinkModal";
import DraggableReferenceClaimsModal from "./modals/DraggableReferenceClaimsModal";
import ClaimEvaluationModal from "./modals/ClaimEvaluationModal";
import RelationshipMap, { ClaimLink } from "./RelationshipMap";
import { fetchClaimById } from "../services/useDashboardAPI"; // or wherever
import { fetchClaimsAndLinkedReferencesForTask } from "../services/useDashboardAPI";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

import { useTaskStore } from "../store/useTaskStore";
// imports at top:
import { useBreakpointValue } from "@chakra-ui/react";
import MobileWorkspaceShell from "./MobileWorkspaceShell";

interface WorkspaceProps {
  contentId: number;
  viewerId: number | null;
  onHeightChange?: (height: number) => void;
}
const Workspace: React.FC<WorkspaceProps> = ({
  contentId,
  viewerId,
  onHeightChange,
}) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimLinks, setClaimLinks] = useState<ClaimLink[]>([]);
  const [refreshLinks, setRefreshLinks] = useState(false);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [refreshReferences, setRefreshReferences] = useState(false);
  const [sourceClaim, setSourceClaim] = useState<Pick<
    Claim,
    "claim_id" | "claim_text"
  > | null>(null);
  // inside Workspace component:
  const isMobile = useBreakpointValue({ base: true, md: false });
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
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftX, setLeftX] = useState(0);
  const [rightX, setRightX] = useState(0);
  const [computedHeight, setComputedHeight] = useState(500);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [selectedClaimLink, setSelectedClaimLink] = useState<ClaimLink | null>(
    null
  );

  const updateXPositionsAndHeight = () => {
    if (leftRef.current && rightRef.current && containerRef.current) {
      const leftBox = leftRef.current.getBoundingClientRect();
      const rightBox = rightRef.current.getBoundingClientRect();
      const containerBox = containerRef.current.getBoundingClientRect();

      // ✅ These are now RELATIVE to containerRef
      setLeftX(leftBox.left + leftBox.width - containerBox.left);
      setRightX(rightBox.left - containerBox.left);

      const fullHeight =
        Math.max(leftBox.height, rightBox.height) + headerPadding;
      setComputedHeight(fullHeight);
    }
  };
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);

  useEffect(() => {
    fetchClaimsAndLinkedReferencesForTask(contentId, viewerId)
      .then((data) => {
        // Map the API results to the ClaimLink shape expected by the component.
        const formattedLinks: ClaimLink[] = data.map((row) => ({
          id: row.id.toString(),
          claimId: row.left_claim_id, // from content_claims.target_claim_id
          referenceId: row.right_reference_id, // from claims_references.reference_content_id
          sourceClaimId: row.source_claim_id,
          relation:
            row.relationship === "supports"
              ? "support"
              : row.relationship === "refutes"
              ? "refute"
              : "support", // fallback for "related"
          confidence: row.confidence || 0,
          notes: row.notes || "",
        }));
        setClaimLinks(formattedLinks);
      })
      .catch((error) => {
        console.error("Error fetching claim links:", error);
      });
  }, [contentId, refreshLinks, viewerId]);

  useEffect(() => {
    fetchClaimsForTask(contentId, viewerId).then(setClaims);
  }, [contentId, viewerId]);

  useEffect(() => {
    fetchReferencesWithClaimsForTask(contentId).then((data) => {
      console.log("✅ references fetched:", data);
      setReferences(data);
    });
  }, [contentId, refreshReferences]);

  useEffect(() => {
    updateXPositionsAndHeight();
    window.addEventListener("resize", updateXPositionsAndHeight);
    return () =>
      window.removeEventListener("resize", updateXPositionsAndHeight);
  }, [claims, references]);

  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(computedHeight);
    }
  }, [claims, references, computedHeight, onHeightChange]);

  const handleLineClick = async (link: ClaimLink) => {
    try {
      const [source, target] = await Promise.all([
        fetchClaimById(link.sourceClaimId),
        fetchClaimById(link.claimId),
      ]);

      console.log(source, "SOURCE", target, "TARET");
      if (source && target) {
        setSourceClaim({
          claim_id: source.claim_id,
          claim_text: source.claim_text,
        });
        setTargetClaim(target);
        setIsClaimLinkModalOpen(true);
        setSelectedClaimLink(link);
      } else {
        console.warn("❌ Claim(s) not found:", { source, target, link });
      }
    } catch (err) {
      console.error("🔥 Error fetching claims by ID:", err);
    }
    setReadOnly(true);
  };

  const handleDeleteReference = async (
    contentId: number,
    refId: number
  ): Promise<void> => {
    await deleteReferenceFromTask(contentId, refId);

    setRefreshReferences((prev) => !prev);
  };

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

  // Define constants for layout:
  const rowHeight = 58; // height per list item
  const headerPadding = 80; // extra space for headings, margins, etc.
  // Compute the workspace height based on the longer list:
  const handleLinkCreated = async () => {
    const viewerId = useTaskStore.getState().viewingUserId;

    // ✅ Update scores
    await updateScoresForContent(contentId, viewerId);
    const scores = await fetchContentScores(contentId, viewerId);
    setVerimeterScore(contentId, scores?.verimeterScore ?? null);
    // 🔔 notify any listeners to refetch or re-read store
    window.dispatchEvent(
      new CustomEvent("verimeter:updated", { detail: { contentId } })
    );
    // ✅ Refresh links so new lines appear in RelationshipMap
    setRefreshLinks((prev) => !prev);
  };
  if (isMobile) {
    return (
      <MobileWorkspaceShell
        contentId={contentId}
        claims={claims}
        references={references}
        claimLinks={claimLinks}
      />
    );
  }
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={useColorModeValue("gray.50", "gray.800")}
      borderColor="gray.300"
      height={`${computedHeight}px`} // dynamic height computed above
      onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
    >
      <Heading size="md" mb={2}>
        Claim Analysis
      </Heading>
      <Grid
        templateColumns="2fr 2fr 2fr" // mobile → stacked, desktop → middle flexes more
        gap={4}
        height="100%"
      >
        <Box ref={leftRef} minW="250px" maxW="400px" w="100%">
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
        </Box>
        <Box ref={containerRef} minW="100px" w="100%">
          {/* Middle column reserved */}
          <RelationshipMap
            key={`${leftX}-${rightX}-${claims.length}-${references.length}`}
            contentId={contentId}
            leftItems={claims}
            rightItems={references}
            rowHeight={rowHeight}
            topOffset={headerPadding} // 👈 This is your top offset
            height={computedHeight} // 👈 Total height of the surrounding Box
            leftX={leftX} // 👈 You can adjust this to match TaskClaims column
            rightX={rightX} // 👈 Adjust to align with ReferenceList column
            onLineClick={handleLineClick}
            claimLinks={claimLinks}
          />
        </Box>
        <Box ref={rightRef} maxW="400px" w="100%">
          <ReferenceList
            references={references}
            onEditReference={handleUpdateReference}
            onDeleteReference={(refId) =>
              handleDeleteReference(contentId, refId)
            }
            taskId={contentId}
            onReferenceClick={(ref) => {
              setSelectedReference(ref);
              setIsReferenceClaimsModalOpen(true);
            }}
            selectedReference={selectedReference}
            onUpdateReferences={() => setRefreshReferences((prev) => !prev)}
          />
        </Box>
      </Grid>
      {selectedReference && (
        <DraggableReferenceClaimsModal
          isOpen={isReferenceClaimsModalOpen}
          onClose={() => setIsReferenceClaimsModalOpen(false)}
          reference={selectedReference}
          setDraggingClaim={setDraggingClaim}
          draggingClaim={draggingClaim}
          onVerifyClaim={handleVerifyClaim}
        />
      )}
      // ...
      <ClaimLinkOverlay
        isOpen={isClaimLinkModalOpen}
        onClose={() => {
          setIsClaimLinkModalOpen(false);
          setReadOnly(false);
        }}
        sourceClaim={sourceClaim}
        targetClaim={targetClaim}
        isReadOnly={readOnly}
        claimLink={selectedClaimLink}
        onLinkCreated={handleLinkCreated}
      />
      {verifyingClaim && (
        <ClaimEvaluationModal
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
      {draggingClaim && hoveredClaimId && (
        <Box
          position="fixed"
          top={mousePosition.y - 80} // 👈 push it above the cursor
          left={mousePosition.x + 20}
          bg="gray.700"
          color="white"
          px={4}
          py={2}
          borderRadius="md"
          boxShadow="lg"
          maxW="400px"
          zIndex={3000}
          fontSize="sm"
          pointerEvents="none"
        >
          {claims.find((c) => c.claim_id === hoveredClaimId)?.claim_text}
        </Box>
      )}
    </Box>
  );
};

export default Workspace;
