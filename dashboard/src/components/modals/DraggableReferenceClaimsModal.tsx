import React, { useRef, useState } from "react";
import {
  Box,
  Heading,
  IconButton,
  Button,
  Text,
  VStack,
  Divider,
  HStack,
  useColorModeValue,
} from "@chakra-ui/react";
import { CloseIcon, Search2Icon, EditIcon, DeleteIcon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";

interface Props {
  anchorSelector?: string;
  isOpen: boolean;
  onClose: () => void;
  reference: ReferenceWithClaims | null;
  setDraggingClaim: (
    claim: Pick<Claim, "claim_id" | "claim_text"> | null,
  ) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onVerifyClaim?: (claim: Claim) => void;
  onEditClaim?: (claim: Claim) => void;
  onDeleteClaim?: (claimId: number) => void;
  claimLinks?: Array<{
    id?: string;
    claimId: number;
    referenceId: number;
    sourceClaimId: number;
    relation: "support" | "refute" | "nuance";
    confidence: number;
  }>;
  taskClaims?: Claim[];
  onClaimClick?: (claim: Claim) => void;
}

const DraggableReferenceClaimsModal: React.FC<Props> = ({
  anchorSelector,
  isOpen,
  onClose,
  reference,
  setDraggingClaim,
  draggingClaim,
  onVerifyClaim,
  onEditClaim,
  onDeleteClaim,
  claimLinks = [],
  taskClaims = [],
  onClaimClick,
}) => {
  // ✅ ALL HOOKS MUST BE AT THE TOP - BEFORE ANY CONDITIONAL LOGIC
  // Color mode values - define all at once to avoid circular references
  const bgColor = useColorModeValue("white", "gray.900");
  const textColor = useColorModeValue("gray.800", "white");
  const borderColor = useColorModeValue("2px solid #ddd", "2px solid #333");
  const headerBg = useColorModeValue("gray.100", "gray.800");
  const headingColor = useColorModeValue("teal.600", "teal.200");
  const linkColor = useColorModeValue("blue.600", "blue.300");
  const connectedBg = useColorModeValue("blue.50", "blue.900");
  const connectedBorder = useColorModeValue("2px solid #90CDF4", "2px solid #2C5282");
  const connectedTextColor = useColorModeValue("blue.700", "blue.200");
  const badgeBg = useColorModeValue("blue.100", "blue.800");
  const metaColor = useColorModeValue("gray.600", "gray.400");
  const claimTextColor = useColorModeValue("gray.900", "white");
  const supportBg = useColorModeValue("gray.100", "gray.800");
  const supportTextLight = useColorModeValue("gray.700", "gray.300");
  const supportTextDark = useColorModeValue("blue.600", "blue.300");
  const highlightBgLight = useColorModeValue("gray.200", "gray.700");
  const highlightBgDark = useColorModeValue("blue.100", "blue.200");
  const highlightTextColor = useColorModeValue("gray.900", "black");
  const hoverBg = useColorModeValue("gray.50", "gray.700");
  const snippetBg = useColorModeValue("gray.100", "gray.800");
  const snippetColor = useColorModeValue("gray.700", "gray.300");
  const normalBg = useColorModeValue("white", "black");

  // Position state for the floating box
  const [position, setPosition] = useState(() => ({
    x: Math.max(100, window.innerWidth * 0.55 - 250),
    y: 100,
  }));
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Tooltip for dragging claims
  const tipRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const move = (e: MouseEvent) => {
      if (tipRef.current && draggingClaim) {
        // keep your horizontal nudge if you want; it doesn't affect the link bug
        tipRef.current.style.left = `${e.clientX + 10}px`;
        tipRef.current.style.top = `${e.clientY + 10}px`;
      }
    };
    const up = () => {
      // Clear dragging state when mouse is released anywhere
      setDraggingClaim(null);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [draggingClaim, setDraggingClaim]);

  // Track claim element positions for drawing lines
  const claimRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [lineData, setLineData] = useState<
    Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      relation: "support" | "refute" | "nuance";
      isAI: boolean;
    }>
  >([]);

  // Helper: Check if a claim has connections
  const getClaimConnections = (claimId: number) => {
    return claimLinks.filter(
      (link) =>
        link.sourceClaimId === claimId &&
        link.referenceId === reference?.reference_content_id,
    );
  };

  // Get all unique task claims connected to this reference
  const getConnectedTaskClaims = () => {
    if (!reference) return [];

    const taskClaimIds = new Set<number>();
    claimLinks.forEach((link) => {
      if (link.referenceId === reference.reference_content_id) {
        taskClaimIds.add(link.claimId);
      }
    });

    return taskClaims.filter((claim) => taskClaimIds.has(claim.claim_id));
  };

  const connectedTaskClaims = getConnectedTaskClaims();

  // Reset modal position on open
  // Reset modal position on open (anchor under the clicked reference if we have anchorPoint)
  React.useEffect(() => {
    if (!isOpen) return;

    const modalWidth = 500; // matches desktop width
    const padding = 16;
    const headerSafeTop = 80; // keep it below your workspace header

    // 1) If we have an exact click anchor, place modal under it

    // 2) Otherwise, anchor to the reference list column
    const anchor = anchorSelector
      ? (document.querySelector(anchorSelector) as HTMLElement | null)
      : null;

    if (anchor) {
      const r = anchor.getBoundingClientRect();

      // Align close to the left edge of the ref column (no weird 50px drift)
      const x = Math.min(
        window.innerWidth - modalWidth - padding,
        Math.max(padding, r.left + 8),
      );

      const y = Math.max(headerSafeTop, r.top + 12);

      setPosition({ x, y });
      return;
    }

    // 3) Fallback: right-ish
    setPosition({
      x: Math.max(padding, window.innerWidth - modalWidth - padding),
      y: 100,
    });
  }, [isOpen, anchorSelector]);

  // Start drag on header
  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    document.body.style.userSelect = "none";
  };

  // Move
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    setPosition({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    });
  };

  // Stop drag
  const onMouseUp = () => {
    setDragging(false);
    document.body.style.userSelect = "";
  };

  React.useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line
  }, [dragging]);

  // ✅ IMPORTANT: update lines on:
  // - modal move (position)
  // - modal internal scroll (scrollContainerRef)
  // - page scroll (window)
  // - window resize
  React.useEffect(() => {
    if (!isOpen || !reference) {
      setLineData([]);
      return;
    }

    const updateLines = () => {
      const lines: typeof lineData = [];

      // Parse reference claims
      const refClaims: Claim[] =
        typeof reference.claims === "string"
          ? JSON.parse(reference.claims)
          : reference.claims || [];

      const modalContainer = document.querySelector(".mr-modal");
      if (!modalContainer) return;
      const modalRect = modalContainer.getBoundingClientRect();

      for (const claim of refClaims) {
        const connections = getClaimConnections(claim.claim_id);

        for (const link of connections) {
          const claimEl = claimRefs.current[claim.claim_id];
          if (!claimEl) continue;

          // ✅ LIVE: measure the task claim position each time (no caching)
          const taskClaimEl = document.querySelector(
            `[data-claim-id="${link.claimId}"]`,
          ) as HTMLElement | null;
          if (!taskClaimEl) continue;

          const claimRect = claimEl.getBoundingClientRect();
          const taskRect = taskClaimEl.getBoundingClientRect();

          // Skip if reference claim is out of modal viewport
          const refClaimVisible =
            claimRect.bottom >= modalRect.top &&
            claimRect.top <= modalRect.bottom;
          if (!refClaimVisible) continue;

          // ✅ No magic offsets. Attach to edges cleanly.
          const x1 = claimRect.left; // or claimRect.right if you prefer
          const y1 = claimRect.top + claimRect.height / 2;

          const x2 = taskRect.right; // or taskRect.left if you prefer
          const y2 = taskRect.top + taskRect.height / 2;

          lines.push({
            x1,
            y1,
            x2,
            y2,
            relation: link.relation,
            isAI: link.id?.toString().startsWith("ai-") ?? false,
          });
        }
      }

      setLineData(lines);
    };

    // rAF throttle (stable on scroll/resize)
    let raf = 0;
    const throttled = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateLines();
      });
    };

    // Run once after mount/layout
    throttled();

    // Modal scroll
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", throttled, { passive: true });
    }

    // ✅ Page scroll + resize (this is what fixes your bug)
    window.addEventListener("scroll", throttled, { passive: true });
    window.addEventListener("resize", throttled, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", throttled as any);
      }
      window.removeEventListener("scroll", throttled as any);
      window.removeEventListener("resize", throttled as any);
    };
  }, [isOpen, reference, claimLinks, position]); // position makes lines update while dragging modal

  if (!isOpen) return null;

  return (
    <>
      {/* SVG overlay (viewport coords) */}
      {lineData.length > 0 && (
        <Box
          position="fixed"
          top={0}
          left={0}
          width="100vw"
          height="100vh"
          pointerEvents="none"
          zIndex={2400}
        >
          <svg style={{ width: "100%", height: "100%", overflow: "visible" }}>
            {lineData.map((line, i) => {
              const color =
                line.relation === "support"
                  ? "#00ff00"
                  : line.relation === "refute"
                    ? "#ff0000"
                    : "#00aaff";

              const strokeColor = line.isAI
                ? line.relation === "support"
                  ? "rgba(0, 255, 0, 0.7)"
                  : line.relation === "refute"
                    ? "rgba(255, 0, 0, 0.7)"
                    : "rgba(0, 170, 255, 0.7)"
                : color;

              return (
                <g key={i}>
                  <line
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={strokeColor}
                    strokeWidth={12}
                    strokeDasharray={line.isAI ? "8,4" : undefined}
                    opacity={0.3}
                    filter="blur(4px)"
                  />
                  <line
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={strokeColor}
                    strokeWidth={5}
                    strokeDasharray={line.isAI ? "8,4" : undefined}
                    opacity={0.95}
                  />
                </g>
              );
            })}
          </svg>
        </Box>
      )}

      <Box
        className="mr-modal"
        position="fixed"
        left={`${position.x}px`}
        top={`${position.y}px`}
        zIndex={2500}
        w={["90vw", "500px"]}
        maxW="95vw"
        bg={bgColor}
        color={textColor}
        borderRadius="xl"
        boxShadow="2xl"
        border={borderColor}
        p={0}
        cursor={dragging ? "grabbing" : "default"}
        userSelect="none"
      >
        <Box
          className="mr-modal-header"
          onMouseDown={onMouseDown}
          cursor="grab"
          bg={headerBg}
          px={4}
          py={2}
          borderTopRadius="xl"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
        >
          <Heading
            size="sm"
            mb={0}
            color={headingColor}
          >
            Reference Details
          </Heading>
          <IconButton
            aria-label="Close"
            icon={<CloseIcon />}
            size="sm"
            onClick={onClose}
          />
        </Box>

        <Box ref={scrollContainerRef} p={4} maxH="70vh" overflowY="auto">
          <VStack align="start" spacing={4}>
            <Box>
              <Text fontWeight="bold">Title:</Text>
              <Text>{reference?.content_name}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold">Source URL:</Text>
              <Text
                color={linkColor}
                wordBreak="break-all"
              >
                <a
                  href={reference?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {reference?.url}
                </a>
              </Text>
            </Box>
            <Box>
              <Text fontWeight="bold">Topic:</Text>
              <Text>{reference?.topic || "N/A"}</Text>
            </Box>
            <Divider />

            {connectedTaskClaims.length > 0 && (
              <Box
                w="100%"
                bg={useColorModeValue("blue.50", "blue.900")}
                p={3}
                borderRadius="md"
                border={useColorModeValue(
                  "2px solid #3182ce",
                  "2px solid #00aaff",
                )}
              >
                <Text
                  fontWeight="bold"
                  mb={2}
                  color={useColorModeValue("blue.700", "blue.200")}
                >
                  📌 Connected Case Claims:
                </Text>
                <VStack align="start" spacing={2}>
                  {connectedTaskClaims.map((taskClaim) => {
                    const link = claimLinks.find(
                      (l) =>
                        l.claimId === taskClaim.claim_id &&
                        l.referenceId === reference?.reference_content_id,
                    );

                    return (
                      <Box
                        key={taskClaim.claim_id}
                        w="100%"
                        bg={useColorModeValue("blue.100", "blue.800")}
                        p={2}
                        borderRadius="md"
                        border={
                          link?.relation === "support"
                            ? "2px solid green"
                            : link?.relation === "refute"
                              ? "2px solid red"
                              : "2px solid blue"
                        }
                      >
                        <Text
                          fontSize="xs"
                          color={metaColor}
                          mb={1}
                        >
                          Task Claim #{taskClaim.claim_id}
                        </Text>
                        <Text
                          fontSize="sm"
                          color={claimTextColor}
                        >
                          {taskClaim.claim_text}
                        </Text>
                      </Box>
                    );
                  })}
                </VStack>
              </Box>
            )}

            <Divider />

            <Box w="100%">
              <Text fontWeight="bold" mb={2}>
                Associated Claims:
              </Text>
              {reference?.claims && (
                <VStack align="start" spacing={2}>
                  {(typeof reference.claims === "string"
                    ? JSON.parse(reference.claims)
                    : reference.claims
                  ).map((claim: Claim) => {
                    const isSnippet = claim.claim_type === "snippet";
                    const connections = getClaimConnections(claim.claim_id);
                    const hasConnection = connections.length > 0;

                    return (
                      <HStack key={claim.claim_id} align="start">
                        <Box
                          ref={(el) => {
                            claimRefs.current[claim.claim_id] = el;
                          }}
                          data-claim-ref-id={claim.claim_id}
                          flex="1"
                          bg={
                            isSnippet
                              ? snippetBg
                              : normalBg
                          }
                          color={
                            isSnippet
                              ? snippetColor
                              : linkColor
                          }
                          px={2}
                          py={1}
                          borderRadius="md"
                          border={
                            hasConnection
                              ? connections[0].relation === "support"
                                ? "2px solid green"
                                : connections[0].relation === "refute"
                                  ? "2px solid red"
                                  : "2px solid blue"
                              : isSnippet
                                ? "1px solid #718096"
                                : "1px solid blue"
                          }
                          borderLeft={
                            isSnippet && !hasConnection
                              ? "4px solid #A0AEC0"
                              : undefined
                          }
                          _hover={{
                            bg: isSnippet
                              ? highlightBgLight
                              : highlightBgDark,
                            color: highlightTextColor,
                          }}
                          onMouseDown={() => setDraggingClaim(claim)}
                          onMouseUp={() => setDraggingClaim(null)}
                          onClick={() => {
                            if (hasConnection && onClaimClick) {
                              onClaimClick(claim);
                            }
                          }}
                          cursor={hasConnection ? "pointer" : "grab"}
                        >
                          {hasConnection && (
                            <Text
                              fontSize="xs"
                              color={metaColor}
                              mb={1}
                            >
                              {connections[0].relation === "support"
                                ? "🟢 Supports"
                                : connections[0].relation === "refute"
                                  ? "🔴 Refutes"
                                  : "🔵 Nuances"}{" "}
                              task claim
                            </Text>
                          )}
                          {isSnippet ? (
                            <Text
                              fontStyle="italic"
                              fontSize="sm"
                              opacity={0.9}
                            >
                              " {claim.claim_text} "
                            </Text>
                          ) : (
                            claim.claim_text
                          )}
                        </Box>

                        <HStack spacing={2}>
                          <IconButton
                            size="sm"
                            aria-label="Edit"
                            icon={<span>✏️</span>}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onEditClaim) onEditClaim(claim);
                            }}
                          />
                          {onVerifyClaim && (
                            <IconButton
                              size="sm"
                              colorScheme="purple"
                              aria-label="Verify"
                              icon={<Search2Icon />}
                              onClick={(e) => {
                                e.stopPropagation();
                                onVerifyClaim(claim);
                              }}
                            />
                          )}
                          <IconButton
                            size="sm"
                            colorScheme="red"
                            aria-label="Delete"
                            icon={<span>🗑️</span>}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onDeleteClaim) onDeleteClaim(claim.claim_id);
                            }}
                          />
                        </HStack>
                      </HStack>
                    );
                  })}
                </VStack>
              )}
            </Box>
          </VStack>
        </Box>

        <Box
          p={4}
          borderBottomRadius="xl"
          borderTop="1px solid #333"
          display="flex"
          justifyContent="flex-end"
        >
          <Button onClick={onClose}>Close</Button>
        </Box>
      </Box>

      {draggingClaim && (
        <Box
          ref={tipRef}
          position="fixed"
          pointerEvents="none"
          zIndex={3000}
          px={4}
          py={2}
          bg="blue.300"
          color="black"
          borderRadius="md"
          boxShadow="lg"
          maxW="300px"
          fontSize="sm"
        >
          {draggingClaim.claim_text}
        </Box>
      )}
    </>
  );
};

export default DraggableReferenceClaimsModal;
