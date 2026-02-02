// QuadrantGrid.tsx - Investigation Board Layout with Minority Report aesthetic
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useToast } from "@chakra-ui/react";
import { GraphNode } from "../../../shared/entities/types";

interface QuadrantGridProps {
  nodes: {
    id: string;
    label: string;
    type: string;
    claim_id?: number;
    content_id?: number;
    url?: string;
    rating?: string | number;
  }[];
  links: {
    id: string;
    source: string;
    target: string;
    relation?: "supports" | "refutes" | "related";
    notes?: string;
    value?: number;
  }[];
  onNodeClick?: (node: GraphNode) => void;
}

interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const QuadrantGrid: React.FC<QuadrantGridProps> = ({
  nodes,
  links,
  onNodeClick,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [expandedReference, setExpandedReference] = useState<string | null>(null);
  const toast = useToast();

  // Organize nodes by type
  const taskNodes = nodes.filter((n) => n.type === "task");
  const authorNodes = nodes.filter((n) => n.type === "author");
  const publisherNodes = nodes.filter((n) => n.type === "publisher");
  const referenceNodes = nodes.filter((n) => n.type === "reference");
  const taskClaimNodes = nodes.filter((n) => n.type === "taskClaim");
  const refClaimNodes = nodes.filter((n) => n.type === "refClaim");

  // Debug: log the data
  console.log("QuadrantGrid data:", { nodes, links });
  console.log("Categorized:", { taskNodes, authorNodes, publisherNodes, referenceNodes, taskClaimNodes, refClaimNodes });

  // Calculate aggregated stance for each reference based on its claims
  const calculateReferenceStance = (ref: typeof nodes[number]) => {
    // Find all claim nodes that belong to this reference
    const refClaims = refClaimNodes.filter((claim) => claim.content_id === ref.content_id);

    if (refClaims.length === 0) {
      return {
        stance: "none" as const,
        supportCount: 0,
        refuteCount: 0,
        relatedCount: 0,
        totalClaims: 0
      };
    }

    // Count claims by their relationship
    let supportCount = 0;
    let refuteCount = 0;
    let relatedCount = 0;

    refClaims.forEach((claim) => {
      const claimLinks = links.filter(
        (l) =>
          l.source === claim.id &&
          taskClaimNodes.some((tc) => tc.id === l.target)
      );

      claimLinks.forEach((link) => {
        if (link.relation === "supports") supportCount++;
        else if (link.relation === "refutes") refuteCount++;
        else if (link.relation === "related") relatedCount++;
      });
    });

    const totalClaims = supportCount + refuteCount + relatedCount;

    if (totalClaims === 0) {
      return {
        stance: "none" as const,
        supportCount: 0,
        refuteCount: 0,
        relatedCount: 0,
        totalClaims: 0
      };
    }

    // Calculate preponderance (only support vs refute)
    const preponderance = supportCount + refuteCount > 0
      ? supportCount / (supportCount + refuteCount)
      : 0.5;

    console.log(
      `Reference ${ref.label}: support=${supportCount}, refute=${refuteCount}, related=${relatedCount}, preponderance=${preponderance.toFixed(2)}`
    );

    // Determine aggregated stance
    let stance: "supports" | "refutes" | "related" | "none";
    if (preponderance > 0.55) {
      stance = "supports";
    } else if (preponderance < 0.45) {
      stance = "refutes";
    } else if (supportCount > 0 || refuteCount > 0) {
      stance = "related"; // Mixed/neutral
    } else {
      stance = "related"; // Only related links
    }

    return { stance, supportCount, refuteCount, relatedCount, totalClaims };
  };

  // Categorize references by aggregated stance (only those with linked claims)
  const referencesWithClaims = referenceNodes.filter((ref) => {
    const { totalClaims } = calculateReferenceStance(ref);
    return totalClaims > 0;
  });

  const supportsRefs = referencesWithClaims.filter((ref) => {
    const { stance } = calculateReferenceStance(ref);
    return stance === "supports";
  });

  const refutesRefs = referencesWithClaims.filter((ref) => {
    const { stance } = calculateReferenceStance(ref);
    return stance === "refutes";
  });

  const relatedRefs = referencesWithClaims.filter((ref) => {
    const { stance } = calculateReferenceStance(ref);
    return stance === "related";
  });

  console.log("Reference-level stance categorized:", {
    supportsCount: supportsRefs.length,
    refutesCount: refutesRefs.length,
    relatedCount: relatedRefs.length,
    totalWithClaims: referencesWithClaims.length
  });

  // Get claims for a specific reference
  const getClaimsForReference = (ref: typeof nodes[number]) => {
    return refClaimNodes.filter((claim) => claim.content_id === ref.content_id);
  };

  // Update node positions for SVG connections
  useEffect(() => {
    const updatePositions = () => {
      if (!boardRef.current) return;

      const boardRect = boardRef.current.getBoundingClientRect();
      const positions = new Map<string, NodePosition>();

      nodes.forEach((node) => {
        const element = document.getElementById(`node-${node.id}`);
        if (element) {
          const rect = element.getBoundingClientRect();
          positions.set(node.id, {
            id: node.id,
            x: rect.left + rect.width / 2 - boardRect.left,
            y: rect.top + rect.height / 2 - boardRect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      });

      setNodePositions(positions);
    };

    // Initial update and on window resize
    updatePositions();
    window.addEventListener("resize", updatePositions);
    const timeout = setTimeout(updatePositions, 100);

    return () => {
      window.removeEventListener("resize", updatePositions);
      clearTimeout(timeout);
    };
  }, [nodes]);

  const handleNodeClick = (node: typeof nodes[number]) => {
    setSelectedNode(node.id);

    // If clicking a reference with claims, expand it
    if (node.type === "reference") {
      const { totalClaims } = calculateReferenceStance(node);
      if (totalClaims > 0) {
        const newExpandedRef = expandedReference === node.id ? null : node.id;
        setExpandedReference(newExpandedRef);
        return;
      }
    }

    if (onNodeClick) onNodeClick(node as GraphNode);
  };

  // Get task claims connected to the expanded reference
  const getConnectedTaskClaims = () => {
    if (!expandedReference) return [];

    const refClaims = getClaimsForReference(
      referenceNodes.find((r) => r.id === expandedReference)!
    );

    const connectedTaskClaimIds = new Set<string>();

    refClaims.forEach((refClaim) => {
      links.forEach((link) => {
        if (link.source === refClaim.id && taskClaimNodes.some((tc) => tc.id === link.target)) {
          connectedTaskClaimIds.add(link.target);
        }
      });
    });

    return taskClaimNodes.filter((tc) => connectedTaskClaimIds.has(tc.id));
  };

  const connectedTaskClaims = getConnectedTaskClaims();

  // Render SVG connection lines between reference claims and task claims
  const renderConnections = () => {
    if (!expandedReference) return null;

    const refClaims = getClaimsForReference(
      referenceNodes.find((r) => r.id === expandedReference)!
    );

    return links
      .filter((link) => {
        // Only show links from expanded reference's claims to task claims
        const isFromRefClaim = refClaims.some((rc) => rc.id === link.source);
        const isToTaskClaim = taskClaimNodes.some((tc) => tc.id === link.target);
        return isFromRefClaim && isToTaskClaim;
      })
      .map((link) => {
        const sourcePos = nodePositions.get(link.source);
        const targetPos = nodePositions.get(link.target);

        if (!sourcePos || !targetPos) return null;

        const midX = (sourcePos.x + targetPos.x) / 2;
        const midY = (sourcePos.y + targetPos.y) / 2;

        // Curved bezier path
        const path = `M ${sourcePos.x} ${sourcePos.y} Q ${midX} ${midY - 50} ${targetPos.x} ${targetPos.y}`;

        const color =
          link.relation === "supports"
            ? "#22c55e" // green
            : link.relation === "refutes"
            ? "#ef4444" // red
            : "#64748b"; // gray

        // Stroke width based on support_level
        const supportLevel = Math.abs(link.value || 0);
        const strokeWidth = 2 + supportLevel * 3; // 2-5px range

        return (
          <path
            key={link.id}
            d={path}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            opacity="0.7"
            style={{
              filter: `drop-shadow(0 0 4px ${color}80)`,
            }}
          />
        );
      });
  };

  // Helper: Get reference name for a claim
  const getReferenceName = (claim: typeof nodes[number]) => {
    if (claim.type === "refClaim" && claim.content_id) {
      const reference = referenceNodes.find((ref) => ref.content_id === claim.content_id);
      return reference?.label || `Reference ${claim.content_id}`;
    }
    return null;
  };

  // Helper: Get claim stance for a specific claim
  const getClaimStance = (claim: typeof nodes[number]): "supports" | "refutes" | "related" | null => {
    const link = links.find(
      (l) =>
        l.source === claim.id &&
        taskClaimNodes.some((tc) => tc.id === l.target)
    );

    if (!link) return null;

    if (link.relation === "supports") return "supports";
    if (link.relation === "refutes") return "refutes";
    return "related";
  };

  // Node component
  const NodeCard = ({
    node,
    stance,
    isVerified,
    claimCount
  }: {
    node: typeof nodes[number];
    stance?: string;
    isVerified?: boolean;
    claimCount?: { support: number; refute: number; related: number };
  }) => {
    const isSelected = selectedNode === node.id;
    const isExpanded = expandedReference === node.id;
    const isTask = node.type === "task";
    const isClaim = node.type === "taskClaim" || node.type === "refClaim";
    const isReference = node.type === "reference";
    const referenceName = getReferenceName(node);

    const colorScheme = {
      task: {
        border: "#6366f1",
        bg: "rgba(99, 102, 241, 0.08)",
        text: "#a5b4fc",
      },
      author: {
        border: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.05)",
        text: "#fcd34d",
      },
      publisher: {
        border: "#22c55e",
        bg: "rgba(34, 197, 94, 0.05)",
        text: "#86efac",
      },
      reference: {
        border: "#3b82f6",
        bg: "rgba(59, 130, 246, 0.05)",
        text: "#93c5fd",
      },
      taskClaim: {
        border: "#a78bfa",
        bg: "rgba(167, 139, 250, 0.08)",
        text: "#c4b5fd",
      },
      refClaim: {
        border: "#60a5fa",
        bg: "rgba(96, 165, 250, 0.08)",
        text: "#93c5fd",
      },
    };

    const scheme = colorScheme[node.type as keyof typeof colorScheme] || colorScheme.reference;

    // Override for supports/refutes
    if (stance === "supports") {
      scheme.border = "#22c55e";
      scheme.bg = "rgba(34, 197, 94, 0.12)";
    } else if (stance === "refutes") {
      scheme.border = "#ef4444";
      scheme.bg = "rgba(239, 68, 68, 0.12)";
    }

    const totalClaims = claimCount
      ? claimCount.support + claimCount.refute + claimCount.related
      : 0;

    return (
      <Box
        id={`node-${node.id}`}
        bg={scheme.bg}
        backdropFilter="blur(20px)"
        border={isVerified ? `2px solid ${scheme.border}` : `2px dashed ${scheme.border}80`}
        borderRadius="8px"
        p={isTask ? 4 : 2}
        cursor="pointer"
        transition="all 0.3s ease"
        boxShadow={
          isSelected || isExpanded
            ? `0 0 30px ${scheme.border}60, 0 8px 30px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1)`
            : `0 3px 12px rgba(0, 0, 0, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.05)`
        }
        _hover={{
          transform: "scale(1.05) translateY(-2px)",
          boxShadow: `0 8px 30px rgba(0, 0, 0, 0.5), 0 0 20px ${scheme.border}40, inset 0 1px 2px rgba(255, 255, 255, 0.15)`,
          zIndex: 50,
        }}
        onClick={() => handleNodeClick(node)}
        width={isTask ? "300px" : "100%"}
        position="relative"
        overflow="hidden"
      >
        {/* Left edge glow */}
        <Box
          position="absolute"
          left={0}
          top={0}
          width="4px"
          height="100%"
          background={`linear-gradient(180deg, ${scheme.border}80 0%, ${scheme.border}30 100%)`}
          pointerEvents="none"
        />

        <Text
          fontSize="9px"
          textTransform="uppercase"
          letterSpacing="1px"
          color="#64748b"
          mb={1}
          fontWeight="500"
        >
          {node.type === "refClaim" ? "claim" : node.type}
          {isReference && " (click to expand)"}
        </Text>
        {referenceName && (
          <Text
            fontSize="8px"
            color="#64748b"
            mb={1}
            fontStyle="italic"
            noOfLines={1}
          >
            from: {referenceName}
          </Text>
        )}
        <Text
          fontSize={isTask ? "md" : "xs"}
          fontWeight="500"
          color="#f1f5f9"
          mb={1}
          lineHeight="1.3"
          noOfLines={isClaim ? 3 : 2}
        >
          {node.label}
        </Text>

        {/* Claim count badge for references */}
        {claimCount && totalClaims > 0 && (
          <Box display="flex" gap={1} mt={2} flexWrap="wrap">
            {claimCount.support > 0 && (
              <Box
                px={2}
                py={0.5}
                bg="rgba(34, 197, 94, 0.15)"
                borderRadius="full"
                fontSize="9px"
                fontWeight="600"
                color="#22c55e"
              >
                ✓ {claimCount.support}
              </Box>
            )}
            {claimCount.refute > 0 && (
              <Box
                px={2}
                py={0.5}
                bg="rgba(239, 68, 68, 0.15)"
                borderRadius="full"
                fontSize="9px"
                fontWeight="600"
                color="#ef4444"
              >
                ✗ {claimCount.refute}
              </Box>
            )}
            {claimCount.related > 0 && (
              <Box
                px={2}
                py={0.5}
                bg="rgba(100, 116, 139, 0.15)"
                borderRadius="full"
                fontSize="9px"
                fontWeight="600"
                color="#94a3b8"
              >
                ~ {claimCount.related}
              </Box>
            )}
          </Box>
        )}

        {node.rating && (
          <Text fontSize="9px" color="#94a3b8" mt={1}>
            Rating:{" "}
            <Box
              as="span"
              display="inline-block"
              px={1}
              py={0.5}
              bg="rgba(59, 130, 246, 0.15)"
              borderRadius="3px"
              fontWeight="600"
              color="#60a5fa"
              fontSize="9px"
            >
              {node.rating}/10
            </Box>
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Box
      pt={{ base: 0, md: 4 }}
      width={{ base: "100%", md: "calc(100vw - 300px)" }}
      ml={{ base: 0, md: "8px" }}
      mt={{ base: 0, md: -4 }}
      overflowX={{ base: "hidden", md: "visible" }}
    >
      <Box
        position="relative"
        height={{ base: "calc(100dvh - var(--tt-header-h, 98px))", md: "80vh" }}
        width="100%"
        borderWidth={{ base: "0px", md: "1px" }}
        borderRadius={{ base: "0", md: "lg" }}
        p={{ base: 2, md: 4 }}
        bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
        borderColor="rgba(0, 162, 255, 0.3)"
        overflow="hidden"
      >
        {/* Board Grid */}
        <Box
          ref={boardRef}
          position="relative"
          height="100%"
          width="100%"
          display="grid"
          gridTemplateColumns="1fr 1fr"
          gridTemplateRows="auto 1fr 1fr"
          gap={4}
        >
          {/* SVG Connections */}
          <svg
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            {renderConnections()}
          </svg>

          {/* Author Zone (Top-Left) */}
          <Box
            className="zone author-zone"
            bg="rgba(245, 158, 11, 0.03)"
            backdropFilter="blur(15px)"
            border="1.5px solid rgba(245, 158, 11, 0.25)"
            borderRadius="8px"
            p={3}
            position="relative"
            overflow="auto"
            gridColumn="1"
            gridRow="1"
          >
            <Text
              position="absolute"
              top="10px"
              left="15px"
              fontSize="10px"
              textTransform="uppercase"
              letterSpacing="2px"
              color="#fcd34d"
              fontWeight="600"
              zIndex={1}
            >
              📝 AUTHORS
            </Text>
            <Box display="flex" flexWrap="wrap" gap={2} mt="35px">
              {authorNodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </Box>
          </Box>

          {/* Publisher Zone (Top-Right) */}
          <Box
            className="zone publisher-zone"
            bg="rgba(34, 197, 94, 0.03)"
            backdropFilter="blur(15px)"
            border="1.5px solid rgba(34, 197, 94, 0.25)"
            borderRadius="8px"
            p={3}
            position="relative"
            overflow="auto"
            gridColumn="2"
            gridRow="1"
          >
            <Text
              position="absolute"
              top="10px"
              left="15px"
              fontSize="10px"
              textTransform="uppercase"
              letterSpacing="2px"
              color="#86efac"
              fontWeight="600"
              zIndex={1}
            >
              📰 PUBLISHERS
            </Text>
            <Box display="flex" flexWrap="wrap" gap={2} mt="35px">
              {publisherNodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </Box>
          </Box>

          {/* Task Zone (Center) */}
          <Box
            className="zone task-zone"
            bg="rgba(99, 102, 241, 0.08)"
            backdropFilter="blur(15px)"
            border="1.5px solid rgba(99, 102, 241, 0.35)"
            borderRadius="8px"
            p={3}
            position="relative"
            overflow="auto"
            gridColumn="1 / 3"
            gridRow="2"
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="flex-start"
          >
            {/* Main Task */}
            <Box display="flex" flexWrap="wrap" gap={4} justifyContent="center">
              {taskNodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </Box>

            {/* Connected Task Claims (when reference is expanded) */}
            {expandedReference && connectedTaskClaims.length > 0 && (
              <Box mt={4} width="100%" pt={4} borderTop="1px solid rgba(99, 102, 241, 0.3)">
                <Text
                  fontSize="9px"
                  textTransform="uppercase"
                  letterSpacing="1px"
                  color="#a5b4fc"
                  mb={3}
                  fontWeight="600"
                >
                  Connected Task Claims ({connectedTaskClaims.length})
                </Text>
                <Box display="flex" flexDirection="column" gap={2}>
                  {connectedTaskClaims.map((claim) => (
                    <NodeCard key={claim.id} node={claim} isVerified={true} />
                  ))}
                </Box>
              </Box>
            )}
          </Box>

          {/* Refutes Zone (Bottom-Left) */}
          <Box
            className="zone refutes-zone"
            bg="rgba(239, 68, 68, 0.05)"
            backdropFilter="blur(15px)"
            border="1.5px solid rgba(239, 68, 68, 0.25)"
            borderRadius="8px"
            p={3}
            position="relative"
            overflow="auto"
            gridColumn="1"
            gridRow="3"
          >
            <Text
              position="absolute"
              top="10px"
              left="15px"
              fontSize="10px"
              textTransform="uppercase"
              letterSpacing="2px"
              color="#fca5a5"
              fontWeight="600"
              zIndex={1}
            >
              ❌ REFUTES
            </Text>
            <Box display="flex" flexDirection="column" gap={2} mt="35px">
              {refutesRefs.map((ref) => {
                const { supportCount, refuteCount, relatedCount } = calculateReferenceStance(ref);
                const isExpanded = expandedReference === ref.id;
                const claims = getClaimsForReference(ref);

                return (
                  <Box key={ref.id} width="100%">
                    <NodeCard
                      node={ref}
                      stance="refutes"
                      isVerified={false}
                      claimCount={{ support: supportCount, refute: refuteCount, related: relatedCount }}
                    />

                    {/* Expanded claims */}
                    {isExpanded && (
                      <Box
                        mt={2}
                        ml={4}
                        pl={3}
                        borderLeft="2px solid rgba(239, 68, 68, 0.3)"
                        display="flex"
                        flexDirection="column"
                        gap={2}
                      >
                        {claims.map((claim) => {
                          const claimStance = getClaimStance(claim);
                          return (
                            <NodeCard
                              key={claim.id}
                              node={claim}
                              stance={claimStance || undefined}
                              isVerified={true}
                            />
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Supports Zone (Bottom-Right) */}
          <Box
            className="zone supports-zone"
            bg="rgba(34, 197, 94, 0.05)"
            backdropFilter="blur(15px)"
            border="1.5px solid rgba(34, 197, 94, 0.25)"
            borderRadius="8px"
            p={3}
            position="relative"
            overflow="auto"
            gridColumn="2"
            gridRow="3"
          >
            <Text
              position="absolute"
              top="10px"
              left="15px"
              fontSize="10px"
              textTransform="uppercase"
              letterSpacing="2px"
              color="#86efac"
              fontWeight="600"
              zIndex={1}
            >
              ✅ SUPPORTS
            </Text>
            <Box display="flex" flexDirection="column" gap={2} mt="35px">
              {supportsRefs.map((ref) => {
                const { supportCount, refuteCount, relatedCount } = calculateReferenceStance(ref);
                const isExpanded = expandedReference === ref.id;
                const claims = getClaimsForReference(ref);

                return (
                  <Box key={ref.id} width="100%">
                    <NodeCard
                      node={ref}
                      stance="supports"
                      isVerified={false}
                      claimCount={{ support: supportCount, refute: refuteCount, related: relatedCount }}
                    />

                    {/* Expanded claims */}
                    {isExpanded && (
                      <Box
                        mt={2}
                        ml={4}
                        pl={3}
                        borderLeft="2px solid rgba(34, 197, 94, 0.3)"
                        display="flex"
                        flexDirection="column"
                        gap={2}
                      >
                        {claims.map((claim) => {
                          const claimStance = getClaimStance(claim);
                          return (
                            <NodeCard
                              key={claim.id}
                              node={claim}
                              stance={claimStance || undefined}
                              isVerified={true}
                            />
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* Related/Mixed references */}
              {relatedRefs.map((ref) => {
                const { supportCount, refuteCount, relatedCount } = calculateReferenceStance(ref);
                const isExpanded = expandedReference === ref.id;
                const claims = getClaimsForReference(ref);

                return (
                  <Box key={ref.id} width="100%">
                    <NodeCard
                      node={ref}
                      isVerified={false}
                      claimCount={{ support: supportCount, refute: refuteCount, related: relatedCount }}
                    />

                    {/* Expanded claims */}
                    {isExpanded && (
                      <Box
                        mt={2}
                        ml={4}
                        pl={3}
                        borderLeft="2px solid rgba(100, 116, 139, 0.3)"
                        display="flex"
                        flexDirection="column"
                        gap={2}
                      >
                        {claims.map((claim) => {
                          const claimStance = getClaimStance(claim);
                          return (
                            <NodeCard
                              key={claim.id}
                              node={claim}
                              stance={claimStance || undefined}
                              isVerified={true}
                            />
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        {/* Stats Panel */}
        <Box
          position="absolute"
          bottom="20px"
          right="20px"
          bg="rgba(15, 23, 42, 0.9)"
          backdropFilter="blur(25px)"
          border="1.5px solid rgba(0, 162, 255, 0.3)"
          borderRadius="8px"
          p={3}
          zIndex={100}
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.15)"
        >
          <Text
            fontSize="10px"
            textTransform="uppercase"
            letterSpacing="2px"
            color="#00a2ff"
            mb={2}
            fontWeight="500"
          >
            📊 Evidence Balance
          </Text>
          <Box fontSize="xs" color="#cbd5e1">
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Text>Supporting:</Text>
              <Text fontWeight="600" color="#22c55e">
                {supportsRefs.length} refs
              </Text>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Text>Refuting:</Text>
              <Text fontWeight="600" color="#ef4444">
                {refutesRefs.length} refs
              </Text>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Text>Mixed/Related:</Text>
              <Text fontWeight="600" color="#64748b">
                {relatedRefs.length} refs
              </Text>
            </Box>
            <Box
              display="flex"
              justifyContent="space-between"
              mt={2}
              pt={2}
              borderTop="1px solid rgba(148, 163, 184, 0.2)"
            >
              <Text>Total Evidence:</Text>
              <Text fontWeight="600" color="#00a2ff">
                {referencesWithClaims.length}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default QuadrantGrid;
