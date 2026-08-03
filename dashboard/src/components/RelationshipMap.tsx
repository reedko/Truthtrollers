// src/components/RelationshipMap.tsx
import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box } from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import {
  relationPresentation,
  WorkspaceClaimLink,
} from "./evidenceLinkPresentation";

export type ClaimLink = WorkspaceClaimLink;

interface RelationshipMapProps {
  contentId: number;
  leftItems: Claim[];
  rightItems: ReferenceWithClaims[];
  rowHeight: number;
  topOffset: number;
  height: number;
  leftX: number;
  rightX: number;
  onLineClick?: (link: ClaimLink) => void;
  onLineHover?: (link: ClaimLink) => void;
  claimLinks: ClaimLink[];
  isModalOpen?: boolean;
}

const RelationshipMap: React.FC<RelationshipMapProps> = ({
  contentId,
  leftItems,
  rightItems,
  rowHeight,
  topOffset,
  height,
  leftX,
  rightX,
  onLineClick,
  onLineHover,
  claimLinks,
  isModalOpen = false,
}) => {
  const [leftCenters, setLeftCenters] = useState<Record<number, number>>({});
  const [rightCenters, setRightCenters] = useState<Record<number, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const adjustedLeftX = leftX - 12;
  const adjustedRightX = rightX + 15;

  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  useLayoutEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const containerTop = containerRef.current.getBoundingClientRect().top;
      const claimNodes = document.querySelectorAll<HTMLElement>("[data-claim-id]");
      const refNodes = document.querySelectorAll<HTMLElement>("[data-ref-id]");
      const nextLeftCenters: Record<number, number> = {};
      const nextRightCenters: Record<number, number> = {};

      claimNodes.forEach((el) => {
        const id = Number(el.dataset.claimId);
        const r = el.getBoundingClientRect();
        nextLeftCenters[id] = r.top - containerTop + r.height / 2;
      });

      refNodes.forEach((el) => {
        const id = Number(el.dataset.refId);
        const r = el.getBoundingClientRect();
        nextRightCenters[id] = r.top - containerTop + r.height / 2;
      });

      setLeftCenters(nextLeftCenters);
      setRightCenters(nextRightCenters);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [leftItems, rightItems, height]);

  const links = claimLinks;
  const lightweightMode =
    links.length > 80 || leftItems.length > 60 || rightItems.length > 60;

  const getLeftY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset;

  const getRightY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset;

  // Build lookup maps: claim ID → index in leftItems; reference ID → index in rightItems.
  const leftIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    leftItems.forEach((item, index) => map.set(item.claim_id, index));
    return map;
  }, [leftItems]);

  const rightIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    rightItems.forEach((ref, index) =>
      map.set(ref.reference_content_id, index)
    );
    return map;
  }, [rightItems]);

  if (
    !leftItems.length ||
    !rightItems.length ||
    !links.length ||
    leftX === 0 ||
    rightX === 0 // 👈 instead of containerX === 0// 👈 prevent premature render
  ) {
    return null;
  }
  if (!leftItems.length || !rightItems.length || !links.length) {
    return null;
  }

  return (
    <Box
      ref={containerRef}
      position="relative"
      width="100%"
      height={`${height}px`}
    >
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "auto", // let events pass through by default
          //background: "rgba(255,255,0,0.2)",
        }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="16"
            markerHeight="4"
            refX="1"
            refY="2"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="16 0, 0 2, 16 4" fill="blue" />
          </marker>
        </defs>

        {links.map((link, i) => {
          const leftIndex = leftIndexMap.get(Number(link.claimId));
          const rightIndex = rightIndexMap.get(Number(link.referenceId));
          if (leftIndex === undefined || rightIndex === undefined) {
            return null;
          }
          const y1 = leftCenters[Number(link.claimId)] ?? getLeftY(leftIndex);

          const y2 =
            rightCenters[Number(link.referenceId)] ?? getRightY(rightIndex);

          const isAISuggested = link.linkKind !== "human";
          const presentation = relationPresentation(link.relation, link.linkKind);
          const strokeColor = isAISuggested
            ? presentation.aiStrokeColor
            : presentation.baseColor;

          // Create unique key using ALL identifying properties to ensure uniqueness
          const linkId = `${link.claimId}-${link.referenceId}-${link.sourceClaimId || 'none'}-${link.relation}-${i}`;

          const handleMouseEnter = () => {
            if (lightweightMode) return;
            setHoveredLinkId(linkId);
            // Clear any existing timeout
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
            // Set 2-second timeout to trigger onLineHover
            hoverTimeoutRef.current = setTimeout(() => {
              onLineHover?.(link);
            }, 2000);
          };

          const handleMouseLeave = () => {
            if (lightweightMode) return;
            setHoveredLinkId(null);
            // Clear timeout if user stops hovering
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
              hoverTimeoutRef.current = null;
            }
          };

          // Apply fade effect when modal is open
          const opacity = isModalOpen ? 0.15 : 1;
          const activeOpacity = hoveredLinkId === linkId ? 1 : opacity;
          const visibleOpacity = lightweightMode
            ? isModalOpen
              ? 0.1
              : isAISuggested
                ? 0.72
                : 0.55
            : activeOpacity;

          return (
            <g
              key={linkId}
              onClick={lightweightMode ? undefined : () => onLineClick?.(link)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              style={{
                cursor: lightweightMode ? "default" : "pointer",
                pointerEvents: lightweightMode ? "none" : "auto",
              }}
            >
              {/* Invisible thicker line for easier hover detection */}
              {!lightweightMode && (
                <line
                  x1={adjustedLeftX}
                  y1={y1}
                  x2={adjustedRightX}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ cursor: "pointer", pointerEvents: "auto" }}
                />
              )}

              {!lightweightMode && (
                <>
                  <circle
                    cx={adjustedLeftX}
                    cy={y1}
                    r="8"
                    fill="blue"
                    opacity={activeOpacity}
                  />
                  <circle
                    cx={adjustedRightX}
                    cy={y2}
                    r="8"
                    fill="red"
                    opacity={activeOpacity}
                  />
                </>
              )}

              <title>
                {link.linkKind === "document-discovery"
                  ? `${presentation.label} • ${link.discoveryStatus || "unassessed"}`
                  : `${isAISuggested ? "🤖 AI " : "✓ "}${presentation.label} • ${Math.abs(link.confidence * 100).toFixed(0)}%`}
              </title>

              {/* Visible line */}
              <line
                x1={adjustedLeftX}
                y1={y1}
                x2={adjustedRightX}
                y2={y2}
                stroke={strokeColor}
                strokeWidth={lightweightMode ? (isAISuggested ? 3 : 2.5) : hoveredLinkId === linkId ? 6 : 4}
                strokeDasharray={presentation.dotted ? "8,4" : undefined}
                markerStart={lightweightMode ? undefined : "url(#arrowhead)"}
                opacity={visibleOpacity}
                style={{
                  cursor: lightweightMode ? "default" : "pointer",
                  pointerEvents: lightweightMode ? "none" : "auto",
                }}
              />
            </g>
          );
        })}
      </svg>
    </Box>
  );
};

export default RelationshipMap;
