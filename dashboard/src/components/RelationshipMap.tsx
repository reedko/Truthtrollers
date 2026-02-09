// src/components/RelationshipMap.tsx
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box } from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import { fetchClaimsAndLinkedReferencesForTask } from "../services/useDashboardAPI";

export interface ClaimLink {
  id?: string;
  claim_link_id?: number; // for future use
  claimId: number; // target/task claim
  referenceId: number; // reference content id
  sourceClaimId: number; // 👈 new
  relation: "support" | "refute" | "nuance";
  confidence: number;
  notes?: string;
  verimeter_score?: number;
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
  const [rightCenters, setRightCenters] = useState<Record<number, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerX, setContainerX] = useState(0);
  const adjustedLeftX = leftX - 12;
  const adjustedRightX = rightX + 15;
  const [hasMeasuredContainer, setHasMeasuredContainer] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  /*   useEffect(() => {
    const timeout = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setContainerX(rect.x);
            setHasMeasuredContainer(true); // ✅ mark as measured
          }
        });
      });
    }, 250);
      return () => clearTimeout(timeout);
  }, []);
   // ← no delay, just wait for browser to do one frame
 */
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerX(rect.x);
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      // Clear hover timeout on unmount
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);
  useLayoutEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const containerTop = containerRef.current.getBoundingClientRect().top;

      // query all right boxes by our data attribute
      const nodes = document.querySelectorAll<HTMLElement>("[data-ref-id]");
      const map: Record<number, number> = {};
      nodes.forEach((el) => {
        const id = Number(el.dataset.refId);
        const r = el.getBoundingClientRect();
        // center relative to our SVG container
        map[id] = r.top - containerTop + r.height / 2;
      });
      setRightCenters(map);
    };

    measure();
    // re-measure when layout changes
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [rightItems, height]);

  useEffect(() => {
    console.log("📦 containerX updated:", containerX);
  }, [containerX]);

  const links = claimLinks;

  const getLeftY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset;

  const getRightY = (index: number) =>
    index * rowHeight + rowHeight / 2 + topOffset;

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
    rightX === 0 // 👈 instead of containerX === 0// 👈 prevent premature render
  ) {
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
          // remove the hardcoded -6 tweak; use DOM-measured center first, fallback to formula

          const y2 =
            rightCenters[Number(link.referenceId)] ?? getRightY(rightIndex);

          // Check if this is an AI-suggested link (not human-verified)
          const isAISuggested = link.id?.toString().startsWith("ai-");

          // Base colors: green for support, red for refute, blue for nuance
          const baseColor =
            link.relation === "refute" ? "red" :
            link.relation === "support" ? "green" :
            "blue"; // nuance

          // For AI links: lighter/more transparent colors
          const strokeColor = isAISuggested
            ? (link.relation === "refute" ? "rgba(255, 100, 100, 0.5)" :
               link.relation === "support" ? "rgba(100, 255, 100, 0.5)" :
               "rgba(100, 150, 255, 0.5)") // light blue for nuance
            : baseColor;

          const linkId = link.id || i.toString();

          const handleMouseEnter = () => {
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

          return (
            <g
              key={linkId}
              onClick={() => onLineClick?.(link)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
            >
              {/* Invisible thicker line for easier hover detection */}
              <line
                x1={adjustedLeftX}
                y1={y1}
                x2={adjustedRightX}
                y2={y2}
                stroke="transparent"
                strokeWidth={20}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
              />

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

              <title>
                {`${isAISuggested ? "🤖 AI " : "✓ "}${
                  link.relation === "support" ? "Supports" :
                  link.relation === "refute" ? "Refutes" :
                  "Nuances"
                } • ${Math.abs(link.confidence * 100).toFixed(0)}%`}
              </title>

              {/* Visible line */}
              <line
                key={linkId}
                x1={adjustedLeftX}
                y1={y1}
                x2={adjustedRightX}
                y2={y2}
                stroke={strokeColor}
                strokeWidth={hoveredLinkId === linkId ? 6 : 4}
                strokeDasharray={isAISuggested ? "8,4" : undefined}
                markerStart="url(#arrowhead)"
                opacity={activeOpacity}
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
