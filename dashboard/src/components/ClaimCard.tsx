// src/components/ClaimCard.tsx
import React, { useEffect, useState } from "react";
import {
  Box,
  Text,
  Badge,
  Spinner,
  VStack,
  HStack,
  Button,
  useColorModeValue,
} from "@chakra-ui/react";
import { fetchLiveVerimeterScore } from "../services/useDashboardAPI";
import ClaimLinkModal from "./modals/ClaimLinkModal";
import { Claim } from "../../../shared/entities/types";

interface ClaimCardProps {
  claimId: number;
  claimText: string;
  supportLevel: number;
  notes?: string;
  viewerId: number | null;
  sourceClaim: Claim;
  targetClaim: Claim;
  // 🔹 NEW
  variant?: "default" | "pill";
  onClickPill?: () => void; // pill-only click handler
}

const supportColors = {
  1: "green",
  0: "yellow",
  [-1]: "red",
};

const ClaimCard: React.FC<ClaimCardProps> = ({
  claimId,
  claimText,
  supportLevel,
  notes,
  viewerId,
  sourceClaim,
  targetClaim,
  variant = "default",
  onClickPill,
}) => {
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setModalOpen] = useState(false);

  const handleOpenModal = () => setModalOpen(true);
  const handleCloseModal = () => setModalOpen(false);

  const color = useColorModeValue("gray.100", "gray.700");

  useEffect(() => {
    const loadScore = async () => {
      try {
        const result = await fetchLiveVerimeterScore(claimId, viewerId);
        if (
          Array.isArray(result) &&
          typeof result[0]?.verimeter_score === "number"
        ) {
          setVerimeterScore(result[0].verimeter_score);
        }
      } catch (err) {
        console.error("Error loading verimeter score", err);
      } finally {
        setLoading(false);
      }
    };
    loadScore();
  }, [claimId, viewerId]);

  const renderRadialGauge = () => {
    if (verimeterScore === null) return null;

    const percent = Math.round(verimeterScore * 1000);
    const absPercent = Math.min(Math.abs(percent), 100);
    const strokeWidth = 4;
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const arcLength = (absPercent / 100) * circumference;
    const gaugeColor =
      percent > 0 ? "#38A169" : percent < 0 ? "#E53E3E" : "#D69E2E";

    return (
      <Box
        position="relative"
        w="60px"
        h="60px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text
          position="absolute"
          fontSize="xs"
          fontWeight="bold"
          color={gaugeColor}
        >
          {percent > 0 ? "+" : ""}
          {percent}%
        </Text>
        <svg width="60" height="60" viewBox="0 0 40 40">
          <circle
            cx="20"
            cy="20"
            r={radius}
            stroke="rgba(0,0,0,0.1)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx="20"
            cy="20"
            r={radius}
            stroke={gaugeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={percent < 0 ? 0 : circumference - arcLength}
            strokeLinecap="round"
            fill="none"
            transform="rotate(-90 20 20)"
          />
          <circle
            cx="20"
            cy="20"
            r={radius}
            stroke={gaugeColor}
            strokeWidth="0.5"
            opacity="0.15"
            fill="none"
          />
        </svg>
      </Box>
    );
  };

  // 🔹 NEW: compact pill rendering
  if (variant === "pill") {
    const pillColor =
      verimeterScore == null
        ? "gray"
        : verimeterScore > 0
        ? "green"
        : verimeterScore < 0
        ? "red"
        : "yellow";

    return (
      <HStack
        as="button"
        onClick={onClickPill}
        spacing={2}
        px={3}
        py={2}
        borderRadius="md"
        borderWidth="1px"
        bg="rgba(0,0,0,0.25)"
        _hover={{ bg: "rgba(0,0,0,0.35)", transform: "translateY(-1px)" }}
        transition="all 120ms ease"
      >
        <Box w="28px" h="28px" position="relative">
          {/* teeny gauge: simple ring */}
          <Box
            position="absolute"
            inset={0}
            borderRadius="full"
            border="2px solid"
            borderColor={`${pillColor}.400`}
          />
        </Box>
        <Text maxW="240px" isTruncated fontSize="sm">
          {claimText}
        </Text>
        {verimeterScore !== null && (
          <Badge colorScheme={pillColor} ml="auto">
            {verimeterScore > 0
              ? "Supports"
              : verimeterScore < 0
              ? "Refutes"
              : "Neutral"}
          </Badge>
        )}
      </HStack>
    );
  }

  // Default full card
  return (
    <Box
      p={3}
      borderWidth={1}
      borderRadius="md"
      bg="stat2Gradient"
      boxShadow="md"
    >
      <VStack align="start" spacing={3} w="100%">
        <HStack justifyContent="space-between" w="100%" alignItems="center">
          {loading ? <Spinner size="sm" /> : renderRadialGauge()}
          <Box flex={1} textAlign="center">
            {verimeterScore !== null && (
              <Badge
                colorScheme={
                  verimeterScore > 0
                    ? supportColors[1]
                    : verimeterScore < 0
                    ? supportColors[-1]
                    : supportColors[0]
                }
                px={3}
                py={1}
                borderRadius="md"
                fontSize="sm"
              >
                {verimeterScore > 0
                  ? "Supports"
                  : verimeterScore < 0
                  ? "Refutes"
                  : "Neutral"}
              </Badge>
            )}
          </Box>
          <Button size="sm" onClick={handleOpenModal}>
            Details
          </Button>
        </HStack>

        <Text fontWeight="bold" textAlign="left" w="100%">
          {claimText}
        </Text>

        {notes && (
          <Text fontSize="sm" color="gray.400" textAlign="left" w="100%">
            {notes}
          </Text>
        )}

        <ClaimLinkModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          sourceClaim={{
            claim_id: sourceClaim.claim_id,
            claim_text: claimText,
          }}
          targetClaim={targetClaim}
          claimLink={
            {
              claim_link_id: 0,
              source_claim_id: sourceClaim.claim_id,
              target_claim_id: targetClaim.claim_id,
              relationship:
                supportLevel > 0
                  ? "supports"
                  : supportLevel < 0
                  ? "refutes"
                  : "neutral",
              notes: notes || "",
              support_level: supportLevel,
              verimeter_score: verimeterScore ?? null,
            } as any
          }
          isReadOnly={true}
        />
      </VStack>
    </Box>
  );
};

export default ClaimCard;
