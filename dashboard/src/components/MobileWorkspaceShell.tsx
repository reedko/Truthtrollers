// src/components/MobileWorkspaceShell.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  Box,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
} from "@chakra-ui/react";
import {
  AddIcon as ZoomInIcon,
  MinusIcon as ZoomOutIcon,
  ExternalLinkIcon as FitIcon,
} from "@chakra-ui/icons";
import { FiMap } from "react-icons/fi";
import TaskClaims from "./TaskClaims";
import ReferenceList from "./ReferenceList";
import CytoscapeMolecule from "./CytoscapeMolecule";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ClaimLinkModal from "./modals/ClaimLinkModal";
import ClaimEvaluationModal from "./modals/ClaimEvaluationModal";
import {
  Claim,
  GraphNode,
  ReferenceWithClaims,
} from "../../../shared/entities/types";
import { ClaimLink } from "./RelationshipMap";
import {
  addClaim,
  updateClaim,
  deleteClaim,
  updateReference,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";

type BuildArgs = {
  contentId: number;
  claims: Claim[];
  references: ReferenceWithClaims[];
  claimLinks: ClaimLink[];
};

export interface CytoscapeMoleculeProps {
  nodes: {
    id: string;
    label: string;
    type: string;
    claim_id?: number;
    content_id?: number;
    url?: string;
  }[];
  links: {
    id: string;
    source: string;
    target: string;
    relation?: "related" | "refutes" | "supports";
    notes?: string;
    value?: number;
  }[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
}

function buildMolecule({
  contentId,
  claims,
  references,
  claimLinks,
}: BuildArgs) {
  const taskNodeId = `task-${contentId}`;
  const toEdgeRelation = (r: ClaimLink["relation"]): "supports" | "refutes" =>
    r === "refute" ? "refutes" : "supports";

  const nodes: CytoscapeMoleculeProps["nodes"] = [
    { id: taskNodeId, label: "Task", type: "task", content_id: contentId },
    ...references.map((r) => ({
      id: `conte-${r.reference_content_id}`,
      label: r.content_name ?? `Ref ${r.reference_content_id}`,
      type: "reference",
      content_id: r.reference_content_id,
    })),
    ...claims.map((c) => ({
      id: `tclaim-${c.claim_id}`,
      label: c.claim_text ?? `Claim ${c.claim_id}`,
      type: "taskClaim",
      content_id: contentId,
    })),
    ...claimLinks.map((l) => {
      const ref = references.find(
        (r) => r.reference_content_id === Number(l.referenceId)
      );
      const refClaim =
        ref?.claims?.find?.((c) => c.claim_id === Number(l.sourceClaimId)) ||
        ({
          claim_id: l.sourceClaimId,
          claim_text: `Claim ${l.sourceClaimId}`,
        } as any);
      return {
        id: `rclaim-${refClaim.claim_id}`,
        label: refClaim.claim_text,
        type: "refClaim",
        content_id: Number(l.referenceId),
      };
    }),
  ];

  const links: CytoscapeMoleculeProps["links"] = [
    ...references.map((r) => ({
      id: `edge-task-${contentId}-ref-${r.reference_content_id}`,
      source: taskNodeId,
      target: `conte-${r.reference_content_id}`,
      relation: "related" as const,
    })),
    ...claimLinks.map((l) => ({
      id: `edge-r${l.sourceClaimId}-t${l.claimId}`,
      source: `rclaim-${l.sourceClaimId}`,
      target: `tclaim-${l.claimId}`,
      relation: toEdgeRelation(l.relation),
      value: l.confidence ?? 0,
    })),
  ];

  const seen = new Set<string>();
  const dedupedNodes = nodes.filter((n) =>
    seen.has(n.id) ? false : (seen.add(n.id), true)
  );
  const nodeIds = new Set(dedupedNodes.map((n) => n.id));
  const safeLinks = links.filter(
    (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
  );

  return { nodes: dedupedNodes, links: safeLinks };
}

type Props = {
  contentId: number;
  claims: Claim[];
  references: ReferenceWithClaims[];
  claimLinks: ClaimLink[];
  showHeader?: boolean;
};

export default function MobileWorkspaceShell({
  contentId,
  claims: initialClaims,
  references: initialReferences,
  claimLinks,
  showHeader = false,
}: Props) {
  // Local state for claims and references that can be updated
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [references, setReferences] = useState<ReferenceWithClaims[]>(initialReferences);

  // Update local state when props change
  useEffect(() => {
    setClaims(initialClaims);
  }, [initialClaims]);

  useEffect(() => {
    setReferences(initialReferences);
  }, [initialReferences]);

  const { nodes, links } = useMemo(
    () => buildMolecule({ contentId, claims, references, claimLinks }),
    [contentId, claims, references, claimLinks]
  );

  // Tabs: 0=Claims, 1=Refs
  const [tabIndex, setTabIndex] = useState(0);

  // Map modal
  const { isOpen: isMapOpen, onOpen: onMapOpen, onClose: onMapClose } = useDisclosure();

  // Reference details modal
  const [refModalOpen, setRefModalOpen] = useState(false);
  const [refForModal, setRefForModal] = useState<ReferenceWithClaims | null>(
    null
  );

  // Link flow state
  const [linkSource, setLinkSource] = useState<Pick<
    Claim,
    "claim_id" | "claim_text"
  > | null>(null);
  const [linkTarget, setLinkTarget] = useState<Claim | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // Claim modal state
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [isClaimViewModalOpen, setIsClaimViewModalOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);

  // Verification modal state
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [verifyingClaim, setVerifyingClaim] = useState<Claim | null>(null);

  const handleNodeClick = (node: GraphNode) => {
    if (node?.type === "reference" && node.content_id != null) {
      const ref = references.find(
        (r) => Number(r.reference_content_id) === Number(node.content_id)
      );
      if (ref) {
        setRefForModal(ref);
        setRefModalOpen(true);
      }
    }
  };

  // From ReferenceClaimsModal: user taps "Link" next to a ref-claim
  const startLinkFromRefClaim = (
    claim: Pick<Claim, "claim_id" | "claim_text">
  ) => {
    // close ref modal, switch to Claims tab, enter link mode
    setRefModalOpen(false);
    setRefForModal(null);
    setLinkSource(claim);
    setTabIndex(0); // Claims tab (now index 0)
  };

  // In Claims tab: user taps a task claim as the target
  const chooseTarget = (target: Claim) => {
    setLinkTarget(target);
    setLinkModalOpen(true);
  };

  const resetLinkFlow = () => {
    setLinkModalOpen(false);
    setLinkSource(null);
    setLinkTarget(null);
  };

  // Claim handlers
  const handleAddClaim = async (newClaim: Claim) => {
    try {
      const saved = await addClaim({
        ...newClaim,
        content_id: contentId,
        relationship_type: "task",
      });
      setClaims([...claims, { ...newClaim, claim_id: saved.claimId }]);
    } catch (error) {
      console.error("Failed to add claim:", error);
    }
  };

  const handleEditClaim = async (updatedClaim: Claim) => {
    try {
      await updateClaim(updatedClaim);
      setClaims(
        claims.map((c) =>
          c.claim_id === updatedClaim.claim_id ? updatedClaim : c
        )
      );
    } catch (error) {
      console.error("Failed to update claim:", error);
    }
  };

  const handleDeleteClaim = async (claimId: number) => {
    try {
      await deleteClaim(claimId);
      setClaims(claims.filter((claim) => claim.claim_id !== claimId));
    } catch (error) {
      console.error("Failed to delete claim:", error);
    }
  };

  const handleVerifyClaim = (claim: Claim) => {
    setVerifyingClaim(claim);
    setIsVerificationModalOpen(true);
  };

  // Reference handlers
  const handleUpdateReference = async (referenceId: number, title: string) => {
    try {
      await updateReference(referenceId, title);
      setReferences(
        references.map((ref) =>
          ref.reference_content_id === referenceId
            ? { ...ref, content_name: title }
            : ref
        )
      );
    } catch (error) {
      console.error("Failed to update reference:", error);
    }
  };

  const handleDeleteReference = async (refId: number) => {
    try {
      await deleteReferenceFromTask(contentId, refId);
      setReferences(references.filter((ref) => ref.reference_content_id !== refId));
    } catch (error) {
      console.error("Failed to delete reference:", error);
    }
  };

  return (
    <Box w="100%" position="relative">
      {showHeader ? <Box /> : null}

      {/* Floating Map Button */}
      <IconButton
        aria-label="Open Molecule Map"
        icon={<FiMap size={24} />}
        position="fixed"
        bottom={4}
        right={4}
        zIndex={10}
        size="lg"
        colorScheme="purple"
        borderRadius="full"
        boxShadow="0 4px 12px rgba(139, 92, 246, 0.4)"
        onClick={onMapOpen}
        _hover={{
          transform: "scale(1.1)",
          boxShadow: "0 6px 16px rgba(139, 92, 246, 0.6)",
        }}
        transition="all 0.2s"
      />

      <Tabs
        isFitted
        variant="enclosed"
        index={tabIndex}
        onChange={setTabIndex}
      >
        <TabList position="sticky" top={0} zIndex={2} bg="gray.900">
          <Tab>Claims</Tab>
          <Tab>Refs</Tab>
        </TabList>

        <TabPanels>
          <TabPanel p={2}>
            <TaskClaims
              claims={claims}
              onAddClaim={handleAddClaim}
              onEditClaim={handleEditClaim}
              onDeleteClaim={handleDeleteClaim}
              draggingClaim={null}
              onDropReferenceClaim={() => {}}
              taskId={contentId}
              hoveredClaimId={null}
              setHoveredClaimId={() => {}}
              selectedClaim={selectedClaim}
              setSelectedClaim={setSelectedClaim}
              isClaimModalOpen={isClaimModalOpen}
              setIsClaimModalOpen={setIsClaimModalOpen}
              isClaimViewModalOpen={isClaimViewModalOpen}
              setIsClaimViewModalOpen={setIsClaimViewModalOpen}
              editingClaim={editingClaim}
              setEditingClaim={setEditingClaim}
              onVerifyClaim={handleVerifyClaim}
              linkSelection={{
                active: !!linkSource,
                source: linkSource || undefined,
              }}
              onPickTargetForLink={chooseTarget}
              claimLinks={claimLinks}
            />
          </TabPanel>

          <TabPanel p={2}>
            <ReferenceList
              references={references}
              onEditReference={handleUpdateReference}
              onDeleteReference={handleDeleteReference}
              taskId={contentId}
              onReferenceClick={(ref) => {
                setRefForModal(ref);
                setRefModalOpen(true);
              }}
              selectedReference={refForModal}
              onUpdateReferences={() => {}}
            />
          </TabPanel>
        </TabPanels>
      </Tabs>

      {/* Molecule Map Modal */}
      <Modal isOpen={isMapOpen} onClose={onMapClose} size="full">
        <ModalOverlay bg="rgba(0, 0, 0, 0.8)" />
        <ModalContent bg="transparent" boxShadow="none">
          <ModalHeader color="white">Molecule Map</ModalHeader>
          <ModalCloseButton color="white" />
          <ModalBody p={0}>
            <Box position="relative" w="100%" h="calc(100vh - 60px)">
              <CytoscapeMolecule
                nodes={nodes}
                links={links}
                onNodeClick={handleNodeClick}
              />
              <HStack position="absolute" bottom={3} right={3} spacing={2}>
                <IconButton
                  aria-label="Zoom In"
                  icon={<ZoomInIcon boxSize={4} />}
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("tt-zoom-in"))
                  }
                />
                <IconButton
                  aria-label="Zoom Out"
                  icon={<ZoomOutIcon boxSize={4} />}
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("tt-zoom-out"))
                  }
                />
                <IconButton
                  aria-label="Fit"
                  icon={<FitIcon boxSize={4} />}
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("tt-fit"))
                  }
                />
              </HStack>
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Reference details */}
      <ReferenceClaimsModal
        isOpen={refModalOpen}
        onClose={() => {
          setRefModalOpen(false);
          setRefForModal(null);
        }}
        reference={refForModal}
        setDraggingClaim={() => {}}
        draggingClaim={null}
        onVerifyClaim={() => {}}
        // NEW: begin link flow from a ref-claim
        // @ts-ignore prop we add in the modal
        onStartLink={startLinkFromRefClaim}
      />

      {/* Finalize link with your existing modal */}
      <ClaimLinkModal
        isOpen={linkModalOpen}
        onClose={resetLinkFlow}
        sourceClaim={
          linkSource
            ? {
                claim_id: linkSource.claim_id,
                claim_text: linkSource.claim_text,
              }
            : null
        }
        targetClaim={linkTarget}
        isReadOnly={false}
        claimLink={null}
        onLinkCreated={() => {
          resetLinkFlow();
          // Optionally: setTabIndex(0); // jump back to Map after linking
        }}
      />

      {/* Verification Modal */}
      {verifyingClaim && (
        <ClaimEvaluationModal
          isOpen={isVerificationModalOpen}
          onClose={() => setIsVerificationModalOpen(false)}
          claim={verifyingClaim}
          onSaveVerification={(verification) => {
            console.log("🧪 Verification saved:", verification);
            setIsVerificationModalOpen(false);
          }}
        />
      )}
    </Box>
  );
}
