// CytoscapeKnowGraph.tsx - Knowledge graph visualization with hierarchical left-to-right layout
import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { Box, useColorMode } from "@chakra-ui/react";
import { GraphNode, Link } from "../../../shared/entities/types";
import { getSourceCrestDataUri } from "../utils/sourceCrestUri";
import type { Reliability } from "../utils/normalizeSourceProfile";
import SourceDetailModal from "./modals/SourceDetailModal";
import { ClaimModal } from "./cytoscape/ui/ClaimModal";
import type { SelectedClaim } from "./cytoscape/types";

declare global {
  interface Window {
    __veristrataKnowGraphCy?: cytoscape.Core | null;
  }
}

function ratingToRel(rating: number | null | undefined): Reliability {
  if (rating == null) return "unchecked";
  if (rating >= 70) return "high";
  if (rating >= 50) return "medium";
  if (rating >= 35) return "mixed";
  if (rating >= 20) return "low";
  return "flagged";
}
const KNOWGRAPH_RELIABILITY_COLORS: Record<string, string> = {
  high: "#48BB78",
  medium: "#4299E1",
  mixed: "#F6AD55",
  low: "#FC8181",
  flagged: "#FC4444",
  unchecked: "#718096",
};

// Draws a file-folder tab shape for claim nodes.
// Tab extends to horizontal middle; badge top sits 2px from shape top (mostly in handle).
// "CLAIM" type label lives in the handle area to the right of the badge.
function makeClaimNodeSvg(
  label: string,
  hex: string,
  fillColor: string,
  r: number,
  g: number,
  b: number,
  nodeW: number,
  nodeH: number,
  typeLabel: string = "",
): string {
  const th = 36; // handle/tab height — tall enough for label + badge overlap
  const tw = Math.round(nodeW / 2); // tab extends to horizontal middle
  const diag = 32; // diagonal span of tab right edge
  const rnd = 22; // corner radius
  const svgH = nodeH + th;
  const bumpW = Math.round(nodeW * 0.5);
  // badge: top edge sits 2px from shape top
  const bx = 38,
    br = 28,
    by = br + 2; // by = 30
  const bfs = 20;
  // type label: centered in handle height, right of badge
  const typeLabelX = bx + br + 10; // 76
  const typeLabelY = Math.round(th / 2); // 18

  const p =
    `M${rnd},0 H${tw} L${tw + diag},${th} H${nodeW - rnd} ` +
    `Q${nodeW},${th} ${nodeW},${th + rnd} V${svgH - rnd} ` +
    `Q${nodeW},${svgH} ${nodeW - rnd},${svgH} H${rnd} ` +
    `Q0,${svgH} 0,${svgH - rnd} V${rnd} Q0,0 ${rnd},0 Z`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nodeW}" height="${svgH}">` +
    `<defs><radialGradient id="bmp" cx="0%" cy="50%" r="65%" fx="0%" fy="50%" gradientUnits="objectBoundingBox">` +
    `<stop offset="0%" stop-color="rgba(${r},${g},${b},0.45)"/>` +
    `<stop offset="100%" stop-color="rgba(${r},${g},${b},0)"/>` +
    `</radialGradient></defs>` +
    `<path d="${p}" fill="${fillColor}" stroke="none"/>` +
    `<rect x="0" y="${th}" width="${bumpW}" height="${nodeH}" fill="url(#bmp)"/>` +
    // type label fits inside the handle (tab) area, right of badge
    (typeLabel
      ? `<text x="${typeLabelX}" y="${typeLabelY}" dominant-baseline="central" font-family="sans-serif" fill="${hex}" font-size="22" font-weight="800" letter-spacing="2" opacity="0.95">${typeLabel}</text>`
      : "") +
    // badge drawn on top: dark fill + accent stroke, white text for max contrast
    // top edge is 2px from shape top (by = br + 2 = 30)
    `<circle cx="${bx}" cy="${by}" r="${br}" fill="rgba(6,10,22,0.97)" stroke="${hex}" stroke-width="3.5" stroke-opacity="1"/>` +
    `<text x="${bx}" y="${by}" text-anchor="middle" dominant-baseline="central" font-family="Courier New,monospace" fill="#ffffff" font-size="${bfs}" font-weight="900">${label}</text>` +
    // folder border drawn last (on top of everything)
    `<path d="${p}" fill="none" stroke="${hex}" stroke-width="4" stroke-opacity="0.85"/>` +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Badge-only SVG layered over existing gradient for non-claim nodes
function makeNodeBadgeSvg(
  label: string,
  hex: string,
  cr: number,
  cg: number,
  cb: number,
  nodeW: number,
  nodeH: number,
  bx = 22,
  by = 22,
): string {
  const fs = label.length > 3 ? 9 : 11;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nodeW}" height="${nodeH}">` +
    `<circle cx="${bx}" cy="${by}" r="15" fill="rgba(${cr},${cg},${cb},0.18)" stroke="${hex}" stroke-width="1.5" stroke-opacity="0.85"/>` +
    `<text x="${bx}" y="${by + 4}" text-anchor="middle" font-family="Courier New,monospace" fill="${hex}" font-size="${fs}" font-weight="800">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Register dagre layout
cytoscape.use(dagre);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface EdgeLabelOverlay {
  id: string;
  label: string;
  x: number;
  y: number;
  relation: "supports" | "refutes" | "related";
  sourceId: string;
  targetId: string;
  notes: string;
  claimLabel: string;
  taskClaimLabel?: string;
}

interface CytoscapeKnowGraphProps {
  nodes: GraphNode[];
  links: Link[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
  currentUserId?: number | null;
}

const CytoscapeKnowGraph: React.FC<CytoscapeKnowGraphProps> = ({
  nodes,
  links,
  onNodeClick,
  centerNodeId,
  currentUserId,
}) => {
  const { colorMode } = useColorMode();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const [authorDropdown, setAuthorDropdown] = useState<{
    authors: GraphNode[];
    position: { x: number; y: number };
    parentLabel: string;
    isPublishers?: boolean;
  } | null>(null);
  const [edgeLabelOverlays, setEdgeLabelOverlays] = useState<
    EdgeLabelOverlay[]
  >([]);
  const [selectedClaim, setSelectedClaim] = useState<SelectedClaim | null>(
    null,
  );
  const [publisherModal, setPublisherModal] = useState<{
    publisherId?: number;
    publisherName: string;
    admiraltyCode?: string;
  } | null>(null);

  // Update callback ref without triggering graph rebuild
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    if (!cyRef.current) {
      return;
    }
    const viewportWidth = cyRef.current.clientWidth;
    const viewportHeight = cyRef.current.clientHeight;

    if (nodes.length === 0) {
      return;
    }

    // Column positions - spread out more at full res to use horizontal space
    const isFullRes = viewportWidth >= 1280;
    const COLUMNS = isFullRes
      ? {
          CASE: 50,
          AUTH_PUB: 650,
          CASE_CLAIMS: 1350,
          SOURCE_CLAIMS: 2700,
          SOURCE_AUTH_PUB: 3350,
          SOURCES: 4000,
        }
      : {
          CASE: 50,
          AUTH_PUB: 550,
          CASE_CLAIMS: 1100,
          SOURCE_CLAIMS: 2200,
          SOURCE_AUTH_PUB: 2700,
          SOURCES: 3200,
        };

    const ROW_HEIGHT = 220; // Spacing between nodes vertically
    const START_Y = 100;

    // Filter to only show nodes connected by human-created claim_link edges
    // First, collect all claim IDs that are part of claim_links
    const claimIdsInLinks = new Set<string>();
    links.forEach((link) => {
      // claim_links have source and target in the format 'claim-{id}'
      if (
        link.source.startsWith("claim-") &&
        link.target.startsWith("claim-")
      ) {
        claimIdsInLinks.add(link.source);
        claimIdsInLinks.add(link.target);
      }
    });

    // Filter nodes by type and whether they're connected via claim_links
    const caseNodes = nodes.filter((n) => n.type === "task");
    const allAuthNodes = nodes.filter((n) => n.type === "author");
    const allPubNodes = nodes.filter((n) => n.type === "publisher");

    // Only include claims that have human-created claim_link connections
    const allCaseClaimNodes = nodes.filter((n) => n.type === "taskClaim");
    const allSourceClaimNodes = nodes.filter((n) => n.type === "refClaim");

    const caseClaimNodes = allCaseClaimNodes.filter((n) =>
      claimIdsInLinks.has(n.id),
    );
    const sourceClaimNodes = allSourceClaimNodes.filter((n) =>
      claimIdsInLinks.has(n.id),
    );

    // Only include sources that have at least one source claim with a claim_link
    const allSourceNodes = nodes.filter((n) => n.type === "reference");
    const linkedSourceContentIds = new Set(
      sourceClaimNodes.map((sc) => sc.content_id).filter(Boolean),
    );
    const sourceNodes = allSourceNodes.filter((n) =>
      linkedSourceContentIds.has(n.content_id),
    );

    // Build set of visible node IDs (case + visible sources)
    const visibleNodeIds = new Set([
      ...caseNodes.map((n) => n.id),
      ...sourceNodes.map((n) => n.id),
    ]);

    // Build author/publisher-to-parent maps in a single pass over the links.
    // An author/publisher is included if one end of its link is a visible content node.
    const authorsByParent = new Map<string, GraphNode[]>();
    const publishersByParent = new Map<string, GraphNode[]>();
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    links.forEach((link) => {
      const src = nodeById.get(link.source);
      const tgt = nodeById.get(link.target);
      if (!src || !tgt) return;

      // author ↔ visible-content
      if (src.type === "author" && visibleNodeIds.has(link.target)) {
        const bucket = authorsByParent.get(tgt.id) ?? [];
        if (!bucket.some((a) => a.id === src.id)) bucket.push(src);
        authorsByParent.set(tgt.id, bucket);
      } else if (tgt.type === "author" && visibleNodeIds.has(link.source)) {
        const bucket = authorsByParent.get(src.id) ?? [];
        if (!bucket.some((a) => a.id === tgt.id)) bucket.push(tgt);
        authorsByParent.set(src.id, bucket);
      }

      // publisher ↔ visible-content
      if (src.type === "publisher" && visibleNodeIds.has(link.target)) {
        const bucket = publishersByParent.get(tgt.id) ?? [];
        if (!bucket.some((p) => p.id === src.id)) bucket.push(src);
        publishersByParent.set(tgt.id, bucket);
      } else if (tgt.type === "publisher" && visibleNodeIds.has(link.source)) {
        const bucket = publishersByParent.get(src.id) ?? [];
        if (!bucket.some((p) => p.id === tgt.id)) bucket.push(tgt);
        publishersByParent.set(src.id, bucket);
      }
    });

    // Create composite author nodes (one per parent)
    const compositeAuthorNodes: any[] = [];
    authorsByParent.forEach((authors, parentId) => {
      const parent = nodes.find((n) => n.id === parentId);
      compositeAuthorNodes.push({
        id: `authors-${parentId}`,
        label:
          authors.length === 1 ? authors[0].label : `${authors.length} Authors`,
        type: "authorGroup",
        parentId,
        parentLabel: parent?.label || "",
        authors,
        badgeLabel: "Au",
      });
    });

    // Create composite publisher nodes (one per parent)
    const compositePubNodes: any[] = [];
    publishersByParent.forEach((publishers, parentId) => {
      const parent = nodes.find((n) => n.id === parentId);
      const firstPub = publishers[0] as any;
      compositePubNodes.push({
        id: `publishers-${parentId}`,
        label:
          publishers.length === 1
            ? publishers[0].label
            : `${publishers.length} Publishers`,
        type: "publisherGroup",
        parentId,
        parentLabel: parent?.label || "",
        publishers,
        // Carry publisher identity for SourceDetailModal and SourceCrest.
        // Prefer the publisher's own admiralty_code; fall back to the parent content node's code.
        publisher_id: firstPub?.publisher_id ?? null,
        admiralty_code:
          firstPub?.admiralty_code ?? (parent as any)?.admiralty_code ?? null,
        rating: firstPub?.rating ?? null,
        url: firstPub?.url ?? null,
        badgeLabel: "Pub",
      });
    });

    const authPubCompositeNodes = [
      ...compositeAuthorNodes,
      ...compositePubNodes,
    ];

    const maxRows = Math.max(
      caseNodes.length,
      authPubCompositeNodes.length,
      caseClaimNodes.length,
      sourceClaimNodes.length,
      sourceNodes.length,
    );

    // Center the case node vertically
    const centerY = START_Y + (maxRows * ROW_HEIGHT) / 2;

    // Position nodes
    const positionedNodes: any[] = [];

    // Case nodes - centered vertically
    caseNodes.forEach((node, i) => {
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
          badgeLabel: "Case",
        },
        position: { x: COLUMNS.CASE, y: centerY + i * ROW_HEIGHT },
      });
    });

    // Composite Auth/Pub nodes (grouped by parent) - position based on parent type
    // Initial positioning - will adjust source auth/pub in second pass below
    let caseAuthPubIndex = 0;
    let sourceAuthPubIndex = 0;
    authPubCompositeNodes.forEach((node) => {
      // Find parent node to determine its type
      const parentNode = nodes.find((n) => n.id === node.parentId);
      const isSourceParent = parentNode?.type === "reference";

      // Position source authors/publishers between source claims and sources
      // Position case authors/publishers in the original column
      const xPos = isSourceParent ? COLUMNS.SOURCE_AUTH_PUB : COLUMNS.AUTH_PUB;
      const yIndex = isSourceParent ? sourceAuthPubIndex++ : caseAuthPubIndex++;

      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          parentId: node.parentId,
          parentLabel: node.parentLabel,
          authors: node.authors,
          publishers: node.publishers,
          // publisher identity (undefined for authorGroup nodes)
          publisher_id: node.publisher_id ?? null,
          admiralty_code: node.admiralty_code ?? null,
          rating: node.rating ?? null,
          badgeLabel:
            node.badgeLabel ?? (node.type === "authorGroup" ? "Au" : "Pub"),
        },
        position: { x: xPos, y: START_Y + yIndex * ROW_HEIGHT },
      });
    });

    // Case claim nodes
    caseClaimNodes.forEach((node, i) => {
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
          badgeLabel: `C${i + 1}`,
        },
        position: { x: COLUMNS.CASE_CLAIMS, y: START_Y + i * ROW_HEIGHT },
      });
    });

    // Source claim nodes - position them first to establish order
    const sourceClaimPositions = new Map<string, number>();
    sourceClaimNodes.forEach((node, i) => {
      const yPos = START_Y + i * ROW_HEIGHT;
      sourceClaimPositions.set(node.id, yPos);
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
          badgeLabel: `E${i + 1}`,
        },
        position: { x: COLUMNS.SOURCE_CLAIMS, y: yPos },
      });
    });

    // Build source claim → source mapping to align sources with their claims
    const sourceToSourceClaims = new Map<string, string[]>();
    sourceClaimNodes.forEach((sourceClaim) => {
      const sourceNode = sourceNodes.find(
        (s) => s.content_id === sourceClaim.content_id,
      );
      if (sourceNode) {
        if (!sourceToSourceClaims.has(sourceNode.id)) {
          sourceToSourceClaims.set(sourceNode.id, []);
        }
        sourceToSourceClaims.get(sourceNode.id)!.push(sourceClaim.id);
      }
    });

    // Position sources aligned with their source claims (average Y position if multiple claims)
    const positionedSourceIds = new Set<string>();
    sourceNodes.forEach((node, sourceIdx) => {
      const relatedSourceClaims = sourceToSourceClaims.get(node.id) || [];
      let yPos: number;

      if (relatedSourceClaims.length > 0) {
        // Calculate average Y position of related source claims
        const claimYPositions = relatedSourceClaims
          .map((claimId) => sourceClaimPositions.get(claimId))
          .filter(Boolean) as number[];

        if (claimYPositions.length > 0) {
          yPos =
            claimYPositions.reduce((sum, y) => sum + y, 0) /
            claimYPositions.length;
        } else {
          // Fallback if no positions found
          yPos = START_Y + sourceNodes.indexOf(node) * ROW_HEIGHT;
        }
      } else {
        // No related claims, use default positioning
        yPos = START_Y + sourceNodes.indexOf(node) * ROW_HEIGHT;
      }

      positionedSourceIds.add(node.id);
      positionedNodes.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          content_id: node.content_id,
          claim_id: node.claim_id,
          author_id: node.author_id,
          publisher_id: node.publisher_id,
          url: node.url,
          badgeLabel: `S${sourceIdx + 1}`,
        },
        position: { x: COLUMNS.SOURCES, y: yPos },
      });
    });

    // Build position lookup for nodes (both x and y)
    const nodePositions = new Map<string, number>();
    const nodeYPositions = new Map<string, number>();
    positionedNodes.forEach((node) => {
      nodePositions.set(node.data.id, node.position.x);
      nodeYPositions.set(node.data.id, node.position.y);
    });

    // Second pass: Reposition source authors/publishers near their parent sources
    authPubCompositeNodes.forEach((compositeNode) => {
      const parentNode = nodes.find((n) => n.id === compositeNode.parentId);
      const isSourceParent = parentNode?.type === "reference";

      if (isSourceParent) {
        // Find this composite node in positionedNodes and update its Y position
        const positionedNode = positionedNodes.find(
          (n) => n.data.id === compositeNode.id,
        );
        if (positionedNode) {
          const parentYPos = nodeYPositions.get(compositeNode.parentId);
          if (parentYPos !== undefined) {
            // Authors above source, publishers below — offset must exceed half ROW_HEIGHT to prevent overlap
            const isPublisher = compositeNode.type === "publisherGroup";
            const yOffset = isPublisher ? 165 : -165;
            positionedNode.position.y = parentYPos + yOffset;
            nodeYPositions.set(compositeNode.id, parentYPos + yOffset);
          }
        }
      }
    });

    // Map individual author/publisher IDs to their composite node IDs
    const authorToComposite = new Map<string, string>();
    const publisherToComposite = new Map<string, string>();

    authorsByParent.forEach((authors, parentId) => {
      const compositeId = `authors-${parentId}`;
      authors.forEach((author) => {
        authorToComposite.set(author.id, compositeId);
      });
    });

    publishersByParent.forEach((publishers, parentId) => {
      const compositeId = `publishers-${parentId}`;
      publishers.forEach((pub) => {
        publisherToComposite.set(pub.id, compositeId);
      });
    });

    // Build a set of all valid node IDs after filtering
    const validNodeIds = new Set(positionedNodes.map((n) => n.data.id));

    // Prepare edges for cytoscape - redirect to composite nodes and filter out broken edges
    const cyEdges = links
      .filter((link) => {
        if (link.source === link.target) {
          return false;
        }
        return true;
      })
      .map((link, idx) => {
        let finalSource = link.source;
        let finalTarget = link.target;

        // Redirect author/publisher edges to composite nodes
        if (authorToComposite.has(finalSource)) {
          finalSource = authorToComposite.get(finalSource)!;
        }
        if (authorToComposite.has(finalTarget)) {
          finalTarget = authorToComposite.get(finalTarget)!;
        }
        if (publisherToComposite.has(finalSource)) {
          finalSource = publisherToComposite.get(finalSource)!;
        }
        if (publisherToComposite.has(finalTarget)) {
          finalTarget = publisherToComposite.get(finalTarget)!;
        }

        // Determine edge direction based on X positions
        const sourceX = nodePositions.get(finalSource) || 0;
        const targetX = nodePositions.get(finalTarget) || 0;
        const isLeftToRight = sourceX < targetX;

        const rel = link.relation || "meta";
        const conf = (link as any).confidence;
        const val = link.value;
        // Compute a short weight label for claim-to-claim edges
        let edgeLabel = "";
        if (rel === "supports" || rel === "refutes" || rel === "related") {
          const pct =
            conf != null
              ? Math.round(conf * 100)
              : val != null
                ? Math.round(Math.abs(val) * 100)
                : null;
          if (pct != null) {
            const sign =
              rel === "supports" ? "+" : rel === "refutes" ? "−" : "~";
            edgeLabel = `${sign}${pct}%`;
          }
        }

        return {
          data: {
            id: `edge-${idx}`,
            source: finalSource,
            target: finalTarget,
            relation: rel,
            type: link.type || "",
            notes: link.notes || "",
            value: val ?? null,
            confidence: conf ?? null,
            edgeLabel,
            isLeftToRight,
          },
        };
      })
      .filter((edge) => {
        // Only include edges where both source and target nodes exist
        const sourceExists = validNodeIds.has(edge.data.source);
        const targetExists = validNodeIds.has(edge.data.target);

        if (!sourceExists || !targetExists) {
          return false;
        }

        // Filter out direct edges from case (task) to source (reference)
        const sourceNode = nodes.find((n) => n.id === edge.data.source);
        const targetNode = nodes.find((n) => n.id === edge.data.target);

        if (
          (sourceNode?.type === "task" && targetNode?.type === "reference") ||
          (sourceNode?.type === "reference" && targetNode?.type === "task")
        ) {
          return false; // Don't show case-to-source edges
        }

        return true;
      });

    // Add edges from Case to all Case Claims
    const caseNode = caseNodes[0];
    if (caseNode) {
      caseClaimNodes.forEach((claimNode, idx) => {
        cyEdges.push({
          data: {
            id: `case-to-claim-${idx}`,
            source: caseNode.id,
            target: claimNode.id,
            relation: "contains",
            type: "contains",
            notes: "",
            value: null,
            confidence: null,
            edgeLabel: "",
            isLeftToRight: true,
          },
        });
      });
    }

    // Add edges from Source Claims to Sources
    // Each refClaim node has a content_id that tells us which source it belongs to
    let sourceClaimToSourceEdgeCount = 0;
    sourceClaimNodes.forEach((sourceClaimNode) => {
      // Find the source node that matches this claim's content_id
      const sourceNode = sourceNodes.find(
        (n) => n.content_id === sourceClaimNode.content_id,
      );

      if (sourceNode) {
        cyEdges.push({
          data: {
            id: `sourceclaim-to-source-${sourceClaimNode.id}-${sourceNode.id}`,
            source: sourceClaimNode.id,
            target: sourceNode.id,
            relation: "sourceClaim",
            type: "sourceClaim",
            notes: "",
            value: null,
            confidence: null,
            edgeLabel: "",
            isLeftToRight: true,
          },
        });
        sourceClaimToSourceEdgeCount++;
      }
    });
    const clampWords = (text: string, maxChars = 135) => {
      if (!text) return "";

      if (text.length <= maxChars) return text;

      const trimmed = text.slice(0, maxChars);
      const lastSpace = trimmed.lastIndexOf(" ");

      return `${trimmed.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
    };
    // Initialize cytoscape
    const cy = cytoscape({
      container: cyRef.current,
      elements: {
        nodes: positionedNodes,
        edges: cyEdges,
      },
      style: [
        // Node styles - original sizes
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "220px",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "12px",
            "font-weight": 700,
            color: "#ecf4ff",
            "text-outline-color": "#0b1120",
            "text-outline-width": 1.25,
          } as any,
        },
        // Case node - LARGE circle
        {
          selector: 'node[type="task"]',
          style: {
            shape: "ellipse",
            width: 360,
            height: 300,
            "background-fill": "linear-gradient",
            "background-gradient-direction": "to-right",
            "background-gradient-stop-colors":
              "rgba(113,219,255,0.5) rgba(17,39,70,0.97)",
            "background-gradient-stop-positions": "0% 45%",
            "background-image": (ele: any) =>
              makeNodeBadgeSvg(
                ele.data("badgeLabel") || "Case",
                "#71dbff",
                113,
                219,
                255,
                360,
                300,
                38,
                72,
              ),
            "background-width": "100%",
            "background-height": "100%",
            "border-width": 2.5,
            "border-color": "rgba(113, 219, 255, 0.75)",
            "font-size": "30px",
            "text-max-width": "320px",
            "text-outline-width": 0,
            "text-margin-y": 0,
            padding: "8px",
          } as any,
        },
        // Case claims - file-folder shape via SVG overlay (tab=36 + body=148 = 184px total)
        {
          selector: 'node[type="taskClaim"]',
          style: {
            shape: "rectangle",
            width: 700,
            height: 184,
            "background-opacity": 0,
            "background-color": "transparent",
            "border-width": 0,
            "border-opacity": 0,
            "overlay-opacity": 0,
            "background-image": (ele: any) =>
              makeClaimNodeSvg(
                ele.data("badgeLabel") || "C?",
                "#a78bfa",
                "rgba(25,16,60,0.97)",
                139,
                92,
                246,
                690,
                184,
                "CLAIM",
              ),

            "background-width": "97%",
            "background-height": "97%",
            "background-clip": "none",
            "bounds-expansion": 12,

            label: (ele: any) => clampWords(ele.data("label"), 135),
            "font-size": "30px",
            "text-wrap": "wrap",
            "text-max-width": "620px",
            "text-outline-width": 0,
            "text-margin-y": 6,
            padding: "10px",
          } as any,
        },
        // Source claims - file-folder shape via SVG overlay
        {
          selector: 'node[type="refClaim"]',
          style: {
            shape: "rectangle",

            width: 700,
            height: 184,

            // Make Cytoscape's own rectangle invisible
            "background-opacity": 0,
            "background-color": "transparent",
            "background-blacken": 0,
            "border-width": 0,
            "border-opacity": 0,
            "overlay-opacity": 0,

            // SVG card
            "background-image": (ele: any) =>
              makeClaimNodeSvg(
                ele.data("badgeLabel") || "E?",
                "#71dbff",
                "rgba(8,26,50,0.97)",
                113,
                219,
                255,
                690,
                184,
                "EVIDENCE",
              ),

            "background-fit": "none",
            "background-width": "97%",
            "background-height": "97%",
            "background-position-x": "50%",
            "background-position-y": "50%",
            "background-clip": "none",

            "bounds-expansion": 12,

            label: (ele: any) => clampWords(ele.data("label"), 135),
            "font-size": "30px",
            "text-wrap": "wrap",
            "text-max-width": "620px",
            "text-outline-width": 0,
            "text-margin-y": 6,
            padding: "10px",
          } as any,
        },
        // Sources - larger diamonds; badge near top corner of diamond
        {
          selector: 'node[type="reference"]',
          style: {
            shape: "diamond",
            width: 320,
            height: 210,
            "background-fill": "linear-gradient",
            "background-gradient-direction": "to-right",
            "background-gradient-stop-colors":
              "rgba(74,222,128,0.45) rgba(18,53,36,0.97)",
            "background-gradient-stop-positions": "0% 45%",
            "background-image": (ele: any) =>
              makeNodeBadgeSvg(
                ele.data("badgeLabel") || "S?",
                "#4ade80",
                74,
                222,
                128,
                320,
                210,
                160,
                32,
              ),
            "background-width": "100%",
            "background-height": "100%",
            "border-width": 3,
            "border-color": "rgba(74, 222, 128, 0.75)",
            "font-size": "26px",
            "text-max-width": "270px",
            "text-outline-width": 0,
            padding: "8px",
          } as any,
        },
        // Author groups - composite nodes
        {
          selector: 'node[type="authorGroup"]',
          style: {
            shape: "ellipse",
            width: 132,
            height: 92,
            "background-fill": "linear-gradient",
            "background-gradient-direction": "to-right",
            "background-gradient-stop-colors":
              "rgba(255,143,183,0.45) rgba(43,21,32,0.97)",
            "background-gradient-stop-positions": "0% 40%",
            "background-image": (ele: any) =>
              makeNodeBadgeSvg(
                ele.data("badgeLabel") || "Au",
                "#ff8fb7",
                255,
                143,
                183,
                132,
                92,
                22,
                22,
              ),
            "background-width": "100%",
            "background-height": "100%",
            "border-width": 2.5,
            "border-color": "rgba(255, 143, 183, 0.7)",
            "font-size": "26px",
            "text-wrap": "wrap",
            "text-max-width": "118px",
            "text-outline-width": 0,
            label: (ele: any) => (ele.data("label") || "") + "\nAUTHOR",
            padding: "6px",
          } as any,
        },
        // Publisher groups - just the SourceCrest icon, no enclosing circle
        {
          selector: 'node[type="publisherGroup"]',
          style: {
            shape: "rectangle",
            width: 120,
            height: 120,
            "background-image": (ele: any) => {
              return getSourceCrestDataUri(
                ele.data("admiralty_code") ?? undefined,
                96,
              );
            },
            "background-fit": "contain",
            "background-clip": "none",
            "background-fill": "solid",
            "background-color": "rgba(0,0,0,0)",
            "border-width": 0,
            "font-size": "18px",
            "font-weight": 700,
            "text-max-width": "120px",
            "text-valign": "bottom",
            "text-margin-y": 8,
          } as any,
        },
        // Default edge style - curved lines
        {
          selector: "edge",
          style: {
            width: 6,
            "curve-style": "unbundled-bezier",
            "control-point-distances": [24, -24],
            "control-point-weights": [0.28, 0.72],
            "target-arrow-shape": "triangle",
            "target-arrow-color": "data(color)",
            "line-color": "data(color)",
            opacity: 0.7,
          } as any,
        },
        // Left-to-right edges (source on left, target on right) - exit right, enter left
        {
          selector: "edge[?isLeftToRight]",
          style: {
            "source-endpoint": "90deg", // Right side of source
            "target-endpoint": "270deg", // Left side of target
          } as any,
        },
        // Right-to-left edges (source on right, target on left) - exit left, enter right
        {
          selector: "edge[!isLeftToRight]",
          style: {
            "source-endpoint": "270deg", // Left side of source
            "target-endpoint": "90deg", // Right side of target
          } as any,
        },
        // Case to Case Claim edges - thick blue
        {
          selector: 'edge[relation="contains"]',
          style: {
            "line-color": "#6ea8ff",
            "target-arrow-color": "#6ea8ff",
            width: 8,
            opacity: 0.82,
          } as any,
        },
        // Source Claim to Source edges - solid blue
        {
          selector: 'edge[relation="sourceClaim"]',
          style: {
            "line-color": "#58d6ff",
            "target-arrow-color": "#58d6ff",
            width: 6,
            opacity: 0.74,
          } as any,
        },
        // Support edges - vibrant green
        {
          selector: 'edge[relation="supports"]',
          style: {
            "line-color": "#4ade80",
            "target-arrow-color": "#4ade80",
          } as any,
        },
        // Refute edges - vibrant red
        {
          selector: 'edge[relation="refutes"]',
          style: {
            "line-color": "#f87171",
            "target-arrow-color": "#f87171",
          } as any,
        },
        // Related/nuance edges - vibrant blue
        {
          selector: 'edge[relation="related"]',
          style: {
            "line-color": "#60a5fa",
            "target-arrow-color": "#60a5fa",
          } as any,
        },
        // Metadata edges (author/publisher) - haystack for visible stacking of multiple edges
        {
          selector: 'edge[relation="meta"]',
          style: {
            "curve-style": "haystack",
            "haystack-radius": 0.3, // How much the edges spread out
            "line-color": "rgba(172, 189, 220, 0.7)",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "rgba(172, 189, 220, 0.7)",
            opacity: 0.55,
            width: 4,
          } as any,
        },
      ],
      layout: {
        name: "preset", // Use preset positions
      } as any,
      zoomingEnabled: true,
      userZoomingEnabled: true,
    });

    // Store instance
    cyInstance.current = cy;
    window.__veristrataKnowGraphCy = cy;

    // COMPLETELY disable normal wheel zoom - only shift+wheel
    cy.userZoomingEnabled(false);

    // Enable node dragging
    cy.nodes().forEach((node) => {
      node.grabify();
    });

    // Click handler
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const data = node.data();

      // Author group → dropdown
      if (data.type === "authorGroup" && data.authors?.length > 0) {
        const renderedPos = node.renderedPosition();
        setAuthorDropdown({
          authors: data.authors,
          position: { x: renderedPos.x, y: renderedPos.y },
          parentLabel: data.parentLabel,
          isPublishers: false,
        });
        return;
      }

      // Publisher group → SourceDetailModal (single) or dropdown (multiple)
      if (data.type === "publisherGroup") {
        const pubs: GraphNode[] = data.publishers ?? [];
        if (pubs.length > 1) {
          const renderedPos = node.renderedPosition();
          setAuthorDropdown({
            authors: pubs,
            position: { x: renderedPos.x, y: renderedPos.y },
            parentLabel: data.parentLabel,
            isPublishers: true,
          });
        } else {
          const pub = pubs[0] as any;
          setPublisherModal({
            publisherId: pub?.publisher_id ?? data.publisher_id ?? undefined,
            publisherName: pub?.label ?? data.label ?? "",
            admiraltyCode: data.admiralty_code ?? undefined,
          });
        }
        return;
      }

      // Claim nodes → ClaimModal
      if (data.type === "refClaim" || data.type === "taskClaim") {
        const claimEdges = node.connectedEdges().filter((e: any) => {
          const rel = e.data("relation");
          return rel === "supports" || rel === "refutes" || rel === "related";
        });

        if (claimEdges.length > 0) {
          const edge = claimEdges[0];
          const srcNode = cy.getElementById(edge.data("source"));
          const tgtNode = cy.getElementById(edge.data("target"));
          const isRef = data.type === "refClaim";
          const refNode = isRef ? node : srcNode;
          const taskNode = isRef ? tgtNode : node;

          setSelectedClaim({
            id: data.id,
            label: refNode.data("label") ?? "",
            taskClaimLabel: taskNode.data("label") ?? "",
            relation: edge.data("relation") ?? "related",
            notes: edge.data("notes") ?? "",
          });
        } else {
          // No connected edge — show just this claim
          setSelectedClaim({
            id: data.id,
            label: data.label ?? "",
            relation: "related",
            notes: "",
          });
        }
        return;
      }

      if (onNodeClickRef.current) {
        const graphNode = new GraphNode(
          data.id,
          data.label,
          data.type,
          node.position("x"),
          node.position("y"),
          data.url,
          data.content_id,
          data.claim_id,
          data.publisher_id,
          data.author_id,
        );
        onNodeClickRef.current(graphNode);
      }
    });

    // Enable zoom ONLY with shift+wheel - use a toggle approach instead
    let lastScrollDirection = 0;
    const container = cyRef.current;
    if (container) {
      container.addEventListener(
        "wheel",
        (e) => {
          if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();

            const currentZoom = cy.zoom();

            // Check if scroll direction changed (helps detect actual scroll intent)
            // Use wheelDelta if available (for better cross-browser support)
            const delta = e.deltaY || -(e as any).wheelDelta;

            // Determine zoom direction - alternate between zoom in and out based on scroll
            // This avoids the -0 issue
            let newZoom;
            if (Math.abs(delta) < 1) {
              // Very small delta, toggle based on last direction
              lastScrollDirection = lastScrollDirection === 1 ? -1 : 1;
            } else {
              lastScrollDirection = delta > 0 ? 1 : -1;
            }

            if (lastScrollDirection < 0) {
              // ZOOM IN
              newZoom = currentZoom * 1.15;
            } else {
              // ZOOM OUT
              newZoom = currentZoom * 0.85;
            }

            // Get center of viewport
            const pan = cy.pan();
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            const centerX = containerWidth / 2;
            const centerY = containerHeight / 2;

            // Calculate zoom around center point
            const zoomPoint = {
              x: (centerX - pan.x) / currentZoom,
              y: (centerY - pan.y) / currentZoom,
            };

            cy.zoom({
              level: newZoom,
              position: zoomPoint,
            });
          }
          // If no shift key, do nothing - allows normal page scroll
        },
        { passive: false },
      );
    }

    // Set viewport - fit height, start at left edge
    // STEP 2: Get graph bounding box
    const boundingBox = cy.elements().boundingBox();
    const graphWidth = boundingBox.w;
    const graphHeight = boundingBox.h;
    const graphLeftEdge = boundingBox.x1;
    const graphCenterY = boundingBox.y1 + graphHeight / 2;

    // STEP 3: Calculate zoom - fit both dimensions to ensure graph never extends beyond viewport
    const paddingPercentHeight = viewportWidth < 1280 ? 0.95 : 0.92;
    const paddingPercentWidth = viewportWidth < 1280 ? 0.95 : 0.95;
    const availableHeight = viewportHeight * paddingPercentHeight;
    const availableWidth = viewportWidth * paddingPercentWidth;

    const zoomForHeight = availableHeight / graphHeight;
    const zoomForWidth = availableWidth / graphWidth;

    // Always use min to ensure graph fits in both dimensions
    const optimalZoom = Math.min(zoomForHeight, zoomForWidth);

    // STEP 4: Apply zoom and position at left edge
    // Smaller padding on smaller viewports
    const leftPadding = viewportWidth < 1280 ? 30 : 50;
    cy.zoom(optimalZoom);
    cy.pan({
      x: leftPadding - graphLeftEdge * optimalZoom,
      y: viewportHeight / 2 - graphCenterY * optimalZoom,
    });

    // Edge label HTML overlays — recompute screen positions on any viewport change
    const computeOverlays = () => {
      const overlays: EdgeLabelOverlay[] = [];
      const zoom = cy.zoom();
      const pan = cy.pan();
      cy.edges().forEach((edge) => {
        const label = edge.data("edgeLabel");
        if (!label) return;
        const rel = edge.data("relation");
        if (rel !== "supports" && rel !== "refutes" && rel !== "related")
          return;
        const midpoint = edge.midpoint();
        const screenX = midpoint.x * zoom + pan.x;
        const screenY = midpoint.y * zoom + pan.y;
        const srcNodeId = edge.data("source");
        const tgtNodeId = edge.data("target");
        const srcNode = cy.getElementById(srcNodeId);
        const tgtNode = cy.getElementById(tgtNodeId);
        const isRefSource = srcNode.data("type") === "refClaim";
        const refNode = isRefSource ? srcNode : tgtNode;
        const taskNode = isRefSource ? tgtNode : srcNode;
        overlays.push({
          id: edge.id(),
          label,
          x: screenX,
          y: screenY,
          relation: rel as "supports" | "refutes" | "related",
          sourceId: srcNodeId,
          targetId: tgtNodeId,
          notes: edge.data("notes") ?? "",
          claimLabel: refNode.data("label") ?? "",
          taskClaimLabel: taskNode.data("label") ?? "",
        });
      });
      setEdgeLabelOverlays(overlays);
    };
    computeOverlays();
    cy.on("viewport", computeOverlays);
    cy.on("free", computeOverlays);

    // Add resize observer to refit graph when container size changes
    // Throttle to prevent excessive recalculations
    let resizeTimeout: NodeJS.Timeout | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      // Clear pending timeout
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      // Debounce resize handling - only run 500ms after resize stops (increased for prod stability)
      resizeTimeout = setTimeout(() => {
        for (const entry of entries) {
          const newWidth = entry.contentRect.width;
          const newHeight = entry.contentRect.height;

          // Guard against invalid measurements and skip if dimensions haven't actually changed
          if (
            newWidth > 0 &&
            newHeight > 0 &&
            (newWidth !== viewportWidth || newHeight !== viewportHeight)
          ) {
            // Recalculate fit based on new container size
            const boundingBox = cy.elements().boundingBox();
            const graphWidth = boundingBox.w;
            const graphHeight = boundingBox.h;
            const graphLeftEdge = boundingBox.x1;
            const graphCenterY = boundingBox.y1 + graphHeight / 2;

            // Fit both dimensions to ensure graph never extends beyond viewport
            const paddingPercentHeight = newWidth < 1280 ? 0.95 : 0.92;
            const paddingPercentWidth = newWidth < 1280 ? 0.95 : 0.95;
            const availableHeight = newHeight * paddingPercentHeight;
            const availableWidth = newWidth * paddingPercentWidth;

            const zoomForHeight = availableHeight / graphHeight;
            const zoomForWidth = availableWidth / graphWidth;
            const optimalZoom = Math.min(zoomForHeight, zoomForWidth);

            // Adaptive left padding
            const leftPadding = newWidth < 1280 ? 30 : 50;
            cy.zoom(optimalZoom);
            cy.pan({
              x: leftPadding - graphLeftEdge * optimalZoom,
              y: newHeight / 2 - graphCenterY * optimalZoom,
            });
          }
        }
      }, 500);
    });

    if (cyRef.current) {
      resizeObserver.observe(cyRef.current);
    }

    // Cleanup
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      cy.off("viewport", computeOverlays);
      cy.off("free", computeOverlays);
      setEdgeLabelOverlays([]);
      if (window.__veristrataKnowGraphCy === cy) {
        window.__veristrataKnowGraphCy = null;
      }
      cy.destroy();
    };
  }, [nodes, links]);

  return (
    <Box position="relative" width="100%" height="100%">
      <Box
        ref={cyRef}
        width="100%"
        height="100%"
        bg={colorMode === "dark" ? "transparent" : "gray.50"}
        borderRadius="lg"
      />

      {/* Edge weight label overlays — prominent HTML chips over claim-to-claim edges */}
      {edgeLabelOverlays.map((overlay) => {
        const color =
          overlay.relation === "supports"
            ? "#4ade80"
            : overlay.relation === "refutes"
              ? "#f87171"
              : "#60a5fa";
        return (
          <Box
            key={overlay.id}
            position="absolute"
            left={`${overlay.x}px`}
            top={`${overlay.y}px`}
            transform="translate(-50%, -50%)"
            bg="rgba(8, 14, 24, 0.88)"
            color={color}
            fontSize="12px"
            fontWeight={700}
            px={2}
            py={0.5}
            borderRadius="10px"
            border={`1px solid ${color}`}
            boxShadow={`0 0 10px ${color}33`}
            cursor="pointer"
            zIndex={50}
            pointerEvents="all"
            letterSpacing="0.06em"
            userSelect="none"
            onClick={() => {
              setSelectedClaim({
                id: overlay.sourceId,
                label: overlay.claimLabel,
                taskClaimLabel: overlay.taskClaimLabel,
                relation: overlay.relation,
                notes: overlay.notes,
              });
            }}
          >
            {overlay.label}
          </Box>
        );
      })}

      {/* Author/Publisher dropdown overlay */}
      {authorDropdown && (
        <>
          <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            onClick={() => setAuthorDropdown(null)}
            zIndex={100}
          />
          <Box
            position="absolute"
            left={`${authorDropdown.position.x + 60}px`}
            top={`${authorDropdown.position.y}px`}
            bg="rgba(8, 14, 24, 0.96)"
            border={`1px solid ${authorDropdown.isPublishers ? "rgba(255, 191, 105, 0.4)" : "rgba(255, 143, 183, 0.4)"}`}
            borderRadius="12px"
            p={3}
            boxShadow="0 8px 32px rgba(0, 0, 0, 0.7)"
            zIndex={101}
            minW="220px"
            maxH="400px"
            overflowY="auto"
          >
            <Box
              fontSize="xs"
              color={authorDropdown.isPublishers ? "#ffbf69" : "#ff8fb7"}
              fontWeight={700}
              mb={2}
            >
              {authorDropdown.isPublishers ? "Publishers" : "Authors"} for{" "}
              {authorDropdown.parentLabel}
            </Box>
            {authorDropdown.authors.map((item, idx) => (
              <Box
                key={idx}
                p={2}
                mb={1}
                bg={
                  authorDropdown.isPublishers
                    ? "rgba(255, 191, 105, 0.12)"
                    : "rgba(255, 143, 183, 0.12)"
                }
                borderRadius="md"
                border={`1px solid ${authorDropdown.isPublishers ? "rgba(255, 191, 105, 0.25)" : "rgba(255, 143, 183, 0.25)"}`}
                _hover={{
                  bg: authorDropdown.isPublishers
                    ? "rgba(255, 191, 105, 0.22)"
                    : "rgba(255, 143, 183, 0.22)",
                  cursor: "pointer",
                }}
                fontSize="xs"
                color="gray.200"
                onClick={() => {
                  if (authorDropdown.isPublishers) {
                    const pub = item as any;
                    setPublisherModal({
                      publisherId: pub.publisher_id ?? undefined,
                      publisherName: item.label ?? "",
                      admiraltyCode: pub.admiralty_code ?? undefined,
                    });
                    setAuthorDropdown(null);
                  }
                }}
              >
                {item.label}
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* Claim detail modal */}
      {selectedClaim && (
        <ClaimModal
          claim={selectedClaim}
          onClose={() => setSelectedClaim(null)}
        />
      )}

      {/* Publisher / SourceCrest detail modal */}
      {publisherModal && (
        <SourceDetailModal
          isOpen
          onClose={() => setPublisherModal(null)}
          publisherId={publisherModal.publisherId}
          publisherName={publisherModal.publisherName}
          admiraltyCode={publisherModal.admiraltyCode}
        />
      )}
    </Box>
  );
};

export default CytoscapeKnowGraph;
