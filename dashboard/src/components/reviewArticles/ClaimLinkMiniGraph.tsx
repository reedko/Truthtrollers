import React from "react";
import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";

export interface ClaimLinkMiniGraphProps {
  relationship: "supports" | "refutes" | "qualifies" | "unclear" | string;
  strength?: number | string | null;
  caseClaimLabel?: string;
  sourceClaimLabel?: string;
}

const relationshipTone = (relationship?: string) => {
  const rel = (relationship || "unclear").toLowerCase();
  if (rel === "supports") return { color: "var(--mr-green)", border: "var(--mr-green-border)", bg: "rgba(34,197,94,0.12)", score: 1 };
  if (rel === "refutes") return { color: "var(--mr-red)", border: "rgba(248,113,113,0.35)", bg: "rgba(248,113,113,0.12)", score: -1 };
  if (rel === "qualifies") return { color: "var(--mr-gold)", border: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.12)", score: 0 };
  return { color: "var(--mr-text-muted)", border: "var(--mr-glass-border)", bg: "rgba(255,255,255,0.06)", score: 0 };
};

const shortLabel = (value?: string) => {
  const clean = (value || "").trim();
  if (!clean) return "Claim";
  return clean.length > 78 ? `${clean.slice(0, 75)}...` : clean;
};

const ClaimLinkMiniGraph: React.FC<ClaimLinkMiniGraphProps> = ({
  relationship,
  strength,
  caseClaimLabel,
  sourceClaimLabel,
}) => {
  const tone = relationshipTone(relationship);
  const numericStrength = typeof strength === "number" ? strength : Number(strength);
  const hasStrength = Number.isFinite(numericStrength);
  const normalized = hasStrength ? Math.max(-1, Math.min(1, numericStrength)) : tone.score;
  const pct = hasStrength ? Math.round(Math.abs(normalized) * 100) : null;
  const needleLeft = `${((normalized + 1) / 2) * 100}%`;
  const strengthText = pct !== null ? `${normalized > 0 ? "+" : normalized < 0 ? "-" : ""}${pct}%` : "Unrated";

  return (
    <Box
      w="100%"
      border="1px solid rgba(113,219,255,0.22)"
      borderRadius="12px"
      p={3}
      bg="linear-gradient(135deg, rgba(3,10,24,0.92), rgba(8,22,58,0.72))"
      boxShadow="inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 28px rgba(0,0,0,0.28)"
    >
      <HStack align="stretch" spacing={3} w="100%" overflowX="auto">
        <Box minW="150px" flex="1" border="1px solid var(--mr-blue-border)" bg="rgba(0,162,255,0.08)" borderRadius="8px" p={3}>
          <Text fontSize="10px" color="var(--mr-blue)" textTransform="uppercase" letterSpacing="0.08em" fontWeight="800">
            Case Claim
          </Text>
          <Text fontSize="xs" color="var(--mr-text-primary)" noOfLines={3}>
            {shortLabel(caseClaimLabel)}
          </Text>
        </Box>

        <VStack justify="center" minW="150px" spacing={2}>
          <HStack spacing={2}>
            <Badge bg={tone.bg} color={tone.color} border={`1px solid ${tone.border}`} borderRadius="8px" px={2} py={1} textTransform="capitalize">
              {relationship || "unclear"}
            </Badge>
            <Text fontSize="13px" color={tone.color} fontWeight="900">
              {strengthText}
            </Text>
          </HStack>
          <Box position="relative" w="132px" h="12px" borderRadius="full" bg="linear-gradient(90deg, #f87171 0%, #fbbf24 50%, #22c55e 100%)" boxShadow={`0 0 16px ${tone.border}`}>
            <Box position="absolute" left={needleLeft} top="-5px" transform="translateX(-50%)" w="4px" h="22px" borderRadius="full" bg={tone.color} boxShadow={`0 0 10px ${tone.color}`} />
          </Box>
          <HStack w="132px" justify="space-between">
            <Text fontSize="8px" color="var(--mr-text-muted)" fontWeight="800">REFUTE</Text>
            <Text fontSize="8px" color="var(--mr-text-muted)" fontWeight="800">MIXED</Text>
            <Text fontSize="8px" color="var(--mr-text-muted)" fontWeight="800">SUPPORT</Text>
          </HStack>
        </VStack>

        <Box minW="150px" flex="1" border="1px solid var(--mr-green-border)" bg="rgba(34,197,94,0.08)" borderRadius="8px" p={3}>
          <Text fontSize="10px" color="var(--mr-green)" textTransform="uppercase" letterSpacing="0.08em" fontWeight="800">
            Source Claim
          </Text>
          <Text fontSize="xs" color="var(--mr-text-primary)" noOfLines={3}>
            {shortLabel(sourceClaimLabel)}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
};

export default ClaimLinkMiniGraph;
