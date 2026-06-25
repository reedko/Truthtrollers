import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  VStack,
  Heading,
  Button,
  HStack,
  Tooltip,
  Box,
  Text,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  IconButton,
  Badge,
  useColorModeValue,
  Checkbox,
} from "@chakra-ui/react";
import {
  LitReference,
  ReferenceWithClaims,
  FailedReference,
} from "../../../shared/entities/types";
import ReferenceModal from "./modals/ReferenceModal";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ScrapeReferenceModal from "./ScrapeReferenceModal";
import SourceCrest from "./SourceCrest";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";
import SourceDetailModal from "./modals/SourceDetailModal";
import { fetchFailedReferences } from "../services/useDashboardAPI";
import usePermissions from "../hooks/usePermissions";
import { ClaimLink } from "./RelationshipMap";

interface ReferenceListProps {
  references: ReferenceWithClaims[];
  onEditReference: (referenceId: number, title: string) => void;
  onDeleteReference: (referenceId: number) => void;
  taskId: number;
  onReferenceClick: (ref: ReferenceWithClaims, e: React.MouseEvent) => void;
  selectedReference: ReferenceWithClaims | null; // 👈 add this!
  onUpdateReferences?: () => void; // ✅ new
  bubbleStyle?: boolean;
  claimLinks?: ClaimLink[];
  isSuperAdmin?: boolean;
  onHardDeleteReferences?: (referenceIds: number[]) => Promise<void>;
  focusedReferenceId?: number | null;
}

const BUBBLE_KEYFRAMES = {
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
} as const;

const ReferenceList: React.FC<ReferenceListProps> = ({
  references,
  onEditReference,
  onDeleteReference,
  taskId,
  onReferenceClick,
  selectedReference,
  onUpdateReferences,
  bubbleStyle = false,
  claimLinks = [],
  isSuperAdmin = false,
  onHardDeleteReferences,
  focusedReferenceId = null,
}) => {
  const { hasPermission } = usePermissions();
  const [selectedRefIds, setSelectedRefIds] = useState<Set<number>>(new Set());

  const toggleRefSelection = (refId: number) => {
    setSelectedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(refId)) next.delete(refId);
      else next.add(refId);
      return next;
    });
  };

  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingReference, setEditingReference] =
    useState<ReferenceWithClaims | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [failedReferenceIds, setFailedReferenceIds] = useState<Set<number>>(
    new Set(),
  );
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [retryUrl, setRetryUrl] = useState("");
  const [sourceDetailRef, setSourceDetailRef] = useState<ReferenceWithClaims | null>(null);
  const [glowPublisherId, setGlowPublisherId] = useState<number | null>(null);
  const [focusedGlowId, setFocusedGlowId] = useState<number | null>(null);
  const refCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const focusedGlowTimerRef = useRef<number | null>(null);

  // Color mode values
  const defaultBg = useColorModeValue(
    "linear-gradient(135deg, rgba(148, 163, 184, 0.2), rgba(203, 213, 225, 0.3))",
    "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
  );
  const defaultColor = useColorModeValue("gray.700", "#f1f5f9");
  const borderColor = useColorModeValue(
    "rgba(148, 163, 184, 0.3)",
    "rgba(59, 130, 246, 0.4)",
  );

  // Reference card shadows - must be called at top level, not inside map
  const refBoxShadow = useColorModeValue(
    "0 2px 8px rgba(94, 234, 212, 0.2)",
    "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  );
  const refHoverShadow = useColorModeValue(
    "0 4px 12px rgba(94, 234, 212, 0.3)",
    "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
  );
  const useBubbleEffects = bubbleStyle && references.length <= 40;
  const isLargeReferenceList = references.length > 40;
  const effectiveRefBoxShadow = isLargeReferenceList
    ? "0 1px 4px rgba(0, 0, 0, 0.18)"
    : refBoxShadow;
  const effectiveRefHoverShadow = isLargeReferenceList
    ? "0 2px 8px rgba(0, 0, 0, 0.22)"
    : refHoverShadow;

  const focusReferenceCard = useCallback((referenceId: number) => {
    const focus = () => {
      const node = refCardRefs.current.get(referenceId);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      setFocusedGlowId(referenceId);

      if (focusedGlowTimerRef.current) {
        window.clearTimeout(focusedGlowTimerRef.current);
      }
      focusedGlowTimerRef.current = window.setTimeout(() => {
        setFocusedGlowId((current) =>
          current === referenceId ? null : current,
        );
        focusedGlowTimerRef.current = null;
      }, 4500);
    };

    window.requestAnimationFrame(focus);
    window.setTimeout(focus, 150);
  }, []);

  useEffect(() => {
    if (!focusedReferenceId) return;
    focusReferenceCard(focusedReferenceId);
  }, [focusedReferenceId, focusReferenceCard]);

  useEffect(() => {
    return () => {
      if (focusedGlowTimerRef.current) {
        window.clearTimeout(focusedGlowTimerRef.current);
      }
    };
  }, []);

  // Fetch failed references when component mounts or taskId changes
  useEffect(() => {
    if (taskId) {
      fetchFailedReferences(taskId).then((failedRefs) => {
        const ids = new Set(failedRefs.map((ref) => ref.content_id));
        setFailedReferenceIds(ids);
        console.log(
          `📋 Found ${failedRefs.length} failed references for task ${taskId}:`,
          failedRefs,
        );
      });
    }
  }, [taskId]); // `references` intentionally omitted — it changes identity on every parent render

  // Check if a reference is failed
  const isFailedReference = (refId: number) => failedReferenceIds.has(refId);

  return (
    <>
      <VStack
        align="start"
        spacing={2}
        borderLeft={bubbleStyle ? "none" : "1px solid gray"}
        alignSelf="flex-start"
        pl={4}
        width="100%"
        bg={bubbleStyle ? "transparent" : undefined}
      >
        <HStack width="100%" justify="space-between">
          <Heading size="sm">Sources</Heading>
          {isSuperAdmin && selectedRefIds.size > 0 && (
            <Button
              size="xs"
              colorScheme="red"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Permanently remove ${selectedRefIds.size} source(s) from this case for EVERYONE? This cannot be undone.`,
                  )
                )
                  return;
                await onHardDeleteReferences?.([...selectedRefIds]);
                setSelectedRefIds(new Set());
              }}
            >
              🗑 Delete {selectedRefIds.size} for Everyone
            </Button>
          )}
        </HStack>

        {/* 🔥 Button to Open ReferenceModal */}
        <Box
          as="button"
          background={defaultBg}
          border={`1px solid ${borderColor}`}
          color={useColorModeValue("teal.600", "rgba(0, 162, 255, 1)")}
          height="50px"
          width="100%"
          px={3}
          py={2}
          borderRadius="12px"
          boxShadow={useColorModeValue(
            "0 2px 8px rgba(94, 234, 212, 0.2)",
            "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          )}
          position="relative"
          overflow="hidden"
          transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
          _hover={{
            boxShadow: useColorModeValue(
              "0 4px 12px rgba(94, 234, 212, 0.3)",
              "0 8px 24px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
            ),
            transform: "translateY(-2px)",
          }}
          onClick={() => setIsReferenceModalOpen(true)}
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
            + Add Source
          </Text>
        </Box>

        {references.length === 0 ? (
          <Text>No Sources Found</Text>
        ) : (
          references.map((ref) => {
            // Find all links for this reference and determine dominant color
            const refLinks = claimLinks.filter(
              (link) => link.referenceId === ref.reference_content_id,
            );

            // Count relationship types
            const relationCounts = {
              support: refLinks.filter((l) => l.relation === "support").length,
              refute: refLinks.filter((l) => l.relation === "refute").length,
              nuance: refLinks.filter((l) => l.relation === "nuance").length,
            };

            // Determine dominant relationship
            let dominantRelation: "support" | "refute" | "nuance" | null = null;
            if (
              relationCounts.support > 0 ||
              relationCounts.refute > 0 ||
              relationCounts.nuance > 0
            ) {
              const maxCount = Math.max(
                relationCounts.support,
                relationCounts.refute,
                relationCounts.nuance,
              );
              if (relationCounts.support === maxCount)
                dominantRelation = "support";
              else if (relationCounts.refute === maxCount)
                dominantRelation = "refute";
              else dominantRelation = "nuance";
            }

            // Determine styling based on bubbleStyle and dominant relation
            let bubbleBorder = `1px solid ${borderColor}`;
            let bubbleBoxShadow = effectiveRefBoxShadow;
            let bubbleAnimation: string | undefined;
            let bubbleBackground = defaultBg;
            const referenceId = Number(ref.reference_content_id);
            const isFocused = focusedGlowId === referenceId;

            if (useBubbleEffects && dominantRelation) {
              switch (dominantRelation) {
                case "support":
                  bubbleBorder = "2px solid #38A169";
                  bubbleBoxShadow =
                    "0 0 30px rgba(56, 161, 105, 0.8), 0 0 60px rgba(56, 161, 105, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)";
                  bubbleAnimation = "pulse-green 1.5s ease-in-out infinite";
                  bubbleBackground = "transparent";
                  break;
                case "refute":
                  bubbleBorder = "2px solid #E53E3E";
                  bubbleBoxShadow =
                    "0 0 30px rgba(229, 62, 62, 0.8), 0 0 60px rgba(229, 62, 62, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)";
                  bubbleAnimation = "pulse-red 1.5s ease-in-out infinite";
                  bubbleBackground = "transparent";
                  break;
                case "nuance":
                  bubbleBorder = "2px solid #D69E2E";
                  bubbleBoxShadow =
                    "0 0 30px rgba(214, 158, 46, 0.8), 0 0 60px rgba(214, 158, 46, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.2)";
                  bubbleAnimation = "pulse-blue 1.5s ease-in-out infinite";
                  bubbleBackground = "transparent";
                  break;
              }
            }

            return (
              <Box
                key={ref.reference_content_id}
                ref={(node) => {
                  if (node) refCardRefs.current.set(referenceId, node);
                  else refCardRefs.current.delete(referenceId);
                }}
                data-ref-id={ref.reference_content_id} // 👈 for measuring
                border={isFocused ? "3px solid #FBBF24" : bubbleBorder}
                background={bubbleStyle ? "transparent" : bubbleBackground}
                color={defaultColor}
                px={bubbleStyle ? 4 : 3}
                py={bubbleStyle ? 3 : 1}
                borderRadius={bubbleStyle ? "30px" : "12px"}
                boxShadow={
                  isFocused
                    ? "0 0 0 3px rgba(251, 191, 36, 0.35), 0 6px 18px rgba(0, 0, 0, 0.28)"
                    : bubbleBoxShadow
                }
                width="100%"
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                cursor="pointer"
                mb={0} // 👈 no extra margin here
                position="relative"
                overflow="visible"
                transition="border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease"
                fontFamily={
                  bubbleStyle
                    ? "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"
                    : "inherit"
                }
                fontWeight={bubbleStyle ? "bold" : "normal"}
                fontSize={bubbleStyle ? "md" : "sm"}
                _hover={{
                  boxShadow: effectiveRefHoverShadow,
                  transform: bubbleStyle
                    ? "scale(1.15) rotate(-2deg)"
                    : "translateY(-2px)",
                }}
                sx={{
                  animation: isFocused ? undefined : bubbleAnimation,
                  ...(useBubbleEffects && {
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
                  ...(useBubbleEffects ? BUBBLE_KEYFRAMES : {}),
                }}
                onClick={(event) => onReferenceClick(ref, event)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (ref.url) window.open(ref.url, "_blank");
                }}
              >
                {!bubbleStyle && (
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="20px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(59, 130, 246, 0.4) 0%, transparent 100%)"
                    borderLeftRadius="12px"
                    pointerEvents="none"
                  />
                )}
                {isSuperAdmin && (
                  <Checkbox
                    isChecked={selectedRefIds.has(ref.reference_content_id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleRefSelection(ref.reference_content_id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    mr={2}
                    zIndex={2}
                    position="relative"
                    colorScheme="red"
                  />
                )}
                {/* Crest column — fixed width, vertically centered */}
                <Box flexShrink={0} alignSelf="center" position="relative" zIndex={1} mr={1}>
                  <SourceCrest
                    {...normalizeSourceProfile({
                      publisher_name: ref.publisher_name,
                      is_primary_source: ref.is_primary_source,
                      media_source: ref.media_source,
                      veracity_score: ref.publisher_veracity ?? undefined,
                      rating_label: ref.rating_label ?? undefined,
                      rating_type: ref.rating_type ?? undefined,
                      admiralty_code: ref.admiralty_code ?? undefined,
                    })}
                    size="xs"
                    cacheStatus={ref.admiralty_source === "publisher_cached" ? "cached" : "fresh"}
                    active={!!ref.publisher_id && ref.publisher_id === glowPublisherId}
                    onClick={(e) => { e?.stopPropagation(); setSourceDetailRef(ref); }}
                  />
                </Box>
                {/* Title + byline column */}
                <VStack
                  align="start"
                  flex="1"
                  spacing={0}
                  minW={0}
                  position="relative"
                  zIndex={1}
                >
                  <HStack spacing={2} width="100%">
                    <Tooltip label={ref.content_name} hasArrow>
                      <Text
                        flex="1"
                        noOfLines={1}
                      >
                        {ref.content_name}
                      </Text>
                    </Tooltip>
                    {isFailedReference(ref.reference_content_id) && (
                      <Button
                        size="xs"
                        colorScheme="orange"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(ref.url, "_blank");
                          setRetryUrl(ref.url || "");
                          setIsScrapeModalOpen(true);
                        }}
                      >
                        Retry Scrape
                      </Button>
                    )}
                  </HStack>
                  {/* Byline */}
                  <Text fontSize="2xs" color="rgba(0,162,255,0.55)" noOfLines={1} lineHeight="1.1" mt="0">
                    <Text as="span" opacity={0.6}>Pub: </Text>
                    <Text as="span" color={ref.publisher_name ? "rgba(0,162,255,0.8)" : "rgba(255,255,255,0.25)"}>
                      {ref.publisher_name ?? "—"}
                    </Text>
                    <Text as="span" opacity={0.4}> · </Text>
                    <Text as="span" opacity={0.6}>Auth: </Text>
                    <Text as="span" color={ref.author_name ? "rgba(0,162,255,0.8)" : "rgba(255,255,255,0.25)"}>
                      {ref.author_name?.trim() ?? "—"}
                    </Text>
                  </Text>
                </VStack>
                <HStack spacing={2} position="relative" zIndex={1}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingReference(ref);
                      setNewTitle(ref.content_name);
                      setIsEditModalOpen(true);
                    }}
                  >
                    ✏️
                  </Button>
                  <IconButton
                    size="sm"
                    colorScheme="red"
                    aria-label="Delete"
                    icon={<span>🗑️</span>}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteReference(ref.reference_content_id);
                    }}
                  />
                </HStack>
              </Box>
            );
          })
        )}
      </VStack>

      {/* 🔥 Reference Modal for Adding References */}
      <ReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        taskId={taskId} // Pass actual taskId from parent
        onUpdateReferences={onUpdateReferences}
      />

      {/* 🔥 Modal for Editing Reference Title */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Source Title</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter new title"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="green"
              onClick={() => {
                if (editingReference) {
                  onEditReference(
                    editingReference?.reference_content_id as number,
                    newTitle,
                  );
                  setIsEditModalOpen(false);
                }
              }}
              isDisabled={!newTitle.trim()}
            >
              Save
            </Button>
            <Button onClick={() => setIsEditModalOpen(false)} ml={2}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 🔥 Scrape Reference Modal for Retrying Failed Scrapes */}
      <ScrapeReferenceModal
        isOpen={isScrapeModalOpen}
        onClose={() => {
          setIsScrapeModalOpen(false);
          setRetryUrl("");
        }}
        taskId={taskId.toString()}
        onUpdateReferences={onUpdateReferences}
        initialUrl={retryUrl}
      />

      {sourceDetailRef && (() => {
        const profile = normalizeSourceProfile({
          publisher_name: sourceDetailRef.publisher_name,
          is_primary_source: sourceDetailRef.is_primary_source,
          media_source: sourceDetailRef.media_source,
          veracity_score: sourceDetailRef.publisher_veracity ?? undefined,
          admiralty_code: sourceDetailRef.admiralty_code ?? undefined,
        });
        return (
          <SourceDetailModal
            isOpen={!!sourceDetailRef}
            onClose={() => {
              const refId = sourceDetailRef.reference_content_id;
              const pid = sourceDetailRef.publisher_id ?? null;
              setSourceDetailRef(null);
              onUpdateReferences?.();
              focusReferenceCard(refId);
              if (pid) {
                setGlowPublisherId(pid);
                setTimeout(() => setGlowPublisherId(null), 3000);
              }
            }}
            publisherId={sourceDetailRef.publisher_id ?? undefined}
            contentId={sourceDetailRef.reference_content_id}
            sourceUrl={sourceDetailRef.url ?? undefined}
            publisherName={sourceDetailRef.publisher_name ?? ""}
            sourceType={profile.sourceType}
            reliability={profile.reliability}
            admiraltyCode={sourceDetailRef.admiralty_code ?? undefined}
            onPublisherLinked={(newId) => {
              onUpdateReferences?.();
              setGlowPublisherId(newId);
              setTimeout(() => setGlowPublisherId(null), 3000);
            }}
          />
        );
      })()}
    </>
  );
};

export default ReferenceList;
