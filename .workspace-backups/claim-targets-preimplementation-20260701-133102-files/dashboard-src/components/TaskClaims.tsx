// src/components/TaskClaims.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  VStack,
  Heading,
  Box,
  Text,
  HStack,
  IconButton,
  Tooltip,
  useColorModeValue,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Checkbox,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Portal,
} from "@chakra-ui/react";
import { ChevronDownIcon, DeleteIcon, EditIcon, SearchIcon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import ClaimModal from "./modals/ClaimModal";
import RelevanceScanModal from "./modals/RelevanceScanModal";
import EvidenceRerunModal from "./modals/EvidenceRerunModal";
import { ClaimLink } from "./RelationshipMap";

interface TaskClaimsProps {
  claims: Claim[];
  onAddClaim: (newClaim: Claim) => Promise<void>;
  onEditClaim: (updatedClaim: Claim) => Promise<void>;
  onDeleteClaim: (claimId: number) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onDropReferenceClaim: (
    sourceClaim: Pick<Claim, "claim_id" | "claim_text">,
    targetClaim: Claim,
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
  onTaskClaimClick?: (claim: Claim) => void;
  onOpenLinkOverlay?: (
    scanSourceClaim: { claim_id: number; claim_text: string },
    scanTargetClaim: Claim,
    rationale: string,
    supportLevel: number,
  ) => void;
  onFocusReference?: (referenceId: number) => void;
  linkSelection?: {
    active: boolean;
    source?: Pick<Claim, "claim_id" | "claim_text"> | null;
  };
  onPickTargetForLink?: (target: Claim) => void;
  claimLinks?: ClaimLink[];
  selectedReferenceId?: number;
  isReferenceModalOpen?: boolean;
  references?: ReferenceWithClaims[];
  contentId?: number;
  viewerId?: number | null;
  bubbleStyle?: boolean;
  isSuperAdmin?: boolean;
  onHardDeleteClaims?: (claimIds: number[]) => Promise<void>;
}

const CLAIM_BUBBLE_KEYFRAMES = {
  "@keyframes pulse-green": {
    "0%, 100%": {
      boxShadow: "0 0 30px rgba(56, 161, 105, 0.8), 0 0 60px rgba(56, 161, 105, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
      transform: "translateY(0px) scale(1)",
    },
    "50%": {
      boxShadow: "0 0 60px rgba(56, 161, 105, 1), 0 0 120px rgba(56, 161, 105, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
      transform: "translateY(-3px) scale(1.03)",
    },
  },
  "@keyframes pulse-red": {
    "0%, 100%": {
      boxShadow: "0 0 30px rgba(229, 62, 62, 0.8), 0 0 60px rgba(229, 62, 62, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
      transform: "translateY(0px) scale(1)",
    },
    "50%": {
      boxShadow: "0 0 60px rgba(229, 62, 62, 1), 0 0 120px rgba(229, 62, 62, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
      transform: "translateY(-3px) scale(1.03)",
    },
  },
  "@keyframes pulse-blue": {
    "0%, 100%": {
      boxShadow: "0 0 30px rgba(214, 158, 46, 0.8), 0 0 60px rgba(214, 158, 46, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
      transform: "translateY(0px) scale(1)",
    },
    "50%": {
      boxShadow: "0 0 60px rgba(214, 158, 46, 1), 0 0 120px rgba(214, 158, 46, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
      transform: "translateY(-3px) scale(1.03)",
    },
  },
} as const;

const claimBadgeSx = (color: string) => ({
  position: "relative",
  overflow: "hidden",
  background: `${color}26`,
  borderColor: `${color}99`,
  color,
  textShadow: `0 0 8px ${color}88`,
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.42), 0 0 8px ${color}33`,
  _before: {
    content: '""',
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "45%",
    background: "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))",
    pointerEvents: "none",
  },
  _after: {
    content: '""',
    position: "absolute",
    right: "-1px",
    top: "-1px",
    width: "8px",
    height: "8px",
    background: `linear-gradient(135deg, rgba(255,255,255,0.36), ${color}66 48%, rgba(0,0,0,0.5) 52%)`,
    clipPath: "polygon(100% 0, 100% 100%, 0 0)",
    pointerEvents: "none",
  },
});

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
  onTaskClaimClick,
  onOpenLinkOverlay,
  onFocusReference,
  taskId,
  linkSelection,
  onPickTargetForLink,
  claimLinks = [],
  references = [],
  contentId,
  viewerId,
  selectedReferenceId,
  isReferenceModalOpen = false,
  bubbleStyle = false,
  isSuperAdmin = false,
  onHardDeleteClaims,
}) => {
  const claimRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const claimRectCacheRef = useRef<Array<{ claim: Claim; rect: DOMRect }>>([]);
  const hoverRafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Keep a ref to onDropReferenceClaim so handleMouseUp never captures a stale version
  const onDropRef = useRef(onDropReferenceClaim);
  onDropRef.current = onDropReferenceClaim;

  // Super-admin batch selection state
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<number>>(new Set());

  const toggleClaimSelection = (claimId: number) => {
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  // Evidence confirmation dialog state
  const [showEvidencePrompt, setShowEvidencePrompt] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    claim: Claim;
    originalText: string;
  } | null>(null);

  // Evidence re-run modal state
  const [isEvidenceRerunModalOpen, setIsEvidenceRerunModalOpen] = useState(false);
  const [selectedClaimForEvidence, setSelectedClaimForEvidence] = useState<Claim | null>(null);

  // Color mode values
  const defaultBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.15), rgba(148, 163, 184, 0.2))",
    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
  );
  const defaultColor = useColorModeValue("gray.700", "#f1f5f9");
  const hoveredBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.3), rgba(148, 163, 184, 0.35))",
    "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.2))",
  );
  const hoveredColor = useColorModeValue("gray.800", "#ffffff");
  const borderColor = useColorModeValue(
    "rgba(100, 116, 139, 0.3)",
    "rgba(100, 116, 139, 0.5)",
  );

  // 🛠️ FIX: Move boxShadow useColorModeValue calls to top level (Rules of Hooks)
  const boxShadowHovered = useColorModeValue(
    "0 4px 12px rgba(71, 85, 105, 0.25)",
    "0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px rgba(59, 130, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );
  const boxShadowDefault = useColorModeValue(
    "0 2px 8px rgba(94, 234, 212, 0.2)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const boxShadowHover = useColorModeValue(
    "0 4px 12px rgba(94, 234, 212, 0.3)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );
  const addClaimButtonColor = useColorModeValue(
    "teal.600",
    "rgba(0, 162, 255, 1)",
  );
  const addClaimButtonBoxShadow = useColorModeValue(
    "0 2px 8px rgba(94, 234, 212, 0.2)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const addClaimButtonHoverBoxShadow = useColorModeValue(
    "0 4px 12px rgba(94, 234, 212, 0.3)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );

  const rolePriority = (claim: Claim) => {
    const role = String(claim.claim_role || claim.claim_type || "").toLowerCase();
    if (role === "thesis" || role === "task") return 0;
    if (role === "pillar") return 1;
    if (role === "pillar_support") return 2;
    if (role === "evidence" || role === "reference" || role === "snippet") return 3;
    if (role === "fallibility_critical") return 4;
    return 5;
  };

  const claimTree = useMemo(() => {
    const byId = new Map<number, Claim>();
    const children = new Map<number, Claim[]>();
    const roots: Claim[] = [];

    const pushChild = (parentId: number, child: Claim) => {
      const list = children.get(parentId) || [];
      list.push(child);
      children.set(parentId, list);
    };

    claims.forEach((claim) => {
      byId.set(claim.claim_id, claim);
    });

    const sortClaims = (a: Claim, b: Claim) =>
      rolePriority(a) - rolePriority(b) ||
      (a.claim_order ?? 999999) - (b.claim_order ?? 999999) ||
      (b.centrality_score ?? 0) - (a.centrality_score ?? 0) ||
      a.claim_id - b.claim_id;

    claims.forEach((claim) => {
      const parentId = claim.parent_claim_id ?? null;
      if (parentId != null && byId.has(parentId)) {
        pushChild(parentId, claim);
      } else {
        roots.push(claim);
      }
    });

    roots.sort(sortClaims);
    children.forEach((list) => list.sort(sortClaims));

    return { roots, children };
  }, [claims]);

  const getRoleLabel = (claim: Claim) => {
    const relationship = String(claim.relationship_type || "").toLowerCase();
    if (relationship.split(",").map((part) => part.trim()).includes("provenance")) return "PROVENANCE";
    const role = String(claim.claim_role || claim.claim_type || "background").toLowerCase();
    if (role === "task") return "THESIS";
    if (role === "thesis") return "THESIS";
    if (role === "pillar") return "PILLAR";
    if (role === "pillar_support") return "PILLAR SUPPORT";
    if (role === "fallibility_critical") return "CRITICAL";
    if (role === "evidence" || role === "reference" || role === "snippet") return "EVIDENCE";
    return "BACKGROUND";
  };

  const getRoleAccent = (claim: Claim) => {
    const relationship = String(claim.relationship_type || "").toLowerCase();
    if (relationship.split(",").map((part) => part.trim()).includes("provenance")) return "#F6AD55";
    const role = String(claim.claim_role || claim.claim_type || "background").toLowerCase();
    if (role === "thesis" || role === "task") return "#63B3ED";
    if (role === "pillar") return "#9F7AEA";
    if (role === "pillar_support") return "#D69E2E";
    if (role === "fallibility_critical") return "#E53E3E";
    if (role === "evidence" || role === "reference" || role === "snippet") return "#38A169";
    return "#A0AEC0";
  };

  const getRoleDescription = (claim: Claim) => {
    const role = getRoleLabel(claim);
    if (role === "PROVENANCE") return "Attribution wrapper: this can show who said or published a claim, but it does not directly add truth weight to the case score.";
    if (role === "THESIS") return "Main claim or top-level assertion for this case.";
    if (role === "PILLAR") return "Supporting claim that organizes evidence under the thesis.";
    if (role === "PILLAR SUPPORT") return "Intermediate claim that connects a pillar to evidence.";
    if (role === "CRITICAL") return "High-impact claim whose failure would weaken the argument.";
    if (role === "EVIDENCE") return "Evidence-level claim tied to a source or supporting detail.";
    return "Context or side detail that is not central to the argument.";
  };

  const getEmbeddedAssertion = (claim: Claim) => {
    const mappedObject = String(claim.object_claim_text || "").trim();
    if (mappedObject) return mappedObject;

    const relationship = String(claim.relationship_type || "").toLowerCase();
    if (!relationship.split(",").map((part) => part.trim()).includes("provenance")) return "";

    const text = String(claim.claim_text || "").trim().replace(/\s+/g, " ");
    const patterns = [
      /^(?:.+?)\s+(?:revealed|reveals|claimed|claims|alleged|alleges|said|says|stated|states|reported|reports|asserted|asserts|argued|argues|testified|testifies|wrote|writes|published|publishes)\s+that\s+(.+)$/i,
      /^(?:according to|per)\s+[^,]+,\s*(.+)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim().replace(/\.$/, "") + ".";
    }
    return "";
  };

  const getArgumentBadge = (claim: Claim) => {
    const fn = String(claim.argument_function || "").toLowerCase();
    if (fn === "opposing_claim_to_refute") return { label: "OPPOSING", color: "#F97316", tip: "The article presents this as a claim it is trying to refute; evidence impact is inverted." };
    if (fn === "supporting_premise") return { label: "PREMISE", color: "#2DD4BF", tip: "The article uses this claim to support its argument." };
    if (fn === "evidence") return { label: "EVIDENCE", color: "#38A169", tip: "The article uses this as evidence for its argument." };
    if (fn === "reported_neutral") return { label: "NEUTRAL", color: "#A0AEC0", tip: "The article reports this without clear direct scoring impact." };
    if (fn === "background") return { label: "BACKGROUND", color: "#A0AEC0", tip: "Contextual claim with limited direct scoring impact." };
    return null;
  };

  const getScoreTransformBadge = (claim: Claim) => {
    const transform = String(claim.score_transform || "").toLowerCase();
    if (transform === "invert") return { label: "INVERTS SCORE", color: "#F97316", tip: "Support for the evaluated assertion weakens the article; refutation strengthens it." };
    if (transform === "none") return { label: "NO SCORE", color: "#A0AEC0", tip: "This claim is visible for audit but does not directly affect the article score." };
    if (transform === "review") return { label: "REVIEW", color: "#ECC94B", tip: "Argument impact is unclear and should be reviewed before scoring." };
    if (transform === "normal") return { label: "NORMAL SCORE", color: "#38A169", tip: "Support/refutation affects the article in the normal direction." };
    return null;
  };

  const renderClaimNode = (claim: Claim, depth = 0): React.ReactNode => {
    const childClaims = claimTree.children.get(claim.claim_id) || [];
    const embeddedAssertion = getEmbeddedAssertion(claim);
    const argumentBadge = getArgumentBadge(claim);
    const scoreBadge = getScoreTransformBadge(claim);

    const existingLink =
      linkSelection?.active && linkSelection.source
        ? claimLinks.find(
            (link) =>
              link.claimId === claim.claim_id &&
              link.sourceClaimId === linkSelection.source?.claim_id,
          )
        : null;

    const isConnectedToSelectedReference =
      isReferenceModalOpen &&
      selectedReferenceId &&
      claimLinks.some(
        (link) =>
          link.claimId === claim.claim_id &&
          link.referenceId === selectedReferenceId,
      );

    const linkTone = (() => {
      if (isConnectedToSelectedReference || existingLink) {
        const relation =
          claimLinks.find(
            (l) =>
              l.claimId === claim.claim_id &&
              (selectedReferenceId ? l.referenceId === selectedReferenceId : true),
          )?.relation || existingLink?.relation;
        if (relation === "support") return "green";
        if (relation === "refute") return "red";
        return "yellow";
      }
      return "neutral";
    })();

    const roleAccent = getRoleAccent(claim);
    const bg = bubbleStyle
      ? "transparent"
      : hoveredClaimId === claim.claim_id
        ? hoveredBg
        : linkTone === "green"
          ? "linear-gradient(135deg, rgba(56, 161, 105, 0.24), rgba(56, 161, 105, 0.12))"
          : linkTone === "red"
            ? "linear-gradient(135deg, rgba(229, 62, 62, 0.24), rgba(229, 62, 62, 0.12))"
            : linkTone === "yellow"
              ? "linear-gradient(135deg, rgba(214, 158, 46, 0.24), rgba(214, 158, 46, 0.12))"
              : defaultBg;

    const border = linkTone === "green"
      ? "3px solid #38A169"
      : linkTone === "red"
        ? "3px solid #E53E3E"
        : linkTone === "yellow"
          ? "3px solid #D69E2E"
          : `1px solid ${borderColor}`;

    return (
      <Box key={claim.claim_id} width="100%">
        <Box
          ref={(el) => (claimRefs.current[claim.claim_id] = el)}
          data-claim-id={claim.claim_id}
          background={bg}
          color={hoveredClaimId === claim.claim_id ? hoveredColor : defaultColor}
          px={bubbleStyle ? 4 : 3}
          py={bubbleStyle ? 3 : 2}
          minH={bubbleStyle ? undefined : "54px"}
          borderRadius={bubbleStyle ? "30px" : "12px"}
          border={border}
          boxShadow={
            hoveredClaimId === claim.claim_id ? boxShadowHovered : boxShadowDefault
          }
          _hover={
            linkSelection?.active
              ? { bg: linkTone === "neutral" ? "rgba(128, 90, 213, 0.24)" : undefined, cursor: "pointer" }
              : {
                  boxShadow: boxShadowHover,
                  transform: bubbleStyle ? "scale(1.03)" : "translateY(-2px)",
                }
          }
          width="100%"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          cursor="pointer"
          position="relative"
          zIndex={2}
          overflow="visible"
          transition="all 0.35s ease"
          onClick={() => {
            if (linkSelection?.active) {
              onPickTargetForLink?.(claim);
              return;
            }
            setSelectedClaim(claim);
            setIsClaimViewModalOpen(true);
          }}
        >
          {!bubbleStyle && (
            <Box
              position="absolute"
              left={0}
              top={0}
              width="20px"
              height="100%"
              background={`linear-gradient(90deg, ${roleAccent}55 0%, transparent 100%)`}
              borderLeftRadius="12px"
              pointerEvents="none"
            />
          )}
          {isSuperAdmin && (
            <Box
              position="relative"
              zIndex={2}
              mr={2}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                isChecked={selectedClaimIds.has(claim.claim_id)}
                onChange={() => toggleClaimSelection(claim.claim_id)}
                colorScheme="red"
              />
            </Box>
          )}
          <VStack align="start" spacing={0.5} flex="1" minW={0} position="relative" zIndex={1}>
            <HStack spacing={1.5} flexWrap="nowrap" maxW="100%" overflow="hidden">
              <Tooltip label={getRoleDescription(claim)} hasArrow openDelay={900}>
                <Box
                  px={1.5}
                  py={0}
                  borderRadius="md"
                  border="1px solid"
                  borderColor={roleAccent}
                  color={roleAccent}
                  fontSize="9px"
                  lineHeight="16px"
                  textTransform="uppercase"
                  flexShrink={0}
                  sx={claimBadgeSx(roleAccent)}
                >
                  {getRoleLabel(claim)}
                </Box>
              </Tooltip>
              {claim.claim_depth != null && (
                <Tooltip label="Hierarchy level: L0 thesis, L1 pillar, L2 evidence, L3 background." hasArrow openDelay={900}>
                  <Box px={1.5} py={0} borderRadius="md" border="1px solid" fontSize="9px" lineHeight="16px" flexShrink={0} sx={claimBadgeSx("#94A3B8")}>
                    L{claim.claim_depth}
                  </Box>
                </Tooltip>
              )}
              {claim.centrality_score != null && (
                <Tooltip label="Centrality score: higher means this claim is more central to the case argument." hasArrow openDelay={900}>
                  <Box px={1.5} py={0} borderRadius="md" border="1px solid" fontSize="9px" lineHeight="16px" flexShrink={0} sx={claimBadgeSx("#00A2FF")}>
                    C{Math.round(Number(claim.centrality_score))}
                  </Box>
                </Tooltip>
              )}
              {claim.verifiability_score != null && (
                <Tooltip label="Verifiability score: higher means this claim should be easier or more valuable to verify with evidence." hasArrow openDelay={900}>
                  <Box px={1.5} py={0} borderRadius="md" border="1px solid" fontSize="9px" lineHeight="16px" flexShrink={0} sx={claimBadgeSx("#22C55E")}>
                    V{Math.round(Number(claim.verifiability_score))}
                  </Box>
                </Tooltip>
              )}
              {argumentBadge && (
                <Tooltip label={argumentBadge.tip} hasArrow openDelay={900}>
                  <Box px={1.5} py={0} borderRadius="md" border="1px solid" fontSize="9px" lineHeight="16px" flexShrink={0} sx={claimBadgeSx(argumentBadge.color)}>
                    {argumentBadge.label}
                  </Box>
                </Tooltip>
              )}
              {scoreBadge && (
                <Tooltip label={scoreBadge.tip} hasArrow openDelay={900}>
                  <Box px={1.5} py={0} borderRadius="md" border="1px solid" fontSize="9px" lineHeight="16px" flexShrink={0} sx={claimBadgeSx(scoreBadge.color)}>
                    {scoreBadge.label}
                  </Box>
                </Tooltip>
              )}
            </HStack>
            <Tooltip label={claim.claim_text} hasArrow isDisabled={!!draggingClaim}>
              <Text flex="1" noOfLines={1} fontSize="0.9rem" lineHeight="1.3" position="relative" zIndex={1}>
                {claim.claim_text}
              </Text>
            </Tooltip>
            {embeddedAssertion && (
              <Tooltip
                label="Evidence search and refute/support matching should evaluate this embedded assertion, while the wrapper only records attribution."
                hasArrow
                openDelay={700}
              >
                <Text
                  fontSize="10px"
                  lineHeight="1.2"
                  color="rgba(246,173,85,0.85)"
                  noOfLines={1}
                  maxW="100%"
                >
                  Evaluates: {embeddedAssertion}
                </Text>
              </Tooltip>
            )}
          </VStack>
          <Box position="relative" zIndex={3} alignSelf="center" ml={2} onClick={(e) => e.stopPropagation()}>
            <Menu placement="bottom-end">
              <MenuButton
                as={IconButton}
                size="sm"
                variant="ghost"
                aria-label="Claim actions"
                icon={<ChevronDownIcon />}
                minW="30px"
                h="30px"
              />
              <Portal>
                <MenuList minW="190px" fontSize="sm" zIndex={20000}>
                  <MenuItem
                    icon={<EditIcon />}
                    onClick={() => {
                      setEditingClaim(claim);
                      setIsClaimModalOpen(true);
                    }}
                  >
                    Edit
                  </MenuItem>
                  <MenuItem
                    icon={<SearchIcon />}
                    onClick={() => onVerifyClaim(claim)}
                  >
                    Evaluate claim
                  </MenuItem>
                  <MenuItem
                    icon={<span>🔬</span>}
                    onClick={() => {
                      setSelectedClaimForEvidence(claim);
                      setIsEvidenceRerunModalOpen(true);
                    }}
                  >
                    Re-run evidence
                  </MenuItem>
                  <MenuItem
                    icon={<DeleteIcon />}
                    color="red.300"
                    onClick={() => onDeleteClaim(claim.claim_id)}
                  >
                    Delete for user
                  </MenuItem>
                </MenuList>
              </Portal>
            </Menu>
          </Box>
        </Box>

        {childClaims.length > 0 && (
          <VStack align="stretch" spacing={2} mt={2} pl={2} w="100%" borderLeft="1px solid rgba(148, 163, 184, 0.25)">
            {childClaims.map((child) => renderClaimNode(child, depth + 1))}
          </VStack>
        )}
      </Box>
    );
  };

  useEffect(() => {
    if (!draggingClaim) {
      claimRectCacheRef.current = [];
      setHoveredClaimId(null);
      return;
    }

    claimRectCacheRef.current = claims
      .map((claim) => {
        const box = claimRefs.current[claim.claim_id];
        return box ? { claim, rect: box.getBoundingClientRect() } : null;
      })
      .filter(Boolean) as Array<{ claim: Claim; rect: DOMRect }>;

    const updateHoveredClaim = () => {
      hoverRafRef.current = null;
      const pointer = lastPointerRef.current;
      if (!pointer) return;

      for (const { claim, rect } of claimRectCacheRef.current) {
        if (
          pointer.x >= rect.left &&
          pointer.x <= rect.right &&
          pointer.y >= rect.top &&
          pointer.y <= rect.bottom
        ) {
          setHoveredClaimId(claim.claim_id);
          return;
        }
      }

      setHoveredClaimId(null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (hoverRafRef.current != null) return;
      hoverRafRef.current = window.requestAnimationFrame(updateHoveredClaim);
    };

    // Re-scan rects at release time — does NOT rely on stale hoveredClaimId state
    const handleMouseUp = (e: MouseEvent) => {
      if (!draggingClaim) return;

      for (const { claim, rect } of claimRectCacheRef.current) {
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          onDropRef.current(draggingClaim, claim);
          setHoveredClaimId(null);
          return;
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (hoverRafRef.current != null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [claims, draggingClaim]); // hoveredClaimId removed — mouseUp no longer depends on it

  return (
    <VStack
      align="start"
      spacing={2}
      borderRight={bubbleStyle ? "none" : "1px solid gray"}
      pr={4}
      alignSelf="flex-start"
      //overflowY="auto"
      //maxHeight="800px"
      width="100%"
      bg={bubbleStyle ? "transparent" : undefined}
    >
      <HStack width="100%" justify="space-between">
        <Heading size="sm">Claims</Heading>
        {isSuperAdmin && selectedClaimIds.size > 0 && (
          <Button
            size="xs"
            colorScheme="red"
            onClick={async () => {
              if (
                !window.confirm(
                  `Permanently delete ${selectedClaimIds.size} claim(s) for EVERYONE? This cannot be undone.`,
                )
              )
                return;
              await onHardDeleteClaims?.([...selectedClaimIds]);
              setSelectedClaimIds(new Set());
            }}
          >
            🗑 Delete {selectedClaimIds.size} for Everyone
          </Button>
        )}
      </HStack>

      {/* Link Mode Banner */}
      {linkSelection?.active && linkSelection.source && (
        <Box
          mb={2}
          p={3}
          background="linear-gradient(135deg, rgba(128, 90, 213, 0.3), rgba(128, 90, 213, 0.2))"
          border="2px solid rgba(128, 90, 213, 0.6)"
          borderRadius="12px"
          boxShadow="0 4px 16px rgba(128, 90, 213, 0.4)"
          width="100%"
        >
          <Text fontSize="sm" fontWeight="bold" color="#D6BCFA" mb={1}>
            🔗 Link Mode Active
          </Text>
          <Text fontSize="xs" color="whiteAlpha.900" noOfLines={2}>
            Linking from: "{linkSelection.source.claim_text}"
          </Text>
          <Text fontSize="xs" color="whiteAlpha.700" mt={2}>
            🟢 Green = Supports • 🔴 Red = Refutes • 🟡 Yellow = Nuance
          </Text>
        </Box>
      )}

      <Box
        as="button"
        background={defaultBg}
        border={`1px solid ${borderColor}`}
        color={addClaimButtonColor}
        height="50px"
        width="100%"
        px={3}
        py={2}
        borderRadius="12px"
        boxShadow={addClaimButtonBoxShadow}
        position="relative"
        overflow="hidden"
        transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
        _hover={{
          boxShadow: addClaimButtonHoverBoxShadow,
          transform: "translateY(-2px)",
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
        <Text position="relative" zIndex={1}>
          + Add Claim
        </Text>
      </Box>

      {claims.length === 0 ? (
        <Text>No claims found.</Text>
      ) : (
        claimTree.roots.map((claim) => renderClaimNode(claim))
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
            // Check if claim text changed
            const original = claims.find((c) => c.claim_id === claim.claim_id);
            if (original && original.claim_text !== claim.claim_text) {
              // Text changed - show evidence prompt
              setPendingEdit({
                claim,
                originalText: original.claim_text,
              });
              setShowEvidencePrompt(true);
              setIsClaimModalOpen(false);
            } else {
              // Just metadata changed - update directly
              onEditClaim(claim);
              setIsClaimModalOpen(false);
            }
          } else {
            onAddClaim({ ...claim, content_id: taskId });
            setIsClaimModalOpen(false);
          }
          setEditingClaim(null);
        }}
      />
      <RelevanceScanModal
        isOpen={isClaimViewModalOpen}
        onClose={() => {
          setIsClaimViewModalOpen(false);
          setSelectedClaim(null);
        }}
        taskClaim={selectedClaim}
        references={references}
        onOpenLinkOverlay={onOpenLinkOverlay}
        contentId={contentId}
        viewerId={viewerId}
        onFocusReference={onFocusReference}
      />

      {/* Evidence Confirmation Modal */}
      <Modal
        isOpen={showEvidencePrompt}
        onClose={() => {
          setShowEvidencePrompt(false);
          setPendingEdit(null);
        }}
        size="lg"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Run Evidence for Updated Claim?</ModalHeader>
          <ModalBody>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontWeight="semibold" mb={1}>
                  Original:
                </Text>
                <Text
                  p={3}
                  bg={useColorModeValue("red.50", "red.900")}
                  borderRadius="md"
                  color={useColorModeValue("red.700", "red.200")}
                >
                  {pendingEdit?.originalText}
                </Text>
              </Box>
              <Box>
                <Text fontWeight="semibold" mb={1}>
                  Updated:
                </Text>
                <Text
                  p={3}
                  bg={useColorModeValue("green.50", "green.900")}
                  borderRadius="md"
                  color={useColorModeValue("green.700", "green.200")}
                >
                  {pendingEdit?.claim.claim_text}
                </Text>
              </Box>
              <Text color={useColorModeValue("gray.600", "gray.400")}>
                Would you like to run the evidence engine to find sources for
                the updated claim? This may take 30-60 seconds.
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={() => {
                if (pendingEdit) {
                  // Pass runEvidence: true to parent handler
                  onEditClaim({
                    ...pendingEdit.claim,
                    runEvidence: true,
                  } as any);
                }
                setShowEvidencePrompt(false);
                setPendingEdit(null);
              }}
            >
              Yes, Run Evidence
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (pendingEdit) {
                  // Pass runEvidence: false to parent handler
                  onEditClaim({
                    ...pendingEdit.claim,
                    runEvidence: false,
                  } as any);
                }
                setShowEvidencePrompt(false);
                setPendingEdit(null);
              }}
            >
              No, Skip Evidence
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Evidence Re-run Modal */}
      {selectedClaimForEvidence && (
        <EvidenceRerunModal
          isOpen={isEvidenceRerunModalOpen}
          onClose={() => {
            setIsEvidenceRerunModalOpen(false);
            setSelectedClaimForEvidence(null);
          }}
          claim={selectedClaimForEvidence}
          contentId={contentId || taskId}
        />
      )}
    </VStack>
  );
};

export default TaskClaims;
