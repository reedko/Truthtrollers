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
import VerimeterMeter from "./VerimeterMeter";

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
          overflow="hidden"
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
                      borderRadius="12px"
                      border="1px solid"
                      borderColor={
                        isSupport
                          ? "rgba(97, 239, 184, 0.4)"
                          : isRefute
                            ? "rgba(255, 108, 136, 0.4)"
                            : "rgba(0, 162, 255, 0.4)"
                      }
                      boxShadow={
                        isSupport
                          ? "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(97, 239, 184, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                          : isRefute
                            ? "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(255, 108, 136, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                            : "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                      }
                      overflow="hidden"
                      transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                      _hover={{
                        borderColor: isSupport
                          ? "rgba(97, 239, 184, 0.6)"
                          : isRefute
                            ? "rgba(255, 108, 136, 0.6)"
                            : "rgba(0, 162, 255, 0.6)",
                        transform: "translateY(-2px)",
                        boxShadow: isSupport
                          ? "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 40px rgba(97, 239, 184, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)"
                          : isRefute
                            ? "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 40px rgba(255, 108, 136, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)"
                            : "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                      }}
                    >
                      {/* Left edge glow bar */}
                      <Box
                        position="absolute"
                        left={0}
                        top={0}
                        width="20px"
                        height="100%"
                        background={
                          isSupport
                            ? "linear-gradient(90deg, rgba(97, 239, 184, 0.4) 0%, rgba(97, 239, 184, 0) 100%)"
                            : isRefute
                              ? "linear-gradient(90deg, rgba(255, 108, 136, 0.4) 0%, rgba(255, 108, 136, 0) 100%)"
                              : "linear-gradient(90deg, rgba(0, 162, 255, 0.4) 0%, rgba(0, 162, 255, 0) 100%)"
                        }
                        pointerEvents="none"
                        zIndex={1}
                        borderTopLeftRadius="12px"
                        borderBottomLeftRadius="12px"
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
                          {/* Verimeter bar */}
                          <Box>
                            <VerimeterMeter
                              score={pair.verimeter_score}
                              width="100%"
                              showInterpretation={false}
                            />
                          </Box>

                          {/* Claims Row */}
                          <HStack
                            spacing={2}
                            fontSize="10px"
                            align="center"
                          >
                            {/* Case Claim - No Tooltip, just text */}
                            <HStack flex={1} spacing={1} minW={0}>
                              <Image
                                src={getPublisherIconUrl(
                                  pair.caseClaim.publisher,
                                )}
                                alt={pair.caseClaim.publisher}
                                boxSize="10px"
                                borderRadius="2px"
                                flexShrink={0}
                              />
                              <Text
                                color="#b4c9e0"
                                fontWeight="500"
                                noOfLines={1}
                                overflow="hidden"
                                textOverflow="ellipsis"
                                whiteSpace="nowrap"
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                {pair.caseClaim.claim_text}
                              </Text>
                            </HStack>
                            {/* Divider */}
                            <Box
                              width="1px"
                              height="12px"
                              bg="rgba(0, 162, 255, 0.3)"
                              flexShrink={0}
                            />
                            {/* Source Claim - No Tooltip, just text */}
                            <HStack flex={1} spacing={1} minW={0}>
                              <Image
                                src={getPublisherIconUrl(
                                  pair.sourceClaim.publisher,
                                )}
                                alt={pair.sourceClaim.publisher}
                                boxSize="10px"
                                borderRadius="2px"
                                flexShrink={0}
                              />
                              <Text
                                color="#b4c9e0"
                                fontWeight="500"
                                noOfLines={1}
                                overflow="hidden"
                                textOverflow="ellipsis"
                                whiteSpace="nowrap"
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                {pair.sourceClaim.claim_text}
                              </Text>
                            </HStack>
                            {/* Expand Icon */}
                            <Text
                              fontSize="xs"
                              color="#89a9bf"
                              flexShrink={0}
                              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                            >
                              {isExpanded ? "▼" : "▶"}
                            </Text>
                          </HStack>
                        </VStack>
                      </Box>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <Box
                          p={3}
                          bg="rgba(0, 0, 0, 0.4)"
                          borderTop="1px solid rgba(255, 255, 255, 0.05)"
                          position="relative"
                          zIndex={1}
                        >
                          <VStack spacing={3} align="stretch">
                            {/* Stance Badge */}
                            <HStack justify="center">
                              <Badge
                                fontSize="9px"
                                px={3}
                                py={1}
                                borderRadius="999px"
                                bg={
                                  isSupport
                                    ? "rgba(97, 239, 184, 0.2)"
                                    : isRefute
                                      ? "rgba(255, 108, 136, 0.2)"
                                      : "rgba(120, 168, 255, 0.2)"
                                }
                                color={
                                  isSupport
                                    ? "#61efb8"
                                    : isRefute
                                      ? "#ff6c88"
                                      : "#78a8ff"
                                }
                                border="1px solid"
                                borderColor={
                                  isSupport
                                    ? "rgba(97, 239, 184, 0.4)"
                                    : isRefute
                                      ? "rgba(255, 108, 136, 0.4)"
                                      : "rgba(120, 168, 255, 0.4)"
                                }
                              >
                                {isSupport
                                  ? "SUPPORTED"
                                  : isRefute
                                    ? "REFUTED"
                                    : "NEUTRAL"}
                              </Badge>
                            </HStack>

                            {/* Case Claim */}
                            <Box>
                              <HStack spacing={2} mb={1}>
                                <Image
                                  src={getPublisherIconUrl(
                                    pair.caseClaim.publisher,
                                  )}
                                  alt={pair.caseClaim.publisher}
                                  boxSize="12px"
                                  borderRadius="2px"
                                />
                                <Text
                                  fontSize="9px"
                                  color="#89a9bf"
                                  textTransform="uppercase"
                                  letterSpacing="0.05em"
                                  fontWeight="600"
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  Case Claim
                                </Text>
                              </HStack>
                              <Text
                                fontSize="11px"
                                color="#d4e9ff"
                                lineHeight="1.5"
                                fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                              >
                                {pair.caseClaim.claim_text}
                              </Text>
                            </Box>

                            {/* Source Claim */}
                            <Box>
                              <HStack spacing={2} mb={1}>
                                <Image
                                  src={getPublisherIconUrl(
                                    pair.sourceClaim.publisher,
                                  )}
                                  alt={pair.sourceClaim.publisher}
                                  boxSize="12px"
                                  borderRadius="2px"
                                />
                                <Text
                                  fontSize="9px"
                                  color="#89a9bf"
                                  textTransform="uppercase"
                                  letterSpacing="0.05em"
                                  fontWeight="600"
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  Source Claim
                                </Text>
                              </HStack>
                              <Text
                                fontSize="11px"
                                color="#d4e9ff"
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
                                  fontSize="9px"
                                  color="#89a9bf"
                                  textTransform="uppercase"
                                  letterSpacing="0.05em"
                                  fontWeight="600"
                                  mb={1}
                                  fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                                >
                                  Rationale
                                </Text>
                                <Text
                                  fontSize="10px"
                                  color="#b4c9e0"
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
                                  fontSize="9px"
                                  color="#89a9bf"
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
