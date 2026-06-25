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
import SourceCrest from "../SourceCrest";
import { normalizeSourceProfile } from "../../utils/normalizeSourceProfile";

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
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const modalDragRafRef = useRef<number | null>(null);
  const pendingPositionRef = useRef(position);

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

  // useLayoutEffect runs before paint — no visible jump on open
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    setPosition({
      x: Math.max(16, window.innerWidth - 516),
      y: Math.max(16, (window.innerHeight - 600) / 2),
    });
  }, [isOpen]);

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
    pendingPositionRef.current = {
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    };
    if (modalDragRafRef.current != null) return;
    modalDragRafRef.current = window.requestAnimationFrame(() => {
      modalDragRafRef.current = null;
      setPosition(pendingPositionRef.current);
    });
  };

  // Stop drag
  const onMouseUp = () => {
    setDragging(false);
    document.body.style.userSelect = "";
    if (modalDragRafRef.current != null) {
      window.cancelAnimationFrame(modalDragRafRef.current);
      modalDragRafRef.current = null;
    }
    setPosition(pendingPositionRef.current);
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
      if (modalDragRafRef.current != null) {
        window.cancelAnimationFrame(modalDragRafRef.current);
        modalDragRafRef.current = null;
      }
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
    if (dragging) {
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
  }, [isOpen, reference, claimLinks, dragging]);

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
        p={0}
        cursor={dragging ? "grabbing" : "default"}
        userSelect="none"
        overflow="hidden"
        style={{
          background: "rgba(10, 15, 25, 0.94)",
          border: "2px solid rgba(113, 219, 255, 0.4)",
          borderRadius: "16px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 12px 32px rgba(0,0,0,0.6), 0 0 60px rgba(113,219,255,0.3), inset 0 2px 0 rgba(255,255,255,0.15)",
        }}
      >
        {/* Left edge glow overlay */}
        <Box
          position="absolute"
          left={0}
          top={0}
          width="32px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.35) 0%, transparent 100%)"
          borderLeftRadius="16px"
          pointerEvents="none"
          zIndex={0}
        />
        {/* Radial background glow */}
        <Box
          position="absolute"
          top="-20%"
          right="-10%"
          width="60%"
          height="60%"
          background="radial-gradient(circle, rgba(0, 162, 255, 0.12) 0%, transparent 70%)"
          pointerEvents="none"
          zIndex={0}
        />
        <Box
          onMouseDown={onMouseDown}
          cursor="grab"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          position="relative"
          zIndex={1}
          px={5}
          py={4}
          borderBottom="1px solid rgba(113, 219, 255, 0.2)"
        >
          <Heading
            size="md"
            mb={0}
            fontWeight="semibold"
            color="white"
          >
            Reference Details
          </Heading>
          <IconButton
            aria-label="Close"
            icon={<CloseIcon />}
            size="sm"
            variant="ghost"
            color="rgba(113, 219, 255, 0.7)"
            _hover={{ bg: "rgba(113, 219, 255, 0.12)", color: "rgba(113, 219, 255, 1)" }}
            onClick={onClose}
          />
        </Box>

        <Box ref={scrollContainerRef} p={3} maxH="70vh" overflowY="auto" position="relative" zIndex={1}>
          <VStack align="start" spacing={3}>

            {/* ── DEBUG DRAWER ── */}
            <Box w="100%">
              <HStack
                cursor="pointer"
                onClick={() => setDebugOpen(!debugOpen)}
                py="3px"
                px={2}
                bg="rgba(88, 28, 135, 0.18)"
                borderRadius="6px"
                border="1px solid rgba(139, 92, 246, 0.25)"
                justify="space-between"
                _hover={{ bg: "rgba(88, 28, 135, 0.32)" }}
                transition="background 0.15s"
              >
                <Text fontSize="9px" fontFamily="monospace" color="rgba(167,139,250,0.75)" letterSpacing="1px" textTransform="uppercase">
                  debug {debugOpen ? "▼" : "▶"}
                </Text>
                <Text fontSize="9px" fontFamily="monospace" color="rgba(167,139,250,0.4)">
                  src #{reference?.reference_content_id ?? "—"}
                </Text>
              </HStack>
              {debugOpen && (
                <Box mt={1} p={2} bg="rgba(88, 28, 135, 0.18)" borderRadius="6px" border="1px solid rgba(139, 92, 246, 0.25)" fontSize="9px" fontFamily="monospace">
                  <Text color="rgba(167,139,250,0.8)">reference_content_id: {reference?.reference_content_id ?? "—"}</Text>
                  <Text color="rgba(167,139,250,0.8)">content_id: {(reference as any)?.content_id ?? "—"}</Text>
                  <Text color="rgba(167,139,250,0.8)">publisher: {reference?.publisher_name ?? "—"}</Text>
                  <Text color="rgba(167,139,250,0.8)">media_source: {reference?.media_source ?? "—"}</Text>
                  <Text color="rgba(167,139,250,0.8)">is_primary: {String(reference?.is_primary_source ?? "—")}</Text>
                  <Text color="rgba(167,139,250,0.8)">claims_count: {Array.isArray(reference?.claims) ? reference.claims.length : "—"}</Text>
                </Box>
              )}
            </Box>

            {/* ── SOURCE INFO 3D FLOAT BOX ── */}
            <Box
              w="100%"
              bg="rgba(8, 16, 36, 0.75)"
              p={3}
              borderLeftRadius="16px"
              border="1px solid rgba(0, 162, 255, 0.28)"
              boxShadow="0 18px 44px rgba(0,0,0,0.65), 0 8px 18px rgba(0,0,0,0.45), 0 0 28px rgba(0,162,255,0.16), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.35)"
              position="relative"
              overflow="hidden"
              transition="box-shadow 0.2s ease, transform 0.2s ease"
              _hover={{ transform: "translateY(-2px)", boxShadow: "0 24px 56px rgba(0,0,0,0.72), 0 10px 22px rgba(0,0,0,0.5), 0 0 36px rgba(0,162,255,0.22), inset 0 1px 0 rgba(255,255,255,0.14)" }}
            >
              <Box position="absolute" left={0} top={0} width="20px" height="100%" background="linear-gradient(90deg, rgba(0,162,255,0.32) 0%, transparent 100%)" borderLeftRadius="16px" pointerEvents="none" zIndex={0} />
              <VStack align="start" spacing={2} position="relative" zIndex={1}>
                <Box w="100%">
                  <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.4)" letterSpacing="1px" textTransform="uppercase" mb="1px">title</Text>
                  <Text color="var(--mr-text-primary)" fontSize="sm" fontWeight="semibold">{reference?.content_name}</Text>
                </Box>
                <HStack spacing={2} flexWrap="wrap" align="center">
                  {reference && (
                    <SourceCrest
                      {...normalizeSourceProfile({
                        publisher_name: reference.publisher_name,
                        is_primary_source: reference.is_primary_source,
                        media_source: reference.media_source,
                        veracity_score: reference.publisher_veracity ?? undefined,
                        admiralty_code: reference.admiralty_code ?? undefined,
                      })}
                      size="xs"
                    />
                  )}
                  <Text fontSize="xs" color="rgba(0,162,255,0.7)">
                    <Text as="span" opacity={0.6}>Pub: </Text>
                    <Text as="span" color={reference?.publisher_name ? "rgba(0,162,255,0.9)" : "rgba(255,255,255,0.3)"}>
                      {reference?.publisher_name ?? "—"}
                    </Text>
                  </Text>
                  <Text fontSize="xs" color="rgba(0,162,255,0.7)">
                    <Text as="span" opacity={0.6}>Auth: </Text>
                    <Text as="span" color={reference?.author_name?.trim() ? "rgba(0,162,255,0.9)" : "rgba(255,255,255,0.3)"}>
                      {reference?.author_name?.trim() ?? "—"}
                    </Text>
                  </Text>
                </HStack>
                <Box w="100%">
                  <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.4)" letterSpacing="1px" textTransform="uppercase" mb="1px">url</Text>
                  <Text color="var(--mr-blue)" wordBreak="break-all" fontSize="xs">
                    <a href={reference?.url} target="_blank" rel="noopener noreferrer">{reference?.url}</a>
                  </Text>
                </Box>
                <Box w="100%">
                  <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.4)" letterSpacing="1px" textTransform="uppercase" mb="1px">topic</Text>
                  <Text color="var(--mr-text-primary)" fontSize="sm">{reference?.topic || "N/A"}</Text>
                </Box>
              </VStack>
            </Box>

            {/* ── CONNECTED CASE CLAIMS ── */}
            {connectedTaskClaims.length > 0 && (
              <Box
                w="100%"
                bg="rgba(0, 30, 70, 0.55)"
                p={3}
                borderLeftRadius="16px"
                border="2px solid rgba(0, 162, 255, 0.3)"
                boxShadow="0 16px 40px rgba(0,0,0,0.6), 0 6px 16px rgba(0,0,0,0.4), 0 0 24px rgba(0,162,255,0.14), inset 0 1px 0 rgba(255,255,255,0.08)"
                position="relative"
                overflow="hidden"
              >
                <Box position="absolute" left={0} top={0} width="20px" height="100%" background="linear-gradient(90deg, rgba(0,162,255,0.3) 0%, transparent 100%)" borderLeftRadius="16px" pointerEvents="none" zIndex={0} />
                <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.5)" letterSpacing="1px" textTransform="uppercase" mb={2} position="relative" zIndex={1}>
                  Connected Case Claims
                </Text>
                <VStack align="start" spacing={2} position="relative" zIndex={1}>
                  {connectedTaskClaims.map((taskClaim) => {
                    const link = claimLinks.find(
                      (l) =>
                        l.claimId === taskClaim.claim_id &&
                        l.referenceId === reference?.reference_content_id,
                    );
                    const rColor =
                      link?.relation === "support" ? "rgba(74,222,128,0.65)"
                      : link?.relation === "refute" ? "rgba(239,68,68,0.65)"
                      : "rgba(0,162,255,0.4)";

                    return (
                      <Box
                        key={taskClaim.claim_id}
                        w="100%"
                        bg="rgba(0, 0, 28, 0.6)"
                        p={2}
                        borderLeftRadius="10px"
                        border={`2px solid ${rColor}`}
                        boxShadow={`0 10px 24px rgba(0,0,0,0.5), 0 4px 10px rgba(0,0,0,0.35), 0 0 14px ${rColor.replace("0.65", "0.15")}, inset 0 1px 0 rgba(255,255,255,0.07)`}
                        transition="box-shadow 0.2s, transform 0.2s"
                        _hover={{ transform: "translateY(-1px)", boxShadow: `0 14px 32px rgba(0,0,0,0.6), 0 0 20px ${rColor.replace("0.65", "0.22")}` }}
                      >
                        <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.4)" letterSpacing="1px" mb="2px">#{taskClaim.claim_id}</Text>
                        <Text fontSize="sm" color="var(--mr-text-primary)">
                          {taskClaim.claim_text}
                        </Text>
                      </Box>
                    );
                  })}
                </VStack>
              </Box>
            )}

            <Divider borderColor="rgba(0,162,255,0.15)" />

            {/* ── ASSOCIATED CLAIMS ── */}
            <Box w="100%">
              <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.4)" letterSpacing="1px" textTransform="uppercase" mb={2}>
                Associated Claims
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

                    const accentColor =
                      hasConnection
                        ? connections[0].relation === "support"
                          ? "rgba(74,222,128,0.7)"
                          : connections[0].relation === "refute"
                            ? "rgba(239,68,68,0.7)"
                            : "rgba(0,162,255,0.7)"
                        : isSnippet
                          ? "rgba(160,174,192,0.38)"
                          : "rgba(0,162,255,0.32)";

                    const glowColor = hasConnection
                      ? connections[0].relation === "support" ? "rgba(74,222,128,0.12)" : connections[0].relation === "refute" ? "rgba(239,68,68,0.12)" : "rgba(0,162,255,0.12)"
                      : "rgba(0,162,255,0.08)";

                    return (
                      <HStack key={claim.claim_id} align="start" w="100%">
                        <Box
                          ref={(el) => {
                            claimRefs.current[claim.claim_id] = el;
                          }}
                          data-claim-ref-id={claim.claim_id}
                          flex="1"
                          bg="rgba(15, 24, 48, 0.65)"
                          borderLeftRadius="12px"
                          border={`2px solid ${accentColor}`}
                          boxShadow={`0 12px 30px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.38), 0 0 18px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.08)`}
                          transition="box-shadow 0.2s ease, transform 0.2s ease"
                          _hover={{
                            transform: "translateY(-2px)",
                            boxShadow: `0 18px 40px rgba(0,0,0,0.65), 0 6px 16px rgba(0,0,0,0.45), 0 0 26px ${glowColor.replace("0.08","0.2").replace("0.12","0.24")}, inset 0 1px 0 rgba(255,255,255,0.12)`,
                          }}
                          position="relative"
                          overflow="hidden"
                          onMouseDown={() => setDraggingClaim(claim)}
                          onMouseUp={() => setDraggingClaim(null)}
                          onClick={() => {
                            if (hasConnection && onClaimClick) {
                              onClaimClick(claim);
                            }
                          }}
                          cursor={hasConnection ? "pointer" : "grab"}
                        >
                          {/* Left edge curl */}
                          <Box
                            position="absolute"
                            left={0}
                            top={0}
                            width="16px"
                            height="100%"
                            background={`linear-gradient(90deg, ${accentColor} 0%, transparent 100%)`}
                            borderLeftRadius="12px"
                            pointerEvents="none"
                            zIndex={0}
                            opacity={0.45}
                          />
                          <Box position="relative" zIndex={1} px={2} pt="5px" pb={2}>
                            {/* claim id chip */}
                            <Text fontSize="9px" fontFamily="monospace" color="rgba(0,162,255,0.45)" letterSpacing="1px" mb="3px">#{claim.claim_id}</Text>
                            {hasConnection && (
                              <Text fontSize="10px" color={accentColor} mb="3px" letterSpacing="0.5px">
                                {connections[0].relation === "support"
                                  ? "🟢 Supports"
                                  : connections[0].relation === "refute"
                                    ? "🔴 Refutes"
                                    : "🔵 Nuances"}{" "}
                                task claim
                              </Text>
                            )}
                            {isSnippet ? (
                              <Text fontStyle="italic" fontSize="sm" color="var(--mr-text-secondary)" opacity={0.9}>
                                " {claim.claim_text} "
                              </Text>
                            ) : (
                              <Text fontSize="sm" color="var(--mr-text-primary)">{claim.claim_text}</Text>
                            )}
                          </Box>
                        </Box>

                        <VStack spacing={1} align="center" pt={1}>
                          <IconButton
                            size="xs"
                            aria-label="Edit"
                            icon={<span style={{ fontSize: "11px" }}>✏️</span>}
                            variant="ghost"
                            color="var(--mr-blue)"
                            _hover={{ bg: "rgba(0, 162, 255, 0.15)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onEditClaim) onEditClaim(claim);
                            }}
                          />
                          {onVerifyClaim && (
                            <IconButton
                              size="xs"
                              aria-label="Verify"
                              icon={<Search2Icon boxSize="10px" />}
                              variant="ghost"
                              color="var(--mr-purple)"
                              _hover={{ bg: "rgba(139, 92, 246, 0.15)" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onVerifyClaim(claim);
                              }}
                            />
                          )}
                          <IconButton
                            size="xs"
                            aria-label="Delete"
                            icon={<span style={{ fontSize: "11px" }}>🗑️</span>}
                            variant="ghost"
                            color="var(--mr-red)"
                            _hover={{ bg: "rgba(239, 68, 68, 0.15)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onDeleteClaim) onDeleteClaim(claim.claim_id);
                            }}
                          />
                        </VStack>
                      </HStack>
                    );
                  })}
                </VStack>
              )}
            </Box>
          </VStack>
        </Box>

        <Box
          p={3}
          borderTop="1px solid rgba(0, 162, 255, 0.2)"
          display="flex"
          justifyContent="flex-end"
          position="relative"
          zIndex={1}
        >
          <Button className="mr-button" onClick={onClose} size="sm">Close</Button>
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
