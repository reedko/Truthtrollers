// dashboard/src/pages/EvidenceMapPage.tsx
// OSINT-style Evidence Map prototype.
// Current DB model: content -> extracted task claims -> extracted source claims -> sources.
// Future reasoning levels (thesis -> pillar -> evidence claims) are represented as UI framing,
// not as stored schema, until the scrape/extraction pipeline supports them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Select,
  Spinner,
  Text,
  Tooltip,
  Icon,
  useColorMode,
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
  fetchReferenceClaimTaskLinks,
  ReferenceClaimTaskLink,
} from "../services/referenceClaimRelevance";
import { fetchContentScores, fetchClaimScoresForTask } from "../services/useDashboardAPI";
import { api } from "../services/api";
import SourceCrest from "../components/SourceCrest";
import SourceDetailModal from "../components/modals/SourceDetailModal";
import GraphNodeDetailModal, {
  GraphNodeDetailSourceClaim,
} from "../components/graph/GraphNodeDetailModal";
import TruthGauge from "../components/ModernArcGauge";
import { VerimeterModeToggle } from "../components/VerimeterModeToggle";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";
import { captureElementAsPng } from "../utils/domSnapshot";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";

type EvidenceNodeKind = "content" | "taskClaim" | "evidenceClaim" | "source";
type Stance = "support" | "refute" | "nuance" | "insufficient";
type LinkProvenance = "user" | "ai";

const NODE_SIZE: Record<EvidenceNodeKind, { width: number; height: number }> = {
  content: { width: 132, height: 132 },
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
      px={compact ? 2 : 3}
      py={compact ? 1.5 : 2}
      minW={compact ? "72px" : "96px"}
      {...mrBoxStyle(tone)}
    >
      <CurvedEdge tone={tone} radius={compact ? "10px" : "14px"} />
      <Text
        position="relative"
        zIndex={1}
        fontSize={compact ? "8px" : "9px"}
        textTransform="uppercase"
        letterSpacing="0.08em"
        color="rgba(228, 244, 255, 0.78)"
        lineHeight="1.1"
        noOfLines={1}
      >
        {label}
      </Text>
      {value != null && (
        <Text
          position="relative"
          zIndex={1}
          fontSize={compact ? "13px" : "16px"}
          fontWeight="800"
          color={c.hex}
          lineHeight="1.15"
          mt={0.5}
          noOfLines={1}
        >
          {value}
        </Text>
      )}
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
  return link?.source_table?.startsWith("claim_links") ? "user" : "ai";
}

function formatStrength(confidence?: number | null) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "";
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
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
  depth?: number;
  dimmed?: boolean;
  onReframe?: (id: string) => void;
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
      opacity={data.dimmed ? 0.7 : 1}
      bg={isFocus
        ? "linear-gradient(135deg, rgba(9,27,52,0.98), rgba(17,42,68,0.95))"
        : "linear-gradient(135deg, rgba(3,10,24,0.62), rgba(8,20,36,0.56))"}
      border={isUser ? `2px solid ${color}` : `1px ${data.provenance === "ai" ? "dashed" : "solid"} ${color}99`}
      borderRadius={data.kind === "taskClaim" || data.kind === "evidenceClaim" ? "full" : "10px"}
      boxShadow={`0 10px 28px rgba(0,0,0,0.45), 0 0 ${isFocus || isUser ? 24 : 10}px ${color}44, inset 0 1px 0 rgba(255,255,255,0.08)`}
      overflow="hidden"
      color="var(--mr-text-primary)"
      transition="opacity 180ms ease, transform 180ms ease, box-shadow 180ms ease"
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

  const contentNode = nodes.find((node) => node.data.kind === "content");
  const centerId = focusNodeId || contentNode?.id || nodes[0].id;
  const depths = getCloudDepths(nodes, edges, centerId);

  const ringRadius: Record<number, number> = { 0: 0, 1: 250, 2: 430, 3: 585 };
  const kindOrder: Record<EvidenceNodeKind, number> = {
    content: 0,
    taskClaim: 1,
    evidenceClaim: 2,
    source: 3,
  };
  const sortNodes = (items: Node<EvidenceNodeData>[]) =>
    [...items].sort((a, b) => {
      const kindDelta = kindOrder[a.data.kind] - kindOrder[b.data.kind];
      if (kindDelta !== 0) return kindDelta;
      return a.id.localeCompare(b.id);
    });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach((node) => adjacency.set(node.id, new Set()));
  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });
  const getParentId = (node: Node<EvidenceNodeData>) => {
    const depth = depths.get(node.id) ?? 3;
    const candidates = Array.from(adjacency.get(node.id) || [])
      .filter((id) => (depths.get(id) ?? 99) === depth - 1)
      .sort();
    return candidates[0] || centerId;
  };
  const positions = new Map<string, { x: number; y: number; angle: number }>();
  positions.set(centerId, { x: 0, y: 0, angle: -Math.PI / 2 });

  const maxRing = Math.min(3, Math.max(...Array.from(depths.values()).map((depth) => Math.min(depth, 3))));
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const ringNodes = sortNodes(nodes.filter((node) => Math.min(depths.get(node.id) ?? 3, 3) === ring));
    if (!ringNodes.length) continue;

    if (ring === 1) {
      ringNodes.forEach((node, index) => {
        const angle = -Math.PI / 2 + (index / ringNodes.length) * Math.PI * 2;
        positions.set(node.id, {
          x: Math.cos(angle) * ringRadius[ring],
          y: Math.sin(angle) * ringRadius[ring],
          angle,
        });
      });
      continue;
    }

    const groups = new Map<string, Node<EvidenceNodeData>[]>();
    ringNodes.forEach((node) => {
      const parentId = getParentId(node);
      if (!groups.has(parentId)) groups.set(parentId, []);
      groups.get(parentId)?.push(node);
    });

    Array.from(groups.entries())
      .sort(([a], [b]) => (positions.get(a)?.angle ?? 0) - (positions.get(b)?.angle ?? 0))
      .forEach(([parentId, children]) => {
        const parentAngle = positions.get(parentId)?.angle ?? -Math.PI / 2;
        const sortedChildren = sortNodes(children);
        const wedge = Math.min(1.15, Math.max(0.42, sortedChildren.length * 0.28));
        sortedChildren.forEach((node, index) => {
          const t = sortedChildren.length === 1 ? 0 : index / (sortedChildren.length - 1) - 0.5;
          const angle = parentAngle + t * wedge;
          const jitter = ((index % 3) - 1) * 18;
          const radius = ringRadius[ring] + jitter + Math.max(0, ringNodes.length - 12) * 5;
          positions.set(node.id, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            angle,
          });
        });
      });
  }

  return nodes.map((node) => {
    const depth = depths.get(node.id) ?? 3;
    const cloudPosition = positions.get(node.id) || { x: 0, y: 0, angle: -Math.PI / 2 };
    const width = node.width || NODE_SIZE[node.data.kind].width;
    const height = node.height || NODE_SIZE[node.data.kind].height;

    return {
      ...node,
      position: {
        x: cloudPosition.x - width / 2,
        y: cloudPosition.y - height / 2,
      },
      data: {
        ...node.data,
        depth,
        dimmed: Boolean(focusNodeId && depth >= 2),
      },
    };
  });
}

function buildFlow({
  contentId,
  taskName,
  caseClaims,
  references,
  linksByClaim,
  claimScores,
  overallScore,
  linkFilter,
  onReframe,
}: {
  contentId: number;
  taskName: string;
  caseClaims: Claim[];
  references: ReferenceWithClaims[];
  linksByClaim: Map<number, ReferenceClaimTaskLink[]>;
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
      title: "Article",
      label: "Article",
      sublabel: "Current state: title and extracted task claims. Thesis extraction is future schema.",
      detail: `${taskName}\n\n${verdict.sub}`,
      score: overallScore,
      sourceCount: caseClaims.length,
      onReframe,
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
      const evId = `evidence-claim-${link.reference_claim_id}`;
      const refId = link.reference_content_id;
      const sourceNodeId = refId ? `source-${refId}` : `source-unknown-${link.reference_claim_id}`;
      const reference = refId ? refMap.get(refId) : undefined;
      evidenceClaimIds.add(link.reference_claim_id);
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

function filterAroundFocus(
  nodes: Node<EvidenceNodeData>[],
  edges: Edge[],
  adjacency: Map<string, Set<string>>,
  focusNodeId: string | null,
) {
  if (!focusNodeId) return { nodes, edges };

  const visible = new Set<string>([focusNodeId]);
  const direct = adjacency.get(focusNodeId) || new Set<string>();
  direct.forEach((id) => visible.add(id));

  // Keep the content node visible as orientation, and include one extra hop for sources/evidence.
  nodes.forEach((node) => {
    if (node.data.kind === "content") visible.add(node.id);
  });
  direct.forEach((id) => {
    const second = adjacency.get(id) || new Set<string>();
    second.forEach((secondId) => visible.add(secondId));
  });

  return {
    nodes: nodes.filter((node) => visible.has(node.id)),
    edges: edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
  };
}

function EvidenceMapFlow({
  contentId,
  taskName,
  caseClaims,
  references,
  claimScores,
  overallScore,
  linkFilter,
  onCountsChange,
  onRefreshReferences,
}: {
  contentId: number;
  taskName: string;
  caseClaims: Claim[];
  references: ReferenceWithClaims[];
  claimScores: Record<number, number>;
  overallScore: number | null;
  linkFilter: "all" | "user" | "ai";
  onCountsChange: (counts: FlowBuildResult["counts"]) => void;
  onRefreshReferences?: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EvidenceNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [linksByClaim, setLinksByClaim] = useState<Map<number, ReferenceClaimTaskLink[]>>(new Map());
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<EvidenceNodeData | null>(null);
  const [isLayouting, setIsLayouting] = useState(false);
  const [sourceDetailRef, setSourceDetailRef] = useState<ReferenceWithClaims | null>(null);
  const { fitView, setCenter, getViewport, setViewport, screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    let active = true;
    if (!caseClaims.length || !contentId) {
      setLinksByClaim(new Map());
      return;
    }

    Promise.all(
      caseClaims.map(async (claim) => {
        const links = await fetchReferenceClaimTaskLinks(claim.claim_id);
        return [claim.claim_id, links] as const;
      }),
    )
      .then((entries) => {
        if (!active) return;
        setLinksByClaim(new Map(entries));
      })
      .catch((err) => {
        console.error("[EvidenceMap] Failed to fetch claim links:", err);
        if (active) setLinksByClaim(new Map());
      });

    return () => {
      active = false;
    };
  }, [caseClaims, contentId]);

  const flow = useMemo(
    () =>
      buildFlow({
        contentId,
        taskName,
        caseClaims,
        references,
        linksByClaim,
        claimScores,
        overallScore,
        linkFilter,
        onReframe: setFocusNodeId,
      }),
    [contentId, taskName, caseClaims, references, linksByClaim, claimScores, overallScore, linkFilter],
  );

  useEffect(() => {
    onCountsChange(flow.counts);
  }, [flow.counts.ai, flow.counts.user, flow.counts.sources, flow.counts.evidenceClaims, onCountsChange]);

  useEffect(() => {
    let active = true;
    const visible = filterAroundFocus(flow.nodes, flow.edges, flow.adjacency, focusNodeId);
    setIsLayouting(true);

    layoutNodes(visible.nodes, visible.edges, focusNodeId)
      .then((layouted) => {
        if (!active) return;
        const anchoredEdges = resolveEdgeAnchors(layouted, visible.edges);
        setNodes(layouted.map((node) => ({
          ...node,
          data: {
            ...node.data,
            focused: node.id === focusNodeId || (!focusNodeId && node.data.kind === "content"),
          },
        })));
        setEdges(anchoredEdges);
        window.requestAnimationFrame(() => fitView({ padding: 0.18, duration: 0 }));
      })
      .catch((err) => {
        console.error("[EvidenceMap] Cloud layout failed:", err);
        if (!active) return;
        const anchoredEdges = resolveEdgeAnchors(visible.nodes, visible.edges);
        setNodes(visible.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            focused: node.id === focusNodeId || (!focusNodeId && node.data.kind === "content"),
          },
        })));
        setEdges(anchoredEdges);
      })
      .finally(() => {
        if (active) setIsLayouting(false);
      });

    return () => {
      active = false;
    };
  }, [flow, focusNodeId, setNodes, setEdges, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<EvidenceNodeData>) => {
      setFocusNodeId(node.id);
      setSelectedNodeData(node.data);
      const width = node.width || NODE_SIZE[node.data.kind].width;
      const height = node.height || NODE_SIZE[node.data.kind].height;
      setCenter((node.position.x || 0) + width / 2, (node.position.y || 0) + height / 2, {
        zoom: 1.15,
        duration: 450,
      });
    },
    [setCenter],
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

      setViewport(
        {
          x: event.clientX - bounds.left - flowPoint.x * nextZoom,
          y: event.clientY - bounds.top - flowPoint.y * nextZoom,
          zoom: nextZoom,
        },
      );
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
          {selectedNodeData?.detail && (
            <Text fontSize="11px" color="var(--mr-text-secondary)" lineHeight="1.55">
              {selectedNodeData.detail}
            </Text>
          )}
          {selectedNodeData?.sublabel && (
            <Text fontSize="10px" color="var(--mr-text-muted)" lineHeight="1.45">
              {selectedNodeData.sublabel}
            </Text>
          )}
        </VStack>
      </Box>

      {selectedNodeData && (
        <GraphNodeDetailModal
          isOpen={!!selectedNodeData}
          kicker={
            selectedNodeData.kind === "content"
              ? "Article"
              : selectedNodeData.kind === "taskClaim"
                ? "Case Claim"
                : selectedNodeData.kind === "evidenceClaim"
                  ? "Source Claim"
                  : "Source"
          }
          title={`${selectedNodeData.label} | ${selectedNodeData.title}`}
          subtitle={selectedNodeData.sublabel}
          caseClaim={selectedNodeData.caseClaim}
          sourceClaim={selectedNodeData.sourceClaim}
          rationale={selectedNodeData.rationale}
          detail={selectedNodeData.detail}
          url={selectedNodeData.reference?.url || (selectedNodeData.kind === "source" ? selectedNodeData.sublabel : undefined)}
          reference={selectedNodeData.reference}
          sourceClaims={selectedNodeData.sourceClaims}
          relation={selectedNodeData.stance}
          statusItems={[
            ...(selectedNodeData.provenance
              ? [{
                  label: selectedNodeData.provenance === "user" ? "User" : "AI",
                  value: selectedNodeData.provenance === "user" ? "Linked" : "Suggested",
                  tone: selectedNodeData.provenance === "user" ? "cyan" as const : "purple" as const,
                }]
              : []),
            ...(typeof selectedNodeData.confidence === "number"
              ? [{
                  label: "Confidence",
                  value: `${Math.round(selectedNodeData.confidence * 100)}%`,
                  tone: "cyan" as const,
                }]
              : []),
            ...(typeof selectedNodeData.sourceCount === "number"
              ? [{
                  label: "Sources",
                  value: selectedNodeData.sourceCount,
                  tone: "green" as const,
                }]
              : []),
          ]}
          onSourceCrestClick={(reference) => setSourceDetailRef(reference)}
          onClose={() => setSelectedNodeData(null)}
        />
      )}

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
  const { colorMode } = useColorMode();
  const toast = useToast();
  const { contentId: paramId } = useParams<{ contentId: string }>();
  const { selectedTask } = useTaskStore();
  const { user } = useAuthStore();
  const { mode, aiWeight } = useVerimeterMode();

  const contentId = paramId ? parseInt(paramId, 10) : selectedTask?.content_id ?? 0;
  const viewerId = user?.user_id ?? null;

  const { caseClaims, references, claimScores: hookClaimScores, isLoading: sessionLoading, refreshReferences } = useClaimLinkSession({
    contentId,
    viewerId,
    scope: "all",
  });

  const [claimScores, setClaimScores] = useState<Record<number, number>>({});
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [linkFilter, setLinkFilter] = useState<"all" | "user" | "ai">("all");
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [counts, setCounts] = useState<FlowBuildResult["counts"]>({
    user: 0,
    ai: 0,
    sources: 0,
    evidenceClaims: 0,
  });

  useEffect(() => {
    setClaimScores(hookClaimScores || {});
  }, [hookClaimScores]);

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
          backdropFilter="blur(12px)"
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
                    fontSize="22px"
                    fontWeight="800"
                    letterSpacing="0.1em"
                    textTransform="uppercase"
                    color="#71dbff"
                  >
                    Evidence Map
                  </Text>
                  <MRStatusBox compact tone="cyan" label="OSINT" value="Prototype" />
                </HStack>
                <Text fontSize="11px" color="var(--mr-text-muted)" maxW="680px">
                  Current data model mapped as content, task claims, extracted evidence claims, and sources.
                  Future reasoning levels will promote thesis and pillar claims once the extraction schema exists.
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

        <HStack
          px={6}
          py={4}
          spacing={3}
          className="mr-card mr-card-purple"
          bg="transparent"
          flexWrap="nowrap"
          alignItems="center"
          justifyContent="space-between"
          borderBottom="1px solid rgba(0,162,255,0.12)"
          borderLeftRadius="24px"
          position="relative"
          zIndex={2}
          mx={6}
          my={3}
          overflowX="auto"
          overflowY="visible"
          sx={{
            "&::before": {
              content: '""',
              position: "absolute",
              left: 0,
              top: 0,
              width: "20px",
              height: "100%",
              background:
                "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
              borderLeftRadius: "24px",
              pointerEvents: "none",
              zIndex: -1,
            },
          }}
        >
          <Text
            fontSize="16px"
            fontWeight="800"
            color="var(--mr-text-primary)"
            whiteSpace="nowrap"
          >
            Evidence Controls
          </Text>
          <Box
            display="flex"
            alignItems="center"
            gap={2}
            bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)"}
            px={3}
            py={2}
            borderRadius="full"
            border="1px solid rgba(113,219,255,0.2)"
            boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
            position="relative"
            zIndex={20}
          >
            <Text
              className="mr-text-muted"
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="1px"
              whiteSpace="nowrap"
            >
              Link Filter
            </Text>
            <Select
              size="sm"
              width="150px"
              value={linkFilter}
              onChange={(e) => setLinkFilter(e.target.value as "all" | "user" | "ai")}
              bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white"}
              border="1px solid"
              borderColor={colorMode === "dark" ? "var(--mr-blue-border)" : "rgba(71, 85, 105, 0.3)"}
              color={colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800"}
              borderRadius="full"
              boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
            >
              <option value="all">All Links</option>
              <option value="user">User Links</option>
              <option value="ai">AI Links</option>
            </Select>
          </Box>
          <Box position="relative" zIndex={20}>
            <VerimeterModeToggle compact />
          </Box>
          <HStack spacing={2} flexWrap="nowrap" flexShrink={0}>
            <MRStatusBox compact tone="purple" label="Claims" value={caseClaims.length} />
            <MRStatusBox compact tone="blue" label="Evidence" value={counts.evidenceClaims} />
            <MRStatusBox compact tone="green" label="Sources" value={counts.sources} />
            <MRStatusBox compact tone="cyan" label="User Links" value={counts.user} />
            <MRStatusBox compact tone="purple" label="AI Links" value={counts.ai} />
          </HStack>
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
          <Text fontSize="10px" color="var(--mr-text-muted)" flex="1" minW="180px" noOfLines={1}>
            Click any node to blossom its neighborhood. Use Reframe to center a node’s local chain.
          </Text>
        </HStack>

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
              caseClaims={caseClaims}
              references={references}
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
