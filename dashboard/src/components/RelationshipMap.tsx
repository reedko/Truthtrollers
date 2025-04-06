// src/components/RelationshipMap.tsx
import React from "react";
import { Box } from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";

export interface ClaimLink {
  claimId: number; // ID of the claim on the left
  referenceId: number; // ID of the reference on the right
  relation: "support" | "refute";
  confidence: number; // e.g. 0 to 1 or -1 to 1
  id?: string;
}

interface RelationshipMapProps {
  leftItems: Claim[]; // Claims from the left column
  rightItems: ReferenceWithClaims[]; // References from the right column
  links: ClaimLink[];
  rowHeight: number; // Height of each row (e.g., 40px)
  leftX?: number; // Fixed x position for left items (default 150)
  rightX?: number; // Fixed x position for right items (default 650)
  onLineClick?: (link: ClaimLink) => void;
}

const RelationshipMap: React.FC<RelationshipMapProps> = ({
  leftItems,
  rightItems,
  links,
  rowHeight,
  leftX = 150,
  rightX = 650,
  onLineClick,
}) => {
  // Helper: given an index, compute the y coordinate (center of the row)
  const getYFromIndex = (index: number) => index * rowHeight + rowHeight / 2;

  // Build lookup maps: claim ID -> index in leftItems, and reference ID -> index in rightItems.
  const leftIndexMap = new Map<number, number>();
  leftItems.forEach((item, index) => {
    leftIndexMap.set(item.claim_id, index);
  });

  const rightIndexMap = new Map<number, number>();
  rightItems.forEach((ref, index) => {
    rightIndexMap.set(ref.reference_content_id, index);
  });

  // Calculate overall height based on the longer list.
  const overallHeight =
    Math.max(leftItems.length, rightItems.length) * rowHeight;

  return (
    <Box position="relative" width="100%" height={`${overallHeight}px`}>
      {/* SVG overlay to draw lines */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none", // Allow clicks to pass through, unless overridden
        }}
      >
        {links.map((link, i) => {
          const leftIndex = leftIndexMap.get(link.claimId);
          const rightIndex = rightIndexMap.get(link.referenceId);
          if (leftIndex === undefined || rightIndex === undefined) return null;

          const y1 = getYFromIndex(leftIndex);
          const y2 = getYFromIndex(rightIndex);
          // Choose a stroke color based on the relation.
          const strokeColor = link.relation === "refute" ? "red" : "green";

          return (
            <line
              key={link.id || i}
              x1={leftX}
              y1={y1}
              x2={rightX}
              y2={y2}
              stroke={strokeColor}
              strokeWidth={2}
              // Enable pointer events on the line so clicks register.
              onClick={() => onLineClick && onLineClick(link)}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
            />
          );
        })}
      </svg>
    </Box>
  );
};

export default RelationshipMap;
