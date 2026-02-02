// src/components/TruthGapMeter.tsx
/**
 * Visual meter showing gap between user belief and evidence
 * Provides live feedback during gameplay
 */

import React from "react";
import { Box, Text, Tooltip } from "@chakra-ui/react";
import { getGapColor } from "../services/userRatingService";

interface TruthGapMeterProps {
  priorBelief: number; // 0-100
  evidenceTruthScore: number; // 0-100
  cardsExamined: number;
  totalCards: number;
  averageHonestyScore?: number; // 0-100
}

const TruthGapMeter: React.FC<TruthGapMeterProps> = ({
  priorBelief,
  evidenceTruthScore,
  cardsExamined,
  totalCards,
  averageHonestyScore,
}) => {
  const gap = Math.abs(priorBelief - evidenceTruthScore);
  const gapColor = getGapColor(gap);

  // Determine if evidence supports or refutes belief
  const evidenceDirection =
    evidenceTruthScore > priorBelief
      ? "SUPPORTS"
      : evidenceTruthScore < priorBelief
      ? "REFUTES"
      : "NEUTRAL";

  const directionColor =
    evidenceDirection === "SUPPORTS"
      ? "#4ade80"
      : evidenceDirection === "REFUTES"
      ? "#f87171"
      : "#fbbf24";

  return (
    <Box
      className="mr-card"
      p="20px"
      mb="20px"
      background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
      backdropFilter="blur(20px)"
      border="2px solid rgba(0, 162, 255, 0.3)"
      borderRadius="12px"
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.2)"
    >
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb="16px">
        <Text
          className="mr-text-primary"
          fontSize="1.1rem"
          fontWeight="600"
          letterSpacing="1px"
          textTransform="uppercase"
        >
          📊 Evidence Analysis
        </Text>
        <Text className="mr-text-secondary" fontSize="0.85rem">
          {cardsExamined} / {totalCards} Cards Examined
        </Text>
      </Box>

      {/* Belief vs Evidence */}
      <Box mb="16px">
        <Box display="flex" justifyContent="space-between" mb="8px">
          <Box>
            <Text className="mr-text-secondary" fontSize="0.75rem" mb="4px">
              YOUR PRIOR BELIEF
            </Text>
            <Text
              className="mr-text-primary"
              fontSize="1.5rem"
              fontWeight="700"
              color="#a78bfa"
            >
              {priorBelief}% True
            </Text>
          </Box>

          <Box textAlign="right">
            <Text className="mr-text-secondary" fontSize="0.75rem" mb="4px">
              EVIDENCE SAYS
            </Text>
            <Text
              className="mr-text-primary"
              fontSize="1.5rem"
              fontWeight="700"
              color={directionColor}
            >
              {evidenceTruthScore}% True
            </Text>
          </Box>
        </Box>

        {/* Visual Gap Bar */}
        <Box position="relative" height="40px" mb="8px">
          {/* Background track */}
          <Box
            position="absolute"
            top="50%"
            left="0"
            right="0"
            height="8px"
            background="rgba(100, 116, 139, 0.3)"
            borderRadius="4px"
            transform="translateY(-50%)"
          />

          {/* Prior Belief Marker */}
          <Tooltip label={`Your belief: ${priorBelief}%`} placement="top">
            <Box
              position="absolute"
              top="50%"
              left={`${priorBelief}%`}
              transform="translate(-50%, -50%)"
              width="20px"
              height="20px"
              borderRadius="50%"
              background="#a78bfa"
              border="3px solid rgba(139, 92, 246, 0.4)"
              boxShadow="0 0 12px #a78bfa"
              zIndex={2}
              cursor="pointer"
            />
          </Tooltip>

          {/* Evidence Score Marker */}
          <Tooltip label={`Evidence: ${evidenceTruthScore}%`} placement="top">
            <Box
              position="absolute"
              top="50%"
              left={`${evidenceTruthScore}%`}
              transform="translate(-50%, -50%)"
              width="20px"
              height="20px"
              borderRadius="50%"
              background={directionColor}
              border={`3px solid ${directionColor}40`}
              boxShadow={`0 0 12px ${directionColor}`}
              zIndex={2}
              cursor="pointer"
            />
          </Tooltip>

          {/* Gap Indicator Line */}
          {gap > 5 && (
            <Box
              position="absolute"
              top="50%"
              left={`${Math.min(priorBelief, evidenceTruthScore)}%`}
              width={`${gap}%`}
              height="4px"
              background={gapColor}
              opacity={0.6}
              transform="translateY(-50%)"
              zIndex={1}
            />
          )}
        </Box>

        {/* Gap Info */}
        <Box textAlign="center">
          <Text className="mr-text-secondary" fontSize="0.75rem">
            Truth Gap
          </Text>
          <Text fontSize="1.2rem" fontWeight="700" color={gapColor}>
            {gap.toFixed(0)} points{" "}
            <Text as="span" fontSize="0.85rem" opacity={0.8}>
              ({gap < 10 ? "Excellent" : gap < 25 ? "Good" : gap < 50 ? "Fair" : "Poor"})
            </Text>
          </Text>
          <Text className="mr-text-secondary" fontSize="0.75rem" mt="4px">
            Evidence {evidenceDirection} your belief
          </Text>
        </Box>
      </Box>

      {/* Honesty Score */}
      {averageHonestyScore !== undefined && (
        <Box
          borderTop="1px solid rgba(100, 116, 139, 0.3)"
          pt="12px"
          mt="12px"
          textAlign="center"
        >
          <Text className="mr-text-secondary" fontSize="0.75rem" mb="4px">
            HONESTY SCORE
          </Text>
          <Box display="flex" justifyContent="center" alignItems="center" gap="8px">
            <Text fontSize="1.2rem" fontWeight="700" color="#4ade80">
              {averageHonestyScore.toFixed(0)}%
            </Text>
            <Text className="mr-text-secondary" fontSize="0.75rem">
              {"⭐".repeat(Math.ceil(averageHonestyScore / 20))}
            </Text>
          </Box>
          <Text className="mr-text-secondary" fontSize="0.65rem" mt="4px" opacity={0.7}>
            How close your ratings match AI assessments
          </Text>
        </Box>
      )}

      {/* Tip */}
      {gap > 25 && (
        <Box
          mt="12px"
          p="10px"
          background="rgba(251, 191, 36, 0.1)"
          border="1px solid rgba(251, 191, 36, 0.3)"
          borderRadius="6px"
        >
          <Text className="mr-text-secondary" fontSize="0.75rem">
            💡 <Text as="span" fontWeight="600">Tip:</Text> Your belief differs significantly from evidence.
            Consider examining remaining cards carefully.
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default TruthGapMeter;
