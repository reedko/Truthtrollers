import React, { useState, useEffect } from "react";
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
} from "@chakra-ui/react";
import {
  LitReference,
  ReferenceWithClaims,
  FailedReference,
} from "../../../shared/entities/types";
import ReferenceModal from "./modals/ReferenceModal";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";
import ScrapeReferenceModal from "./ScrapeReferenceModal";
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
}

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
}) => {
  const { hasPermission } = usePermissions();
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
  }, [taskId, references]);

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
        <Heading size="sm">Sources</Heading>

        {/* 🔥 Button to Open ReferenceModal */}
        <Box
          as="button"
          background={defaultBg}
          backdropFilter="blur(20px)"
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
            let bubbleBoxShadow = refBoxShadow;
            let bubbleAnimation: string | undefined;
            let bubbleBackground = defaultBg;

            if (bubbleStyle && dominantRelation) {
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
                data-ref-id={ref.reference_content_id} // 👈 for measuring
                border={bubbleBorder}
                background={bubbleStyle ? "transparent" : bubbleBackground}
                color={defaultColor}
                px={bubbleStyle ? 4 : 3}
                py={bubbleStyle ? 3 : 2}
                borderRadius={bubbleStyle ? "30px" : "12px"}
                boxShadow={bubbleBoxShadow}
                width="100%"
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                cursor="pointer"
                mb={0} // 👈 no extra margin here
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
                _hover={{
                  boxShadow: refHoverShadow,
                  transform: bubbleStyle
                    ? "scale(1.15) rotate(-2deg)"
                    : "translateY(-2px)",
                }}
                sx={{
                  animation: bubbleAnimation,
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
              >
                {!bubbleStyle && (
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="20px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(59, 130, 246, 0.4) 0%, transparent 100%)"
                    pointerEvents="none"
                  />
                )}
                <VStack
                  align="start"
                  flex="1"
                  spacing={0}
                  position="relative"
                  zIndex={1}
                >
                  <HStack
                    spacing={2}
                    width="100%"
                    position="relative"
                    zIndex={1}
                  >
                    <Tooltip label={ref.content_name} hasArrow>
                      <Text
                        flex="1"
                        noOfLines={1}
                        onClick={(e) => {
                          onReferenceClick(ref, e);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (ref.url) window.open(ref.url, "_blank");
                        }}
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
                          // Open URL in new tab so user can visit the page
                          window.open(ref.url, "_blank");
                          // Pre-fill the scrape modal with this URL
                          setRetryUrl(ref.url || "");
                          setIsScrapeModalOpen(true);
                        }}
                      >
                        Retry Scrape
                      </Button>
                    )}
                  </HStack>
                </VStack>
                <HStack spacing={2} position="relative" zIndex={1}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Edit"
                    onClick={() => {
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
                    onClick={() => onDeleteReference(ref.reference_content_id)}
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
    </>
  );
};

export default ReferenceList;
