// src/components/RelationshipMap.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import { fetchClaimsAndLinkedReferencesForTask } from "../services/useDashboardAPI";

export interface ClaimLink {
  id?: string;
  claim_link_id?: number; // for future use
  claimId: number; // target/task claim
  referenceId: number; // reference content id
  sourceClaimId: number; // 👈 new
  relation: "support" | "refute";
  confidence: number;
}

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerX, setContainerX] = useState(0);
  const adjustedLeftX = leftX - containerX - 12;
  const adjustedRightX = rightX - containerX + 15;

  useEffect(() => {
    const timeout = setTimeout(() => {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setContainerX(rect.x);
        }
      });
    }, 50); // ← no delay, just wait for browser to do one frame

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    console.log("📦 containerX updated:", containerX);
  }, [containerX]);

  const [links, setLinks] = useState<ClaimLink[]>([]);
  useEffect(() => {
    fetchClaimsAndLinkedReferencesForTask(contentId)
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
        }));
        setLinks(formattedLinks);
      })
      .catch((error) => {
        console.error("Error fetching claim links:", error);
      });
  }, [contentId]);
  const getLeftY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset;

  const getRightY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset - 6; // ← tweak here!
  // Helper: compute the y coordinate (center of the row) based on index.
  const getYFromIndex = (index: number) =>
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
    rightX === 0
  ) {
    console.log("⏳ Waiting for valid X positions before drawing links...");
    return null;
  }
  if (!leftItems.length || !rightItems.length || !links.length) {
    console.log("⏳ Waiting for data before drawing links...");
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
            console.warn("❌ No index match:", {
              link,
              leftIndex,
              rightIndex,
            });
            return null;
          }
          const y1 = getLeftY(leftIndex);
          const y2 = getRightY(rightIndex);
          const strokeColor = link.relation === "refute" ? "red" : "green";

          return (
            <g
              key={link.id || i}
              onClick={() => onLineClick?.(link)}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
            >
              <circle cx={adjustedLeftX} cy={y1} r="8" fill="blue" />
              <circle cx={adjustedRightX} cy={y2} r="8" fill="red" />

              <title>
                {`${
                  link.relation === "support" ? "✅ Supports" : "⛔ Refutes"
                } • ${Math.abs(link.confidence * 100).toFixed(0)}%`}
              </title>
              <line
                key={link.id || i}
                x1={adjustedLeftX}
                y1={y1}
                x2={adjustedRightX}
                y2={y2}
                stroke={strokeColor}
                strokeWidth={4}
                markerStart="url(#arrowhead)"
                style={{ cursor: "pointer", pointerEvents: "auto" }}
              />
            </g>
          );
        })}
      </svg>
    </Box>
  );
};

export default RelationshipMap;
