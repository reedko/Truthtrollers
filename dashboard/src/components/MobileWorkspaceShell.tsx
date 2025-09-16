// src/components/MobileWorkspaceShell.tsx
import React, { useMemo, useState } from "react";
import {
  Box,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  IconButton,
} from "@chakra-ui/react";
import {
  AddIcon as ZoomInIcon,
  MinusIcon as ZoomOutIcon,
  ExternalLinkIcon as FitIcon,
} from "@chakra-ui/icons";
import TaskClaims from "./TaskClaims";
import ReferenceList from "./ReferenceList";
import CytoscapeMolecule from "./CytoscapeMolecule";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ClaimLinkModal from "./modals/ClaimLinkModal";
import {
  Claim,
  GraphNode,
  ReferenceWithClaims,
} from "../../../shared/entities/types";
import { ClaimLink } from "./RelationshipMap";

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
  claims,
  references,
  claimLinks,
  showHeader = false,
}: Props) {
  const { nodes, links } = useMemo(
    () => buildMolecule({ contentId, claims, references, claimLinks }),
    [contentId, claims, references, claimLinks]
  );

  // Tabs: 0=Map, 1=Claims, 2=Refs
  const [tabIndex, setTabIndex] = useState(0);

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
    setTabIndex(1); // Claims tab
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

  return (
    <Box w="100%" h="100svh" display="flex" flexDir="column" overflow="hidden">
      {showHeader ? <Box /> : null}

      <Tabs
        isFitted
        variant="enclosed"
        flex="1"
        minH={0}
        display="flex"
        flexDir="column"
        index={tabIndex}
        onChange={setTabIndex}
      >
        <TabList position="sticky" top={0} zIndex={2} flexShrink={0}>
          <Tab>Map</Tab>
          <Tab>Claims</Tab>
          <Tab>Refs</Tab>
        </TabList>

        <TabPanels flex="1" minH={0}>
          <TabPanel p={0} h="100%">
            <Box position="relative" w="100%" h="100%">
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
          </TabPanel>

          <TabPanel p={0} h="100%" overflowY="auto">
            <TaskClaims
              claims={claims}
              onAddClaim={() => Promise.resolve()}
              onEditClaim={() => Promise.resolve()}
              onDeleteClaim={() => {}}
              draggingClaim={null}
              onDropReferenceClaim={() => {}}
              taskId={contentId}
              hoveredClaimId={null}
              setHoveredClaimId={() => {}}
              selectedClaim={null}
              setSelectedClaim={() => {}}
              isClaimModalOpen={false}
              setIsClaimModalOpen={() => {}}
              isClaimViewModalOpen={false}
              setIsClaimViewModalOpen={() => {}}
              editingClaim={null}
              setEditingClaim={() => {}}
              onVerifyClaim={() => {}}
              // NEW — link mode props:
              linkSelection={{
                active: !!linkSource,
                source: linkSource || undefined,
              }}
              onPickTargetForLink={chooseTarget}
            />
          </TabPanel>

          <TabPanel p={0} h="100%" overflowY="auto">
            <ReferenceList
              references={references}
              onEditReference={() => Promise.resolve()}
              onDeleteReference={() => {}}
              taskId={contentId}
              onReferenceClick={(ref) => {
                setRefForModal(ref);
                setRefModalOpen(true);
              }}
              selectedReference={null}
              onUpdateReferences={() => {}}
            />
          </TabPanel>
        </TabPanels>
      </Tabs>

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
    </Box>
  );
}
