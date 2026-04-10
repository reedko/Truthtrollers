// src/components/overlays/ClaimLinkOverlay.tsx
import React, { useEffect, useState } from "react";
import {
  Box,
  Badge,
  Button,
  FormLabel,
  HStack,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
  Textarea,
  useToast,
} from "@chakra-ui/react";
import ResponsiveOverlay from "./ResponsiveOverlay"; // <-- use the shell we discussed
import {
  addClaimLink,
  fetchContentScores,
  fetchLiveVerimeterScore,
  updateScoresForContent,
} from "../../services/useDashboardAPI";
import { Claim } from "../../../../shared/entities/types";
import { ClaimLink } from "../RelationshipMap";
import { useTaskStore } from "../../store/useTaskStore";
import { calculateLinkPoints } from "../../services/gameScoring";
import { useVerimeterMode } from "../../contexts/VerimeterModeContext";

interface ClaimLinkOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sourceClaim: Pick<Claim, "claim_id" | "claim_text"> | null;
  targetClaim: Claim | null;
  isReadOnly?: boolean;
  claimLink?: ClaimLink | null;
  onLinkCreated?: () => void;
  verimeter_score?: number;
  // 🎮 Game scoring
  onScoreAwarded?: (points: number) => void;
  sourceClaimVeracity?: number; // AI truth rating of source claim
  // AI rationale from reference_claim_task_links
  rationale?: string;
  // AI suggested support level (-1 to 1)
  aiSupportLevel?: number | null;
}

const ClaimLinkOverlay: React.FC<ClaimLinkOverlayProps> = ({
  isOpen,
  onClose,
  sourceClaim,
  targetClaim,
  isReadOnly,
  claimLink,
  onLinkCreated,
  onScoreAwarded,
  sourceClaimVeracity,
  rationale,
  aiSupportLevel,
}) => {
  const toast = useToast();
  const { mode, aiWeight } = useVerimeterMode();
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);
  const viewerId = useTaskStore((s) => s.viewingUserId) ?? 0; // use your store id

  const [supportLevel, setSupportLevel] = useState(0);
  const [relationship, setRelationship] = useState<"supports" | "refutes" | "nuanced">(
    "nuanced",
  );
  // Pre-populate notes with AI rationale from reference_claim_task_links
  const [notes, setNotes] = useState(claimLink?.notes || rationale || "");
  const [verimeterScore, setLocalVerimeterScore] = useState<number | null>(
    claimLink?.verimeter_score ?? null,
  );

  // Track whether the current values were AI-suggested (for badge display)
  const [aiPrefilled, setAiPrefilled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When modal opens, sync notes + support level with AI suggestions
  useEffect(() => {
    if (isOpen && !isReadOnly && !claimLink?.notes) {
      setNotes(rationale || "");

      if (aiSupportLevel != null) {
        setSupportLevel(aiSupportLevel);
        if (aiSupportLevel === 0) setRelationship("nuanced");
        else if (aiSupportLevel > 0) setRelationship("supports");
        else setRelationship("refutes");
        setAiPrefilled(true);
      } else {
        setSupportLevel(0);
        setRelationship("nuanced");
        setAiPrefilled(false);
      }
    }

    // Reset ai badge when modal closes
    if (!isOpen) {
      setAiPrefilled(false);
      setSupportLevel(0);
      setRelationship("nuanced");
      setNotes("");
      setIsSubmitting(false);
    }
  }, [isOpen, rationale, aiSupportLevel, isReadOnly, claimLink?.notes]);

  // Update relationship based on support level
  const handleSupportLevelChange = (val: number) => {
    setSupportLevel(val);
    setAiPrefilled(false); // user is now manually adjusting
    if (val === 0) {
      setRelationship("nuanced");
    } else if (val > 0) {
      setRelationship("supports");
    } else {
      setRelationship("refutes");
    }
  };

  // keep your live score fetch behavior for read-only viewing
  useEffect(() => {
    const shouldFetch =
      isReadOnly &&
      isOpen &&
      targetClaim?.claim_id &&
      viewerId &&
      verimeterScore === null;

    if (shouldFetch) {
      fetchLiveVerimeterScore(targetClaim.claim_id, viewerId)
        .then((result) => {
          if (
            Array.isArray(result) &&
            typeof result[0]?.verimeter_score === "number"
          ) {
            setLocalVerimeterScore(result[0].verimeter_score);
          }
        })
        .catch((err) => {
          console.error("Error fetching verimeter score in overlay:", err);
        });
    }
  }, [isReadOnly, isOpen, targetClaim?.claim_id, viewerId, verimeterScore]);

  const handleSubmit = async () => {
    if (isSubmitting) return; // Prevent duplicate submissions

    setIsSubmitting(true);
    try {
      // Map "nuanced" to "related" for the API
      const apiRelationship = relationship === "nuanced" ? "related" : relationship;

      // 🎮 Calculate points BEFORE creating link
      let pointsEarned = 0;
      if (onScoreAwarded && sourceClaimVeracity !== undefined) {
        pointsEarned = calculateLinkPoints(sourceClaimVeracity, supportLevel);
        console.log(`🎮 Points earned: ${pointsEarned} (veracity: ${sourceClaimVeracity}, stance: ${supportLevel})`);
      }

      // Create link with points_earned
      await addClaimLink({
        source_claim_id: sourceClaim?.claim_id ?? 0,
        target_claim_id: targetClaim?.claim_id ?? 0,
        user_id: viewerId, // <-- FIXED: use your store id
        relationship: apiRelationship, // "supports" | "refutes" | "related"
        support_level: supportLevel, // (keep your -1..1 slider as-is)
        notes, // from your existing field
        points_earned: pointsEarned, // 🎮 Save to database
      });

      // Link created successfully - notify parent
      onLinkCreated?.();

      // 🎮 Award points locally
      if (onScoreAwarded && sourceClaimVeracity !== undefined) {
        onScoreAwarded(pointsEarned);

        toast({
          title: `Claim link created - ${pointsEarned >= 0 ? '+' : ''}${pointsEarned.toFixed(1)} points!`,
          description: `Link: ${relationship} (${supportLevel})`,
          status: pointsEarned >= 0 ? "success" : "warning",
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Claim link created",
          description: `Link: ${relationship} (${supportLevel})`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      }

      // Update scores (non-blocking - errors won't prevent modal close)
      const contentId = targetClaim?.content_id ?? null;
      if (contentId) {
        try {
          await updateScoresForContent(contentId, viewerId);
          const scores = await fetchContentScores(contentId, viewerId, mode, aiWeight);
          setVerimeterScore(contentId, scores?.verimeterScore ?? null);
        } catch (scoreErr) {
          console.warn("Failed to update scores after link creation:", scoreErr);
          // Don't show error toast - link was created successfully
        }
      }

      onClose();
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to create link",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = !isReadOnly
    ? "Create Claim Relationship"
    : "Claim Relationship";

  const footer = !isReadOnly ? (
    <>
      <Button
        bg="rgba(72, 187, 120, 0.3)"
        color="white"
        backdropFilter="blur(10px)"
        border="1px solid"
        borderColor="rgba(72, 187, 120, 0.5)"
        mr={3}
        onClick={handleSubmit}
        isLoading={isSubmitting}
        isDisabled={isSubmitting}
        _hover={{
          bg: "rgba(72, 187, 120, 0.4)",
          transform: "translateY(-1px)",
          boxShadow: "0 6px 16px rgba(0, 0, 0, 0.5), 0 0 20px rgba(72, 187, 120, 0.3)",
        }}
        boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
      >
        Create Link
      </Button>
      <Button
        bg="rgba(160, 174, 192, 0.2)"
        color="white"
        backdropFilter="blur(10px)"
        border="1px solid"
        borderColor="rgba(160, 174, 192, 0.4)"
        onClick={onClose}
        isDisabled={isSubmitting}
        _hover={{
          bg: "rgba(160, 174, 192, 0.3)",
          transform: "translateY(-1px)",
          boxShadow: "0 6px 16px rgba(0, 0, 0, 0.5)",
        }}
        boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
      >
        Cancel
      </Button>
    </>
  ) : (
    <Button
      bg="rgba(160, 174, 192, 0.2)"
      color="white"
      backdropFilter="blur(10px)"
      border="1px solid"
      borderColor="rgba(160, 174, 192, 0.4)"
      onClick={onClose}
      _hover={{
        bg: "rgba(160, 174, 192, 0.3)",
        transform: "translateY(-1px)",
        boxShadow: "0 6px 16px rgba(0, 0, 0, 0.5)",
      }}
      boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
    >
      Close
    </Button>
  );

  return (
    <ResponsiveOverlay
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      size="lg"
    >
      <Text fontWeight="bold" mb={2} color="rgba(113, 219, 255, 0.9)">
        Source Claim:
      </Text>
      <Box
        mb={4}
        p={3}
        bg="rgba(15, 25, 40, 0.6)"
        backdropFilter="blur(15px)"
        borderLeftRadius="16px"
        border="1px solid"
        borderColor="rgba(113, 219, 255, 0.3)"
        boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        position="relative"
        overflow="hidden"
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="20px"
          height="100%"
          background="linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)"
          borderLeftRadius="16px"
          pointerEvents="none"
          zIndex={0}
        />
        <Text fontSize="sm" position="relative" zIndex={1} color="white">{sourceClaim?.claim_text}</Text>
      </Box>

      <Text fontWeight="bold" mb={2} color="rgba(113, 219, 255, 0.9)">
        Target Claim:
      </Text>
      <Box
        mb={4}
        p={3}
        bg="rgba(15, 25, 40, 0.6)"
        backdropFilter="blur(15px)"
        borderLeftRadius="16px"
        border="1px solid"
        borderColor="rgba(113, 219, 255, 0.3)"
        boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        position="relative"
        overflow="hidden"
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="20px"
          height="100%"
          background="linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)"
          borderLeftRadius="16px"
          pointerEvents="none"
          zIndex={0}
        />
        <Text fontSize="sm" position="relative" zIndex={1} color="white">{targetClaim?.claim_text}</Text>
      </Box>

      <HStack mb={1} mt={4} align="center" spacing={2}>
        <FormLabel mb={0} color="rgba(113, 219, 255, 0.9)" fontWeight="bold">Notes</FormLabel>
        {aiPrefilled && notes && (
          <Badge
            bg="rgba(139, 92, 246, 0.3)"
            color="white"
            border="1px solid"
            borderColor="rgba(139, 92, 246, 0.5)"
            fontSize="2xs"
          >
            ✨ AI suggested
          </Badge>
        )}
      </HStack>
      {isReadOnly ? (
        <Box
          p={3}
          bg="rgba(15, 25, 40, 0.6)"
          backdropFilter="blur(15px)"
          borderLeftRadius="16px"
          border="1px solid"
          borderColor="rgba(113, 219, 255, 0.3)"
          boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          position="relative"
          overflow="hidden"
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="20px"
            height="100%"
            background="linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)"
            borderLeftRadius="16px"
            pointerEvents="none"
            zIndex={0}
          />
          <Text fontSize="sm" fontStyle="italic" position="relative" zIndex={1} color="rgba(255, 255, 255, 0.8)">
            {claimLink?.notes || "No notes provided."}
          </Text>
        </Box>
      ) : (
        <Textarea
          placeholder="Optional notes about this link..."
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setAiPrefilled(false); }}
          bg="rgba(15, 25, 40, 0.6)"
          backdropFilter="blur(15px)"
          borderLeftRadius="16px"
          border="1px solid"
          borderColor="rgba(113, 219, 255, 0.3)"
          color="white"
          _placeholder={{ color: "rgba(255, 255, 255, 0.4)" }}
          _focus={{
            borderColor: "rgba(113, 219, 255, 0.6)",
            boxShadow: "0 0 20px rgba(113, 219, 255, 0.3)",
          }}
          boxShadow="0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        />
      )}

      {isReadOnly && claimLink ? (
        <Box mb={4} mt={2}>
          <FormLabel className="mr-text-primary" mb={1}>Relationship</FormLabel>
          <Text className="mr-text-primary" fontWeight="bold" fontSize="lg">
            {verimeterScore !== null ? (
              <>
                {verimeterScore > 0
                  ? "✅ Supports"
                  : verimeterScore < 0
                    ? "⛔ Refutes"
                    : "⚖️ Neutral"}{" "}
                : {(verimeterScore * 1000).toFixed(0)}%
              </>
            ) : (
              <Text as="span" className="mr-text-muted" fontStyle="italic">
                loading...
              </Text>
            )}
          </Text>
        </Box>
      ) : (
        <>
          <HStack mb={1} align="center" spacing={2}>
            <FormLabel className="mr-text-primary" mb={0}>Support Level</FormLabel>
            {aiPrefilled && (
              <Badge colorScheme="purple" fontSize="2xs">✨ AI suggested</Badge>
            )}
          </HStack>
          <Slider
            aria-label="support-slider"
            value={supportLevel}
            min={-1}
            max={1}
            step={0.1}
            onChange={handleSupportLevelChange}
          >
            <SliderTrack bg="rgba(255,255,255,0.1)">
              <SliderFilledTrack
                bg={
                  supportLevel === 0
                    ? "var(--mr-yellow)"
                    : supportLevel > 0
                    ? "var(--mr-green)"
                    : "var(--mr-red)"
                }
              />
            </SliderTrack>
            <SliderThumb boxSize={6} bg={
              supportLevel === 0
                ? "var(--mr-yellow)"
                : supportLevel > 0
                ? "var(--mr-green)"
                : "var(--mr-red)"
            } />
          </Slider>
          <Box mt={2} textAlign="center">
            <Text className="mr-text-primary" fontWeight="bold" fontSize="lg">
              {supportLevel === 0
                ? "⚖️ Nuanced"
                : supportLevel > 0
                ? "✅ Supports"
                : "⛔ Refutes"
              } ({supportLevel.toFixed(1)})
            </Text>
          </Box>
        </>
      )}
    </ResponsiveOverlay>
  );
};

export default ClaimLinkOverlay;
