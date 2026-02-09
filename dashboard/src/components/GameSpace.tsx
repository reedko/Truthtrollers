import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Text,
  IconButton,
  Spinner,
  useToast,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
} from "@chakra-ui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  RepeatIcon,
  InfoIcon,
} from "@chakra-ui/icons";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";
import ClaimLinkOverlay from "./overlays/ClaimLinkOverlay";
import ReassessClaimModal from "./modals/ReassessClaimModal";
import {
  enrichReferencesWithRelevance,
  sortByRelevance,
  ReferenceWithRelevance,
} from "../services/relevanceScoring";
import { fetchLinksForClaim } from "../services/evidenceEngineClient";
import {
  enrichClaimsWithRelevance,
  ClaimWithRelevance,
} from "../services/referenceClaimRelevance";
import {
  calculateLinkPoints,
  getMaxPossiblePoints,
  formatPoints,
} from "../services/gameScoring";

interface GameSpaceProps {
  contentId: number;
  claims: Claim[];
  references: ReferenceWithClaims[];
  claimLinks?: Array<{
    task_claim_id: number;
    reference_content_id: number;
    reference_claim_id?: number;
  }>;
}

// Playing Card Component - Minority Report Style
interface PlayingCardProps {
  claim: Claim;
  type: "task" | "reference";
  isHovered?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  style?: React.CSSProperties;
  index?: number;
  totalCards?: number;
  // Relevance scoring (for reference claims)
  relevanceScore?: number;
  stance?: "support" | "refute" | "nuance" | "insufficient";
  confidence?: number;
  support_level?: number; // -1.2 to +1.2 directional support score
  rationale?: string; // AI explanation for the stance
  hasLink?: boolean;
  // 🎮 Game scoring
  potentialPoints?: number; // Max points for perfect match
  veracityScore?: number; // AI truth rating
  onReassess?: () => void; // Callback to open reassess modal
}

const PlayingCard: React.FC<PlayingCardProps> = ({
  claim,
  type,
  isHovered = false,
  isFocused = false,
  isSelected = false,
  onClick,
  onHover,
  onDragStart,
  onDragEnd,
  style,
  index = 0,
  totalCards = 1,
  relevanceScore,
  stance,
  confidence,
  support_level,
  rationale,
  hasLink = false,
  potentialPoints,
  veracityScore,
  onReassess,
}) => {
  const typeColors = {
    task: {
      border: "rgba(139, 92, 246, 0.4)",
      glow: "rgba(139, 92, 246, 0.8)",
      text: "#a78bfa",
      indicator: "TASK",
    },
    reference: {
      border: "rgba(34, 197, 94, 0.4)",
      glow: "rgba(34, 197, 94, 0.8)",
      text: "#4ade80",
      indicator: "REFERENCE",
    },
  };

  const colors = typeColors[type];

  // Metrics: show different data based on context
  const metrics =
    type === "reference"
      ? [
          {
            value:
              hasLink && support_level !== undefined
                ? `${support_level > 0 ? "+" : ""}${Math.round(support_level * 100)}`
                : "N/A",
            label: "Truth Rating",
            color:
              (support_level || 0) > 0.3
                ? "#4ade80"
                : (support_level || 0) < -0.3
                  ? "#f87171"
                  : "#fbbf24",
          },
          {
            value:
              stance === "support"
                ? "Support"
                : stance === "refute"
                  ? "Refute"
                  : stance === "nuance"
                    ? "Nuanced"
                    : "Unrated",
            label: "Stance",
            color:
              stance === "support"
                ? "#4ade80"
                : stance === "refute"
                  ? "#f87171"
                  : "#fbbf24",
          },
          {
            value: confidence ? `${Math.round(confidence * 100)}%` : "N/A",
            label: "Confidence",
            color: "#94a3b8",
          },
          {
            value:
              potentialPoints !== undefined
                ? formatPoints(potentialPoints)
                : formatPoints(getMaxPossiblePoints()),
            label: "Max Points",
            color: "#a78bfa",
          },
          { value: index + 1, label: "Position", color: "#64748b" },
        ]
      : [
          { value: claim.veracity_score || 0, label: "Veracity" },
          { value: claim.confidence_level || 0, label: "Confidence" },
          { value: index + 1, label: "Position" },
        ];

  return (
    <Box
      onClick={onClick}
      onMouseEnter={onHover}
      style={style}
      sx={{
        // position is controlled by style prop for stacking
        width: "320px", // Playing card width (2.5" at ~128dpi)
        height: isFocused ? "480px" : "60px", // Playing card height (3.75" expanded) or title only
        background:
          "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
        backdropFilter: "blur(20px)",
        border: `1px solid ${colors.border}`,
        borderRadius: "12px",
        boxShadow: isSelected
          ? `0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
          : isFocused
            ? `0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
            : `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        userSelect: "none",
        overflow: "hidden",
        borderColor: isSelected
          ? colors.border.replace("0.4", "0.8")
          : colors.border,
      }}
    >
      {/* Left edge glow bar - 3D fade effect */}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="20px"
        height="100%"
        background={`linear-gradient(90deg, ${colors.border} 0%, transparent 100%)`}
        pointerEvents="none"
        zIndex={1}
      />

      {/* Scanlines overlay */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        borderRadius="12px"
        zIndex={2}
      />

      {/* Title Bar - Always Visible */}
      <Box
        background={`linear-gradient(90deg, ${colors.border}, transparent)`}
        borderBottom={isFocused ? `1px solid ${colors.border}` : "none"}
        px="16px"
        py="12px"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        position="relative"
        zIndex={3}
        height="60px"
      >
        <Box
          px="10px"
          py="4px"
          background={colors.border.replace("0.4", "0.2")}
          border={`1px solid ${colors.border}`}
          borderRadius="10px"
          fontSize="0.65rem"
          fontWeight="600"
          letterSpacing="1.5px"
          textTransform="uppercase"
          color={colors.text}
          textShadow={`0 0 8px ${colors.glow}`}
        >
          {colors.indicator} {index + 1}
        </Box>
        <Box display="flex" gap="6px" alignItems="center">
          {/* Relevance Score Badge (for reference claims) */}
          {hasLink && relevanceScore !== undefined && (
            <Box
              px="8px"
              py="2px"
              background={
                stance === "support"
                  ? "rgba(34, 197, 94, 0.15)"
                  : stance === "refute"
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(234, 179, 8, 0.15)"
              }
              border={`1px solid ${
                stance === "support"
                  ? "rgba(34, 197, 94, 0.5)"
                  : stance === "refute"
                    ? "rgba(239, 68, 68, 0.5)"
                    : "rgba(234, 179, 8, 0.5)"
              }`}
              borderRadius="8px"
              fontSize="0.65rem"
              fontWeight="700"
              letterSpacing="0.5px"
              color={
                stance === "support"
                  ? "#4ade80"
                  : stance === "refute"
                    ? "#f87171"
                    : "#fbbf24"
              }
              textShadow={`0 0 6px ${
                stance === "support"
                  ? "#4ade80"
                  : stance === "refute"
                    ? "#f87171"
                    : "#fbbf24"
              }`}
              display="flex"
              alignItems="center"
              gap="4px"
            >
              <Text>
                {stance === "support"
                  ? "✓"
                  : stance === "refute"
                    ? "✗"
                    : stance === "nuance"
                      ? "~"
                      : "?"}
              </Text>
              <Text>{Math.round(relevanceScore)}</Text>
            </Box>
          )}
          {/* Info icon (for viewing rationale) */}
          {hasLink && rationale && (
            <Popover placement="top" trigger="hover">
              <PopoverTrigger>
                <IconButton
                  aria-label="View rationale"
                  icon={<InfoIcon />}
                  size="xs"
                  variant="ghost"
                  color={colors.text}
                  _hover={{
                    bg: colors.border.replace("0.4", "0.2"),
                  }}
                  transition="all 0.3s ease"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              </PopoverTrigger>
              <PopoverContent
                bg="#0f172a"
                borderColor={colors.border}
                border="2px solid"
                boxShadow={`0 8px 32px rgba(0, 0, 0, 0.95), 0 0 20px ${colors.border}`}
                maxW="400px"
                _focus={{ outline: "none" }}
              >
                <PopoverArrow bg="#0f172a" borderColor={colors.border} />
                <PopoverBody bg="#0f172a" borderRadius="md">
                  <Text
                    fontSize="xs"
                    fontWeight="bold"
                    color={colors.text}
                    mb={2}
                  >
                    AI Rationale:
                  </Text>
                  <Text fontSize="sm" color="#94a3b8" lineHeight="1.6">
                    {rationale}
                  </Text>
                </PopoverBody>
              </PopoverContent>
            </Popover>
          )}
          {/* Re-assess button (for linked reference claims) */}
          {hasLink && onReassess && (
            <IconButton
              aria-label="Re-assess claim relationship"
              icon={<RepeatIcon />}
              size="xs"
              variant="ghost"
              color={colors.text}
              _hover={{
                bg: colors.border.replace("0.4", "0.2"),
                transform: "rotate(180deg)",
              }}
              transition="all 0.3s ease"
              onClick={(e) => {
                e.stopPropagation();
                onReassess();
              }}
            />
          )}
        </Box>
        <Box display="flex" gap="6px" alignItems="center">
          <Box
            fontSize="0.7rem"
            color="#64748b"
            fontWeight="300"
            letterSpacing="1px"
          >
            {index + 1}/{totalCards}
          </Box>
          <Box
            width="8px"
            height="8px"
            borderRadius="50%"
            background={isSelected ? "#22c55e" : "#64748b"}
            boxShadow={isSelected ? "0 0 8px #22c55e" : "none"}
            animation={
              isSelected ? "statusPulse 2s ease-in-out infinite" : "none"
            }
            sx={{
              "@keyframes statusPulse": {
                "0%, 100%": { opacity: 1, transform: "scale(1)" },
                "50%": { opacity: 0.6, transform: "scale(1.2)" },
              },
            }}
          />
        </Box>
      </Box>

      {/* Card Content - Only visible when focused */}
      {isFocused && (
        <>
          {/* Claim Text */}
          <Box
            p="20px"
            pt="16px"
            position="relative"
            zIndex={2}
            flex={1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            maxHeight={type === "reference" ? "240px" : "260px"}
            overflowY="auto"
            sx={{
              "&::-webkit-scrollbar": {
                width: "6px",
              },
              "&::-webkit-scrollbar-track": {
                background: "rgba(100, 116, 139, 0.1)",
                borderRadius: "3px",
              },
              "&::-webkit-scrollbar-thumb": {
                background: "rgba(100, 116, 139, 0.3)",
                borderRadius: "3px",
                "&:hover": {
                  background: "rgba(100, 116, 139, 0.5)",
                },
              },
            }}
          >
            <Text
              fontSize="1.05rem"
              fontWeight="300"
              color="#f1f5f9"
              lineHeight="1.5"
              letterSpacing="0.3px"
              textAlign="center"
            >
              {claim.claim_text}
            </Text>
          </Box>

          {/* Metrics Footer */}
          <Box
            position="relative"
            zIndex={3}
            borderTop={`1px solid rgba(100, 116, 139, 0.2)`}
            p="16px"
            display="grid"
            gridTemplateColumns={
              type === "reference" ? "repeat(3, 1fr)" : "repeat(3, 1fr)"
            }
            gridTemplateRows={type === "reference" ? "auto auto" : "auto"}
            gap="10px"
          >
            {metrics.map((metric: any, idx) => (
              <Box
                key={idx}
                textAlign="center"
                p="6px"
                background={`${colors.border.replace("0.4", "0.05")}`}
                borderRadius="6px"
                border={`1px solid ${colors.border.replace("0.4", "0.1")}`}
              >
                <Text
                  fontSize="1.2rem"
                  fontWeight="200"
                  color={metric.color || colors.text}
                  textShadow={`0 0 10px ${metric.color || colors.glow}`}
                  mb="2px"
                >
                  {typeof metric.value === "number"
                    ? metric.value.toFixed(1)
                    : metric.value}
                </Text>
                <Text
                  fontSize="0.6rem"
                  color="#64748b"
                  textTransform="uppercase"
                  letterSpacing="0.5px"
                  fontWeight="300"
                >
                  {metric.label}
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

// Reference Playing Card Component
interface ReferenceCardProps {
  reference: ReferenceWithRelevance;
  isFocused?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  style?: React.CSSProperties;
  index?: number;
  totalCards?: number;
}

const ReferenceCard: React.FC<ReferenceCardProps> = ({
  reference,
  isFocused = false,
  isSelected = false,
  onClick,
  onHover,
  style,
  index = 0,
  totalCards = 1,
}) => {
  const colors = {
    border: "rgba(34, 197, 94, 0.4)",
    glow: "rgba(34, 197, 94, 0.8)",
    text: "#4ade80",
    indicator: "REFERENCE",
  };

  // Parse claims count - claims might be a JSON string
  let claimCount = 0;
  if (reference.claims) {
    if (Array.isArray(reference.claims)) {
      claimCount = reference.claims.length;
    } else if (typeof reference.claims === "string") {
      try {
        const parsed = JSON.parse(reference.claims);
        claimCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch (e) {
        claimCount = 0;
      }
    }
  }

  // Build metrics array dynamically
  const metrics = reference.hasLink
    ? [
        { value: Math.round(reference.relevanceScore), label: "Relevance" },
        {
          value:
            reference.stance === "support"
              ? "Support"
              : reference.stance === "refute"
                ? "Refute"
                : "Nuanced",
          label: "Doc Stance",
        },
        { value: claimCount, label: "Claims" },
      ]
    : [
        { value: claimCount, label: "Claims" },
        { value: reference.is_primary_source ? "Yes" : "No", label: "Primary" },
        { value: index + 1, label: "Position" },
      ];

  // Extract short name for title (first 30 chars)
  const shortName =
    reference.content_name.length > 30
      ? reference.content_name.substring(0, 30) + "..."
      : reference.content_name;

  return (
    <Box
      onClick={onClick}
      onMouseEnter={onHover}
      style={style}
      sx={{
        position: "relative",
        width: "320px",
        height: isFocused ? "480px" : "60px",
        background:
          "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
        backdropFilter: "blur(20px)",
        border: `1px solid ${colors.border}`,
        borderRadius: "12px",
        boxShadow: isSelected
          ? `0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
          : isFocused
            ? `0 12px 48px rgba(0, 0, 0, 0.8), 0 0 60px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
            : `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px ${colors.border}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        userSelect: "none",
        overflow: "hidden",
        borderColor: isSelected
          ? colors.border.replace("0.4", "0.8")
          : colors.border,
      }}
    >
      {/* Left edge glow bar - 3D fade effect */}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="20px"
        height="100%"
        background={`linear-gradient(90deg, ${colors.border} 0%, transparent 100%)`}
        pointerEvents="none"
        zIndex={1}
      />

      {/* Scanlines overlay */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        borderRadius="12px"
        zIndex={2}
      />

      {/* Title Bar - Always Visible */}
      <Box
        background={`linear-gradient(90deg, ${colors.border}, transparent)`}
        borderBottom={isFocused ? `1px solid ${colors.border}` : "none"}
        px="16px"
        py="12px"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        position="relative"
        zIndex={3}
        height="60px"
      >
        <Box
          px="10px"
          py="4px"
          background={colors.border.replace("0.4", "0.2")}
          border={`1px solid ${colors.border}`}
          borderRadius="10px"
          fontSize="0.65rem"
          fontWeight="600"
          letterSpacing="1.5px"
          textTransform="uppercase"
          color={colors.text}
          textShadow={`0 0 8px ${colors.glow}`}
          maxWidth="140px"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {shortName}
        </Box>
        <Box display="flex" gap="6px" alignItems="center">
          {/* Relevance Score Badge */}
          {reference.hasLink && reference.relevanceScore > 0 && (
            <Box
              px="8px"
              py="2px"
              background={
                reference.stance === "support"
                  ? "rgba(34, 197, 94, 0.15)"
                  : reference.stance === "refute"
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(234, 179, 8, 0.15)"
              }
              border={`1px solid ${
                reference.stance === "support"
                  ? "rgba(34, 197, 94, 0.5)"
                  : reference.stance === "refute"
                    ? "rgba(239, 68, 68, 0.5)"
                    : "rgba(234, 179, 8, 0.5)"
              }`}
              borderRadius="8px"
              fontSize="0.65rem"
              fontWeight="700"
              letterSpacing="0.5px"
              color={
                reference.stance === "support"
                  ? "#4ade80"
                  : reference.stance === "refute"
                    ? "#f87171"
                    : "#fbbf24"
              }
              textShadow={`0 0 6px ${
                reference.stance === "support"
                  ? "#4ade80"
                  : reference.stance === "refute"
                    ? "#f87171"
                    : "#fbbf24"
              }`}
              display="flex"
              alignItems="center"
              gap="4px"
            >
              <Text>
                {reference.stance === "support"
                  ? "✓"
                  : reference.stance === "refute"
                    ? "✗"
                    : "~"}
              </Text>
              <Text>{Math.round(reference.relevanceScore)}</Text>
            </Box>
          )}
        </Box>
        <Box display="flex" gap="6px" alignItems="center">
          <Box
            fontSize="0.7rem"
            color="#64748b"
            fontWeight="300"
            letterSpacing="1px"
          >
            {index + 1}/{totalCards}
          </Box>
          <Box
            width="8px"
            height="8px"
            borderRadius="50%"
            background={isSelected ? "#22c55e" : "#64748b"}
            boxShadow={isSelected ? "0 0 8px #22c55e" : "none"}
            animation={
              isSelected ? "statusPulse 2s ease-in-out infinite" : "none"
            }
            sx={{
              "@keyframes statusPulse": {
                "0%, 100%": { opacity: 1, transform: "scale(1)" },
                "50%": { opacity: 0.6, transform: "scale(1.2)" },
              },
            }}
          />
        </Box>
      </Box>

      {/* Card Content - Only visible when focused */}
      {isFocused && (
        <>
          {/* Reference Details */}
          <Box
            p="20px"
            pt="16px"
            position="relative"
            zIndex={3}
            flex={1}
            display="flex"
            flexDirection="column"
            justifyContent="center"
            minHeight="260px"
          >
            <Text
              fontSize="1.15rem"
              fontWeight="300"
              color="#f1f5f9"
              lineHeight="1.4"
              letterSpacing="0.3px"
              textAlign="center"
              mb="16px"
            >
              {reference.content_name}
            </Text>

            {/* Publisher/Author Info */}
            <Box
              textAlign="center"
              fontSize="0.85rem"
              color="#94a3b8"
              lineHeight="1.6"
            >
              {reference.media_source && (
                <Box mb="8px">
                  <Text
                    as="span"
                    fontSize="0.7rem"
                    color="#64748b"
                    textTransform="uppercase"
                    letterSpacing="1px"
                  >
                    Publisher:{" "}
                  </Text>
                  <Text as="span" color="#cbd5e1">
                    {reference.media_source}
                  </Text>
                </Box>
              )}
              {reference.url && (
                <Box
                  fontSize="0.75rem"
                  color="#64748b"
                  fontFamily="monospace"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                  px="20px"
                >
                  {reference.url}
                </Box>
              )}
            </Box>
          </Box>

          {/* Metrics Footer */}
          <Box
            position="relative"
            zIndex={3}
            borderTop={`1px solid rgba(100, 116, 139, 0.2)`}
            p="16px"
            display="grid"
            gridTemplateColumns="repeat(3, 1fr)"
            gap="12px"
          >
            {metrics.map((metric: any, idx) => (
              <Box
                key={idx}
                textAlign="center"
                p="8px"
                background={`${colors.border.replace("0.4", "0.05")}`}
                borderRadius="6px"
                border={`1px solid ${colors.border.replace("0.4", "0.1")}`}
              >
                <Text
                  fontSize="1.4rem"
                  fontWeight="200"
                  color={metric.color || colors.text}
                  textShadow={`0 0 10px ${metric.color || colors.glow}`}
                  mb="2px"
                >
                  {metric.value}
                </Text>
                <Text
                  fontSize="0.65rem"
                  color="#64748b"
                  textTransform="uppercase"
                  letterSpacing="1px"
                  fontWeight="300"
                >
                  {metric.label}
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

// Main GameSpace Component
const GameSpace: React.FC<GameSpaceProps> = ({
  contentId,
  claims,
  references,
  claimLinks = [],
}) => {
  const toast = useToast();
  const [focusedCardIndex, setFocusedCardIndex] = useState<number>(0);
  const [focusedReferenceIndex, setFocusedReferenceIndex] = useState<number>(0);
  const [focusedReferenceClaimIndex, setFocusedReferenceClaimIndex] =
    useState<number>(0);
  const [selectedTaskClaimIndex, setSelectedTaskClaimIndex] = useState<
    number | null
  >(null);
  const [selectedReferenceIndex, setSelectedReferenceIndex] = useState<
    number | null
  >(null);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [currentComparisonIndex, setCurrentComparisonIndex] = useState(0);
  const [isFocusedMode, setIsFocusedMode] = useState(false);
  const [isReferenceClaimsMode, setIsReferenceClaimsMode] = useState(false);
  const [isClaimLinkModalOpen, setIsClaimLinkModalOpen] = useState(false);

  // Re-assess modal state
  const [isReassessModalOpen, setIsReassessModalOpen] = useState(false);
  const [reassessTarget, setReassessTarget] = useState<{
    referenceClaimId: number;
    referenceClaimText: string;
    taskClaimId: number;
    taskClaimText: string;
    currentAssessment: {
      stance: string;
      confidence: number;
      support_level: number;
      rationale?: string;
    };
  } | null>(null);

  // Evidence engine state (document-level)
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [enrichedReferences, setEnrichedReferences] = useState<
    ReferenceWithRelevance[]
  >([]);

  // Claim-level relevance state
  const [isAssessingClaims, setIsAssessingClaims] = useState(false);
  const [enrichedReferenceClaims, setEnrichedReferenceClaims] = useState<
    ClaimWithRelevance[]
  >([]);

  // 🎮 GAME SCORING STATE
  const [userScore, setUserScore] = useState(0);
  const [ghostScore, setGhostScore] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedClaimVeracity, setDraggedClaimVeracity] = useState<
    number | null
  >(null);

  // Card stack constants for slide-deck style
  const TITLE_HEIGHT = 60; // Height of title bar
  const CARD_FULL_HEIGHT = 480; // Full playing card height
  const PEEK_AMOUNT = 30; // How much of cards above/below to show when one is focused

  // REMOVED: Auto-entering comparison mode - we want to show claims stack first
  // Comparison mode should only be entered when user double-clicks a claim card

  // Evidence engine and relevance scoring
  useEffect(() => {
    async function loadEvidenceAndEnrichReferences() {
      console.log(
        `[Evidence useEffect] selectedTaskClaimIndex=${selectedTaskClaimIndex}, isFocusedMode=${isFocusedMode}`,
      );

      if (selectedTaskClaimIndex === null || !isFocusedMode) {
        // No task claim selected, show all references without enrichment
        console.log(
          `[Evidence useEffect] Not in focused mode, showing all references without enrichment`,
        );
        setEnrichedReferences(
          references.map((ref) => ({
            ...ref,
            relevanceScore: 0,
            hasLink: false,
          })),
        );
        return;
      }

      const selectedClaim = claims[selectedTaskClaimIndex];
      if (!selectedClaim) return;

      try {
        setIsLoadingEvidence(true);

        console.log(
          `[GameSpace] Loading evidence for claim: "${selectedClaim.claim_text}"`,
        );

        // Fetch existing links first
        let existingLinks = await fetchLinksForClaim(
          contentId,
          selectedClaim.claim_id,
        );

        console.log(
          `[GameSpace] Found ${existingLinks.length} existing reference links`,
        );

        // If fewer than 3 links, run evidence engine to find more
        if (existingLinks.length < 3) {
          console.log(
            `[GameSpace] Running evidence engine to find more references (need 3, have ${existingLinks.length})`,
          );

          const { runEvidenceForSingleClaim } =
            await import("../services/evidenceEngineClient");
          const result = await runEvidenceForSingleClaim(
            contentId,
            selectedClaim.claim_id,
            selectedClaim.claim_text,
          );

          if (result.didRun && result.response) {
            console.log(`[GameSpace] Evidence engine ran successfully`);
          }

          // Re-fetch links after evidence engine ran
          existingLinks = result.existingLinks || existingLinks;
        }

        console.log(
          `[GameSpace] Using ${existingLinks.length} total reference links`,
        );

        // Enrich references with relevance scores using the claim-specific links
        const enriched = enrichReferencesWithRelevance(
          references,
          selectedClaim.claim_id,
          existingLinks,
        );

        // Sort by relevance
        const sorted = sortByRelevance(enriched);

        console.log(
          `[GameSpace] Enriched ${sorted.length} references, ${sorted.filter((r) => r.hasLink).length} with links`,
        );

        setEnrichedReferences(sorted);
      } catch (error) {
        console.error("[GameSpace] Error loading evidence:", error);

        const errorMessage =
          error instanceof Error ? error.message : "Failed to load evidence";

        toast({
          title: "Evidence Engine Error",
          description: errorMessage,
          status: "error",
          duration: 5000,
          isClosable: true,
        });

        // Fallback to showing all references without relevance
        setEnrichedReferences(
          references.map((ref) => ({
            ...ref,
            relevanceScore: 0,
            hasLink: false,
          })),
        );
      } finally {
        setIsLoadingEvidence(false);
      }
    }

    loadEvidenceAndEnrichReferences();
  }, [
    selectedTaskClaimIndex,
    isFocusedMode,
    contentId,
    claims,
    references,
    toast,
  ]);

  // Claim-level relevance assessment (when viewing reference claims)
  useEffect(() => {
    async function assessReferenceClaims() {
      // Reset when not in reference claims mode
      if (
        !isReferenceClaimsMode ||
        selectedTaskClaimIndex === null ||
        selectedReferenceIndex === null
      ) {
        setEnrichedReferenceClaims([]);
        setIsAssessingClaims(false);
        return;
      }

      const selectedTaskClaim = claims[selectedTaskClaimIndex];
      const selectedReference = references[selectedReferenceIndex];

      if (!selectedTaskClaim || !selectedReference) {
        setEnrichedReferenceClaims([]);
        return;
      }

      // Parse reference claims
      let referenceClaims: any[] = [];
      if (Array.isArray(selectedReference.claims)) {
        referenceClaims = selectedReference.claims;
        console.log(
          `[GameSpace] Reference has ${referenceClaims.length} claims (array)`,
        );
      } else if (typeof selectedReference.claims === "string") {
        try {
          referenceClaims = JSON.parse(selectedReference.claims);
          console.log(
            `[GameSpace] Reference has ${referenceClaims.length} claims (parsed string)`,
          );
        } catch (e) {
          console.error(
            "[Claim Assessment] Failed to parse reference claims:",
            e,
          );
          setEnrichedReferenceClaims([]);
          return;
        }
      } else {
        console.warn(
          "[GameSpace] Reference claims is neither array nor string:",
          typeof selectedReference.claims,
        );
      }

      if (referenceClaims.length === 0) {
        console.warn(
          "[GameSpace] No reference claims found for this reference",
        );
        setEnrichedReferenceClaims([]);
        return;
      }

      try {
        setIsAssessingClaims(true);

        console.log(
          `[GameSpace] Loading ${referenceClaims.length} reference claims`,
        );

        // Fetch existing reference claim → task claim links only (no AI assessment)
        const { fetchReferenceClaimTaskLinks } =
          await import("../services/referenceClaimRelevance");
        const links = await fetchReferenceClaimTaskLinks(
          selectedTaskClaim.claim_id,
        );

        console.log(
          `[GameSpace] Found ${links.length} existing claim assessments for task claim`,
        );

        // Filter links to only those for claims in THIS reference
        const referenceClaimIds = referenceClaims.map((c) => c.claim_id);
        const relevantLinks = links.filter((link) =>
          referenceClaimIds.includes(link.reference_claim_id),
        );

        console.log(
          `[GameSpace] ${relevantLinks.length} links relevant to this reference`,
        );

        // Check if we need to assess any claims using batch function
        const { batchAssessReferenceClaims } =
          await import("../services/referenceClaimRelevance");

        const assessmentResult = await batchAssessReferenceClaims(
          referenceClaims,
          selectedTaskClaim.claim_id,
          selectedTaskClaim.claim_text,
        );

        console.log(
          `[GameSpace] Batch assessment complete: ${assessmentResult.assessedCount} new assessments`,
        );

        // Filter to relevant links after assessment
        const allRelevantLinks = assessmentResult.links.filter((link) =>
          referenceClaimIds.includes(link.reference_claim_id),
        );

        // Enrich claims with assessment data
        const enriched = enrichClaimsWithRelevance(
          referenceClaims,
          selectedTaskClaim.claim_id,
          allRelevantLinks,
        );

        console.log(`[GameSpace] About to set enriched claims:`, enriched);
        setEnrichedReferenceClaims(enriched);
        setIsAssessingClaims(false);
        console.log(
          `[GameSpace] State updated - ${enriched.length} claims, isAssessingClaims=false`,
        );
      } catch (error) {
        console.error("[GameSpace] Error loading claims:", error);

        // Fallback - show claims without enrichment
        const fallback = referenceClaims.map((claim) => ({
          ...claim,
          relevanceScore: 0,
          hasLink: false,
        }));
        setEnrichedReferenceClaims(fallback);
        setIsAssessingClaims(false);
      }
    }

    assessReferenceClaims();
  }, [
    isReferenceClaimsMode,
    selectedTaskClaimIndex,
    selectedReferenceIndex,
    claims,
    references,
    toast,
  ]);

  // 🎮 Load user score from database on mount
  useEffect(() => {
    const loadScore = async () => {
      const { getClaimLinkScore } = await import("../services/useDashboardAPI");
      const { useTaskStore } = await import("../store/useTaskStore");
      const viewerId = useTaskStore.getState().viewingUserId;

      if (contentId && viewerId) {
        const totalScore = await getClaimLinkScore(contentId, viewerId);
        console.log(`🎮 Loaded score from database: ${totalScore}`);
        setUserScore(totalScore);
      }
    };

    loadScore();
  }, [contentId]);

  const handleCardHover = (index: number) => {
    setFocusedCardIndex(index);
  };

  const handleReferenceHover = (index: number) => {
    setFocusedReferenceIndex(index);
  };

  const handleTaskClaimClick = (index: number) => {
    if (selectedTaskClaimIndex === index && isFocusedMode) {
      // Clicking the same task claim exits focused mode
      setSelectedTaskClaimIndex(null);
      setIsFocusedMode(false);
      setIsComparisonMode(false);
      setFocusedReferenceIndex(0);
    } else {
      // Select task claim and enter focused mode
      setSelectedTaskClaimIndex(index);
      setFocusedCardIndex(index);
      setIsFocusedMode(true);
      setFocusedReferenceIndex(0);
      setSelectedReferenceIndex(null);
    }
  };

  const handleBackToAllClaims = () => {
    // Exit reference claims mode and comparison mode
    // Keep the task claim selected and in focused mode
    // Show references list on the right
    setIsReferenceClaimsMode(false);
    setIsComparisonMode(false);
    setSelectedReferenceIndex(null);
    setFocusedReferenceClaimIndex(0);
    // Keep selectedTaskClaimIndex and isFocusedMode to stay on the task claim with references
  };

  const handleReferenceClick = (index: number) => {
    // Enter reference claims mode - show the claims stack for this reference
    console.log(
      `[GameSpace] Reference clicked, index: ${index}, entering reference claims mode`,
    );
    setSelectedReferenceIndex(index);
    setFocusedReferenceIndex(index);
    setIsReferenceClaimsMode(true);
    setFocusedReferenceClaimIndex(0);
  };

  const [isClickInProgress, setIsClickInProgress] = useState(false);

  const handleReferenceClaimHover = (index: number) => {
    // Don't change focus during a click action
    if (isClickInProgress) return;
    setFocusedReferenceClaimIndex(index);
  };

  const handleReferenceClaimClick = (claimIndex: number) => {
    console.log("[Reference Claim Click]", {
      claimIndex,
      currentStackLength: enrichedReferenceClaims.length,
    });

    // Block hover events during click
    setIsClickInProgress(true);

    // Get the clicked card's ID before reordering
    const clickedCardId = enrichedReferenceClaims[claimIndex].claim_id;

    // Move clicked claim to top of stack and focus it
    if (claimIndex !== 0) {
      // Reorder array so clicked card becomes first
      const reordered = [...enrichedReferenceClaims];
      const [clickedCard] = reordered.splice(claimIndex, 1);
      reordered.unshift(clickedCard);
      setEnrichedReferenceClaims(reordered);
      console.log("[Reference Claim Click] Moved card to top", {
        clickedCardId: clickedCard.claim_id,
      });

      // Scroll to the specific clicked card after re-render
      setTimeout(() => {
        const targetCard = document.querySelector(
          `[data-reference-card-id="${clickedCardId}"]`,
        );
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
          console.log("[Reference Claim Click] Scrolled to clicked card", {
            clickedCardId,
          });
        } else {
          console.warn(
            "[Reference Claim Click] Could not find card to scroll to",
            { clickedCardId },
          );
        }
      }, 150);
    } else {
      // Already at top, just scroll to it
      const targetCard = document.querySelector(
        `[data-reference-card-id="${clickedCardId}"]`,
      );
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    // Focus the top card (which is now the clicked card)
    setFocusedReferenceClaimIndex(0);
    setCurrentComparisonIndex(0);

    // Re-enable hover after animation completes
    setTimeout(() => {
      setIsClickInProgress(false);
    }, 500);
  };

  const handleBackToReferences = () => {
    // Exit reference claims mode and comparison mode
    // Clear the selected reference so we show the references list instead of reference claims
    // Keep the task claim selected (isFocusedMode stays true)
    // This will show the task claim with references list on the right
    setIsReferenceClaimsMode(false);
    setIsComparisonMode(false);
    setSelectedReferenceIndex(null); // Clear reference selection to show references list
    setFocusedReferenceClaimIndex(0);
    // Keep selectedTaskClaimIndex and isFocusedMode so we stay on the task claim view with references
  };

  const handleCloseComparison = () => {
    // Exit comparison mode and reference claims mode
    // Return to showing the selected task claim with references list on the right
    setIsComparisonMode(false);
    setIsReferenceClaimsMode(false);
    setSelectedReferenceIndex(null);
    setFocusedReferenceClaimIndex(0);
    // Keep selectedTaskClaimIndex and isFocusedMode so we stay on the task claim view with references
  };

  const handlePrevCard = () => {
    setCurrentComparisonIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextCard = () => {
    setCurrentComparisonIndex((prev) =>
      Math.min(enrichedReferenceClaims.length - 1, prev + 1),
    );
  };

  // Calculate card positions for slide-deck style stack
  const getCardStackStyle = (index: number): React.CSSProperties => {
    const isFocused = index === focusedCardIndex;

    let top = 0;
    let zIndex = 100;

    if (index < focusedCardIndex) {
      // Cards above the focused card
      top = index * TITLE_HEIGHT;
      zIndex = index;
    } else if (index === focusedCardIndex) {
      // Focused card
      top =
        focusedCardIndex * TITLE_HEIGHT +
        (focusedCardIndex > 0 ? PEEK_AMOUNT : 0);
      zIndex = 200;
    } else {
      // Cards below the focused card
      const baseTop = focusedCardIndex * TITLE_HEIGHT + CARD_FULL_HEIGHT;
      top =
        baseTop + (index - focusedCardIndex - 1) * TITLE_HEIGHT + PEEK_AMOUNT;
      zIndex = 100 - (index - focusedCardIndex);
    }

    return {
      position: "absolute",
      top: `${top}px`,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex,
    };
  };

  // Calculate reference card positions for slide-deck style stack
  const getReferenceStackStyle = (index: number): React.CSSProperties => {
    const isFocused = index === focusedReferenceIndex;

    let top = 0;
    let zIndex = 100;

    if (index < focusedReferenceIndex) {
      // Cards above the focused card
      top = index * TITLE_HEIGHT;
      zIndex = index;
    } else if (index === focusedReferenceIndex) {
      // Focused card
      top =
        focusedReferenceIndex * TITLE_HEIGHT +
        (focusedReferenceIndex > 0 ? PEEK_AMOUNT : 0);
      zIndex = 200;
    } else {
      // Cards below the focused card
      const baseTop = focusedReferenceIndex * TITLE_HEIGHT + CARD_FULL_HEIGHT;
      top =
        baseTop +
        (index - focusedReferenceIndex - 1) * TITLE_HEIGHT +
        PEEK_AMOUNT;
      zIndex = 100 - (index - focusedReferenceIndex);
    }

    return {
      position: "absolute",
      top: `${top}px`,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex,
    };
  };

  // Use enriched references sorted by relevance
  const filteredReferences: ReferenceWithRelevance[] =
    enrichedReferences.length > 0
      ? enrichedReferences
      : references.map((ref) => ({
          ...ref,
          relevanceScore: 0,
          hasLink: false,
        }));

  // Determine which claims and references to display
  const displayedClaims =
    isFocusedMode && selectedTaskClaimIndex !== null
      ? [claims[selectedTaskClaimIndex]]
      : claims;

  const displayedReferences = filteredReferences;

  // Calculate total stack height
  const totalStackHeight =
    (displayedClaims.length - 1) * TITLE_HEIGHT +
    CARD_FULL_HEIGHT +
    (displayedClaims.length > 1 ? PEEK_AMOUNT * 2 : 0) +
    100; // Extra padding

  // Get reference claims for the selected reference (use original references array)
  const selectedReference =
    selectedReferenceIndex !== null ? references[selectedReferenceIndex] : null;

  // Get current reference claim for comparison mode
  // Use enrichedReferenceClaims if available (they're populated by useEffect)
  const currentRefClaim =
    enrichedReferenceClaims.length > 0
      ? enrichedReferenceClaims[currentComparisonIndex]
      : null;
  const taskClaim =
    selectedTaskClaimIndex !== null ? claims[selectedTaskClaimIndex] : null;

  // Calculate reference claim stack positions
  const getReferenceClaimStackStyle = (index: number): React.CSSProperties => {
    const isFocused = index === focusedReferenceClaimIndex;

    let top = 0;
    let zIndex = 100;

    if (index < focusedReferenceClaimIndex) {
      top = index * TITLE_HEIGHT;
      zIndex = index;
    } else if (index === focusedReferenceClaimIndex) {
      top =
        focusedReferenceClaimIndex * TITLE_HEIGHT +
        (focusedReferenceClaimIndex > 0 ? PEEK_AMOUNT : 0);
      zIndex = 200;
    } else {
      const baseTop =
        focusedReferenceClaimIndex * TITLE_HEIGHT + CARD_FULL_HEIGHT;
      top =
        baseTop +
        (index - focusedReferenceClaimIndex - 1) * TITLE_HEIGHT +
        PEEK_AMOUNT;
      zIndex = 100 - (index - focusedReferenceClaimIndex);
    }

    console.log(
      `[Card Stack] Claim ${index}: top=${top}px, zIndex=${zIndex}, focused=${isFocused}`,
    );

    return {
      position: "absolute",
      top: `${top}px`,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex,
    };
  };

  // Calculate total reference stack height
  const totalReferenceStackHeight = isReferenceClaimsMode
    ? Math.max(
        600,
        (enrichedReferenceClaims.length - 1) * TITLE_HEIGHT +
          CARD_FULL_HEIGHT +
          (enrichedReferenceClaims.length > 1 ? PEEK_AMOUNT * 2 : 0) +
          100,
      )
    : (displayedReferences.length - 1) * TITLE_HEIGHT +
      CARD_FULL_HEIGHT +
      (displayedReferences.length > 1 ? PEEK_AMOUNT * 2 : 0) +
      100; // Extra padding

  // Drag-and-drop handling (old pattern restored)
  const [draggingClaim, setDraggingClaim] = useState<{
    claim_id: number;
    claim_text: string;
  } | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });
  const [isOverTaskClaim, setIsOverTaskClaim] = useState(false);
  const [isOverSkipZone, setIsOverSkipZone] = useState(false);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const taskClaimRef = useRef<HTMLDivElement | null>(null);

  // Track mouse position globally when dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });

      if (!draggingClaim) return;

      // Detect dragging direction from start position
      const dragDistance = e.clientX - dragStartPosition.x;
      setIsDraggingLeft(dragDistance < -30); // Moved 30px left
      setIsDraggingRight(dragDistance > 30); // Moved 30px right

      // Check if over task claim (drop zone for linking)
      if (taskClaimRef.current && selectedTaskClaimIndex !== null) {
        const rect = taskClaimRef.current.getBoundingClientRect();

        // Expand vertical bounds significantly since card height may not be captured correctly
        // Standard PlayingCard is ~480px tall, so add ±300px padding
        const verticalPadding = 300;
        const expandedTop = rect.top - verticalPadding;
        const expandedBottom =
          (rect.bottom === rect.top ? rect.top + 480 : rect.bottom) +
          verticalPadding;

        const isOver =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= expandedTop &&
          e.clientY <= expandedBottom;

        // DEBUG: Log every 50px of movement to track detection
        const debugFrequency = Math.floor(e.clientX / 50);
        if (debugFrequency !== (window as any).__lastDebugFreq) {
          (window as any).__lastDebugFreq = debugFrequency;
          console.log("[Mouse Move Debug]", {
            mouseX: e.clientX,
            mouseY: e.clientY,
            taskClaimBounds: {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
            },
            expandedBounds: {
              top: Math.round(expandedTop),
              bottom: Math.round(expandedBottom),
            },
            isOver,
          });
        }

        setIsOverTaskClaim(isOver);
      } else if (draggingClaim && selectedTaskClaimIndex !== null) {
        // Log if ref is missing during drag
        console.log(
          "[Task Claim Detection] WARNING: taskClaimRef.current is null!",
        );
      }

      // Check if over skip zone (right side of screen)
      const isRightSide = e.clientX > window.innerWidth * 0.75;
      setIsOverSkipZone(isRightSide);
    };

    const handleMouseUp = () => {
      console.log(
        "[handleMouseUp] Called - draggingClaim:",
        draggingClaim ? "exists" : "null",
      );
      if (draggingClaim) {
        console.log("[Drag End]", {
          isOverTaskClaim,
          isOverSkipZone,
          taskClaimRef_current: taskClaimRef.current ? "exists" : "null",
          selectedTaskClaimIndex,
        });

        if (isOverTaskClaim) {
          // Dropped on task claim → LINK
          console.log("[Drag End] Opening link modal");
          handleLinkClaims();
        } else if (isOverSkipZone) {
          // Dropped on right side → SKIP
          console.log("[Drag End] Skipping claim");
          handleSkipClaim();
        } else {
          console.log("[Drag End] Neither condition met - no action taken");
        }
        setDraggingClaim(null);
        setIsOverTaskClaim(false);
        setIsOverSkipZone(false);
        setIsDraggingLeft(false);
        setIsDraggingRight(false);

        // 🎮 Reset dragging state (but keep draggedClaimVeracity for scoring until modal closes)
        setIsDragging(false);
        setGhostScore(null);
        // DON'T reset draggedClaimVeracity here - it's needed for scoring in the modal
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    draggingClaim,
    isOverTaskClaim,
    isOverSkipZone,
    selectedTaskClaimIndex,
    dragStartPosition,
  ]);

  const handleLinkClaims = () => {
    // Open modal to link the currently focused reference claim to task claim
    console.log("[handleLinkClaims] Called", {
      enrichedReferenceClaims_length: enrichedReferenceClaims.length,
      focusedReferenceClaimIndex,
      isReferenceClaimsMode,
      selectedTaskClaimIndex,
      isClaimLinkModalOpen,
    });

    if (
      enrichedReferenceClaims.length > 0 &&
      focusedReferenceClaimIndex < enrichedReferenceClaims.length
    ) {
      console.log("[handleLinkClaims] Setting modal open to TRUE");
      setIsClaimLinkModalOpen(true);
    } else {
      console.log("[handleLinkClaims] Condition NOT met - modal will not open");
    }
  };

  const handleSkipClaim = () => {
    // Remove current card from stack (it's at index 0)
    if (enrichedReferenceClaims.length > 1) {
      const remaining = enrichedReferenceClaims.slice(1);
      setEnrichedReferenceClaims(remaining);
      // Focus stays at 0 (new first card)
      setFocusedReferenceClaimIndex(0);
    } else {
      // Last card - go back to references
      handleBackToReferences();
    }
  };

  const handleClaimLinkModalClose = () => {
    console.log("[handleClaimLinkModalClose] Closing modal");
    setIsClaimLinkModalOpen(false);
    // 🎮 Reset draggedClaimVeracity after modal closes (so scoring can use it)
    setDraggedClaimVeracity(null);
  };

  const handleLinkCreated = () => {
    console.log("[handleLinkCreated] Link created, closing modal and skipping");
    setIsClaimLinkModalOpen(false);
    // Move to next claim after linking
    handleSkipClaim();
  };

  // Monitor modal state changes
  useEffect(() => {
    console.log(
      "[Modal State] isClaimLinkModalOpen changed to:",
      isClaimLinkModalOpen,
    );
  }, [isClaimLinkModalOpen]);

  // Comparison View
  if (
    isComparisonMode &&
    selectedTaskClaimIndex !== null &&
    selectedReference &&
    taskClaim &&
    currentRefClaim
  ) {
    // Use actual relevance data from the enriched claim
    const relationship = {
      type: currentRefClaim.stance || "insufficient",
      veracity: Math.round(currentRefClaim.relevanceScore || 0),
      weight: currentRefClaim.confidence
        ? Math.round(currentRefClaim.confidence * 10)
        : 0,
    };

    return (
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        minHeight="100vh"
        pt="380px"
        background="#000000"
        zIndex={1000}
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        p={8}
        sx={{
          "&::before": {
            content: '""',
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "linear-gradient(rgba(0, 162, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 162, 255, 0.1) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
            animation: "gridMove 40s linear infinite",
            pointerEvents: "none",
            zIndex: 0,
            perspective: "1000px",
            transform: "rotateX(60deg)",
          },
          "@keyframes gridMove": {
            "0%": { backgroundPosition: "0 0" },
            "100%": { backgroundPosition: "50px 50px" },
          },
        }}
      >
        {/* Close Button */}
        <IconButton
          aria-label="Close comparison"
          icon={<CloseIcon />}
          position="absolute"
          top="24px"
          right="24px"
          size="lg"
          bg="rgba(239, 68, 68, 0.1)"
          border="1px solid rgba(239, 68, 68, 0.4)"
          color="#ef4444"
          _hover={{
            bg: "rgba(239, 68, 68, 0.2)",
            boxShadow: "0 0 30px rgba(239, 68, 68, 0.4)",
          }}
          onClick={handleCloseComparison}
          zIndex={2001}
        />

        {/* Reference Title */}
        <Box
          mb={6}
          background="rgba(0, 0, 0, 0.6)"
          backdropFilter="blur(20px)"
          border="1px solid rgba(34, 197, 94, 0.4)"
          borderRadius="8px"
          px="48px"
          py="16px"
          boxShadow="0 4px 24px rgba(0, 0, 0, 0.6), 0 0 40px rgba(34, 197, 94, 0.2)"
          zIndex={2001}
        >
          <Text
            color="#4ade80"
            fontSize="1.3rem"
            fontWeight="200"
            textAlign="center"
            letterSpacing="4px"
            textTransform="uppercase"
            textShadow="0 0 20px rgba(34, 197, 94, 0.8)"
          >
            {selectedReference.content_name}
          </Text>
        </Box>

        {/* Card Container */}
        <Box
          display="flex"
          gap={8}
          alignItems="center"
          justifyContent="center"
          flex={1}
          maxWidth="1400px"
          width="100%"
          zIndex={2001}
        >
          {/* Task Claim - Left */}
          <Box flex={1} display="flex" justifyContent="flex-end">
            <PlayingCard
              claim={taskClaim}
              type="task"
              isFocused={true}
              isSelected={true}
              totalCards={claims.length}
              index={selectedTaskClaimIndex}
            />
          </Box>

          {/* VS Divider with Relationship Indicator */}
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            gap={4}
          >
            {/* Relationship Badge */}
            <Box
              px="20px"
              py="8px"
              borderRadius="12px"
              background={
                relationship.type === "support"
                  ? "rgba(34, 197, 94, 0.2)"
                  : relationship.type === "refute"
                    ? "rgba(239, 68, 68, 0.2)"
                    : "rgba(234, 179, 8, 0.2)"
              }
              border={`2px solid ${
                relationship.type === "support"
                  ? "rgba(34, 197, 94, 0.5)"
                  : relationship.type === "refute"
                    ? "rgba(239, 68, 68, 0.5)"
                    : "rgba(234, 179, 8, 0.5)"
              }`}
              boxShadow={`0 0 30px ${
                relationship.type === "support"
                  ? "rgba(34, 197, 94, 0.3)"
                  : relationship.type === "refute"
                    ? "rgba(239, 68, 68, 0.3)"
                    : "rgba(234, 179, 8, 0.3)"
              }`}
            >
              <Text
                color={
                  relationship.type === "support"
                    ? "#4ade80"
                    : relationship.type === "refute"
                      ? "#ef4444"
                      : "#fbbf24"
                }
                fontSize="14px"
                fontWeight="700"
                textTransform="uppercase"
                letterSpacing="2px"
                textShadow={`0 0 10px ${
                  relationship.type === "support"
                    ? "rgba(34, 197, 94, 0.8)"
                    : relationship.type === "refute"
                      ? "rgba(239, 68, 68, 0.8)"
                      : "rgba(234, 179, 8, 0.8)"
                }`}
              >
                {relationship.type === "support"
                  ? "✓ SUPPORTS"
                  : relationship.type === "refute"
                    ? "✗ REFUTES"
                    : "◆ NEUTRAL"}
              </Text>
            </Box>

            {/* VS Circle */}
            <Box
              width="80px"
              height="80px"
              borderRadius="50%"
              background="rgba(0, 162, 255, 0.1)"
              border="2px solid rgba(0, 162, 255, 0.4)"
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxShadow="0 0 40px rgba(0, 162, 255, 0.3)"
            >
              <Text
                color="#00a2ff"
                fontSize="28px"
                fontWeight="200"
                textShadow="0 0 20px rgba(0, 162, 255, 0.8)"
                letterSpacing="4px"
              >
                VS
              </Text>
            </Box>

            {/* Stats */}
            <Box
              display="flex"
              gap={4}
              px="16px"
              py="8px"
              borderRadius="8px"
              background="rgba(15, 23, 42, 0.6)"
              border="1px solid rgba(0, 162, 255, 0.3)"
            >
              <Box textAlign="center">
                <Text fontSize="20px" fontWeight="700" color="#00a2ff">
                  {relationship.veracity}
                </Text>
                <Text fontSize="10px" color="#64748b" textTransform="uppercase">
                  Veracity
                </Text>
              </Box>
              <Box width="1px" bg="rgba(100, 116, 139, 0.3)" />
              <Box textAlign="center">
                <Text fontSize="20px" fontWeight="700" color="#00a2ff">
                  {relationship.weight}/10
                </Text>
                <Text fontSize="10px" color="#64748b" textTransform="uppercase">
                  Weight
                </Text>
              </Box>
            </Box>

            {/* Navigation */}
            <Box display="flex" gap={2} alignItems="center">
              <IconButton
                aria-label="Previous claim"
                icon={<ChevronLeftIcon boxSize={6} />}
                onClick={handlePrevCard}
                isDisabled={currentComparisonIndex === 0}
                size="sm"
                bg="rgba(34, 197, 94, 0.1)"
                border="1px solid rgba(34, 197, 94, 0.4)"
                color="#4ade80"
                _hover={{
                  bg: "rgba(34, 197, 94, 0.2)",
                  boxShadow: "0 0 20px rgba(34, 197, 94, 0.4)",
                }}
                _disabled={{ opacity: 0.3, cursor: "not-allowed" }}
              />
              <Text
                color="#64748b"
                fontSize="0.8rem"
                fontWeight="300"
                letterSpacing="1px"
                minWidth="60px"
                textAlign="center"
              >
                {currentComparisonIndex + 1} / {enrichedReferenceClaims.length}
              </Text>
              <IconButton
                aria-label="Next claim"
                icon={<ChevronRightIcon boxSize={6} />}
                onClick={handleNextCard}
                isDisabled={
                  currentComparisonIndex === enrichedReferenceClaims.length - 1
                }
                size="sm"
                bg="rgba(34, 197, 94, 0.1)"
                border="1px solid rgba(34, 197, 94, 0.4)"
                color="#4ade80"
                _hover={{
                  bg: "rgba(34, 197, 94, 0.2)",
                  boxShadow: "0 0 20px rgba(34, 197, 94, 0.4)",
                }}
                _disabled={{ opacity: 0.3, cursor: "not-allowed" }}
              />
            </Box>
          </Box>

          {/* Reference Claim - Right (Swipeable) */}
          <Box
            flex={1}
            display="flex"
            justifyContent="flex-start"
            position="relative"
          >
            {currentRefClaim && selectedReference && (
              <Box position="relative">
                <PlayingCard
                  claim={{
                    claim_id: currentRefClaim.claim_id,
                    claim_text: currentRefClaim.claim_text,
                    veracity_score: 0,
                    confidence_level: 0,
                    last_verified: "",
                  }}
                  type="reference"
                  isFocused={true}
                  isSelected={true}
                  totalCards={enrichedReferenceClaims.length}
                  index={currentComparisonIndex}
                  relevanceScore={currentRefClaim.relevanceScore}
                  stance={currentRefClaim.stance}
                  confidence={currentRefClaim.confidence}
                  hasLink={currentRefClaim.hasLink}
                />
              </Box>
            )}
          </Box>
        </Box>

        {/* Hint */}
        <Box
          mt={6}
          background="rgba(15, 23, 42, 0.6)"
          backdropFilter="blur(20px)"
          border="1px solid rgba(0, 162, 255, 0.3)"
          borderRadius="8px"
          px="20px"
          py="12px"
          fontSize="0.8rem"
          color="#64748b"
          letterSpacing="0.5px"
          zIndex={2001}
        >
          🎮{" "}
          <Text as="span" color="#4ade80">
            Drag LEFT to LINK
          </Text>{" "}
          •{" "}
          <Text as="span" color="#ef4444">
            Drag RIGHT to SKIP
          </Text>{" "}
          • Arrows to browse • ESC to exit
        </Box>

        {/* Claim Link Overlay */}
        <ClaimLinkOverlay
          isOpen={isClaimLinkModalOpen}
          onClose={handleClaimLinkModalClose}
          sourceClaim={
            currentRefClaim
              ? {
                  claim_id: currentRefClaim.claim_id,
                  claim_text: currentRefClaim.claim_text,
                }
              : null
          }
          targetClaim={taskClaim}
          isReadOnly={false}
          onLinkCreated={handleLinkCreated}
          rationale={currentRefClaim?.rationale}
        />
      </Box>
    );
  }

  // Selection View
  return (
    <Box
      width="100%"
      minHeight="100vh"
      background="#000000"
      p={8}
      position="relative"
      sx={{
        "&::before": {
          content: '""',
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "linear-gradient(rgba(0, 162, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 162, 255, 0.1) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
          animation: "gridMove 40s linear infinite",
          pointerEvents: "none",
          zIndex: 0,
          perspective: "1000px",
          transform: "rotateX(60deg)",
        },
        "@keyframes gridMove": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "50px 50px" },
        },
      }}
    >
      {/* Header */}
      <Box
        position="absolute"
        top="20px"
        left="50%"
        transform="translateX(-50%)"
        textAlign="center"
        zIndex={100}
        background="rgba(0, 0, 0, 0.6)"
        backdropFilter="blur(20px)"
        px="32px"
        py="10px"
        borderRadius="8px"
        border="1px solid rgba(0, 162, 255, 0.3)"
        boxShadow="0 4px 24px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.2)"
      >
        <Text
          fontSize="1.2rem"
          fontWeight="200"
          letterSpacing="6px"
          color="#00a2ff"
          textShadow="0 0 20px rgba(0, 162, 255, 0.8)"
          textTransform="uppercase"
        >
          GAME SPACE {isFocusedMode ? "• FOCUSED" : ""}
        </Text>
      </Box>

      {/* 🎮 SCORE DISPLAY - Centered below column headers, above VS */}
      <Box
        position="absolute"
        top="200px"
        left="50%"
        transform="translateX(-50%)"
        zIndex={100}
        background="rgba(0, 0, 0, 0.8)"
        backdropFilter="blur(20px)"
        px="32px"
        py="20px"
        borderRadius="12px"
        border="2px solid rgba(139, 92, 246, 0.5)"
        boxShadow="0 4px 24px rgba(0, 0, 0, 0.6), 0 0 40px rgba(139, 92, 246, 0.3)"
      >
        <Text
          fontSize="0.7rem"
          color="#a78bfa"
          letterSpacing="2px"
          textTransform="uppercase"
          fontWeight="600"
          mb="8px"
          textAlign="center"
        >
          Score
        </Text>
        <Box
          display="flex"
          alignItems="baseline"
          justifyContent="center"
          gap="8px"
        >
          <Text
            fontSize="3rem"
            fontWeight="700"
            color={ghostScore !== null ? "#64748b" : "#a78bfa"}
            textShadow={
              ghostScore !== null ? "none" : "0 0 20px rgba(139, 92, 246, 0.8)"
            }
            transition="all 0.3s ease"
            opacity={ghostScore !== null ? 0.4 : 1}
          >
            {userScore.toFixed(1)}
          </Text>
          {ghostScore !== null && (
            <Text
              fontSize="3rem"
              fontWeight="700"
              color="#22c55e"
              textShadow="0 0 20px rgba(34, 197, 94, 0.8)"
              animation="ghostPulse 1s ease-in-out infinite"
              sx={{
                "@keyframes ghostPulse": {
                  "0%, 100%": { opacity: 1, transform: "scale(1)" },
                  "50%": { opacity: 0.7, transform: "scale(1.05)" },
                },
              }}
            >
              {ghostScore.toFixed(1)}
            </Text>
          )}
        </Box>
        {ghostScore !== null && (
          <Text
            fontSize="0.8rem"
            color="#22c55e"
            textAlign="center"
            mt="4px"
            fontWeight="600"
          >
            {formatPoints(ghostScore - userScore)}
          </Text>
        )}
      </Box>

      {/* Main Grid */}
      <Box
        display="grid"
        gridTemplateColumns={isReferenceClaimsMode ? "1fr auto 1fr" : "1fr 1fr"}
        gap={6}
        maxWidth="1800px"
        mx="auto"
        pt="80px"
        position="relative"
        zIndex={1}
      >
        {/* Left Column - Task Claims Slide Deck */}
        <Box>
          <Box
            mb={6}
            background="rgba(0, 0, 0, 0.6)"
            backdropFilter="blur(20px)"
            border="1px solid rgba(139, 92, 246, 0.4)"
            borderRadius="8px"
            px="24px"
            py="12px"
            boxShadow="0 4px 24px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 92, 246, 0.2)"
            display="flex"
            alignItems="center"
            gap={3}
          >
            {isFocusedMode && (
              <IconButton
                aria-label="Back to overview"
                icon={<ChevronLeftIcon boxSize={5} />}
                onClick={() => {
                  setSelectedTaskClaimIndex(null);
                  setIsFocusedMode(false);
                  setIsReferenceClaimsMode(false);
                  setIsComparisonMode(false);
                  setSelectedReferenceIndex(null);
                }}
                size="sm"
                bg="rgba(139, 92, 246, 0.1)"
                border="1px solid rgba(139, 92, 246, 0.4)"
                color="#a78bfa"
                _hover={{
                  bg: "rgba(139, 92, 246, 0.2)",
                  boxShadow: "0 0 20px rgba(139, 92, 246, 0.4)",
                }}
              />
            )}
            <Text
              color="#a78bfa"
              fontSize="0.9rem"
              fontWeight="300"
              textAlign="center"
              textTransform="uppercase"
              letterSpacing="2px"
              textShadow="0 0 8px rgba(139, 92, 246, 0.6)"
              flex={1}
            >
              Task Claims
            </Text>
          </Box>

          {/* Card Stack Container - Slide Deck Style */}
          <Box
            position="relative"
            height={`${totalStackHeight}px`}
            mx="auto"
            width="360px"
          >
            {displayedClaims.map((claim, displayIndex) => {
              // Get the original index from the full claims array
              const originalIndex = claims.findIndex(
                (c) => c.claim_id === claim.claim_id,
              );
              const isDropZone =
                isReferenceClaimsMode &&
                originalIndex === selectedTaskClaimIndex;
              return (
                <Box
                  key={claim.claim_id}
                  ref={isDropZone ? taskClaimRef : null}
                  position="absolute"
                  width="320px"
                  height="480px"
                  left="20px"
                  sx={{
                    ...(isFocusedMode
                      ? {
                          top: "0px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          zIndex: 200,
                        }
                      : getCardStackStyle(displayIndex)),
                    boxShadow:
                      isDropZone && isOverTaskClaim
                        ? "0 0 40px rgba(34, 197, 94, 0.8), 0 0 80px rgba(34, 197, 94, 0.4)"
                        : undefined,
                    border:
                      isDropZone && isOverTaskClaim
                        ? "3px solid rgba(34, 197, 94, 0.8)"
                        : undefined,
                    borderRadius:
                      isDropZone && isOverTaskClaim ? "16px" : undefined,
                    transition: "all 0.2s ease",
                    pointerEvents: "auto",
                  }}
                >
                  <PlayingCard
                    claim={claim}
                    type="task"
                    isFocused={
                      (!isFocusedMode && displayIndex === focusedCardIndex) ||
                      isFocusedMode
                    }
                    isSelected={originalIndex === selectedTaskClaimIndex}
                    onClick={() => handleTaskClaimClick(originalIndex)}
                    onHover={() =>
                      !isFocusedMode && handleCardHover(displayIndex)
                    }
                    style={{}}
                    index={originalIndex}
                    totalCards={claims.length}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Middle Column - VS Comparison Info */}
        {isReferenceClaimsMode &&
          selectedTaskClaimIndex !== null &&
          enrichedReferenceClaims.length > 0 && (
            <Box
              display="flex"
              alignItems="flex-start"
              justifyContent="center"
              pt="240px"
            >
              {(() => {
                const focusedClaim = enrichedReferenceClaims[0];
                const relationship = {
                  type: focusedClaim.stance || "insufficient",
                  veracity: Math.round(focusedClaim.relevanceScore || 0),
                  weight: focusedClaim.confidence
                    ? Math.round(focusedClaim.confidence * 10)
                    : 0,
                };
                return (
                  <Box
                    display="inline-flex"
                    flexDirection="column"
                    gap={3}
                    alignItems="center"
                    p="20px"
                    background="rgba(0, 0, 0, 0.9)"
                    backdropFilter="blur(20px)"
                    borderRadius="16px"
                    border="2px solid rgba(0, 162, 255, 0.5)"
                    boxShadow="0 8px 40px rgba(0, 0, 0, 0.8), 0 0 60px rgba(0, 162, 255, 0.3)"
                  >
                    <Box
                      px="20px"
                      py="10px"
                      borderRadius="10px"
                      background={
                        relationship.type === "support"
                          ? "rgba(34, 197, 94, 0.25)"
                          : relationship.type === "refute"
                            ? "rgba(239, 68, 68, 0.25)"
                            : "rgba(234, 179, 8, 0.25)"
                      }
                      border={`2px solid ${
                        relationship.type === "support"
                          ? "rgba(34, 197, 94, 0.6)"
                          : relationship.type === "refute"
                            ? "rgba(239, 68, 68, 0.6)"
                            : "rgba(234, 179, 8, 0.6)"
                      }`}
                    >
                      <Text
                        color={
                          relationship.type === "support"
                            ? "#4ade80"
                            : relationship.type === "refute"
                              ? "#ef4444"
                              : "#fbbf24"
                        }
                        fontSize="14px"
                        fontWeight="700"
                        textTransform="uppercase"
                        letterSpacing="1.5px"
                        textAlign="center"
                      >
                        {relationship.type === "support"
                          ? "✓ SUPPORTS"
                          : relationship.type === "refute"
                            ? "✗ REFUTES"
                            : relationship.type === "nuance"
                              ? "~ NUANCES"
                              : "? UNCLEAR"}
                      </Text>
                    </Box>
                    <Text fontSize="24px" fontWeight="200" color="#00a2ff">
                      VS
                    </Text>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <Box
                        textAlign="center"
                        px="16px"
                        py="8px"
                        background="rgba(0, 162, 255, 0.15)"
                        borderRadius="8px"
                        border="1px solid rgba(0, 162, 255, 0.3)"
                      >
                        <Text color="#00a2ff" fontWeight="700" fontSize="20px">
                          {relationship.veracity}
                        </Text>
                        <Text
                          color="#64748b"
                          textTransform="uppercase"
                          fontSize="10px"
                        >
                          Score
                        </Text>
                      </Box>
                      <Box
                        textAlign="center"
                        px="16px"
                        py="8px"
                        background="rgba(0, 162, 255, 0.15)"
                        borderRadius="8px"
                        border="1px solid rgba(0, 162, 255, 0.3)"
                      >
                        <Text color="#00a2ff" fontWeight="700" fontSize="20px">
                          {relationship.weight}/10
                        </Text>
                        <Text
                          color="#64748b"
                          textTransform="uppercase"
                          fontSize="10px"
                        >
                          Weight
                        </Text>
                      </Box>
                    </Box>
                  </Box>
                );
              })()}
            </Box>
          )}

        {/* Right Column - Reference Cards OR Reference Claims Slide Deck */}
        <Box>
          <Box
            mb={6}
            background="rgba(0, 0, 0, 0.6)"
            backdropFilter="blur(20px)"
            border="1px solid rgba(34, 197, 94, 0.4)"
            borderRadius="8px"
            px="24px"
            py="12px"
            boxShadow="0 4px 24px rgba(0, 0, 0, 0.6), 0 0 30px rgba(34, 197, 94, 0.2)"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text
              color="#4ade80"
              fontSize="0.9rem"
              fontWeight="300"
              textAlign="center"
              textTransform="uppercase"
              letterSpacing="2px"
              textShadow="0 0 8px rgba(34, 197, 94, 0.6)"
              flex={1}
            >
              {isReferenceClaimsMode ? "Reference Claims" : "References"}
            </Text>
            {isReferenceClaimsMode && (
              <IconButton
                aria-label="Back to references"
                icon={<ChevronLeftIcon boxSize={5} />}
                onClick={handleBackToReferences}
                size="sm"
                bg="rgba(34, 197, 94, 0.1)"
                border="1px solid rgba(34, 197, 94, 0.4)"
                color="#4ade80"
                _hover={{
                  bg: "rgba(34, 197, 94, 0.2)",
                  boxShadow: "0 0 20px rgba(34, 197, 94, 0.4)",
                }}
              />
            )}
          </Box>

          {/* Reference Card Stack Container - Slide Deck Style */}
          <Box
            position="relative"
            height={`${totalReferenceStackHeight}px`}
            mx="auto"
            width="360px"
          >
            {isReferenceClaimsMode ? (
              // Show reference claims as cards
              isAssessingClaims ? (
                <Box textAlign="center" p="60px" color="var(--mr-blue)">
                  <Spinner size="xl" color="var(--mr-blue)" mb={4} />
                  <Text fontSize="1.2rem" fontWeight="bold" mb={2}>
                    Loading Claims...
                  </Text>
                  <Text fontSize="0.9rem" opacity={0.8}>
                    Assessing reference claims
                  </Text>
                </Box>
              ) : enrichedReferenceClaims.length > 0 ? (
                enrichedReferenceClaims.map((claim, claimIndex) => {
                  const isFocusedClaim = claimIndex === 0; // Top card is always focused
                  const isBeingDragged =
                    draggingClaim?.claim_id === claim.claim_id;
                  return (
                    <Box
                      key={claim.claim_id}
                      data-reference-card-index={claimIndex}
                      data-reference-card-id={claim.claim_id}
                      style={getReferenceClaimStackStyle(claimIndex)}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault(); // Prevent any default scroll behavior
                      }}
                      onMouseDown={
                        isFocusedClaim
                          ? (e: React.MouseEvent) => {
                              console.log(
                                "[Drag Start] Setting draggingClaim and dragStartPosition",
                                {
                                  claim_id: claim.claim_id,
                                  mouseX: e.clientX,
                                  mouseY: e.clientY,
                                },
                              );
                              setDraggingClaim({
                                claim_id: claim.claim_id,
                                claim_text: claim.claim_text,
                              });
                              setDragStartPosition({
                                x: e.clientX,
                                y: e.clientY,
                              });

                              // 🎮 Set dragging state for score preview
                              setIsDragging(true);
                              // Use support_level (relationship to task claim) not veracity_score (standalone truth)
                              const claimVeracity =
                                claim.support_level !== undefined
                                  ? claim.support_level * 100 // Convert -1.2..+1.2 to -120..+120
                                  : 0;
                              console.log(
                                `🎮 Drag start: support_level=${claim.support_level}, claimVeracity=${claimVeracity}`,
                              );
                              setDraggedClaimVeracity(claimVeracity);
                              // Calculate ghost score (current + max possible points)
                              const maxPoints = getMaxPossiblePoints();
                              setGhostScore(userScore + maxPoints);
                            }
                          : undefined
                      }
                      sx={{
                        opacity: isBeingDragged ? 0.3 : 1,
                        transition: "opacity 0.2s ease",
                        cursor: isFocusedClaim ? "grab" : "pointer",
                        userSelect: "none",
                      }}
                    >
                      <PlayingCard
                        claim={{
                          claim_id: claim.claim_id,
                          claim_text: claim.claim_text,
                          veracity_score: claim.veracity_score || 0,
                          confidence_level: claim.confidence_level || 0,
                          last_verified: claim.last_verified || "",
                        }}
                        type="reference"
                        isFocused={claimIndex === focusedReferenceClaimIndex}
                        veracityScore={claim.veracity_score}
                        potentialPoints={getMaxPossiblePoints()}
                        isSelected={false}
                        onClick={() => handleReferenceClaimClick(claimIndex)}
                        onHover={() => handleReferenceClaimHover(claimIndex)}
                        style={{}}
                        index={claimIndex}
                        totalCards={enrichedReferenceClaims.length}
                        relevanceScore={claim.relevanceScore}
                        stance={claim.stance}
                        confidence={claim.confidence}
                        support_level={claim.support_level}
                        rationale={claim.rationale}
                        hasLink={claim.hasLink}
                        onReassess={() => {
                          if (selectedTaskClaimIndex !== null) {
                            const taskClaim = claims[selectedTaskClaimIndex];
                            setReassessTarget({
                              referenceClaimId: claim.claim_id,
                              referenceClaimText: claim.claim_text,
                              taskClaimId: taskClaim.claim_id,
                              taskClaimText: taskClaim.claim_text,
                              currentAssessment: {
                                stance: claim.stance || "insufficient",
                                confidence: claim.confidence || 0,
                                support_level: claim.support_level || 0,
                                rationale: claim.rationale,
                              },
                            });
                            setIsReassessModalOpen(true);
                          }
                        }}
                      />
                    </Box>
                  );
                })
              ) : (
                <Box textAlign="center" p="40px" color="#64748b">
                  <Text mb="8px">No claims found</Text>
                  <Text fontSize="0.75rem" opacity={0.7}>
                    This reference has no claims
                  </Text>
                </Box>
              )
            ) : (
              // Show references as cards (when NOT in reference claims mode)
              <>
                {(() => {
                  console.log(
                    `[References Render] isLoadingEvidence=${isLoadingEvidence}, displayedReferences.length=${displayedReferences.length}, isReferenceClaimsMode=${isReferenceClaimsMode}, totalReferenceStackHeight=${totalReferenceStackHeight}`,
                  );
                  return null;
                })()}
                {isLoadingEvidence ? (
                  // Loading evidence engine
                  <Box textAlign="center" p="60px" color="var(--mr-blue)">
                    <Spinner size="xl" color="var(--mr-blue)" mb={4} />
                    <Text fontSize="1.2rem" fontWeight="bold" mb={2}>
                      Analyzing Evidence...
                    </Text>
                    <Text fontSize="0.9rem" opacity={0.8}>
                      Finding relevant references for this claim
                    </Text>
                  </Box>
                ) : // Show references as cards
                displayedReferences.length > 0 ? (
                  displayedReferences.map((reference, displayIndex) => {
                    // Get the original index from the full references array
                    const originalIndex = references.findIndex(
                      (r) =>
                        r.reference_content_id ===
                        reference.reference_content_id,
                    );
                    return (
                      <ReferenceCard
                        key={reference.reference_content_id}
                        reference={reference}
                        isFocused={displayIndex === focusedReferenceIndex}
                        isSelected={originalIndex === selectedReferenceIndex}
                        onClick={() => handleReferenceClick(originalIndex)}
                        onHover={() => handleReferenceHover(displayIndex)}
                        style={getReferenceStackStyle(displayIndex)}
                        index={displayIndex}
                        totalCards={displayedReferences.length}
                      />
                    );
                  })
                ) : (
                  <Box
                    textAlign="center"
                    p="40px"
                    color="#64748b"
                    fontSize="0.9rem"
                  >
                    <Text mb="8px">No linked references found</Text>
                    <Text fontSize="0.75rem" opacity={0.7}>
                      This task claim has no connected references
                    </Text>
                  </Box>
                )}
              </>
            )}
          </Box>
        </Box>
      </Box>

      {/* Interaction Hint */}
      <Box
        position="absolute"
        bottom="20px"
        left="20px"
        background="rgba(15, 23, 42, 0.6)"
        backdropFilter="blur(20px)"
        border="1px solid rgba(0, 162, 255, 0.3)"
        borderRadius="8px"
        px="20px"
        py="12px"
        zIndex={100}
        fontSize="0.8rem"
        color="#64748b"
        letterSpacing="0.5px"
      >
        {isReferenceClaimsMode
          ? "💡 Hover claims to expand • Drag LEFT to LINK • Drag RIGHT to SKIP • ← to go back"
          : isFocusedMode
            ? "💡 Hover over references to expand • Click reference to see its claims • ← to go back"
            : "💡 Click task claim to focus on linked references • Hover cards to expand"}
      </Box>

      {/* Claim Link Modal - for linking reference claims to task claims */}
      {(() => {
        const shouldRender =
          isReferenceClaimsMode && selectedTaskClaimIndex !== null;
        const sourceClaim =
          enrichedReferenceClaims.length > 0 &&
          focusedReferenceClaimIndex < enrichedReferenceClaims.length
            ? {
                claim_id:
                  enrichedReferenceClaims[focusedReferenceClaimIndex].claim_id,
                claim_text:
                  enrichedReferenceClaims[focusedReferenceClaimIndex]
                    .claim_text,
              }
            : null;

        console.log("[ClaimLinkOverlay Render]", {
          shouldRender,
          isClaimLinkModalOpen,
          sourceClaim: sourceClaim ? "valid" : "null",
          targetClaim: selectedTaskClaimIndex !== null ? "valid" : "null",
        });

        if (!shouldRender) return null;

        return (
          <ClaimLinkOverlay
            isOpen={isClaimLinkModalOpen}
            onClose={handleClaimLinkModalClose}
            sourceClaim={sourceClaim}
            targetClaim={
              selectedTaskClaimIndex !== null
                ? claims[selectedTaskClaimIndex]
                : null
            }
            isReadOnly={false}
            onLinkCreated={handleLinkCreated}
            onScoreAwarded={(points) => {
              console.log(`🎮 Awarding ${points} points!`);
              setUserScore((prev) => {
                console.log(`🎮 Score update: ${prev} → ${prev + points}`);
                return prev + points;
              });
            }}
            sourceClaimVeracity={(() => {
              console.log(
                `🎮 Passing sourceClaimVeracity to overlay: ${draggedClaimVeracity}`,
              );
              return draggedClaimVeracity !== null
                ? draggedClaimVeracity
                : undefined;
            })()}
            rationale={
              enrichedReferenceClaims.length > 0 &&
              focusedReferenceClaimIndex < enrichedReferenceClaims.length
                ? enrichedReferenceClaims[focusedReferenceClaimIndex].rationale
                : undefined
            }
          />
        );
      })()}

      {/* Re-assess Claim Modal */}
      {reassessTarget && (
        <ReassessClaimModal
          isOpen={isReassessModalOpen}
          onClose={() => {
            setIsReassessModalOpen(false);
            setReassessTarget(null);
          }}
          referenceClaimId={reassessTarget.referenceClaimId}
          taskClaimId={reassessTarget.taskClaimId}
          referenceClaimText={reassessTarget.referenceClaimText}
          taskClaimText={reassessTarget.taskClaimText}
          currentAssessment={reassessTarget.currentAssessment}
          onReassessComplete={async () => {
            // Refresh the enriched claims to show updated assessment
            if (
              selectedTaskClaimIndex !== null &&
              selectedReferenceIndex !== null
            ) {
              const selectedTaskClaim = claims[selectedTaskClaimIndex];
              const { fetchReferenceClaimTaskLinks } =
                await import("../services/referenceClaimRelevance");
              const { enrichClaimsWithRelevance } =
                await import("../services/referenceClaimRelevance");

              const links = await fetchReferenceClaimTaskLinks(
                selectedTaskClaim.claim_id,
              );
              const selectedReference = references[selectedReferenceIndex];

              let referenceClaims: any[] = [];
              if (Array.isArray(selectedReference.claims)) {
                referenceClaims = selectedReference.claims;
              } else if (typeof selectedReference.claims === "string") {
                try {
                  referenceClaims = JSON.parse(selectedReference.claims);
                } catch (e) {
                  console.error("Failed to parse reference claims:", e);
                }
              }

              const referenceClaimIds = referenceClaims.map((c) => c.claim_id);
              const relevantLinks = links.filter((link) =>
                referenceClaimIds.includes(link.reference_claim_id),
              );

              const enriched = enrichClaimsWithRelevance(
                referenceClaims,
                selectedTaskClaim.claim_id,
                relevantLinks,
              );

              setEnrichedReferenceClaims(enriched);
              toast({
                title: "Claims refreshed!",
                description: "Updated assessment is now visible",
                status: "success",
                duration: 2000,
                isClosable: true,
              });
            }
          }}
        />
      )}

      {/* Floating Card - follows cursor when dragging */}
      {draggingClaim &&
        (() => {
          const draggedClaim = enrichedReferenceClaims.find(
            (c) => c.claim_id === draggingClaim.claim_id,
          );
          if (!draggedClaim) return null;

          return (
            <Box
              position="fixed"
              left={`${mousePosition.x}px`}
              top={`${mousePosition.y}px`}
              pointerEvents="none"
              zIndex={9999}
              transform={
                isOverTaskClaim
                  ? "translate(-50%, -50%) scale(1.1) rotate(-5deg)"
                  : isOverSkipZone
                    ? "translate(-50%, -50%) scale(0.9) rotate(8deg)"
                    : isDraggingLeft
                      ? "translate(-50%, -50%) rotate(-5deg)"
                      : isDraggingRight
                        ? "translate(-50%, -50%) rotate(5deg)"
                        : "translate(-50%, -50%) rotate(0deg)"
              }
              transition="transform 0.15s ease"
              filter="drop-shadow(0 10px 40px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 40px rgba(34, 197, 94, 0.6))"
            >
              <PlayingCard
                claim={{
                  claim_id: draggedClaim.claim_id,
                  claim_text: draggedClaim.claim_text,
                  veracity_score: draggedClaimVeracity || 0,
                  confidence_level: 0,
                  last_verified: "",
                }}
                type="reference"
                isFocused={true}
                isSelected={false}
                onClick={() => {}}
                onHover={() => {}}
                style={{}}
                index={0}
                totalCards={1}
                relevanceScore={draggedClaim.relevanceScore}
                stance={draggedClaim.stance}
                confidence={draggedClaim.confidence}
                hasLink={draggedClaim.hasLink}
                veracityScore={draggedClaimVeracity || undefined}
                potentialPoints={getMaxPossiblePoints()}
              />
            </Box>
          );
        })()}

      {/* Skip Zone Indicator - shows when dragging RIGHT */}
      {draggingClaim && isDraggingRight && (
        <Box
          position="absolute"
          left="0"
          right="0"
          top="580px"
          pointerEvents="none"
          zIndex={9998}
          display="flex"
          justifyContent="center"
          alignItems="center"
        >
          <Box
            px="40px"
            py="24px"
            background={
              isOverSkipZone
                ? "rgba(239, 68, 68, 0.4)"
                : "rgba(239, 68, 68, 0.2)"
            }
            backdropFilter="blur(20px)"
            border={
              isOverSkipZone
                ? "4px solid rgba(239, 68, 68, 0.9)"
                : "3px solid rgba(239, 68, 68, 0.6)"
            }
            borderRadius="16px"
            boxShadow="0 8px 40px rgba(0, 0, 0, 0.8), 0 0 60px rgba(239, 68, 68, 0.6)"
            transition="all 0.2s ease"
          >
            <Text
              color="#ef4444"
              fontSize="36px"
              fontWeight="700"
              letterSpacing="2px"
              textAlign="center"
            >
              {isOverSkipZone ? "✗ DROP TO SKIP" : "SKIP →"}
            </Text>
          </Box>
        </Box>
      )}

      {/* Link Zone Indicator - shows when dragging LEFT */}
      {draggingClaim && isDraggingLeft && (
        <Box
          position="absolute"
          left="0"
          right="0"
          top="580px"
          pointerEvents="none"
          zIndex={9998}
          display="flex"
          justifyContent="center"
          alignItems="center"
        >
          <Box
            px="40px"
            py="24px"
            background={
              isOverTaskClaim
                ? "rgba(34, 197, 94, 0.4)"
                : "rgba(34, 197, 94, 0.2)"
            }
            backdropFilter="blur(20px)"
            border={
              isOverTaskClaim
                ? "4px solid rgba(34, 197, 94, 0.9)"
                : "3px solid rgba(34, 197, 94, 0.6)"
            }
            borderRadius="16px"
            boxShadow="0 8px 40px rgba(0, 0, 0, 0.8), 0 0 60px rgba(34, 197, 94, 0.6)"
            transition="all 0.2s ease"
          >
            <Text
              color="#4ade80"
              fontSize="36px"
              fontWeight="700"
              letterSpacing="2px"
              textAlign="center"
            >
              {isOverTaskClaim ? "✓ DROP TO LINK" : "← LINK"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default GameSpace;
