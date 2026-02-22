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
  fetchClaimsWithEvidence,
  fetchReferencesWithClaimsForTask,
  fetchAIEvidenceLinks,
  updateReference,
  deleteReferenceFromTask,
  addClaim,
  updateClaim,
  addClaimLink,
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
import RelevanceScanModal from "./modals/RelevanceScanModal";
import RelationshipMap, { ClaimLink } from "./RelationshipMap";
import { fetchClaimById } from "../services/useDashboardAPI"; // or wherever
import { fetchClaimsAndLinkedReferencesForTask } from "../services/useDashboardAPI";
import {
  updateScoresForContent,
  fetchContentScores,
} from "../services/useDashboardAPI";

import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
// imports at top:
import { useBreakpointValue } from "@chakra-ui/react";
import MobileWorkspaceShell from "./MobileWorkspaceShell";

interface WorkspaceProps {
  contentId: number;
  viewerId: number | null;
  onHeightChange?: (height: number) => void;
}
// Workspace Component v3.0 - Fixed Conditional Hooks
const Workspace: React.FC<WorkspaceProps> = ({
  contentId,
  viewerId,
  onHeightChange,
}) => {
  console.log("🟢 Workspace v3.0 loaded - Conditional hooks fixed");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimLinks, setClaimLinks] = useState<ClaimLink[]>([]);
  const [aiEvidenceLinks, setAIEvidenceLinks] = useState<import("../../../shared/entities/types").AIEvidenceLink[]>([]);
  const [refreshLinks, setRefreshLinks] = useState(false);
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftX, setLeftX] = useState(0);
  const [rightX, setRightX] = useState(0);
  const [computedHeight, setComputedHeight] = useState(500);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [selectedClaimLink, setSelectedClaimLink] = useState<ClaimLink | null>(
    null
  );
  const [linkRationale, setLinkRationale] = useState<string>("");
  const [aiSuggestedSupportLevel, setAiSuggestedSupportLevel] = useState<number | null>(null);
  const [isRelevanceScanModalOpen, setIsRelevanceScanModalOpen] = useState(false);
  const [scanningTaskClaim, setScanningTaskClaim] = useState<Claim | null>(null);

  // Hooks that use context - must be after all useState hooks, but BEFORE any early returns
  const isMobile = useBreakpointValue({ base: true, md: false });
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);
  const bgColor = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.15), rgba(148, 163, 184, 0.2))",
    "gray.800"
  );
  const borderColor = useColorModeValue("rgba(100, 116, 139, 0.25)", "gray.300");
  const user = useAuthStore((s) => s.user);

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

  useEffect(() => {
    fetchClaimsAndLinkedReferencesForTask(contentId, viewerId)
      .then((data) => {
        // Map the API results to the ClaimLink shape expected by the component.
        const formattedLinks: ClaimLink[] = data.map((row) => {
          // Normalize relationship values
          let normalizedRelation: "support" | "refute" | "nuance";
          const rel = String(row.relationship); // Cast to string for comparison

          if (rel === "supports" || rel === "support") {
            normalizedRelation = "support";
          } else if (rel === "refutes" || rel === "refute") {
            normalizedRelation = "refute";
          } else if (rel === "nuance") {
            normalizedRelation = "nuance";
          } else {
            console.warn(`⚠️ Unknown relationship: "${row.relationship}", defaulting to "nuance"`);
            normalizedRelation = "nuance";
          }

          return {
            id: row.id.toString(),
            claimId: row.left_claim_id, // from content_claims.target_claim_id
            referenceId: row.right_reference_id, // from claims_references.reference_content_id
            sourceClaimId: row.source_claim_id,
            relation: normalizedRelation,
            confidence: row.confidence || 0,
            notes: row.notes || "",
          };
        });
        console.log(`✅ Loaded ${formattedLinks.length} claim links for content ${contentId}`);
        setClaimLinks(formattedLinks);
      })
      .catch((error) => {
        console.error("Error fetching claim links:", error);
      });
  }, [contentId, refreshLinks, viewerId]);

  useEffect(() => {
    // Use new API that includes claim_type for snippet detection
    fetchClaimsWithEvidence(contentId, viewerId)
      .then(setClaims)
      .catch((error) => {
        console.error("Error fetching claims with evidence:", error);
        setClaims([]); // Set empty array on error to prevent undefined state
      });
  }, [contentId, viewerId]);

  useEffect(() => {
    // Fetch AI evidence links (reference_claim_links with support_level/stance)
    fetchAIEvidenceLinks(contentId)
      .then((links) => {
        console.log("✅ AI evidence links fetched:", links);
        setAIEvidenceLinks(links);
      })
      .catch((error) => {
        console.error("Error fetching AI evidence links:", error);
        setAIEvidenceLinks([]); // Set empty array on error
      });
  }, [contentId, refreshLinks]);

  useEffect(() => {
    fetchReferencesWithClaimsForTask(contentId)
      .then((data) => {
        console.log("✅ references fetched:", data);
        setReferences(data);
      })
      .catch((error) => {
        console.error("Error fetching references:", error);
        setReferences([]); // Set empty array on error
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

  const handleTaskClaimRelevanceScan = (claim: Claim) => {
    console.log("[Workspace] Opening relevance scan for task claim:", claim.claim_id);
    setScanningTaskClaim(claim);
    setIsRelevanceScanModalOpen(true);
  };

  const handleOpenLinkOverlayFromScan = (
    scanSourceClaim: { claim_id: number; claim_text: string },
    rationale: string,
    supportLevel: number
  ) => {
    // The scan's "source" claim is a reference claim; the target is the task claim being scanned
    setSourceClaim(scanSourceClaim);
    setTargetClaim(scanningTaskClaim);
    setLinkRationale(rationale);
    setAiSuggestedSupportLevel(supportLevel);
    setSelectedClaimLink(null);
    setReadOnly(false);
    setIsRelevanceScanModalOpen(false);
    setIsClaimLinkModalOpen(true);
  };

  const handleSelectReferenceClaim = async (claim: any, referenceId: number) => {
    // Close the relevance scan modal
    setIsRelevanceScanModalOpen(false);

    // Find the reference
    const reference = references.find(
      (r) => r.reference_content_id === referenceId
    );

    if (!reference) {
      console.warn("[Workspace] Reference not found:", referenceId);
      return;
    }

    // Open the reference claims modal focused on this claim
    setSelectedReference(reference);
    setIsReferenceClaimsModalOpen(true);
  };

  const handleLineClick = async (link: ClaimLink) => {
    // Count how many links connect to this reference
    const linksToReference = claimLinks.filter(
      (l) => l.referenceId === link.referenceId
    );

    // If 1-2 links, open claim relationship box(es)
    if (linksToReference.length <= 2) {
      try {
        // Check if this is an AI evidence link (from reference_claim_links)
        // AI links have id like "ai-123" and don't have actual source claim IDs
        const isAILink = link.id?.startsWith('ai-') ?? false;

        let source, target;

        if (isAILink) {
          // For AI links, find the original AI evidence link data
          const aiLink = aiEvidenceLinks.find(ai => `ai-${ai.link_id}` === link.id);

          // Fetch target claim (task claim)
          target = await fetchClaimById(link.claimId);

          // Use the evidence text (quote) as the source claim
          source = {
            claim_id: 0, // Dummy ID for AI evidence
            claim_text: aiLink?.quote || link.notes || "No evidence text available",
            claim_type: "ai_evidence"
          };

          // Set the AI rationale
          setLinkRationale(aiLink?.rationale || "");
        } else {
          // For user-created claim_links, fetch both claims by ID
          [source, target] = await Promise.all([
            fetchClaimById(link.sourceClaimId),
            fetchClaimById(link.claimId),
          ]);

          // Clear rationale for user-created links (use notes from link instead)
          setLinkRationale(link.notes || "");
        }

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
    } else {
      // 3+ links: open reference modal instead
      const reference = references.find(
        (ref) => ref.reference_content_id === link.referenceId
      );
      if (reference) {
        setSelectedReference(reference);
        setIsReferenceClaimsModalOpen(true);
      }
    }
  };

  const handleLineHover = (link: ClaimLink) => {
    // Find the reference for this link and open modal after 2s
    const reference = references.find(
      (ref) => ref.reference_content_id === link.referenceId
    );
    if (reference) {
      setSelectedReference(reference);
      setIsReferenceClaimsModalOpen(true);
    }
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
    setSelectedClaimLink(null);
    setReadOnly(false);
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
      bgGradient={bgColor}
      backdropFilter="blur(8px)"
      borderColor={borderColor}
      height={`${computedHeight}px`} // dynamic height computed above
      onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
    >
      <Heading size="md" mb={2} className="workspace-header">
        Claim Analysis
      </Heading>
      <Grid
        templateColumns="2fr 2fr 2fr" // mobile → stacked, desktop → middle flexes more
        gap={4}
        height="100%"
      >
        <Box ref={leftRef} minW="250px" maxW="400px" w="100%" className="workspace-claims">
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
            onTaskClaimClick={handleTaskClaimRelevanceScan}
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
            key={`${leftX}-${rightX}-${claims.length}-${references.length}-${aiEvidenceLinks.length}`}
            contentId={contentId}
            leftItems={claims}
            rightItems={references}
            rowHeight={rowHeight}
            topOffset={headerPadding} // 👈 This is your top offset
            height={computedHeight} // 👈 Total height of the surrounding Box
            leftX={leftX} // 👈 You can adjust this to match TaskClaims column
            rightX={rightX} // 👈 Adjust to align with ReferenceList column
            onLineClick={handleLineClick}
            onLineHover={handleLineHover}
            isModalOpen={isReferenceClaimsModalOpen}
            claimLinks={[
              ...claimLinks, // User-created claim links
              // Convert AI evidence links to ClaimLink format
              ...aiEvidenceLinks.map((ai) => ({
                id: `ai-${ai.link_id}`,
                claimId: ai.task_claim_id,
                referenceId: ai.reference_content_id,
                sourceClaimId: ai.task_claim_id, // For AI links, source = task claim
                relation: ai.stance === 'support' ? 'support' as const :
                         ai.stance === 'refute' ? 'refute' as const :
                         ai.stance === 'nuance' ? 'nuance' as const :
                         'support' as const, // fallback
                confidence: ai.support_level, // Use support_level for line thickness/opacity
                notes: ai.rationale || '',
              }))
            ]}
          />
        </Box>
        <Box ref={rightRef} maxW="400px" w="100%" className="workspace-references">
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
          claimLinks={claimLinks}
          taskClaims={claims}
          onClaimClick={async (claim: Claim) => {
            // Find the link for this claim
            const link = claimLinks.find(
              (l) => l.sourceClaimId === claim.claim_id &&
                     l.referenceId === selectedReference.reference_content_id
            );
            if (link) {
              const [source, target] = await Promise.all([
                fetchClaimById(link.sourceClaimId),
                fetchClaimById(link.claimId),
              ]);
              if (source && target) {
                setSourceClaim({
                  claim_id: source.claim_id,
                  claim_text: source.claim_text,
                });
                setTargetClaim(target);
                setIsClaimLinkModalOpen(true);
                setSelectedClaimLink(link);
                setReadOnly(true);
              }
            }
          }}
        />
      )}
      // ...
      <ClaimLinkOverlay
        isOpen={isClaimLinkModalOpen}
        onClose={() => {
          setIsClaimLinkModalOpen(false);
          setReadOnly(false);
          setLinkRationale("");
          setAiSuggestedSupportLevel(null);
        }}
        sourceClaim={sourceClaim}
        targetClaim={targetClaim}
        isReadOnly={readOnly}
        claimLink={selectedClaimLink}
        onLinkCreated={handleLinkCreated}
        rationale={linkRationale}
        aiSupportLevel={aiSuggestedSupportLevel}
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
      <RelevanceScanModal
        isOpen={isRelevanceScanModalOpen}
        onClose={() => {
          setIsRelevanceScanModalOpen(false);
          setScanningTaskClaim(null);
        }}
        taskClaim={scanningTaskClaim}
        references={references}
        onSelectReferenceClaim={handleSelectReferenceClaim}
        onOpenLinkOverlay={handleOpenLinkOverlayFromScan}
      />
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
