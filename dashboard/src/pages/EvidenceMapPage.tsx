// dashboard/src/pages/EvidenceMapPage.tsx
// OSINT-style Evidence Map prototype.
// Current DB model: content -> extracted task claims -> extracted source claims -> sources.
// Future reasoning levels (thesis -> pillar -> evidence claims) are represented as UI framing,
// not as stored schema, until the scrape/extraction pipeline supports them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Spinner,
  Text,
  Tooltip,
  Icon,

  useToast,
  VStack,
} from "@chakra-ui/react";
import { FiCamera } from "react-icons/fi";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  Handle,
  getBezierPath,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
} from "reactflow";
import "reactflow/dist/style.css";

import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { useClaimLinkSession } from "../hooks/useClaimLinkSession";
import {
  ReferenceClaimTaskLink,
} from "../services/referenceClaimRelevance";
import {
  fetchContentScores,
  fetchClaimScoresForTask,
  fetchAIEvidenceLinks,
  fetchClaimsAndLinkedReferencesForTask,
} from "../services/useDashboardAPI";
import { api } from "../services/api";
import SourceCrest from "../components/SourceCrest";
import SourceDetailModal from "../components/modals/SourceDetailModal";
import { GraphNodeDetailSourceClaim } from "../components/graph/GraphNodeDetailModal";
import TruthGauge from "../components/ModernArcGauge";
import { VerimeterModeToggle } from "../components/VerimeterModeToggle";
import GraphControlBar, { GraphMetricPill } from "../components/GraphControlBar";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";
import { captureElementAsPng } from "../utils/domSnapshot";
import { AIEvidenceLink, Claim, ClaimLinks, ReferenceWithClaims } from "../../../shared/entities/types";

type EvidenceNodeKind = "content" | "taskClaim" | "evidenceClaim" | "source";
type Stance = "support" | "refute" | "nuance" | "insufficient";
type LinkProvenance = "user" | "ai";

const NODE_SIZE: Record<EvidenceNodeKind, { width: number; height: number }> = {
  content: { width: 48, height: 68 },
  taskClaim: { width: 104, height: 104 },
  evidenceClaim: { width: 96, height: 96 },
  source: { width: 86, height: 86 },
};

const STANCE: Record<Stance, { color: string; label: string; scheme: string }> = {
  support: { color: "#22c55e", label: "Supports", scheme: "green" },
  refute: { color: "#ef4444", label: "Refutes", scheme: "red" },
  nuance: { color: "#3b82f6", label: "Qualifies", scheme: "blue" },
  insufficient: { color: "#718096", label: "Insufficient", scheme: "gray" },
};

const MR_TONES: Record<string, { rgb: string; hex: string }> = {
  red: { rgb: "255, 108, 136", hex: "#ff6c88" },
  blue: { rgb: "120, 168, 255", hex: "#78a8ff" },
  green: { rgb: "97, 239, 184", hex: "#61efb8" },
  cyan: { rgb: "113, 219, 255", hex: "#71dbff" },
  purple: { rgb: "167, 139, 250", hex: "#a78bfa" },
  gray: { rgb: "138, 169, 191", hex: "#89a9bf" },
};

function mrBoxStyle(tone: string) {
  const c = MR_TONES[tone] || MR_TONES.cyan;
  return {
    bg: `linear-gradient(180deg, rgba(${c.rgb}, 0.18), rgba(${c.rgb}, 0.08))`,
    border: "1px solid",
    borderColor: `rgba(${c.rgb}, 0.3)`,
    boxShadow: `inset 0 3px 6px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05), 0 0 18px rgba(${c.rgb}, 0.12)`,
    color: c.hex,
  };
}

function CurvedEdge({ tone = "cyan", radius = "10px" }: { tone?: string; radius?: string }) {
  const c = MR_TONES[tone] || MR_TONES.cyan;
  return (
    <Box
      position="absolute"
      left={0}
      top={0}
      width="14px"
      height="100%"
      background={`linear-gradient(90deg, rgba(${c.rgb}, 0.4) 0%, transparent 100%)`}
      borderLeftRadius={radius}
      pointerEvents="none"
      zIndex={0}
    />
  );
}

function MRStatusBox({
  label,
  value,
  tone = "cyan",
  compact = false,
}: {
  label: string;
  value?: React.ReactNode;
  tone?: string;
  compact?: boolean;
}) {
  const c = MR_TONES[tone] || MR_TONES.cyan;
  return (
    <Box
      position="relative"
      overflow="hidden"
      borderRadius={compact ? "10px" : "14px"}
      px={compact ? 2.5 : 3}
      py={compact ? 1 : 2}
      minW={compact ? "auto" : "96px"}
      minH={compact ? "30px" : undefined}
      display={compact ? "flex" : "block"}
      alignItems={compact ? "center" : undefined}
      gap={compact ? 1.5 : undefined}
      {...mrBoxStyle(tone)}
    >
      <CurvedEdge tone={tone} radius={compact ? "10px" : "14px"} />
      <Text
        position="relative"
        zIndex={1}
        fontSize={compact ? "9px" : "9px"}
        textTransform="uppercase"
        letterSpacing={compact ? "0.04em" : "0.08em"}
        color="rgba(228, 244, 255, 0.78)"
        lineHeight="1.1"
        noOfLines={1}
        whiteSpace="nowrap"
      >
        {label}
      </Text>
      {value != null && (
        <Text
          position="relative"
          zIndex={1}
          fontSize={compact ? "12px" : "16px"}
          fontWeight="800"
          color={c.hex}
          lineHeight={compact ? "1" : "1.15"}
          mt={compact ? 0 : 0.5}
          noOfLines={1}
          whiteSpace="nowrap"
        >
          {value}
        </Text>
      )}
    </Box>
  );
}

function FocusDetailBox({
  label,
  children,
  tone = "cyan",
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
}) {
  const c = MR_TONES[tone] || MR_TONES.cyan;
  return (
    <Box
      position="relative"
      w="100%"
      border="1px solid"
      borderColor={`rgba(${c.rgb}, 0.24)`}
      bg={`linear-gradient(180deg, rgba(${c.rgb}, 0.10), rgba(3, 10, 24, 0.52))`}
      borderRadius="8px"
      boxShadow={`inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(0,0,0,0.22), 0 0 14px rgba(${c.rgb}, 0.08)`}
      overflow="hidden"
      px={3}
      py={2.5}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        bottom={0}
        w="14px"
        bg={`linear-gradient(90deg, rgba(${c.rgb}, 0.28), transparent)`}
        pointerEvents="none"
      />
      <Text
        position="relative"
        fontSize="9px"
        fontWeight="900"
        color={c.hex}
        textTransform="uppercase"
        letterSpacing="0.12em"
        mb={1.5}
      >
        {label}
      </Text>
      <Box position="relative" color="var(--mr-text-secondary)" fontSize="12px" lineHeight="1.5" whiteSpace="pre-wrap">
        {children}
      </Box>
    </Box>
  );
}

function getStance(s?: string): Stance {
  if (s === "support" || s === "supports") return "support";
  if (s === "refute" || s === "refutes") return "refute";
  if (s === "nuance" || s === "related") return "nuance";
  return "insufficient";
}

function getProvenance(link?: ReferenceClaimTaskLink): LinkProvenance {
  if (!link) return "ai";
  const createdByAi = (link as any).created_by_ai;
  if (createdByAi === true || createdByAi === 1 || createdByAi === "1" || createdByAi === "true") return "ai";
  if (createdByAi === false || createdByAi === 0 || createdByAi === "0" || createdByAi === "false") return "user";
  if (link.verified_by_user_id != null) return "user";
  if (link.source_table?.includes("claim_links")) return "user";
  if ((link as any).relationship && !link.source_table?.includes("reference_claim_task_links")) return "user";
  return "ai";
}

function formatStrength(confidence?: number | null) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "";
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function getClaimLinkRowId(link: ClaimLinks): number {
  return Number(link.id || link.claim_link_id || 0);
}

function normalizeRelationshipToStance(relationship?: string): Stance {
  if (relationship === "supports" || relationship === "support") return "support";
  if (relationship === "refutes" || relationship === "refute") return "refute";
  return "nuance";
}

function normalizeLinkConfidence(value?: number | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  const abs = Math.abs(n);
  return abs > 1 ? Math.min(1, abs / 100) : Math.min(1, abs);
}

function normalizeWorkspaceClaimLink(
  link: ClaimLinks,
  referencesById: Map<number, ReferenceWithClaims>,
): ReferenceClaimTaskLink {
  const reference = referencesById.get(link.right_reference_id);
  const sourceClaim = reference?.claims?.find((claim) => claim.claim_id === link.source_claim_id);
  const stance = normalizeRelationshipToStance(link.relationship);
  const supportLevel = Number(link.support_level ?? link.confidence ?? 0);
  const confidence = normalizeLinkConfidence(link.confidence ?? link.support_level);

  return {
    reference_claim_task_links_id: getClaimLinkRowId(link),
    reference_claim_id: link.source_claim_id,
    task_claim_id: link.left_claim_id,
    stance,
    score: Math.round(confidence * 100),
    confidence,
    support_level: supportLevel,
    rationale: link.notes,
    quote: undefined,
    created_by_ai: Boolean(link.created_by_ai),
    verified_by_user_id: undefined,
    created_at: "",
    source_table: "claim_links:workspace",
    reference_claim_text: sourceClaim?.claim_text,
    source_name: reference?.content_name || reference?.media_source || reference?.publisher_name,
    source_url: reference?.url,
    reference_content_id: link.right_reference_id,
    relation: stance,
    relationship: link.relationship,
    claim_text: sourceClaim?.claim_text,
  };
}

function buildWorkspaceClaimLinksByClaim(
  workspaceLinks: ClaimLinks[],
  references: ReferenceWithClaims[],
): Map<number, ReferenceClaimTaskLink[]> {
  const referencesById = new Map(references.map((reference) => [reference.reference_content_id, reference]));
  const byClaim = new Map<number, ReferenceClaimTaskLink[]>();

  workspaceLinks.forEach((workspaceLink) => {
    const taskClaimId = workspaceLink.left_claim_id;
    const claimLinks = byClaim.get(taskClaimId) || [];
    claimLinks.push(normalizeWorkspaceClaimLink(workspaceLink, referencesById));
    byClaim.set(taskClaimId, claimLinks);
  });

  return byClaim;
}

function scoreVerdict(score: number | null): { label: string; sub: string } {
  if (score === null || score === 0) {
    return { label: "Unknown", sub: "No evidence assessment available yet." };
  }
  if (score <= -0.5) return { label: "False", sub: "Evidence strongly suggests this is false." };
  if (score <= -0.15) return { label: "Likely False", sub: "Evidence nominally suggests this is false." };
  if (score < 0.15) return { label: "Nuanced", sub: "Evidence is inconclusive or mixed." };
  if (score < 0.5) return { label: "Likely True", sub: "Evidence nominally suggests this is true." };
  return { label: "True", sub: "Evidence strongly suggests this is true." };
}

interface EvidenceNodeData {
  kind: EvidenceNodeKind;
  title: string;
  label: string;
  sublabel?: string;
  detail?: string;
  caseClaim?: string;
  sourceClaim?: string;
  rationale?: string;
  stance?: Stance;
  provenance?: LinkProvenance;
  score?: number | null;
  confidence?: number | null;
  reference?: ReferenceWithClaims;
  sourceClaims?: GraphNodeDetailSourceClaim[];
  sourceCount?: number;
  focused?: boolean;
  focusNeighbor?: boolean;
  focusSecondHop?: boolean;
  depth?: number;
  dimmed?: boolean;
  exiting?: boolean;
  outOfFocus?: boolean;
  onReframe?: (id: string) => void;
  // content node: task publisher identity for SourceCrest
  taskAdmiraltyCode?: string;
  taskPublisherName?: string;
}

function NodeChrome({
  children,
  data,
}: {
  children: React.ReactNode;
  data: EvidenceNodeData;
}) {
  const stance = data.stance ? STANCE[data.stance] : null;
  const isUser = data.provenance === "user";
  const isFocus = data.focused;
  const color =
    data.kind === "content"
      ? "#00a2ff"
      : data.kind === "taskClaim"
        ? "#a78bfa"
        : stance?.color || "#00a2ff";

  return (
    <Box
      w="100%"
      h="100%"
      position="relative"
      opacity={data.exiting ? 0 : data.outOfFocus ? 0.34 : data.dimmed ? 0.66 : 1}
      bg={isFocus
        ? "linear-gradient(135deg, rgba(9,27,52,0.98), rgba(17,42,68,0.95))"
        : "linear-gradient(135deg, rgba(3,10,24,0.62), rgba(8,20,36,0.56))"}
      border={isUser ? `2px solid ${color}` : `1px ${data.provenance === "ai" ? "dashed" : "solid"} ${color}99`}
      borderRadius={
        data.kind === "content"
          ? "full"
          : data.kind === "taskClaim" || data.kind === "evidenceClaim"
            ? "full"
            : "10px"
      }
      boxShadow={`0 10px 28px rgba(0,0,0,0.45), 0 0 ${isFocus || isUser ? 24 : 10}px ${color}44, inset 0 1px 0 rgba(255,255,255,0.08)`}
      overflow="hidden"
      color="var(--mr-text-primary)"
      transform={data.exiting ? "scale(0.78)" : data.outOfFocus ? "scale(0.72)" : data.focusSecondHop ? "scale(0.9)" : "scale(1)"}
      transition="opacity 1000ms ease, transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 500ms ease"
      _before={{
        content: '""',
        position: "absolute",
        inset: 0,
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(0,162,255,0.055) 4px, rgba(0,162,255,0.055) 6px)",
        pointerEvents: "none",
      }}
      _after={{
        content: '""',
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: isFocus ? "24px" : "14px",
        background: `linear-gradient(90deg, ${color}55 0%, transparent 100%)`,
        pointerEvents: "none",
      }}
    >
      <Handle id={`${data.kind}-top-target`} type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-bottom-target`} type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-left-target`} type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-right-target`} type="target" position={Position.Right} style={{ opacity: 0 }} />
      <Box position="relative" zIndex={1} p={data.kind === "source" ? 2 : 2.5} h="100%">
        {children}
      </Box>
      <Handle id={`${data.kind}-top-source`} type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-bottom-source`} type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-left-source`} type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id={`${data.kind}-right-source`} type="source" position={Position.Right} style={{ opacity: 0 }} />
    </Box>
  );
}

function EvidenceFlowNode({ id, data }: { id: string; data: EvidenceNodeData }) {
  const stance = data.stance ? STANCE[data.stance] : null;
  const color = data.kind === "taskClaim" ? "#a78bfa" : stance?.color || "#00a2ff";
  const icon =
    data.kind === "content" ? "◎" :
    data.kind === "taskClaim" ? "◈" :
    data.kind === "evidenceClaim" ? "◌" :
    "▣";

  return (
    <NodeChrome data={data}>
      <VStack align="center" justify="center" spacing={1} h="100%" textAlign="center">
        {data.kind === "source" && data.reference ? (
          <SourceCrest
            {...normalizeSourceProfile({
              publisher_name: data.reference.publisher_name,
              is_primary_source: data.reference.is_primary_source,
              media_source: data.reference.media_source,
              veracity_score: data.reference.publisher_veracity ?? undefined,
              rating_label: data.reference.rating_label ?? undefined,
              rating_type: data.reference.rating_type ?? undefined,
              admiralty_code: data.reference.admiralty_code ?? undefined,
            })}
            size="xs"
          />
        ) : data.kind === "content" && data.taskAdmiraltyCode ? (
          <SourceCrest
            {...normalizeSourceProfile({
              publisher_name: data.taskPublisherName,
              admiralty_code: data.taskAdmiraltyCode,
            })}
            size="xs"
          />
        ) : (
          <Center
            w={data.kind === "source" ? "24px" : "30px"}
            h={data.kind === "source" ? "24px" : "30px"}
            borderRadius="full"
            border={`1px solid ${color}`}
            bg={`${color}22`}
            color={color}
            fontSize={data.kind === "source" ? "12px" : "15px"}
            fontWeight="800"
            boxShadow={`0 0 12px ${color}55`}
          >
            {icon}
          </Center>
        )}
        <Text
          fontSize={data.kind === "content" ? "16px" : data.kind === "source" ? "13px" : "15px"}
          fontWeight="900"
          lineHeight="1"
          color="var(--mr-text-primary)"
          letterSpacing="0.03em"
          noOfLines={1}
        >
          {data.label}
        </Text>
        {data.kind !== "content" && (
          <Text
            fontSize="8px"
            fontWeight="800"
            lineHeight="1"
            letterSpacing="0.1em"
            textTransform="uppercase"
            color={color}
            noOfLines={1}
            maxW="92%"
          >
            {data.title}
          </Text>
        )}
        {(typeof data.confidence === "number" || typeof data.sourceCount === "number") && (
          <Text fontSize="8px" color="var(--mr-text-muted)" lineHeight="1" noOfLines={1}>
            {typeof data.confidence === "number"
              ? `${Math.round(data.confidence * 100)}%`
              : `${data.sourceCount} links`}
          </Text>
        )}
      </VStack>
    </NodeChrome>
  );
}

const nodeTypes = { evidenceNode: EvidenceFlowNode };

function EvidenceFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps) {
  const { zoom } = useViewport();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.18,
  });
  const tone = (data as any)?.tone || "cyan";
  const c = MR_TONES[tone] || MR_TONES.cyan;
  const showLabel = Boolean(label) && zoom >= 0.92;

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          filter: `drop-shadow(0 0 5px rgba(${c.rgb}, 0.35))`,
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <Box
            position="absolute"
            transform={`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}
            px={2}
            py={0.5}
            borderRadius="8px"
            bg="rgba(3,10,24,0.88)"
            border={`1px solid rgba(${c.rgb}, 0.44)`}
            boxShadow={`0 0 12px rgba(${c.rgb}, 0.24), inset 0 1px 0 rgba(255,255,255,0.08)`}
            color={c.hex}
            fontSize="8px"
            fontWeight="900"
            letterSpacing="0.08em"
            textTransform="uppercase"
            pointerEvents="none"
            userSelect="none"
            whiteSpace="nowrap"
            zIndex={2}
          >
            {label}
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { evidenceEdge: EvidenceFlowEdge };

interface FlowBuildResult {
  nodes: Node<EvidenceNodeData>[];
  edges: Edge[];
  adjacency: Map<string, Set<string>>;
  counts: { user: number; ai: number; sources: number; evidenceClaims: number };
}

function makeEdge(id: string, source: string, target: string, opts?: { stance?: Stance; provenance?: LinkProvenance; label?: string }): Edge {
  const stance = opts?.stance ? STANCE[opts.stance] : null;
  const isUser = opts?.provenance === "user";
  const tone =
    opts?.stance === "support" ? "green" :
    opts?.stance === "refute" ? "red" :
    opts?.stance === "nuance" ? "blue" :
    opts?.provenance === "user" ? "cyan" :
    opts?.provenance === "ai" ? "purple" :
    "cyan";
  return {
    id,
    source,
    target,
    type: "evidenceEdge",
    animated: false,
    label: opts?.label,
    data: { tone, provenance: opts?.provenance, stance: opts?.stance },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stance?.color || "#00a2ff",
    },
    style: {
      stroke: stance?.color || "#00a2ff",
      strokeWidth: isUser ? 2.8 : 1.8,
      strokeDasharray: opts?.provenance === "ai" ? "8 6" : undefined,
      opacity: isUser ? 0.95 : 0.58,
    },
    interactionWidth: 18,
  };
}

function sideHandleId(kind: EvidenceNodeKind, side: "top" | "bottom" | "left" | "right", type: "source" | "target") {
  return `${kind}-${side}-${type}`;
}

function resolveEdgeAnchors(nodes: Node<EvidenceNodeData>[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return edge;

    const sourceWidth = sourceNode.width || NODE_SIZE[sourceNode.data.kind].width;
    const sourceHeight = sourceNode.height || NODE_SIZE[sourceNode.data.kind].height;
    const targetWidth = targetNode.width || NODE_SIZE[targetNode.data.kind].width;
    const targetHeight = targetNode.height || NODE_SIZE[targetNode.data.kind].height;

    const sourceCenterX = (sourceNode.position.x || 0) + sourceWidth / 2;
    const sourceCenterY = (sourceNode.position.y || 0) + sourceHeight / 2;
    const targetCenterX = (targetNode.position.x || 0) + targetWidth / 2;
    const targetCenterY = (targetNode.position.y || 0) + targetHeight / 2;
    const dx = targetCenterX - sourceCenterX;
    const dy = targetCenterY - sourceCenterY;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const sourceSide: "top" | "bottom" | "left" | "right" =
      absDx > absDy
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "bottom"
          : "top";
    const targetSide: "top" | "bottom" | "left" | "right" =
      absDx > absDy
        ? dx > 0
          ? "left"
          : "right"
        : dy > 0
          ? "top"
          : "bottom";

    return {
      ...edge,
      sourceHandle: sideHandleId(sourceNode.data.kind, sourceSide, "source"),
      targetHandle: sideHandleId(targetNode.data.kind, targetSide, "target"),
    };
  });
}

function getCloudDepths(nodes: Node<EvidenceNodeData>[], edges: Edge[], centerId: string) {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  ids.forEach((id) => adjacency.set(id, new Set()));
  edges.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: centerId, depth: 0 }];
  depths.set(centerId, 0);

  while (queue.length) {
    const item = queue.shift();
    if (!item) break;
    const neighbors = adjacency.get(item.id) || new Set<string>();
    neighbors.forEach((neighborId) => {
      if (depths.has(neighborId)) return;
      const nextDepth = item.depth + 1;
      depths.set(neighborId, nextDepth);
      queue.push({ id: neighborId, depth: nextDepth });
    });
  }

  nodes.forEach((node) => {
    if (!depths.has(node.id)) depths.set(node.id, 3);
  });

  return depths;
}

async function layoutNodes(nodes: Node<EvidenceNodeData>[], edges: Edge[], focusNodeId: string | null) {
  if (!nodes.length) return nodes;

  const activeNodes = nodes;
  const activeIds = new Set(activeNodes.map((node) => node.id));
  const activeEdges = edges.filter((edge) => activeIds.has(edge.source) && activeIds.has(edge.target));
  const contentNode = activeNodes.find((node) => node.data.kind === "content") || nodes.find((node) => node.data.kind === "content");
  const centerId = focusNodeId || contentNode?.id || nodes[0].id;
  const depths = getCloudDepths(activeNodes, activeEdges, centerId);

  const FULL_RADII: Record<number, number> = { 0: 0, 1: 250, 2: 430, 3: 585 };
  const FOCUS_RADII_X: Record<number, number> = { 0: 0, 1: 230, 2: 430, 3: 720 };
  const FOCUS_RADII_Y: Record<number, number> = { 0: 0, 1: 155, 2: 300, 3: 520 };

  const ringRadiusX = focusNodeId ? FOCUS_RADII_X : FULL_RADII;
  const ringRadiusY = focusNodeId ? FOCUS_RADII_Y : FULL_RADII;

  const kindOrder: Record<EvidenceNodeKind, number> = { content: 0, taskClaim: 1, evidenceClaim: 2, source: 3 };
  const sortNodes = (items: Node<EvidenceNodeData>[]) =>
    [...items].sort((a, b) => {
      const d = kindOrder[a.data.kind] - kindOrder[b.data.kind];
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

  const nodeById = new Map(activeNodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  activeNodes.forEach((node) => adjacency.set(node.id, new Set()));
  activeEdges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  // Blossom: traverse from focus node only toward nodes that are DEEPER from content.
  // This naturally scopes the blossom to only the focused node's subtree:
  //   taskClaim focused  → blossom = taskClaim + its evidenceClaims + their sources
  //   evidenceClaim focused → blossom = evidenceClaim + its source nodes only
  //   source focused → blossom = source only (no deeper nodes exist)
  // Everything shallower or at the same depth (content, other task claims, sibling evidence claims)
  // stays in the cluster, orbiting the case node.
  const contentDepths = focusNodeId && contentNode
    ? getCloudDepths(activeNodes, activeEdges, contentNode.id)
    : new Map<string, number>();
  const blossomSet = new Set<string>();
  if (focusNodeId) {
    const q = [focusNodeId];
    blossomSet.add(focusNodeId);
    while (q.length) {
      const id = q.shift()!;
      const d = contentDepths.get(id) ?? 0;
      for (const nb of adjacency.get(id) || []) {
        if (!blossomSet.has(nb) && (contentDepths.get(nb) ?? 0) > d) {
          blossomSet.add(nb);
          q.push(nb);
        }
      }
    }
  }

  // Compute a ring layout centered at cId using given radii and depths
  const computeLayout = (
    cId: string,
    nodeDepths: Map<string, number>,
    radX: Record<number, number>,
    radY: Record<number, number>,
  ): Map<string, { x: number; y: number; angle: number }> => {
    const pos = new Map<string, { x: number; y: number; angle: number }>();
    pos.set(cId, { x: 0, y: 0, angle: -Math.PI / 2 });
    const maxRing = Math.min(3, Math.max(...Array.from(nodeDepths.values()).map((d) => Math.min(d, 3))));
    for (let ring = 1; ring <= maxRing; ring++) {
      const ringNodes = sortNodes(activeNodes.filter((n) => Math.min(nodeDepths.get(n.id) ?? 3, 3) === ring));
      if (!ringNodes.length) continue;
      if (ring === 1) {
        ringNodes.forEach((node, i) => {
          const angle = -Math.PI / 2 + (i / ringNodes.length) * Math.PI * 2;
          pos.set(node.id, { x: Math.cos(angle) * radX[ring], y: Math.sin(angle) * radY[ring], angle });
        });
        continue;
      }
      const groups = new Map<string, Node<EvidenceNodeData>[]>();
      ringNodes.forEach((node) => {
        const d = Math.min(nodeDepths.get(node.id) ?? 3, 3);
        const parent = Array.from(adjacency.get(node.id) || [])
          .filter((id) => Math.min(nodeDepths.get(id) ?? 99, 3) === d - 1)
          .sort()[0] || cId;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent)!.push(node);
      });
      Array.from(groups.entries())
        .sort(([a], [b]) => (pos.get(a)?.angle ?? 0) - (pos.get(b)?.angle ?? 0))
        .forEach(([parentId, children]) => {
          const parentAngle = pos.get(parentId)?.angle ?? -Math.PI / 2;
          const sorted = sortNodes(children);
          const wedge = Math.min(1.15, Math.max(0.42, sorted.length * 0.28));
          sorted.forEach((node, i) => {
            const t = sorted.length === 1 ? 0 : i / (sorted.length - 1) - 0.5;
            const angle = parentAngle + t * wedge;
            const jitter = ((i % 3) - 1) * 18;
            const rX = radX[ring] + jitter + Math.max(0, ringNodes.length - 12) * 4;
            const rY = radY[ring] + jitter * 0.45 + Math.max(0, ringNodes.length - 12) * 2;
            pos.set(node.id, { x: Math.cos(angle) * rX, y: Math.sin(angle) * rY, angle });
          });
        });
    }
    return pos;
  };

  const positions = computeLayout(centerId, depths, ringRadiusX, ringRadiusY);

  // Cluster layout: centered at content node with ring 3 compressed so source nodes
  // sit very tight (almost overlapping) around their parent evidence claim nodes.
  const CLUSTER_OFFSET = { x: -680, y: 220 };
  const CLUSTER_SCALE = 0.62;
  const FOCUS_BLOSSOM_OFFSET = { x: 200, y: 0 };
  const CLUSTER_FULL_RADII: Record<number, number> = { 0: 0, 1: 250, 2: 430, 3: 500 };
  let fullMapPositions: Map<string, { x: number; y: number; angle: number }> | null = null;
  if (focusNodeId && contentNode) {
    const fullDepths = getCloudDepths(activeNodes, activeEdges, contentNode.id);
    fullMapPositions = computeLayout(contentNode.id, fullDepths, CLUSTER_FULL_RADII, CLUSTER_FULL_RADII);
  }

  return nodes.map((node) => {
    const depth = Math.min(depths.get(node.id) ?? 3, 3);
    const isContentNode = node.data.kind === "content";
    const inBlossom = !focusNodeId || blossomSet.has(node.id);
    let cloudPosition: { x: number; y: number };
    if (focusNodeId && !inBlossom && fullMapPositions?.has(node.id)) {
      // Cluster: content node at center, all cluster nodes (other task claims, evidence, sources) around it
      const fmp = fullMapPositions.get(node.id)!;
      cloudPosition = { x: fmp.x * CLUSTER_SCALE + CLUSTER_OFFSET.x, y: fmp.y * CLUSTER_SCALE + CLUSTER_OFFSET.y };
    } else if (focusNodeId && inBlossom) {
      // Focus blossom shifted right to balance cluster on left
      const p = positions.get(node.id) || { x: 0, y: 0 };
      cloudPosition = { x: p.x + FOCUS_BLOSSOM_OFFSET.x, y: p.y + FOCUS_BLOSSOM_OFFSET.y };
    } else {
      cloudPosition = positions.get(node.id) || { x: 0, y: 0 };
    }
    const width = node.width || NODE_SIZE[node.data.kind].width;
    const height = node.height || NODE_SIZE[node.data.kind].height;
    return {
      ...node,
      position: { x: cloudPosition.x - width / 2, y: cloudPosition.y - height / 2 },
      data: {
        ...node.data,
        depth,
        // Content node stays unimmed in cluster; blossom nodes always unimmed
        dimmed: Boolean(focusNodeId && !inBlossom && !isContentNode),
      },
    };
  });
}

function buildFlow({
  contentId,
  taskName,
  taskAdmiraltyCode,
  taskPublisherName,
  caseClaims,
  references,
  linksByClaim,
  aiEvidenceLinks,
  claimScores,
  overallScore,
  linkFilter,
  onReframe,
}: {
  contentId: number;
  taskName: string;
  taskAdmiraltyCode?: string;
  taskPublisherName?: string;
  caseClaims: Claim[];
  references: ReferenceWithClaims[];
  linksByClaim: Map<number, ReferenceClaimTaskLink[]>;
  aiEvidenceLinks: AIEvidenceLink[];
  claimScores: Record<number, number>;
  overallScore: number | null;
  linkFilter: "all" | "user" | "ai";
  onReframe: (id: string) => void;
}): FlowBuildResult {
  const refMap = new Map<number, ReferenceWithClaims>();
  references.forEach((ref) => refMap.set(ref.reference_content_id, ref));

  const nodes = new Map<string, Node<EvidenceNodeData>>();
  const edges = new Map<string, Edge>();
  const adjacency = new Map<string, Set<string>>();
  const evidenceClaimIds = new Set<number>();
  const sourceIds = new Set<number>();
  const sourceLabels = new Map<number, string>();
  let userCount = 0;
  let aiCount = 0;
  const aiEvidenceLinksByClaim = new Map<number, AIEvidenceLink[]>();
  aiEvidenceLinks.forEach((link) => {
    if (!aiEvidenceLinksByClaim.has(link.task_claim_id)) aiEvidenceLinksByClaim.set(link.task_claim_id, []);
    aiEvidenceLinksByClaim.get(link.task_claim_id)?.push(link);
  });

  const addAdj = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };

  const addNode = (node: Node<EvidenceNodeData>) => {
    nodes.set(node.id, node);
  };

  const contentNodeId = `content-${contentId}`;
  const verdict = scoreVerdict(overallScore);
  addNode({
    id: contentNodeId,
    type: "evidenceNode",
    position: { x: 0, y: 0 },
    width: NODE_SIZE.content.width,
    height: NODE_SIZE.content.height,
    data: {
      kind: "content",
      title: taskName,
      label: "CASE",
      sublabel: `${caseClaims.length} case claims mapped to available evidence`,
      detail: `${taskName}\n\n${verdict.sub}`,
      score: overallScore,
      sourceCount: caseClaims.length,
      onReframe,
      taskAdmiraltyCode,
      taskPublisherName,
    },
  });

  caseClaims.forEach((claim, index) => {
    const claimNodeId = `task-claim-${claim.claim_id}`;
    const claimLabel = `C${index + 1}`;
    const claimLinks = (linksByClaim.get(claim.claim_id) || []).filter((link) => {
      const provenance = getProvenance(link);
      if (linkFilter === "user") return provenance === "user";
      if (linkFilter === "ai") return provenance === "ai";
      return true;
    });
    const linkedSourceClaims: GraphNodeDetailSourceClaim[] = claimLinks.map((link, linkIndex) => {
      const reference = link.reference_content_id ? refMap.get(link.reference_content_id) : undefined;
      return {
        id: link.reference_claim_task_links_id || link.reference_claim_id || linkIndex,
        label: `S${index + 1}${String.fromCharCode(65 + linkIndex)}`,
        text: link.reference_claim_text || link.claim_text || "Source claim unavailable",
        relation: link.stance || link.relationship || link.relation,
        rationale: link.rationale || (link as any).notes || undefined,
        sourceName: reference?.content_name || link.source_name,
        sourceUrl: reference?.url || link.source_url,
        reference,
      };
    });
    addNode({
      id: claimNodeId,
      type: "evidenceNode",
      position: { x: 0, y: 0 },
      width: NODE_SIZE.taskClaim.width,
      height: NODE_SIZE.taskClaim.height,
      data: {
        kind: "taskClaim",
        title: "Origin Claim",
        label: claimLabel,
        sublabel: "Current extracted claim. Future model may promote selected claims to pillars.",
        detail: claim.claim_text,
        caseClaim: claim.claim_text,
        sourceClaims: linkedSourceClaims,
        score: claimScores[claim.claim_id] ?? null,
        sourceCount: claimLinks.length,
        onReframe,
      },
    });
    const rootEdgeId = `${contentNodeId}->${claimNodeId}`;
    edges.set(rootEdgeId, makeEdge(rootEdgeId, contentNodeId, claimNodeId, {
      label: "Claim",
    }));
    addAdj(contentNodeId, claimNodeId);

    claimLinks.forEach((link, linkIndex) => {
      const provenance = getProvenance(link);
      if (provenance === "user") userCount += 1;
      else aiCount += 1;

      const stance = getStance(link.stance);
      const linkRowId = Number(link.reference_claim_task_links_id || link.reference_claim_id || linkIndex);
      const evId = `evidence-claim-${linkRowId}`;
      const refId = link.reference_content_id;
      const sourceNodeId = refId ? `source-${refId}` : `source-unknown-${link.reference_claim_id}`;
      const reference = refId ? refMap.get(refId) : undefined;
      evidenceClaimIds.add(linkRowId);
      if (refId) {
        sourceIds.add(refId);
        if (!sourceLabels.has(refId)) sourceLabels.set(refId, `S${sourceLabels.size + 1}`);
      }
      const evidenceLabel = `E${index + 1}${String.fromCharCode(65 + linkIndex)}`;
      const sourceLabel = refId ? sourceLabels.get(refId) || "S?" : "S?";

      if (!nodes.has(evId)) {
        addNode({
          id: evId,
          type: "evidenceNode",
          position: { x: 0, y: 0 },
          width: NODE_SIZE.evidenceClaim.width,
          height: NODE_SIZE.evidenceClaim.height,
          data: {
            kind: "evidenceClaim",
            title: "Evidence Claim",
            label: evidenceLabel,
            sublabel: reference?.content_name || link.source_name || "Extracted from source",
            detail: reference?.content_name || link.source_name || "Extracted from source",
            caseClaim: claim.claim_text,
            sourceClaim: link.reference_claim_text || link.claim_text || "Evidence claim unavailable",
            rationale: link.rationale || (link as any).notes || undefined,
            stance,
            provenance,
            confidence: link.confidence,
            score: link.score != null ? link.score / 100 : null,
            reference,
            onReframe,
          },
        });
      }

      if (!nodes.has(sourceNodeId)) {
        addNode({
          id: sourceNodeId,
          type: "evidenceNode",
          position: { x: 0, y: 0 },
          width: NODE_SIZE.source.width,
          height: NODE_SIZE.source.height,
          data: {
            kind: "source",
            title: "Source",
            label: sourceLabel,
            sublabel: reference?.url || link.source_url || undefined,
            detail: reference?.content_name || link.source_name || "Unknown Source",
            reference,
            onReframe,
          },
        });
      }

      const claimToEvidence = `${claimNodeId}->${evId}-${link.reference_claim_task_links_id}`;
      const strength = formatStrength(link.confidence);
      edges.set(claimToEvidence, makeEdge(claimToEvidence, claimNodeId, evId, {
        stance,
        provenance,
        label: `${STANCE[stance].label}${strength ? ` ${strength}` : ""} ${provenance === "user" ? "User" : "AI"}`,
      }));
      addAdj(claimNodeId, evId);

      const evidenceToSource = `${evId}->${sourceNodeId}`;
      if (!edges.has(evidenceToSource)) {
        edges.set(evidenceToSource, makeEdge(evidenceToSource, evId, sourceNodeId, {
          stance,
          provenance,
          label: "Source",
        }));
        addAdj(evId, sourceNodeId);
      }
    });

    const filteredAiEvidenceLinks = linkFilter === "user"
      ? []
      : (aiEvidenceLinksByClaim.get(claim.claim_id) || []);
    filteredAiEvidenceLinks.forEach((link, aiIndex) => {
      aiCount += 1;
      const refId = link.reference_content_id;
      const sourceNodeId = `source-${refId}`;
      const reference = refMap.get(refId);
      sourceIds.add(refId);
      if (!sourceLabels.has(refId)) sourceLabels.set(refId, `S${sourceLabels.size + 1}`);
      const sourceLabel = sourceLabels.get(refId) || "S?";
      const stance = getStance(link.stance);
      const evId = `ai-evidence-${link.link_id}`;
      evidenceClaimIds.add(-Math.abs(Number(link.link_id || aiIndex + 1)));

      if (!nodes.has(evId)) {
        addNode({
          id: evId,
          type: "evidenceNode",
          position: { x: 0, y: 0 },
          width: NODE_SIZE.evidenceClaim.width,
          height: NODE_SIZE.evidenceClaim.height,
          data: {
            kind: "evidenceClaim",
            title: "AI Evidence",
            label: `AI${index + 1}${String.fromCharCode(65 + aiIndex)}`,
            sublabel: reference?.content_name || link.reference_title || "AI evidence from source",
            detail: reference?.content_name || link.reference_title || "AI evidence from source",
            caseClaim: claim.claim_text,
            sourceClaim: link.quote || link.rationale || "AI evidence unavailable",
            rationale: link.rationale || undefined,
            stance,
            provenance: "ai",
            confidence: link.confidence,
            score: link.score != null ? link.score / 100 : null,
            reference,
            onReframe,
          },
        });
      }

      if (!nodes.has(sourceNodeId)) {
        addNode({
          id: sourceNodeId,
          type: "evidenceNode",
          position: { x: 0, y: 0 },
          width: NODE_SIZE.source.width,
          height: NODE_SIZE.source.height,
          data: {
            kind: "source",
            title: "Source",
            label: sourceLabel,
            sublabel: reference?.url || link.reference_url || undefined,
            detail: reference?.content_name || link.reference_title || "Unknown Source",
            reference,
            provenance: "ai",
            onReframe,
          },
        });
      }

      const claimToEvidence = `${claimNodeId}->${evId}`;
      const strength = formatStrength(link.confidence);
      edges.set(claimToEvidence, makeEdge(claimToEvidence, claimNodeId, evId, {
        stance,
        provenance: "ai",
        label: `${STANCE[stance].label}${strength ? ` ${strength}` : ""} AI`,
      }));
      addAdj(claimNodeId, evId);

      const evidenceToSource = `${evId}->${sourceNodeId}`;
      edges.set(evidenceToSource, makeEdge(evidenceToSource, evId, sourceNodeId, {
        stance,
        provenance: "ai",
        label: "Source",
      }));
      addAdj(evId, sourceNodeId);
    });
  });

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    adjacency,
    counts: {
      user: userCount,
      ai: aiCount,
      sources: sourceIds.size,
      evidenceClaims: evidenceClaimIds.size,
    },
  };
}

function annotateFocusNeighborhood(
  nodes: Node<EvidenceNodeData>[],
  edges: Edge[],
  adjacency: Map<string, Set<string>>,
  focusNodeId: string | null,
) {
  if (!focusNodeId) {
    return {
      nodes: nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          focused: node.data.kind === "content",
          focusNeighbor: false,
          focusSecondHop: false,
          outOfFocus: false,
          dimmed: false,
        },
      })),
      edges: styleEdgesForFocus(edges, null, new Set(), new Set()),
    };
  }

  const direct = adjacency.get(focusNodeId) || new Set<string>();
  const secondHop = new Set<string>();
  direct.forEach((id) => {
    const second = adjacency.get(id) || new Set<string>();
    second.forEach((secondId) => {
      if (secondId !== focusNodeId && !direct.has(secondId)) secondHop.add(secondId);
    });
  });

  return {
    nodes: nodes.map((node) => {
      const focused = node.id === focusNodeId;
      const focusNeighbor = direct.has(node.id);
      const focusSecondHop = secondHop.has(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          focused,
          focusNeighbor,
          focusSecondHop,
          outOfFocus: !focused && !focusNeighbor && !focusSecondHop,
          dimmed: !focused && !focusNeighbor,
        },
      };
    }),
    edges: styleEdgesForFocus(edges, focusNodeId, direct, secondHop),
  };
}

function styleEdgesForFocus(
  edges: Edge[],
  focusNodeId: string | null,
  direct: Set<string>,
  secondHop: Set<string>,
) {
  if (!focusNodeId) {
    return edges.map((edge) => ({
      ...edge,
      style: {
        ...(edge.style || {}),
        opacity: (edge.style as any)?.opacity ?? 0.7,
      },
    }));
  }

  const inFirstHop = (id: string) => id === focusNodeId || direct.has(id);
  const inSecondHop = (id: string) => inFirstHop(id) || secondHop.has(id);

  return edges.map((edge) => {
    const touchesFocus = edge.source === focusNodeId || edge.target === focusNodeId;
    const firstHopEdge = inFirstHop(edge.source) && inFirstHop(edge.target);
    const secondHopEdge = inSecondHop(edge.source) && inSecondHop(edge.target);
    const baseWidth = Number((edge.style as any)?.strokeWidth ?? 1.8);
    const opacity = touchesFocus ? 1 : firstHopEdge ? 0.76 : secondHopEdge ? 0.48 : 0.16;
    const strokeWidth = touchesFocus ? Math.max(baseWidth + 1.2, 3.2) : firstHopEdge ? Math.max(baseWidth, 2.2) : secondHopEdge ? baseWidth : Math.max(baseWidth * 0.7, 1.1);

    return {
      ...edge,
      animated: touchesFocus ? edge.animated : false,
      style: {
        ...(edge.style || {}),
        opacity,
        strokeWidth,
        transition: "opacity 260ms ease, stroke-width 260ms ease",
      },
    };
  });
}

function withNodeTransition(node: Node<EvidenceNodeData>, opacity = 1): Node<EvidenceNodeData> {
  return {
    ...node,
    style: {
      ...(node.style || {}),
      opacity,
      transition:
        "transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 1000ms ease",
    },
  };
}

function collapsePositionFor(
  node: Node<EvidenceNodeData>,
  focus: { x: number; y: number },
) {
  const width = node.width || NODE_SIZE[node.data.kind].width;
  const height = node.height || NODE_SIZE[node.data.kind].height;
  return {
    x: focus.x - width / 2,
    y: focus.y - height / 2,
  };
}

function EvidenceMapFlow({
  contentId,
  taskName,
  taskAdmiraltyCode,
  taskPublisherName,
  caseClaims,
  references,
  viewerId,
  viewScope,
  claimScores,
  overallScore,
  linkFilter,
  onCountsChange,
  onRefreshReferences,
}: {
  contentId: number;
  taskName: string;
  taskAdmiraltyCode?: string;
  taskPublisherName?: string;
  caseClaims: Claim[];
  references: ReferenceWithClaims[];
  viewerId: number | null;
  viewScope: "user" | "all" | "admin";
  claimScores: Record<number, number>;
  overallScore: number | null;
  linkFilter: "all" | "user" | "ai";
  onCountsChange: (counts: FlowBuildResult["counts"]) => void;
  onRefreshReferences?: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EvidenceNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [linksByClaim, setLinksByClaim] = useState<Map<number, ReferenceClaimTaskLink[]>>(new Map());
  const [aiEvidenceLinks, setAiEvidenceLinks] = useState<AIEvidenceLink[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<EvidenceNodeData | null>(null);
  const [isLayouting, setIsLayouting] = useState(false);
  const [sourceDetailRef, setSourceDetailRef] = useState<ReferenceWithClaims | null>(null);
  const { fitView, setCenter, getViewport, setViewport, screenToFlowPosition } = useReactFlow();
  const wheelZoomRafRef = useRef<number | null>(null);
  const pendingViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

  useEffect(() => {
    return () => {
      if (wheelZoomRafRef.current !== null) {
        window.cancelAnimationFrame(wheelZoomRafRef.current);
        wheelZoomRafRef.current = null;
      }
      pendingViewportRef.current = null;
    };
  }, []);
  const currentNodesRef = useRef<Node<EvidenceNodeData>[]>([]);
  const transitionTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    if (!caseClaims.length || !contentId) {
      setLinksByClaim(new Map());
      setAiEvidenceLinks([]);
      return;
    }

    Promise.all([
      fetchClaimsAndLinkedReferencesForTask(contentId, viewerId, viewScope),
      fetchAIEvidenceLinks(contentId),
    ])
      .then(([workspaceClaimLinks, aiEvidenceRows]) => {
        if (!active) return;
        setLinksByClaim(buildWorkspaceClaimLinksByClaim(workspaceClaimLinks, references));
        setAiEvidenceLinks(aiEvidenceRows);
      })
      .catch((err) => {
        console.error("[EvidenceMap] Failed to fetch claim links:", err);
        if (active) setLinksByClaim(new Map());
        if (active) setAiEvidenceLinks([]);
      });

    return () => {
      active = false;
    };
  }, [caseClaims, contentId, references, viewerId, viewScope]);

  const flow = useMemo(
    () =>
      buildFlow({
        contentId,
        taskName,
        taskAdmiraltyCode,
        taskPublisherName,
        caseClaims,
        references,
        linksByClaim,
        aiEvidenceLinks,
        claimScores,
        overallScore,
        linkFilter,
        onReframe: setFocusNodeId,
      }),
    [contentId, taskName, taskAdmiraltyCode, taskPublisherName, caseClaims, references, linksByClaim, aiEvidenceLinks, claimScores, overallScore, linkFilter],
  );

  useEffect(() => {
    onCountsChange(flow.counts);
  }, [flow.counts.ai, flow.counts.user, flow.counts.sources, flow.counts.evidenceClaims, onCountsChange]);

  useEffect(() => {
    setFocusNodeId(null);
    setSelectedNodeData(null);
  }, [linkFilter]);

  useEffect(() => {
    let active = true;
    const focusedGraph = annotateFocusNeighborhood(flow.nodes, flow.edges, flow.adjacency, focusNodeId);
    setIsLayouting(true);
    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    layoutNodes(focusedGraph.nodes, focusedGraph.edges, focusNodeId)
      .then((layouted) => {
        if (!active) return;
        const anchoredEdges = resolveEdgeAnchors(layouted, focusedGraph.edges);
        const finalNodes = layouted.map((node) => withNodeTransition({
          ...node,
          data: {
            ...node.data,
            exiting: false,
          },
        }));
        const finalIds = new Set(finalNodes.map((node) => node.id));
        const previousNodes = currentNodesRef.current;
        const previousById = new Map(previousNodes.map((node) => [node.id, node]));
        const focusNode = finalNodes.find((node) => node.id === focusNodeId) || finalNodes.find((node) => node.data.kind === "content") || finalNodes[0];
        const focus = focusNode
          ? {
              x: focusNode.position.x + (focusNode.width || NODE_SIZE[focusNode.data.kind].width) / 2,
              y: focusNode.position.y + (focusNode.height || NODE_SIZE[focusNode.data.kind].height) / 2,
            }
          : { x: 0, y: 0 };

        const enteringIds = new Set(finalNodes.filter((node) => !previousById.has(node.id)).map((node) => node.id));
        const stagedFinal = finalNodes.map((node) => {
          if (!enteringIds.has(node.id)) return previousById.get(node.id) || node;
          return withNodeTransition({
            ...node,
            position: collapsePositionFor(node, focus),
            data: { ...node.data, exiting: true },
          }, 0);
        });
        const exitingNodes = previousNodes
          .filter((node) => !finalIds.has(node.id))
          .map((node) => withNodeTransition({
            ...node,
            position: collapsePositionFor(node, focus),
            selectable: false,
            draggable: false,
            data: {
              ...node.data,
              exiting: true,
              dimmed: true,
            },
          }, 0));

        const stagedNodes = [...stagedFinal, ...exitingNodes];
        currentNodesRef.current = stagedNodes;
        setNodes(stagedNodes);
        setEdges(anchoredEdges);
        window.requestAnimationFrame(() => {
          const animatedNodes = [...finalNodes, ...exitingNodes];
          currentNodesRef.current = animatedNodes;
          setNodes(animatedNodes);
          if (focusNodeId && focusNode) {
            setCenter(focus.x + 60, focus.y, {
              zoom: 0.88,
              duration: 1000,
            });
          } else {
            // Reset: center on case node so it anchors the view
            const contentLayoutNode = finalNodes.find((n) => n.data.kind === "content");
            if (contentLayoutNode) {
              const cx = contentLayoutNode.position.x + (contentLayoutNode.width || NODE_SIZE.content.width) / 2;
              const cy = contentLayoutNode.position.y + (contentLayoutNode.height || NODE_SIZE.content.height) / 2;
              setCenter(cx, cy, { zoom: 0.85, duration: 1000 });
            } else {
              fitView({ padding: 0.18, duration: 1000 });
            }
          }
          transitionTimeoutRef.current = window.setTimeout(() => {
            currentNodesRef.current = finalNodes;
            setNodes(finalNodes);
            transitionTimeoutRef.current = null;
          }, 1150);
        });
      })
      .catch((err) => {
        console.error("[EvidenceMap] Cloud layout failed:", err);
        if (!active) return;
        const anchoredEdges = resolveEdgeAnchors(focusedGraph.nodes, focusedGraph.edges);
        const fallbackNodes = focusedGraph.nodes.map((node) => withNodeTransition({
          ...node,
          data: {
            ...node.data,
            exiting: false,
          },
        }));
        currentNodesRef.current = fallbackNodes;
        setNodes(fallbackNodes);
        setEdges(anchoredEdges);
      })
      .finally(() => {
        if (active) setIsLayouting(false);
      });

    return () => {
      active = false;
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [flow, focusNodeId, setNodes, setEdges, fitView, setCenter]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<EvidenceNodeData>) => {
      if (node.data.kind === "content") {
        setFocusNodeId(null);
        setSelectedNodeData(null);
        window.requestAnimationFrame(() => fitView({ padding: 0.18, duration: 1000 }));
        return;
      }

      setFocusNodeId(node.id);
      setSelectedNodeData(node.data);
      const width = node.width || NODE_SIZE[node.data.kind].width;
      const height = node.height || NODE_SIZE[node.data.kind].height;
      setCenter((node.position.x || 0) + width / 2 + 280, (node.position.y || 0) + height / 2, {
        zoom: 1.05,
        duration: 220,
      });
    },
    [fitView, setCenter],
  );

  const handleWheelCapture = useCallback(
    (event: React.WheelEvent) => {
      if (!event.shiftKey) {
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();

      const delta = event.deltaY || -((event.nativeEvent as WheelEvent & { wheelDelta?: number }).wheelDelta || 0);
      const direction = Math.abs(delta) < 1 ? 1 : delta > 0 ? -1 : 1;
      const zoomFactor = 1.08;
      const viewport = getViewport();
      const nextZoom = Math.max(0.25, Math.min(1.6, viewport.zoom * (direction > 0 ? zoomFactor : 1 / zoomFactor)));
      const flowPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const bounds = event.currentTarget.getBoundingClientRect();
      pendingViewportRef.current = {
        x: event.clientX - bounds.left - flowPoint.x * nextZoom,
        y: event.clientY - bounds.top - flowPoint.y * nextZoom,
        zoom: nextZoom,
      };
      if (wheelZoomRafRef.current !== null) return;
      wheelZoomRafRef.current = window.requestAnimationFrame(() => {
        wheelZoomRafRef.current = null;
        if (pendingViewportRef.current) {
          setViewport(pendingViewportRef.current);
          pendingViewportRef.current = null;
        }
      });
    },
    [getViewport, screenToFlowPosition, setViewport],
  );

  return (
    <Box className="veristrata-evidence-map-snapshot-target" position="relative" h="calc(100vh - 236px)" minH="520px">
      {isLayouting && (
        <HStack
          position="absolute"
          right={4}
          top={4}
          zIndex={5}
          bg="rgba(3,10,24,0.8)"
          border="1px solid rgba(0,162,255,0.2)"
          borderRadius="8px"
          px={3}
          py={2}
        >
          <Spinner size="xs" color="#00a2ff" />
          <Text fontSize="10px" color="var(--mr-text-muted)">Reframing map</Text>
        </HStack>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.25}
        maxZoom={1.6}
        zoomOnScroll={false}
        zoomActivationKeyCode={null}
        panOnScroll={false}
        onWheelCapture={handleWheelCapture}
        onlyRenderVisibleElements
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(0,162,255,0.22)" gap={28} size={1} />
        <Controls
          position="bottom-right"
          style={{
            background: "rgba(3,10,24,0.82)",
            border: "1px solid rgba(0,162,255,0.22)",
          }}
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeColor={(node) => {
            if (node.data?.kind === "taskClaim") return "#a78bfa";
            if (node.data?.kind === "evidenceClaim") return node.data?.stance ? STANCE[node.data.stance as Stance].color : "#00a2ff";
            if (node.data?.kind === "source") return "#4ade80";
            return "#00a2ff";
          }}
          nodeColor="rgba(5,12,28,0.9)"
          maskColor="rgba(0,0,0,0.18)"
          style={{
            width: 184,
            height: 122,
            background: "rgba(3,10,24,0.95)",
            border: "1px solid rgba(113,219,255,0.36)",
            boxShadow: "0 12px 34px rgba(0,0,0,0.45), 0 0 18px rgba(0,162,255,0.14)",
          }}
        />
      </ReactFlow>

      <Box position="absolute" left={4} top={4} zIndex={5} pointerEvents="auto">
        <Legend />
      </Box>

      {focusNodeId && (
        <Button
          size="sm"
          position="absolute"
          left={4}
          top="246px"
          zIndex={5}
          className="mr-button"
          onClick={() => {
            setFocusNodeId(null);
            setSelectedNodeData(null);
          }}
        >
          Show Full Map
        </Button>
      )}

      <Box
        position="absolute"
        right={4}
        top={4}
        zIndex={5}
        w="340px"
        maxW="calc(100vw - 32px)"
        border="1px solid rgba(113,219,255,0.22)"
        borderRadius="24px"
        boxShadow="0 18px 54px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
        p={4}
        pointerEvents="auto"
        overflow="visible"
        style={{ background: "rgba(8, 22, 58, 0.82)" }}
        sx={{
          background: "rgba(8, 22, 58, 0.82) !important",
          "&::before": {
            content: '""',
            position: "absolute",
            left: 0,
            top: 0,
            width: "20px",
            height: "100%",
            background: "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
            borderRadius: "24px 0 0 24px",
            pointerEvents: "none",
            zIndex: 1,
          },
        }}
      >
        <VStack align="start" spacing={3}>
          <Text fontSize="9px" fontWeight="800" letterSpacing="0.14em" color="#71dbff" textTransform="uppercase">
            Focus Detail
          </Text>

          <HStack align="start" justify="space-between" w="100%" spacing={3}>
            {selectedNodeData?.reference ? (
              <HStack spacing={3} minW={0} flex="1">
                <SourceCrest
                  {...normalizeSourceProfile({
                    publisher_name: selectedNodeData.reference.publisher_name,
                    is_primary_source: selectedNodeData.reference.is_primary_source,
                    media_source: selectedNodeData.reference.media_source,
                    veracity_score: selectedNodeData.reference.publisher_veracity ?? undefined,
                    rating_label: selectedNodeData.reference.rating_label ?? undefined,
                    rating_type: selectedNodeData.reference.rating_type ?? undefined,
                    admiralty_code: selectedNodeData.reference.admiralty_code ?? undefined,
                  })}
                  size="sm"
                  onClick={(e) => { e?.stopPropagation(); setSourceDetailRef(selectedNodeData.reference!); }}
                />
                <VStack align="start" spacing={0} minW={0}>
                  <Text fontSize="11px" fontWeight="800" noOfLines={1}>
                    {selectedNodeData.reference.publisher_name || selectedNodeData.reference.media_source || "Unresolved source"}
                  </Text>
                  <Text fontSize="9px" color="var(--mr-text-muted)" noOfLines={1}>
                    {selectedNodeData.reference.admiralty_code ? `Admiralty ${selectedNodeData.reference.admiralty_code}` : "Admiralty pending"}
                  </Text>
                  {selectedNodeData.reference.author_name && (
                    <Text fontSize="9px" color="var(--mr-text-muted)" noOfLines={1}>
                      Author: {selectedNodeData.reference.author_name}
                    </Text>
                  )}
                </VStack>
              </HStack>
            ) : (
              <Text fontSize="10px" color="var(--mr-text-muted)" flex="1">
                Select a source or evidence claim to see publisher, author, and admiralty detail.
              </Text>
            )}

            <VStack align="end" spacing={2} flexShrink={0}>
              {selectedNodeData?.stance && (
                <MRStatusBox
                  compact
                  tone={selectedNodeData.stance === "support" ? "green" : selectedNodeData.stance === "refute" ? "red" : "blue"}
                  label="Stance"
                  value={STANCE[selectedNodeData.stance].label}
                />
              )}
              {selectedNodeData?.provenance && (
                <MRStatusBox
                  compact
                  tone={selectedNodeData.provenance === "user" ? "cyan" : "purple"}
                  label={selectedNodeData.provenance === "user" ? "User" : "AI"}
                  value={selectedNodeData.provenance === "user" ? "Linked" : "Suggested"}
                />
              )}
            </VStack>
          </HStack>

          <HStack justify="space-between" w="100%">
            <Text fontSize="9px" fontWeight="800" letterSpacing="0.14em" color="#71dbff" textTransform="uppercase">
              Node
            </Text>
          </HStack>
          <Text fontSize="14px" fontWeight="800" lineHeight="1.35">
            {selectedNodeData ? `${selectedNodeData.label} | ${selectedNodeData.title}` : "Click a node to inspect its claim, source, and provenance."}
          </Text>
          {selectedNodeData?.caseClaim && (
            <FocusDetailBox label="Case Claim" tone="purple">
              {selectedNodeData.caseClaim}
            </FocusDetailBox>
          )}
          {selectedNodeData?.sourceClaim && (
            <FocusDetailBox label="Source Claim" tone="cyan">
              {selectedNodeData.sourceClaim}
            </FocusDetailBox>
          )}
          {selectedNodeData?.rationale && (
            <FocusDetailBox label="Rationale" tone="green">
              {selectedNodeData.rationale}
            </FocusDetailBox>
          )}
          {selectedNodeData?.detail && !selectedNodeData.caseClaim && !selectedNodeData.sourceClaim && (
            <FocusDetailBox label="Detail" tone="cyan">
              {selectedNodeData.detail}
            </FocusDetailBox>
          )}
          {selectedNodeData?.sourceClaims && selectedNodeData.sourceClaims.length > 0 && (
            <FocusDetailBox label="Connected Claims" tone="blue">
              {selectedNodeData.sourceClaims.slice(0, 3).map((claim) => claim.text).join("\n\n")}
            </FocusDetailBox>
          )}
          {selectedNodeData?.sublabel && (
            <Text fontSize="10px" color="var(--mr-text-muted)" lineHeight="1.45">
              {selectedNodeData.sublabel}
            </Text>
          )}
        </VStack>
      </Box>

      {sourceDetailRef && (
        <SourceDetailModal
          isOpen={!!sourceDetailRef}
          onClose={() => {
            setSourceDetailRef(null);
            setSelectedNodeData(null);
            onRefreshReferences?.();
          }}
          publisherId={sourceDetailRef.publisher_id}
          publisherName={sourceDetailRef.publisher_name || sourceDetailRef.media_source || "Unknown"}
          sourceUrl={sourceDetailRef.url}
          admiraltyCode={sourceDetailRef.admiralty_code ?? undefined}
        />
      )}
    </Box>
  );
}

function Legend() {
  const legendDot = (color: string, shape: "circle" | "square" = "circle", label: string) => (
    <HStack spacing={2}>
      <Center
        w="16px"
        h="16px"
        borderRadius={shape === "circle" ? "full" : "4px"}
        border={`1px solid ${color}`}
        bg={`${color}22`}
        color={color}
        fontSize="8px"
        boxShadow={`0 0 8px ${color}44`}
      >
        {shape === "circle" ? "•" : "▪"}
      </Center>
      <Text fontSize="10px" color="var(--mr-text-muted)">{label}</Text>
    </HStack>
  );

  const legendLine = (color: string, label: string, dashed = false) => (
    <HStack spacing={2}>
      <Box
        w="28px"
        h="0"
        borderTop={`2px ${dashed ? "dashed" : "solid"} ${color}`}
        boxShadow={`0 0 8px ${color}44`}
      />
      <Text fontSize="10px" color="var(--mr-text-muted)">{label}</Text>
    </HStack>
  );

  return (
    <Box
      border="1px solid rgba(113,219,255,0.22)"
      borderRadius="24px"
      boxShadow="0 18px 54px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
      p={4}
      w="320px"
      pointerEvents="auto"
      overflow="visible"
      position="relative"
      style={{ background: "rgba(8, 22, 58, 0.82)" }}
      sx={{
        background: "rgba(8, 22, 58, 0.82) !important",
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 0,
          width: "20px",
          height: "100%",
          background: "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
          borderRadius: "24px 0 0 24px",
          pointerEvents: "none",
          zIndex: 1,
        },
      }}
    >
      <Text fontSize="11px" fontWeight="900" letterSpacing="0.12em" color="#71dbff" textTransform="uppercase" mb={3}>
        Evidence Map Legend
      </Text>
      <Flex justify="space-between" gap={5}>
        <Box>
          <Text fontSize="10px" fontWeight="800" color="var(--mr-text-primary)" mb={1}>
            Nodes
          </Text>
          <VStack align="start" spacing={1.5}>
            {legendDot("#00a2ff", "square", "Article")}
            {legendDot("#a78bfa", "circle", "Origin claim")}
            {legendDot("#22c55e", "circle", "Evidence claim")}
            {legendDot("#4ade80", "square", "Source")}
          </VStack>
        </Box>

        <Box>
          <Text fontSize="10px" fontWeight="800" color="var(--mr-text-primary)" mb={1}>
            Links
          </Text>
          <VStack align="start" spacing={1.5}>
            {legendLine("#22c55e", "Supports")}
            {legendLine("#ef4444", "Refutes")}
            {legendLine("#3b82f6", "Qualifies")}
            {legendLine("#a78bfa", "AI suggested", true)}
            {legendLine("#00e5ff", "User linked")}
          </VStack>
        </Box>
      </Flex>
      <Text fontSize="10px" mt={3} color="var(--mr-text-muted)" textAlign="center">
        Shift-scroll zooms. Shift-drag selects a box; drag any selected node to move the group.
      </Text>
    </Box>
  );
}

export default function EvidenceMapPage() {
  const navigate = useNavigate();

  const toast = useToast();
  const { contentId: paramId } = useParams<{ contentId: string }>();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const linkFilter = useTaskStore((s) => s.graphLinkFilter);
  const viewingUserId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
  const { user } = useAuthStore();
  const { mode, aiWeight } = useVerimeterMode();

  const contentId = paramId ? parseInt(paramId, 10) : selectedTask?.content_id ?? 0;
  const viewerId = viewingUserId ?? user?.user_id ?? null;

  const { caseClaims, references, isLoading: sessionLoading, refreshReferences } = useClaimLinkSession({
    contentId,
    viewerId,
    scope: viewScope,
  });

  const [claimScores, setClaimScores] = useState<Record<number, number>>({});
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [counts, setCounts] = useState<FlowBuildResult["counts"]>({
    user: 0,
    ai: 0,
    sources: 0,
    evidenceClaims: 0,
  });

  useEffect(() => {
    if (!contentId) return;
    fetchContentScores(contentId, viewerId, mode, aiWeight)
      .then((s) => setOverallScore(s?.verimeterScore ?? null))
      .catch(() => setOverallScore(null));
    fetchClaimScoresForTask(contentId, viewerId)
      .then((scores) => setClaimScores(scores ?? {}))
      .catch(() => {});
  }, [contentId, viewerId, mode, aiWeight]);

  const taskName = selectedTask?.content_name ?? "Content Under Review";
  const verdict = scoreVerdict(overallScore);

  const handleCountsChange = useCallback((nextCounts: FlowBuildResult["counts"]) => {
    setCounts((current) => (
      current.user === nextCounts.user &&
      current.ai === nextCounts.ai &&
      current.sources === nextCounts.sources &&
      current.evidenceClaims === nextCounts.evidenceClaims
        ? current
        : nextCounts
    ));
  }, []);

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Could not read snapshot image."));
      reader.readAsDataURL(blob);
    });

  const captureEvidenceMapSnapshotBlob = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const target = document.querySelector<HTMLElement>(".veristrata-evidence-map-snapshot-target");
    if (!target) throw new Error("Evidence map snapshot target was not found.");
    return captureElementAsPng(target, {
      backgroundColor: "#050a14",
      pixelRatio: 2,
      maxWidth: 1800,
    });
  };

  const handleSaveSnapshot = async () => {
    if (!contentId) return;
    try {
      setSavingSnapshot(true);
      const blob = await captureEvidenceMapSnapshotBlob();
      const dataUrl = await blobToDataUrl(blob);
      const response = await api.post("/api/review-articles/workspace-snapshot", {
        content_id: contentId,
        data_url: dataUrl,
        module_id: "evidence_map_image",
      });
      toast({
        title: "Evidence map snapshot saved",
        description: response.data?.body_updated
          ? "The Evidence Map Image module was updated."
          : "The image asset was saved and attached to the review article.",
        status: "success",
        duration: 4000,
      });
    } catch (error: any) {
      console.error("Attach evidence map snapshot failed:", error);
      toast({
        title: "Could not attach snapshot",
        description: error.response?.data?.error || error.message || "The evidence map image was not attached.",
        status: "error",
        duration: 5500,
      });
    } finally {
      setSavingSnapshot(false);
    }
  };

  if (!contentId) {
    return (
      <Center h="100vh" flexDir="column" gap={4}>
        <Text color="var(--mr-text-muted)">No task selected.</Text>
        <Button size="sm" className="mr-button" onClick={() => navigate(-1)}>Go Back</Button>
      </Center>
    );
  }

  return (
    <Box
      minH="100vh"
      bg="#050a14"
      color="var(--mr-text-primary)"
      position="relative"
      overflow="hidden"
      _before={{
        content: '""',
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(circle at 18% 20%, rgba(0,162,255,0.18), transparent 36%)",
        pointerEvents: "none",
      }}
    >
      <Box position="relative" zIndex={1}>
        <Box
          px={6}
          py={4}
          borderBottom="1px solid rgba(0,162,255,0.16)"
          bg="rgba(0,8,20,0.92)"
        >
          <HStack justify="space-between" align="center" gap={4}>
            <HStack spacing={4} align="center" minW={0}>
              <Button size="sm" variant="ghost" color="var(--mr-text-muted)" onClick={() => navigate(-1)}>
                ← Back
              </Button>
              <TruthGauge
                score={overallScore ?? 0}
                label="VERIMETER"
                size={{ w: 150, h: 82 }}
                normalize={false}
                dense
              />
              <VStack align="start" spacing={1}>
                <HStack spacing={2}>
                  <Text
                    fontSize="18px"
                    fontWeight="800"
                    letterSpacing="0.1em"
                    textTransform="uppercase"
                    color="#71dbff"
                  >
                    Evidence Map
                  </Text>
                  <MRStatusBox compact tone="cyan" label="OSINT" value="Prototype" />
                </HStack>
                <Text
                  fontSize={{ base: "15px", md: "18px" }}
                  fontWeight="900"
                  color="#f4fbff"
                  maxW={{ base: "360px", md: "720px" }}
                  noOfLines={1}
                  lineHeight="1.15"
                >
                  {taskName}
                </Text>
                <Text fontSize="10px" color="var(--mr-text-muted)" maxW="680px" noOfLines={1}>
                  Content, case claims, extracted evidence claims, and sources.
                </Text>
              </VStack>
            </HStack>

            <HStack spacing={4} align="center" flexShrink={0}>
              <VStack spacing={0} align="end">
                <Text fontSize="9px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.12em">
                  Verimeter
                </Text>
                <Tooltip label={verdict.sub}>
                  <Text fontSize="13px" fontWeight="800" color="#f1f5f9">
                    {verdict.label}
                  </Text>
                </Tooltip>
              </VStack>
            </HStack>
          </HStack>
        </Box>

        <Box mx={6} my={3}>
        <GraphControlBar
          title="Evidence Controls"
          metrics={
            <>
              <GraphMetricPill tone="purple" label="Claims" value={caseClaims.length} />
              <GraphMetricPill tone="blue" label="Evidence" value={counts.evidenceClaims} />
              <GraphMetricPill tone="green" label="Sources" value={counts.sources} />
              <GraphMetricPill tone="cyan" label="User Links" value={counts.user} />
              <GraphMetricPill tone="purple" label="AI Links" value={counts.ai} />
            </>
          }
        >
          <Box position="relative" zIndex={20}>
            <VerimeterModeToggle compact />
          </Box>
          <Button
            className="mr-button"
            size="sm"
            minW="142px"
            px={4}
            flexShrink={0}
            leftIcon={<Icon as={FiCamera} />}
            onClick={handleSaveSnapshot}
            isLoading={savingSnapshot}
            loadingText="Saving"
            isDisabled={sessionLoading || !contentId}
            whiteSpace="nowrap"
            position="relative"
            zIndex={20}
          >
            Save Snapshot
          </Button>
        </GraphControlBar>
        </Box>

        {sessionLoading ? (
          <Center h="60vh">
            <VStack spacing={3}>
              <Spinner size="xl" color="#00a2ff" thickness="3px" />
              <Text color="var(--mr-text-muted)" fontSize="sm">Loading evidence graph…</Text>
            </VStack>
          </Center>
        ) : (
          <ReactFlowProvider>
            <EvidenceMapFlow
              contentId={contentId}
              taskName={taskName}
              taskAdmiraltyCode={(selectedTask?.publishers as any)?.[0]?.admiralty_code ?? undefined}
              taskPublisherName={(selectedTask?.publishers as any)?.[0]?.publisher_name ?? undefined}
              caseClaims={caseClaims}
              references={references}
              viewerId={viewerId}
              viewScope={viewScope}
              claimScores={claimScores}
              overallScore={overallScore}
              linkFilter={linkFilter}
              onCountsChange={handleCountsChange}
              onRefreshReferences={refreshReferences}
            />
          </ReactFlowProvider>
        )}
      </Box>
    </Box>
  );
}
