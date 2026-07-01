import React, { useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Collapse,
  Tooltip,
  Image,
  Badge,
} from "@chakra-ui/react";

interface ClaimPair {
  caseClaim: {
    claim_id: number;
    claim_text: string;
    publisher: string;
    url: string;
  };
  sourceClaim: {
    claim_id: number;
    claim_text: string;
    publisher: string;
    url: string;
    relationship: string;
  };
  verimeter_score: number;
  support_level?: number;
  rationale?: string;
}

interface ClaimPairsData {
  overall_verimeter: number;
  claim_pairs: ClaimPair[];
}

interface ClaimPairsDetailProps {
  claimPairsData: ClaimPairsData | null;
}

// Helper to get publisher icon URL
function getPublisherIconUrl(publisher: string | null): string {
  if (!publisher) return "";

  let domain = publisher;
  try {
    if (publisher.includes("://")) {
      domain = new URL(publisher).hostname;
    }
    domain = domain.replace(/^www\./, "");
  } catch (e) {
    // If parsing fails, use as-is
  }

  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

const ClaimPairsDetail: React.FC<ClaimPairsDetailProps> = ({
  claimPairsData,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedPairId, setExpandedPairId] = useState<string | null>(null);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  return (
    <Box
      width="100%"
      mt={2}
      position="relative"
      background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
      backdropFilter="blur(20px)"
      border="1px solid rgba(0, 162, 255, 0.4)"
      borderRadius="12px"
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
      transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
      overflow="hidden"
    >
      <button
        onClick={handleToggle}
        style={{
          position: "relative",
          width: "100%",
          padding: "10px 24px",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.85))",
          border: "1px solid rgba(0, 162, 255, 0.4)",
          borderRadius: "6px",
          color: "#00a2ff",
          fontWeight: 600,
          letterSpacing: "1px",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "all 0.3s ease",
          backdropFilter: "blur(10px)",
          fontSize: "0.75rem",
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
          overflow: "hidden",
          fontFamily: "Futura, 'Century Gothic', 'Avenir Next', sans-serif",
        }}
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="8px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, transparent 100%)"
          pointerEvents="none"
        />
        <span style={{ position: "relative", zIndex: 1 }}>
          {isOpen ? "▼" : "▶"} {isOpen ? "Hide" : "Show"} Top Claims
        </span>
      </button>

      {/* Left edge glow bar for outer container */}
      <Box
        position="absolute"
        left={0}
        top={0}
        width="20px"
        height="100%"
        background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
        pointerEvents="none"
        zIndex={1}
        borderTopLeftRadius="12px"
        borderBottomLeftRadius="12px"
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

      <Collapse in={isOpen} animateOpacity>
        <Box
          mt={2}
          p={2}
          position="relative"
          maxH="300px"
          overflowY="auto"
          css={{
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 162, 255, 0.1)',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 162, 255, 0.4)',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: 'rgba(0, 162, 255, 0.6)',
            },
          }}
        >
          <Box position="relative" zIndex={1}>
            {!claimPairsData && (
              <Text
                color="gray.500"
                fontSize="sm"
                textAlign="center"
                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
              >
                No claim pairs data available
              </Text>
            )}

            {claimPairsData && (
              <VStack spacing={2} align="stretch">
                {claimPairsData.claim_pairs.map((pair, idx) => {
                  const pairKey = `${pair.caseClaim.claim_id}-${pair.sourceClaim.claim_id}`;
                  const isExpanded = expandedPairId === pairKey;
                  const isSupport = pair.verimeter_score > 0.1;
                  const isRefute = pair.verimeter_score < -0.1;

                  return (
                    <Box
                      key={pairKey}
                      position="relative"
                      background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
                      backdropFilter="blur(20px)"
                      borderRadius="8px"
                      border="1px solid rgba(0, 162, 255, 0.4)"
                      boxShadow="0 4px 16px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 162, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                      overflow="hidden"
                      transition="all 0.3s ease"
                      _hover={{
                        borderColor: "rgba(0, 162, 255, 0.6)",
                        transform: "translateY(-1px)",
                        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                      }}
                    >
                      {/* Left edge glow bar */}
                      <Box
                        position="absolute"
                        left={0}
                        top={0}
                        width="15px"
                        height="100%"
                        background="linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
                        pointerEvents="none"
                        zIndex={1}
                        borderTopLeftRadius="8px"
                        borderBottomLeftRadius="8px"
                      />
                      {/* Collapsed View - Clickable */}
                      <Box
                        w="100%"
                        p={2}
                        cursor="pointer"
                        onClick={() =>
                          setExpandedPairId(isExpanded ? null : pairKey)
                        }
                        textAlign="left"
                        _hover={{ bg: "rgba(255, 255, 255, 0.02)" }}
                        position="relative"
                        zIndex={1}
                      >
                        <VStack
                          spacing={1}
                          align="stretch"
                          pointerEvents="none"
                        >
                          {/* Case Claim (Top) - Blue with glow */}
                          <Text
                            color="#00a2ff"
                            fontWeight="500"
                            fontSize="sm"
                            noOfLines={2}
                            overflow="hidden"
                            textOverflow="ellipsis"
                            fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                            lineHeight="1.3"
                            textShadow="0 0 8px rgba(0, 162, 255, 0.6)"
                          >
                            {pair.caseClaim.claim_text}
                          </Text>

                          {/* Verimeter Bar with Label */}
                          <HStack spacing={1} align="center" py={0.5} mt={1}>
                            <Text
                              fontSize="xs"
                              color="#60a5fa"
                              flexShrink={0}
                              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                            >
                              ↓
                            </Text>

                            {/* Bar container */}
                            <Box flex={1} position="relative">
                              {/* Label above bar - centered */}
                              <Text
                                position="absolute"
                                left="50%"
                                top="-15px"
                                transform="translateX(-50%)"
                                fontSize="2xs"
                                fontWeight="700"
                                color={
                                  isSupport
                                    ? "#4ade80"
                                    : isRefute
                                      ? "#f87171"
                                      : "#60a5fa"
                                }
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                textTransform="uppercase"
                                letterSpacing="1px"
                                whiteSpace="nowrap"
                              >
                                {isSupport
                                  ? "Supported By"
                                  : isRefute
                                    ? "Refuted By"
                                    : "Nuanced By"}
                              </Text>

                              {/* Thin gradient bar */}
                              <Box
                                h="6px"
                                w="100%"
                                borderRadius="3px"
                                background="linear-gradient(to right, #f87171 0%, #60a5fa 50%, #4ade80 100%)"
                                boxShadow="inset 0 1px 2px rgba(0, 0, 0, 0.3)"
                                position="relative"
                                mt={1}
                              />

                              {/* Score badge on bar */}
                              <Box
                                position="absolute"
                                left={`${((pair.verimeter_score + 1) / 2) * 100}%`}
                                top="50%"
                                transform="translate(-50%, -50%)"
                                bg="rgba(15, 23, 42, 0.95)"
                                px={1.5}
                                py={0.5}
                                borderRadius="3px"
                                border="1px solid"
                                borderColor={
                                  isSupport
                                    ? "#4ade80"
                                    : isRefute
                                      ? "#f87171"
                                      : "#60a5fa"
                                }
                                boxShadow="0 2px 4px rgba(0, 0, 0, 0.4)"
                              >
                                <Text
                                  fontSize="2xs"
                                  fontWeight="700"
                                  color={
                                    isSupport
                                      ? "#4ade80"
                                      : isRefute
                                        ? "#f87171"
                                        : "#60a5fa"
                                  }
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                  lineHeight="1"
                                >
                                  {Math.round(pair.verimeter_score * 100)}
                                </Text>
                              </Box>
                            </Box>

                            {/* Expand Icon */}
                            <Text
                              fontSize="xs"
                              color="#60a5fa"
                              flexShrink={0}
                              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                            >
                              {isExpanded ? "▼" : "▶"}
                            </Text>
                          </HStack>

                          {/* Source Claim (Bottom) - Green tint with glow */}
                          <Text
                            color="#86efac"
                            fontWeight="400"
                            fontSize="xs"
                            noOfLines={2}
                            overflow="hidden"
                            textOverflow="ellipsis"
                            fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                            lineHeight="1.3"
                            textShadow="0 0 6px rgba(134, 239, 172, 0.4)"
                          >
                            {pair.sourceClaim.claim_text}
                          </Text>
                        </VStack>
                      </Box>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <Box
                          p={3}
                          bg="rgba(15, 23, 42, 0.6)"
                          borderTop="1px solid rgba(0, 162, 255, 0.2)"
                          position="relative"
                          zIndex={1}
                        >
                          <VStack spacing={3} align="stretch">
                            {/* Stance Badge - Just the label, no verimeter */}
                            <HStack justify="center">
                              <Badge
                                fontSize="xs"
                                px={3}
                                py={1}
                                borderRadius="999px"
                                bg={
                                  isSupport
                                    ? "rgba(74, 222, 128, 0.15)"
                                    : isRefute
                                      ? "rgba(248, 113, 113, 0.15)"
                                      : "rgba(96, 165, 250, 0.15)"
                                }
                                color={
                                  isSupport
                                    ? "#4ade80"
                                    : isRefute
                                      ? "#f87171"
                                      : "#60a5fa"
                                }
                                border="1px solid"
                                borderColor={
                                  isSupport
                                    ? "rgba(74, 222, 128, 0.4)"
                                    : isRefute
                                      ? "rgba(248, 113, 113, 0.4)"
                                      : "rgba(96, 165, 250, 0.4)"
                                }
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                fontWeight="600"
                              >
                                {isSupport
                                  ? "SUPPORTED"
                                  : isRefute
                                    ? "REFUTED"
                                    : "NUANCED"}
                              </Badge>
                            </HStack>

                            {/* Verimeter Bar */}
                            <Box position="relative" w="100%">
                              {/* Thin gradient bar */}
                              <Box
                                h="12px"
                                w="100%"
                                borderRadius="6px"
                                background="linear-gradient(to right, #f87171 0%, #60a5fa 50%, #4ade80 100%)"
                                boxShadow="inset 0 1px 3px rgba(0, 0, 0, 0.4)"
                                position="relative"
                              />

                              {/* Score badge on bar */}
                              <Box
                                position="absolute"
                                left={`${((pair.verimeter_score + 1) / 2) * 100}%`}
                                top="50%"
                                transform="translate(-50%, -50%)"
                                bg="rgba(15, 23, 42, 0.95)"
                                px={2}
                                py={1}
                                borderRadius="4px"
                                border="1px solid"
                                borderColor={
                                  isSupport
                                    ? "#4ade80"
                                    : isRefute
                                      ? "#f87171"
                                      : "#60a5fa"
                                }
                                boxShadow="0 2px 6px rgba(0, 0, 0, 0.5)"
                              >
                                <Text
                                  fontSize="xs"
                                  fontWeight="700"
                                  color={
                                    isSupport
                                      ? "#4ade80"
                                      : isRefute
                                        ? "#f87171"
                                        : "#60a5fa"
                                  }
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                  lineHeight="1"
                                >
                                  {Math.round(pair.verimeter_score * 100)}
                                </Text>
                              </Box>
                            </Box>

                            {/* Case Claim */}
                            <Box>
                              <Text
                                fontSize="xs"
                                color="#60a5fa"
                                textTransform="uppercase"
                                letterSpacing="0.05em"
                                fontWeight="600"
                                mb={1}
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                Case Claim — {pair.caseClaim.publisher}
                              </Text>
                              <Text
                                fontSize="sm"
                                color="#e0f2fe"
                                lineHeight="1.5"
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                {pair.caseClaim.claim_text}
                              </Text>
                            </Box>

                            {/* Source Claim */}
                            <Box>
                              <Text
                                fontSize="xs"
                                color="#60a5fa"
                                textTransform="uppercase"
                                letterSpacing="0.05em"
                                fontWeight="600"
                                mb={1}
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                Source Claim — {pair.sourceClaim.publisher}
                              </Text>
                              <Text
                                fontSize="sm"
                                color="#e0f2fe"
                                lineHeight="1.5"
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                {pair.sourceClaim.claim_text}
                              </Text>
                            </Box>

                            {/* Rationale */}
                            {pair.rationale && (
                              <Box>
                                <Text
                                  fontSize="xs"
                                  color="#60a5fa"
                                  textTransform="uppercase"
                                  letterSpacing="0.05em"
                                  fontWeight="600"
                                  mb={1}
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  Rationale
                                </Text>
                                <Text
                                  fontSize="sm"
                                  color="#bae6fd"
                                  lineHeight="1.5"
                                  fontStyle="italic"
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  {pair.rationale}
                                </Text>
                              </Box>
                            )}

                            {/* Support Level */}
                            {pair.support_level !== undefined && (
                              <Box>
                                <Text
                                  fontSize="xs"
                                  color="#60a5fa"
                                  textTransform="uppercase"
                                  letterSpacing="0.05em"
                                  fontWeight="600"
                                  mb={1}
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  Support Level:{" "}
                                  {Math.round(pair.support_level * 100)}%
                                </Text>
                              </Box>
                            )}
                          </VStack>
                        </Box>
                      )}
                    </Box>
                  );
                })}

                {claimPairsData.claim_pairs.length === 0 && (
                  <Text
                    color="gray.500"
                    fontSize="sm"
                    textAlign="center"
                    fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                  >
                    No claim pairs available
                  </Text>
                )}
              </VStack>
            )}
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
};

export default ClaimPairsDetail;
