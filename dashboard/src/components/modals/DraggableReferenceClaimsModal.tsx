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
} from "@chakra-ui/react";
import { CloseIcon, Search2Icon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";

// Types for props
interface Props {
  isOpen: boolean;
  onClose: () => void;
  reference: ReferenceWithClaims | null;
  setDraggingClaim: (
    claim: Pick<Claim, "claim_id" | "claim_text"> | null
  ) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onVerifyClaim?: (claim: Claim) => void;
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
  isOpen,
  onClose,
  reference,
  setDraggingClaim,
  draggingClaim,
  onVerifyClaim,
  claimLinks = [],
  taskClaims = [],
  onClaimClick,
}) => {
  // Position state for the floating box
  const [position, setPosition] = useState(() => ({
    x: window.innerWidth - 550, // About 500px width + padding
    y: 100,
  }));
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

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

  // Tooltip for dragging claims
  const tipRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const move = (e: MouseEvent) => {
      if (tipRef.current && draggingClaim) {
        tipRef.current.style.left = `${e.clientX + 10}px`;
        tipRef.current.style.top = `${e.clientY + 10}px`;
      }
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, [draggingClaim]);

  // Track claim element positions for drawing lines
  const claimRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [lineData, setLineData] = useState<Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    relation: "support" | "refute" | "nuance";
    isAI: boolean;
  }>>([]);

  // Helper: Check if a claim has connections
  const getClaimConnections = (claimId: number) => {
    return claimLinks.filter(
      (link) => link.sourceClaimId === claimId &&
                link.referenceId === reference?.reference_content_id
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

  // Update line positions when modal moves, opens, or scrolls
  React.useEffect(() => {
    if (!isOpen || !reference) {
      setLineData([]);
      return;
    }

    const updateLines = () => {
      const lines: typeof lineData = [];

      // For each claim in the reference
      const refClaims = typeof reference.claims === "string"
        ? JSON.parse(reference.claims)
        : reference.claims || [];

      // Get scroll container bounds to check visibility
      const scrollContainer = scrollContainerRef.current;
      const containerRect = scrollContainer?.getBoundingClientRect();

      refClaims.forEach((claim: Claim) => {
        const connections = getClaimConnections(claim.claim_id);

        connections.forEach((link) => {
          // Get position of claim in modal
          const claimEl = claimRefs.current[claim.claim_id];
          // Get position of task claim (using data attribute)
          const taskClaimEl = document.querySelector(
            `[data-claim-id="${link.claimId}"]`
          ) as HTMLElement;

          if (claimEl && taskClaimEl) {
            const claimRect = claimEl.getBoundingClientRect();
            const taskRect = taskClaimEl.getBoundingClientRect();

            // Only draw lines for claims that are visible in the scroll container
            if (containerRect) {
              const isVisible =
                claimRect.bottom >= containerRect.top &&
                claimRect.top <= containerRect.bottom;

              if (!isVisible) {
                return; // Skip this line if claim is scrolled out of view
              }
            }

            lines.push({
              x1: claimRect.left,
              y1: claimRect.top + claimRect.height / 2,
              x2: taskRect.right,
              y2: taskRect.top + taskRect.height / 2,
              relation: link.relation,
              isAI: link.id?.toString().startsWith("ai-") ?? false,
            });
          }
        });
      });

      setLineData(lines);
    };

    // Update on mount and when position changes
    const timer = setTimeout(updateLines, 100);

    // Throttled scroll handler for better performance
    let scrollTimer: NodeJS.Timeout;
    const throttledUpdateLines = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(updateLines, 16); // ~60fps
    };

    // Add scroll listener to update lines when scrolling
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', throttledUpdateLines);
    }

    return () => {
      clearTimeout(timer);
      if (scrollTimer) clearTimeout(scrollTimer);
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', throttledUpdateLines);
      }
    };
  }, [isOpen, position, reference, claimLinks]);

  // If not open, render nothing!
  if (!isOpen) return null;

  return (
    <>
      {/* SVG overlay for connection lines */}
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
          <svg
            style={{
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            {lineData.map((line, i) => {
              const color =
                line.relation === "support" ? "#00ff00" :
                line.relation === "refute" ? "#ff0000" :
                "#00aaff";

              const strokeColor = line.isAI
                ? (line.relation === "support" ? "rgba(0, 255, 0, 0.7)" :
                   line.relation === "refute" ? "rgba(255, 0, 0, 0.7)" :
                   "rgba(0, 170, 255, 0.7)")
                : color;

              return (
                <g key={i}>
                  {/* Glow effect */}
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
                  {/* Main line - thicker and more visible */}
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
        left={position.x}
        top={position.y}
        zIndex={2500}
        w={["90vw", "500px"]}
        maxW="95vw"
        bg="gray.900"
        color="white"
        borderRadius="xl"
        boxShadow="2xl"
        border="2px solid #333"
        p={0}
        cursor={dragging ? "grabbing" : "default"}
        userSelect="none"
      >
        {/* DRAG HANDLE */}
        <Box
          className="mr-modal-header"
          onMouseDown={onMouseDown}
          cursor="grab"
          bg="gray.800"
          px={4}
          py={2}
          borderTopRadius="xl"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
        >
          <Heading size="sm" mb={0} color="teal.200">
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
              <Text color="blue.300" wordBreak="break-all">
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

            {/* Connected Task Claims Section */}
            {connectedTaskClaims.length > 0 && (
              <Box w="100%" bg="blue.900" p={3} borderRadius="md" border="2px solid #00aaff">
                <Text fontWeight="bold" mb={2} color="blue.200">
                  📌 Connected Task Claims:
                </Text>
                <VStack align="start" spacing={2}>
                  {connectedTaskClaims.map((taskClaim) => {
                    // Find what relation this task claim has
                    const link = claimLinks.find(
                      (l) =>
                        l.claimId === taskClaim.claim_id &&
                        l.referenceId === reference?.reference_content_id
                    );

                    return (
                      <Box
                        key={taskClaim.claim_id}
                        w="100%"
                        bg="blue.800"
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
                        <Text fontSize="xs" color="gray.400" mb={1}>
                          Task Claim #{taskClaim.claim_id}
                        </Text>
                        <Text fontSize="sm" color="white">
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
                    const isSnippet = claim.claim_type === 'snippet';
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
                          bg={isSnippet ? "gray.800" : "black"}
                          color={isSnippet ? "gray.300" : "blue.300"}
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
                          borderLeft={isSnippet && !hasConnection ? "4px solid #A0AEC0" : undefined}
                          _hover={{ bg: isSnippet ? "gray.700" : "blue.200", color: "black" }}
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
                            <Text fontSize="xs" color="gray.400" mb={1}>
                              {connections[0].relation === "support" ? "🟢 Supports" :
                               connections[0].relation === "refute" ? "🔴 Refutes" :
                               "🔵 Nuances"} task claim
                            </Text>
                          )}
                          {isSnippet ? (
                            <Text fontStyle="italic" fontSize="sm" opacity={0.9}>
                              " {claim.claim_text} "
                            </Text>
                          ) : (
                            claim.claim_text
                          )}
                        </Box>
                        <IconButton
                          size="sm"
                          colorScheme="purple"
                          aria-label="Verify claim"
                          icon={<Search2Icon />}
                          onClick={() => onVerifyClaim?.(claim)}
                        />
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
      {/* Floating tooltip while dragging */}
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
