// src/components/TaskClaims.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  VStack,
  Heading,
  Box,
  Text,
  HStack,
  IconButton,
  Tooltip,
  useColorModeValue,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import ClaimModal from "./modals/ClaimModal";
import RelevanceScanModal from "./modals/RelevanceScanModal";
import { ClaimLink } from "./RelationshipMap";

interface TaskClaimsProps {
  claims: Claim[];
  onAddClaim: (newClaim: Claim) => Promise<void>;
  onEditClaim: (updatedClaim: Claim) => Promise<void>;
  onDeleteClaim: (claimId: number) => void;
  draggingClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  onDropReferenceClaim: (
    sourceClaim: Pick<Claim, "claim_id" | "claim_text">,
    targetClaim: Claim,
  ) => void;
  taskId: number;
  hoveredClaimId: number | null;
  setHoveredClaimId: (id: number | null) => void;
  selectedClaim: Claim | null;
  setSelectedClaim: (claim: Claim | null) => void;
  isClaimModalOpen: boolean;
  setIsClaimModalOpen: (open: boolean) => void;
  isClaimViewModalOpen: boolean;
  setIsClaimViewModalOpen: (open: boolean) => void;
  editingClaim: Claim | null;
  setEditingClaim: (claim: Claim | null) => void;
  onVerifyClaim: (claim: Claim) => void;
  onTaskClaimClick?: (claim: Claim) => void;
  onOpenLinkOverlay?: (
    scanSourceClaim: { claim_id: number; claim_text: string },
    scanTargetClaim: Claim,
    rationale: string,
    supportLevel: number,
  ) => void;
  linkSelection?: {
    active: boolean;
    source?: Pick<Claim, "claim_id" | "claim_text"> | null;
  };
  onPickTargetForLink?: (target: Claim) => void;
  claimLinks?: ClaimLink[];
  selectedReferenceId?: number;
  isReferenceModalOpen?: boolean;
  references?: ReferenceWithClaims[];
  contentId?: number;
  viewerId?: number | null;
  bubbleStyle?: boolean;
}

const TaskClaims: React.FC<TaskClaimsProps> = ({
  claims,
  onAddClaim,
  onEditClaim,
  onDeleteClaim,
  draggingClaim,
  onDropReferenceClaim,
  hoveredClaimId,
  setHoveredClaimId,
  selectedClaim,
  setSelectedClaim,
  isClaimModalOpen,
  setIsClaimModalOpen,
  isClaimViewModalOpen,
  setIsClaimViewModalOpen,
  editingClaim,
  setEditingClaim,
  onVerifyClaim,
  onTaskClaimClick,
  onOpenLinkOverlay,
  taskId,
  linkSelection,
  onPickTargetForLink,
  claimLinks = [],
  references = [],
  contentId,
  viewerId,
  selectedReferenceId,
  isReferenceModalOpen = false,
  bubbleStyle = false,
}) => {
  const claimRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Keep a ref to onDropReferenceClaim so handleMouseUp never captures a stale version
  const onDropRef = useRef(onDropReferenceClaim);
  onDropRef.current = onDropReferenceClaim;

  // Evidence confirmation dialog state
  const [showEvidencePrompt, setShowEvidencePrompt] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    claim: Claim;
    originalText: string;
  } | null>(null);

  // Color mode values
  const defaultBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.15), rgba(148, 163, 184, 0.2))",
    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
  );
  const defaultColor = useColorModeValue("gray.700", "#f1f5f9");
  const hoveredBg = useColorModeValue(
    "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.3), rgba(148, 163, 184, 0.35))",
    "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.2))",
  );
  const hoveredColor = useColorModeValue("gray.800", "#ffffff");
  const borderColor = useColorModeValue(
    "rgba(100, 116, 139, 0.3)",
    "rgba(100, 116, 139, 0.5)",
  );

  // 🛠️ FIX: Move boxShadow useColorModeValue calls to top level (Rules of Hooks)
  const boxShadowHovered = useColorModeValue(
    "0 4px 12px rgba(71, 85, 105, 0.25)",
    "0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px rgba(100, 116, 139, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );
  const boxShadowDefault = useColorModeValue(
    "0 2px 8px rgba(71, 85, 105, 0.15)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(100, 116, 139, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const boxShadowHover = useColorModeValue(
    "0 4px 12px rgba(71, 85, 105, 0.25)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(100, 116, 139, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );
  const addClaimButtonColor = useColorModeValue(
    "teal.600",
    "rgba(0, 162, 255, 1)",
  );
  const addClaimButtonBoxShadow = useColorModeValue(
    "0 2px 8px rgba(94, 234, 212, 0.2)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const addClaimButtonHoverBoxShadow = useColorModeValue(
    "0 4px 12px rgba(94, 234, 212, 0.3)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingClaim) return;

      for (const claim of claims) {
        const box = claimRefs.current[claim.claim_id];
        if (box) {
          const rect = box.getBoundingClientRect();
          const isInside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;

          if (isInside) {
            setHoveredClaimId(claim.claim_id);
            return;
          }
        }
      }

      setHoveredClaimId(null);
    };

    // Re-scan rects at release time — does NOT rely on stale hoveredClaimId state
    const handleMouseUp = (e: MouseEvent) => {
      if (!draggingClaim) return;

      for (const claim of claims) {
        const box = claimRefs.current[claim.claim_id];
        if (box) {
          const rect = box.getBoundingClientRect();
          if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
          ) {
            onDropRef.current(draggingClaim, claim);
            setHoveredClaimId(null);
            return;
          }
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [claims, draggingClaim]); // hoveredClaimId removed — mouseUp no longer depends on it

  return (
    <VStack
      align="start"
      spacing={2}
      borderRight={bubbleStyle ? "none" : "1px solid gray"}
      pr={4}
      alignSelf="flex-start"
      //overflowY="auto"
      //maxHeight="800px"
      width="100%"
      bg={bubbleStyle ? "transparent" : undefined}
    >
      <Heading size="sm">Claims</Heading>

      {/* Link Mode Banner */}
      {linkSelection?.active && linkSelection.source && (
        <Box
          mb={2}
          p={3}
          background="linear-gradient(135deg, rgba(128, 90, 213, 0.3), rgba(128, 90, 213, 0.2))"
          backdropFilter="blur(20px)"
          border="2px solid rgba(128, 90, 213, 0.6)"
          borderRadius="12px"
          boxShadow="0 4px 16px rgba(128, 90, 213, 0.4)"
          width="100%"
        >
          <Text fontSize="sm" fontWeight="bold" color="#D6BCFA" mb={1}>
            🔗 Link Mode Active
          </Text>
          <Text fontSize="xs" color="whiteAlpha.900" noOfLines={2}>
            Linking from: "{linkSelection.source.claim_text}"
          </Text>
          <Text fontSize="xs" color="whiteAlpha.700" mt={2}>
            🟢 Green = Supports • 🔴 Red = Refutes • 🟡 Yellow = Nuance
          </Text>
        </Box>
      )}

      <Box
        as="button"
        background={defaultBg}
        backdropFilter="blur(20px)"
        border={`1px solid ${borderColor}`}
        color={addClaimButtonColor}
        height="50px"
        width="100%"
        px={3}
        py={2}
        borderRadius="12px"
        boxShadow={addClaimButtonBoxShadow}
        position="relative"
        overflow="hidden"
        transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
        _hover={{
          boxShadow: addClaimButtonHoverBoxShadow,
          transform: "translateY(-2px)",
        }}
        onClick={() => {
          setEditingClaim(null);
          setIsClaimModalOpen(true);
        }}
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="20px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, transparent 100%)"
          pointerEvents="none"
        />
        <Text position="relative" zIndex={1}>
          + Add Claim
        </Text>
      </Box>

      {claims.length === 0 ? (
        <Text>No claims found.</Text>
      ) : (
        claims.map((claim) => {
          // Find existing link between this task claim and the selected reference claim
          const existingLink =
            linkSelection?.active && linkSelection.source
              ? claimLinks.find(
                  (link) =>
                    link.claimId === claim.claim_id &&
                    link.sourceClaimId === linkSelection.source?.claim_id,
                )
              : null;

          // Check if this task claim is connected to the open reference modal
          const isConnectedToSelectedReference =
            isReferenceModalOpen &&
            selectedReferenceId &&
            claimLinks.some(
              (link) =>
                link.claimId === claim.claim_id &&
                link.referenceId === selectedReferenceId,
            );

          // Determine border and background colors based on relationship
          const getLinkColors = () => {
            // Priority 1: Show connection to open reference modal
            if (isConnectedToSelectedReference) {
              const link = claimLinks.find(
                (l) =>
                  l.claimId === claim.claim_id &&
                  l.referenceId === selectedReferenceId,
              );

              if (link) {
                switch (link.relation) {
                  case "support":
                    return {
                      border: bubbleStyle
                        ? "6px solid #38A169"
                        : "3px solid #38A169",
                      background: bubbleStyle
                        ? "transparent"
                        : "linear-gradient(135deg, rgba(56, 161, 105, 0.3), rgba(56, 161, 105, 0.2))",
                      hoverBg: "rgba(56, 161, 105, 0.4)",
                      boxShadow: bubbleStyle
                        ? "0 0 30px rgba(56, 161, 105, 0.8), 0 0 60px rgba(56, 161, 105, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)"
                        : "0 0 20px rgba(56, 161, 105, 0.6), 0 0 40px rgba(56, 161, 105, 0.3)",
                      animation: bubbleStyle
                        ? "pulse-green 1.5s ease-in-out infinite"
                        : undefined,
                    };
                  case "refute":
                    return {
                      border: bubbleStyle
                        ? "6px solid #E53E3E"
                        : "3px solid #E53E3E",
                      background: bubbleStyle
                        ? "transparent"
                        : "linear-gradient(135deg, rgba(229, 62, 62, 0.3), rgba(229, 62, 62, 0.2))",
                      hoverBg: "rgba(229, 62, 62, 0.4)",
                      boxShadow: bubbleStyle
                        ? "0 0 30px rgba(229, 62, 62, 0.8), 0 0 60px rgba(229, 62, 62, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)"
                        : "0 0 20px rgba(229, 62, 62, 0.6), 0 0 40px rgba(229, 62, 62, 0.3)",
                      animation: bubbleStyle
                        ? "pulse-red 1.5s ease-in-out infinite"
                        : undefined,
                    };
                  case "nuance":
                    return {
                      border: bubbleStyle
                        ? "6px solid #D69E2E"
                        : "3px solid #D69E2E",
                      background: bubbleStyle
                        ? "transparent"
                        : "linear-gradient(135deg, rgba(214, 158, 46, 0.3), rgba(214, 158, 46, 0.2))",
                      hoverBg: "rgba(214, 158, 46, 0.4)",
                      boxShadow: bubbleStyle
                        ? "0 0 30px rgba(214, 158, 46, 0.8), 0 0 60px rgba(214, 158, 46, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)"
                        : "0 0 20px rgba(214, 158, 46, 0.6), 0 0 40px rgba(214, 158, 46, 0.3)",
                      animation: bubbleStyle
                        ? "pulse-blue 1.5s ease-in-out infinite"
                        : undefined,
                    };
                }
              }
            }

            // Priority 2: Link selection mode
            if (!linkSelection?.active) {
              return {
                border: `1px solid ${borderColor}`,
                background: defaultBg,
                hoverBg: undefined,
              };
            }

            if (existingLink) {
              switch (existingLink.relation) {
                case "support":
                  return {
                    border: bubbleStyle
                      ? "6px solid #38A169"
                      : "3px solid #38A169",
                    background: bubbleStyle
                      ? "transparent"
                      : "linear-gradient(135deg, rgba(56, 161, 105, 0.25), rgba(56, 161, 105, 0.15))",
                    hoverBg: "rgba(56, 161, 105, 0.35)",
                    animation: bubbleStyle
                      ? "pulse-green 1.5s ease-in-out infinite"
                      : undefined,
                  };
                case "refute":
                  return {
                    border: bubbleStyle
                      ? "6px solid #E53E3E"
                      : "3px solid #E53E3E",
                    background: bubbleStyle
                      ? "transparent"
                      : "linear-gradient(135deg, rgba(229, 62, 62, 0.25), rgba(229, 62, 62, 0.15))",
                    hoverBg: "rgba(229, 62, 62, 0.35)",
                    animation: bubbleStyle
                      ? "pulse-red 1.5s ease-in-out infinite"
                      : undefined,
                  };
                case "nuance":
                  return {
                    border: bubbleStyle
                      ? "6px solid #D69E2E"
                      : "3px solid #D69E2E",
                    background: bubbleStyle
                      ? "transparent"
                      : "linear-gradient(135deg, rgba(214, 158, 46, 0.25), rgba(214, 158, 46, 0.15))",
                    hoverBg: "rgba(214, 158, 46, 0.35)",
                    animation: bubbleStyle
                      ? "pulse-blue 1.5s ease-in-out infinite"
                      : undefined,
                  };
                default:
                  return {
                    border: "2px dashed #805AD5",
                    background: bubbleStyle
                      ? "transparent"
                      : "linear-gradient(135deg, rgba(128, 90, 213, 0.2), rgba(128, 90, 213, 0.1))",
                    hoverBg: "rgba(128, 90, 213, 0.3)",
                  };
              }
            }

            // Link mode active but no existing link - neutral highlight
            return {
              border: "2px dashed #805AD5",
              background: bubbleStyle
                ? "transparent"
                : "linear-gradient(135deg, rgba(128, 90, 213, 0.2), rgba(128, 90, 213, 0.1))",
              hoverBg: "rgba(128, 90, 213, 0.3)",
            };
          };

          const colors = getLinkColors();

          return (
            <Box
              key={claim.claim_id}
              ref={(el) => (claimRefs.current[claim.claim_id] = el)}
              data-claim-id={claim.claim_id}
              background={
                bubbleStyle
                  ? "transparent"
                  : hoveredClaimId === claim.claim_id
                    ? hoveredBg
                    : colors.background
              }
              color={
                hoveredClaimId === claim.claim_id ? hoveredColor : defaultColor
              }
              px={bubbleStyle ? 4 : 3}
              py={bubbleStyle ? 3 : 2}
              borderRadius={bubbleStyle ? "30px" : "12px"}
              border={colors.border}
              boxShadow={
                colors.boxShadow
                  ? colors.boxShadow
                  : hoveredClaimId === claim.claim_id
                    ? boxShadowHovered
                    : boxShadowDefault
              }
              _hover={
                linkSelection?.active
                  ? { bg: colors.hoverBg, cursor: "pointer" }
                  : {
                      boxShadow: boxShadowHover,
                      transform: bubbleStyle
                        ? "scale(1.15) rotate(2deg)"
                        : "translateY(-2px)",
                    }
              }
              width="100%"
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              cursor="pointer"
              position="relative"
              overflow="visible"
              transition="all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)"
              fontFamily={
                bubbleStyle
                  ? "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"
                  : "inherit"
              }
              fontWeight={bubbleStyle ? "bold" : "normal"}
              fontSize={bubbleStyle ? "md" : "sm"}
              sx={{
                animation: colors.animation,
                ...(bubbleStyle && {
                  "&::before": {
                    content: '""',
                    position: "absolute",
                    top: "5%",
                    left: "10%",
                    width: "50%",
                    height: "40%",
                    background:
                      "radial-gradient(ellipse at top left, rgba(255, 255, 255, 0.7), transparent 50%)",
                    borderRadius: "50%",
                    pointerEvents: "none",
                  },
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    bottom: "8%",
                    right: "12%",
                    width: "30%",
                    height: "25%",
                    background:
                      "radial-gradient(ellipse at bottom right, rgba(255, 255, 255, 0.4), transparent 60%)",
                    borderRadius: "50%",
                    pointerEvents: "none",
                  },
                }),
                "@keyframes pulse-green": {
                  "0%, 100%": {
                    boxShadow:
                      "0 0 30px rgba(56, 161, 105, 0.8), 0 0 60px rgba(56, 161, 105, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
                    transform: "translateY(0px) scale(1)",
                  },
                  "50%": {
                    boxShadow:
                      "0 0 60px rgba(56, 161, 105, 1), 0 0 120px rgba(56, 161, 105, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
                    transform: "translateY(-3px) scale(1.03)",
                  },
                },
                "@keyframes pulse-red": {
                  "0%, 100%": {
                    boxShadow:
                      "0 0 30px rgba(229, 62, 62, 0.8), 0 0 60px rgba(229, 62, 62, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
                    transform: "translateY(0px) scale(1)",
                  },
                  "50%": {
                    boxShadow:
                      "0 0 60px rgba(229, 62, 62, 1), 0 0 120px rgba(229, 62, 62, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
                    transform: "translateY(-3px) scale(1.03)",
                  },
                },
                "@keyframes pulse-blue": {
                  "0%, 100%": {
                    boxShadow:
                      "0 0 30px rgba(214, 158, 46, 0.8), 0 0 60px rgba(214, 158, 46, 0.5), 0 8px 20px rgba(0, 0, 0, 0.4)",
                    transform: "translateY(0px) scale(1)",
                  },
                  "50%": {
                    boxShadow:
                      "0 0 60px rgba(214, 158, 46, 1), 0 0 120px rgba(214, 158, 46, 0.8), inset 0 4px 8px rgba(255, 255, 255, 0.4), 0 12px 30px rgba(0, 0, 0, 0.5)",
                    transform: "translateY(-3px) scale(1.03)",
                  },
                },
              }}
              onClick={() => {
                if (linkSelection?.active) {
                  onPickTargetForLink?.(claim);
                  return;
                }
                setSelectedClaim(claim);
                setIsClaimViewModalOpen(true);
              }}
            >
              {!bubbleStyle && (
                <Box
                  position="absolute"
                  left={0}
                  top={0}
                  width="20px"
                  height="100%"
                  background="linear-gradient(90deg, rgba(167, 139, 250, 0.4) 0%, transparent 100%)"
                  pointerEvents="none"
                />
              )}
              <Tooltip
                label={claim.claim_text}
                hasArrow
                isDisabled={!!draggingClaim}
              >
                <Text flex="1" noOfLines={1} position="relative" zIndex={1}>
                  {claim.claim_text}
                </Text>
              </Tooltip>
              <HStack spacing={2} position="relative" zIndex={1}>
                <IconButton
                  size="sm"
                  aria-label="Edit"
                  icon={<span>✏️</span>}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingClaim(claim);
                    setIsClaimModalOpen(true);
                  }}
                />
                <IconButton
                  size="sm"
                  colorScheme="purple"
                  aria-label="Verify"
                  icon={<SearchIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVerifyClaim(claim);
                  }}
                />
                <IconButton
                  size="sm"
                  colorScheme="red"
                  aria-label="Delete"
                  icon={<span>🗑️</span>}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteClaim(claim.claim_id);
                  }}
                />
              </HStack>
            </Box>
          );
        })
      )}

      <ClaimModal
        isOpen={isClaimModalOpen}
        onClose={() => {
          setIsClaimModalOpen(false);
          setEditingClaim(null);
        }}
        editingClaim={editingClaim}
        onSave={(claim: Claim) => {
          if (claim.claim_id) {
            // Check if claim text changed
            const original = claims.find(c => c.claim_id === claim.claim_id);
            if (original && original.claim_text !== claim.claim_text) {
              // Text changed - show evidence prompt
              setPendingEdit({
                claim,
                originalText: original.claim_text
              });
              setShowEvidencePrompt(true);
              setIsClaimModalOpen(false);
            } else {
              // Just metadata changed - update directly
              onEditClaim(claim);
              setIsClaimModalOpen(false);
            }
          } else {
            onAddClaim({ ...claim, content_id: taskId });
            setIsClaimModalOpen(false);
          }
          setEditingClaim(null);
        }}
      />
      <RelevanceScanModal
        isOpen={isClaimViewModalOpen}
        onClose={() => {
          setIsClaimViewModalOpen(false);
          setSelectedClaim(null);
        }}
        taskClaim={selectedClaim}
        references={references}
        onOpenLinkOverlay={onOpenLinkOverlay}
        contentId={contentId}
        viewerId={viewerId}
      />

      {/* Evidence Confirmation Modal */}
      <Modal
        isOpen={showEvidencePrompt}
        onClose={() => {
          setShowEvidencePrompt(false);
          setPendingEdit(null);
        }}
        size="lg"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Run Evidence for Updated Claim?</ModalHeader>
          <ModalBody>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontWeight="semibold" mb={1}>
                  Original:
                </Text>
                <Text
                  p={3}
                  bg={useColorModeValue("red.50", "red.900")}
                  borderRadius="md"
                  color={useColorModeValue("red.700", "red.200")}
                >
                  {pendingEdit?.originalText}
                </Text>
              </Box>
              <Box>
                <Text fontWeight="semibold" mb={1}>
                  Updated:
                </Text>
                <Text
                  p={3}
                  bg={useColorModeValue("green.50", "green.900")}
                  borderRadius="md"
                  color={useColorModeValue("green.700", "green.200")}
                >
                  {pendingEdit?.claim.claim_text}
                </Text>
              </Box>
              <Text color={useColorModeValue("gray.600", "gray.400")}>
                Would you like to run the evidence engine to find sources for the updated claim? This may take 30-60 seconds.
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={() => {
                if (pendingEdit) {
                  // Pass runEvidence: true to parent handler
                  onEditClaim({ ...pendingEdit.claim, runEvidence: true } as any);
                }
                setShowEvidencePrompt(false);
                setPendingEdit(null);
              }}
            >
              Yes, Run Evidence
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (pendingEdit) {
                  // Pass runEvidence: false to parent handler
                  onEditClaim({ ...pendingEdit.claim, runEvidence: false } as any);
                }
                setShowEvidencePrompt(false);
                setPendingEdit(null);
              }}
            >
              No, Skip Evidence
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
};

export default TaskClaims;
