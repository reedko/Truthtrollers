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
    if (publisher.includes('://')) {
      domain = new URL(publisher).hostname;
    }
    domain = domain.replace(/^www\./, '');
  } catch (e) {
    // If parsing fails, use as-is
  }

  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

const ClaimPairsDetail: React.FC<ClaimPairsDetailProps> = ({ claimPairsData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedPairId, setExpandedPairId] = useState<string | null>(null);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  return (
    <Box width="100%" mt={2}>
      <Button
        onClick={handleToggle}
        size="sm"
        width="100%"
        variant="ghost"
        color="cyan.300"
        _hover={{ bg: "rgba(0, 162, 255, 0.1)" }}
        fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
      >
        {isOpen ? "▼" : "▶"} {isOpen ? "Hide" : "Show"} Top Claims
      </Button>

      <Collapse in={isOpen} animateOpacity>
        <Box
          mt={2}
          p={2}
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          backdropFilter="blur(20px)"
          border="1px solid rgba(0, 162, 255, 0.3)"
          borderRadius="8px"
          boxShadow="0 4px 12px rgba(0, 0, 0, 0.5)"
          maxH="300px"
          overflowY="auto"
        >
          {!claimPairsData && (
            <Text color="gray.500" fontSize="sm" textAlign="center">
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
                    bg="rgba(0, 0, 0, 0.3)"
                    borderRadius="8px"
                    border="1px solid"
                    borderColor={
                      isSupport
                        ? "rgba(97, 239, 184, 0.3)"
                        : isRefute
                        ? "rgba(255, 108, 136, 0.3)"
                        : "rgba(120, 168, 255, 0.3)"
                    }
                    overflow="hidden"
                    transition="all 0.2s"
                    _hover={{
                      borderColor: isSupport
                        ? "rgba(97, 239, 184, 0.5)"
                        : isRefute
                        ? "rgba(255, 108, 136, 0.5)"
                        : "rgba(120, 168, 255, 0.5)",
                    }}
                  >
                    {/* Collapsed View - Clickable */}
                    <Box
                      w="100%"
                      p={2}
                      cursor="pointer"
                      onClick={() => setExpandedPairId(isExpanded ? null : pairKey)}
                      textAlign="left"
                      _hover={{ bg: "rgba(255, 255, 255, 0.02)" }}
                    >
                      <VStack spacing={1} align="stretch" pointerEvents="none">
                        {/* Verimeter bar */}
                        <Box>
                          <VerimeterMeter
                            score={pair.verimeter_score}
                            width="100%"
                            showInterpretation={false}
                          />
                        </Box>

                        {/* Claims Row */}
                        <HStack spacing={2} fontSize="10px" align="center">
                          {/* Case Claim - No Tooltip, just text */}
                          <HStack flex={1} spacing={1} minW={0}>
                            <Image
                              src={getPublisherIconUrl(pair.caseClaim.publisher)}
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
                              src={getPublisherIconUrl(pair.sourceClaim.publisher)}
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
                          <Text fontSize="xs" color="#89a9bf" flexShrink={0}>
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
                              {isSupport ? "SUPPORTED" : isRefute ? "REFUTED" : "NEUTRAL"}
                            </Badge>
                          </HStack>

                          {/* Case Claim */}
                          <Box>
                            <HStack spacing={2} mb={1}>
                              <Image
                                src={getPublisherIconUrl(pair.caseClaim.publisher)}
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
                                src={getPublisherIconUrl(pair.sourceClaim.publisher)}
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
                              >
                                Rationale
                              </Text>
                              <Text
                                fontSize="10px"
                                color="#b4c9e0"
                                lineHeight="1.5"
                                fontStyle="italic"
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
                              >
                                Support Level: {Math.round(pair.support_level * 100)}%
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
                <Text color="gray.500" fontSize="sm" textAlign="center">
                  No claim pairs available
                </Text>
              )}
            </VStack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default ClaimPairsDetail;
