import React, { useEffect, useState, useRef } from "react";
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
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ClaimEvaluationModal from "./modals/ClaimEvaluationModal";
import RelationshipMap, { ClaimLink } from "./RelationshipMap";
import { fetchClaimById } from "../services/useDashboardAPI"; // or wherever

interface WorkspaceProps {
  contentId: number;
  onHeightChange?: (height: number) => void;
}
const Workspace: React.FC<WorkspaceProps> = ({ contentId, onHeightChange }) => {
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
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const [leftX, setLeftX] = useState(0);
  const [rightX, setRightX] = useState(0);
  const [computedHeight, setComputedHeight] = useState(500);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [selectedClaimLink, setSelectedClaimLink] = useState<ClaimLink | null>(
    null
  );

  const updateXPositionsAndHeight = () => {
    if (leftRef.current && rightRef.current) {
      const leftBox = leftRef.current.getBoundingClientRect();
      const rightBox = rightRef.current.getBoundingClientRect();

      setLeftX(leftBox.left + leftBox.width);
      setRightX(rightBox.left);

      const fullHeight =
        Math.max(leftBox.height, rightBox.height) + headerPadding;
      setComputedHeight(fullHeight);
    }
  };
  useEffect(() => {
    fetchClaimsForTask(contentId).then(setClaims);
  }, [contentId]);

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
  const [hasRetriedClick, setHasRetriedClick] = useState(false);

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

  // Use a ref to measure the container's height

  // recalc when claims or references change
  //console.log("📏 leftX:", leftX, "rightX:", rightX);

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
      <Grid templateColumns="2fr 2fr 2fr" gap={4} height="100%">
        <Box ref={leftRef}>
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
        <Box>
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
          />
        </Box>
        <Box ref={rightRef}>
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
        </Box>
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
        onClose={() => {
          setIsClaimLinkModalOpen(false);
          setReadOnly(false);
        }}
        sourceClaim={sourceClaim}
        targetClaim={targetClaim}
        isReadOnly={readOnly}
        claimLink={selectedClaimLink}
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
    </Box>
  );
};

export default Workspace;
