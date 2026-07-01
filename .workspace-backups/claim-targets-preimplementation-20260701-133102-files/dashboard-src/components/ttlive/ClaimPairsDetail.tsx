/**
 * Claim Pairs Detail Component
 *
 * Displays case claims with their top AI-suggested source claims and verimeter scores
 * Similar to extension ClaimPairsDetail but adapted for dashboard UI
 */

import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Collapse,
  Badge,
  useColorModeValue,
  Icon,
  Tooltip,
} from '@chakra-ui/react';
import { FiChevronDown, FiChevronRight, FiCpu } from 'react-icons/fi';

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
  confidence?: number;
  rationale?: string;
}

interface ClaimPairsData {
  overall_verimeter: number;
  is_ai_rating?: boolean;
  claim_pairs: ClaimPair[];
}

interface ClaimPairsDetailProps {
  claimPairsData: ClaimPairsData | null;
}

const ClaimPairsDetail: React.FC<ClaimPairsDetailProps> = ({ claimPairsData }) => {
  const [isOpen, setIsOpen] = useState(true); // Default open
  const [expandedPairId, setExpandedPairId] = useState<string | null>(null);

  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const hoverBg = useColorModeValue('gray.50', 'gray.700');
  const claimBgColor = useColorModeValue('blue.50', 'blue.900');
  const sourceBgColor = useColorModeValue('green.50', 'green.900');

  if (!claimPairsData || claimPairsData.claim_pairs.length === 0) {
    return null;
  }

  return (
    <Box
      bg={bgColor}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      overflow="hidden"
    >
      {/* Header - Toggle */}
      <HStack
        p={4}
        cursor="pointer"
        onClick={() => setIsOpen(!isOpen)}
        _hover={{ bg: hoverBg }}
        justify="space-between"
      >
        <HStack spacing={2}>
          <Icon as={isOpen ? FiChevronDown : FiChevronRight} />
          <Text fontWeight="bold" fontSize="md">
            AI-Verified Claim Pairs ({claimPairsData.claim_pairs.length})
          </Text>
        </HStack>
        <HStack spacing={2}>
          {claimPairsData.is_ai_rating && (
            <Tooltip label="This is an AI-calculated rating. User ratings will override this when available." hasArrow>
              <Badge
                colorScheme="purple"
                fontSize="xs"
                px={2}
                py={1}
                borderRadius="full"
                display="flex"
                alignItems="center"
                gap={1}
              >
                <Icon as={FiCpu} />
                AI Rating
              </Badge>
            </Tooltip>
          )}
          {claimPairsData.overall_verimeter !== null && claimPairsData.overall_verimeter !== undefined && (
            <Badge
              colorScheme={
                claimPairsData.overall_verimeter > 0.5
                  ? 'green'
                  : claimPairsData.overall_verimeter > 0
                    ? 'yellow'
                    : 'red'
              }
              fontSize="sm"
              px={3}
              py={1}
              borderRadius="full"
            >
              Overall: {Math.round(claimPairsData.overall_verimeter * 100)}%
            </Badge>
          )}
        </HStack>
      </HStack>

      {/* Claim Pairs List */}
      <Collapse in={isOpen} animateOpacity>
        <VStack spacing={3} p={4} pt={0} align="stretch">
          {claimPairsData.claim_pairs.map((pair, idx) => {
            const pairKey = `${pair.caseClaim.claim_id}-${pair.sourceClaim.claim_id}`;
            const isExpanded = expandedPairId === pairKey;
            const isSupport = pair.verimeter_score > 0.1;
            const isRefute = pair.verimeter_score < -0.1;

            return (
              <Box
                key={pairKey}
                borderWidth="1px"
                borderColor={borderColor}
                borderRadius="md"
                overflow="hidden"
                transition="all 0.2s"
                _hover={{ shadow: 'md' }}
              >
                {/* Collapsed View */}
                <Box
                  p={3}
                  cursor="pointer"
                  onClick={() => setExpandedPairId(isExpanded ? null : pairKey)}
                  _hover={{ bg: hoverBg }}
                >
                  <VStack spacing={2} align="stretch">
                    {/* Case Claim */}
                    <HStack align="start" spacing={2}>
                      <Text
                        fontSize="sm"
                        fontWeight="bold"
                        color="blue.600"
                        flexShrink={0}
                      >
                        {idx + 1}.
                      </Text>
                      <Text fontSize="sm" fontWeight="medium" flex={1} noOfLines={2}>
                        {pair.caseClaim.claim_text}
                      </Text>
                    </HStack>

                    {/* Verimeter Bar */}
                    <Box position="relative" px={4}>
                      {/* Label */}
                      <Text
                        fontSize="xs"
                        fontWeight="bold"
                        textAlign="center"
                        mb={1}
                        color={
                          isSupport
                            ? 'green.600'
                            : isRefute
                              ? 'red.600'
                              : 'blue.600'
                        }
                      >
                        {isSupport
                          ? 'SUPPORTED BY'
                          : isRefute
                            ? 'REFUTED BY'
                            : 'NUANCED BY'}
                      </Text>

                      {/* Gradient Bar */}
                      <Box
                        h="8px"
                        w="100%"
                        borderRadius="full"
                        bg="linear-gradient(to right, #f87171 0%, #60a5fa 50%, #4ade80 100%)"
                        position="relative"
                      >
                        {/* Score Badge */}
                        <Box
                          position="absolute"
                          left={`${((pair.verimeter_score + 1) / 2) * 100}%`}
                          top="50%"
                          transform="translate(-50%, -50%)"
                          bg={useColorModeValue('white', 'gray.800')}
                          px={2}
                          py={0.5}
                          borderRadius="md"
                          borderWidth="2px"
                          borderColor={
                            isSupport
                              ? 'green.500'
                              : isRefute
                                ? 'red.500'
                                : 'blue.500'
                          }
                          boxShadow="sm"
                        >
                          <Text
                            fontSize="xs"
                            fontWeight="bold"
                            color={
                              isSupport
                                ? 'green.600'
                                : isRefute
                                  ? 'red.600'
                                  : 'blue.600'
                            }
                          >
                            {Math.round(pair.verimeter_score * 100)}
                          </Text>
                        </Box>
                      </Box>
                    </Box>

                    {/* Source Claim */}
                    <HStack align="start" spacing={2} pl={6}>
                      <Icon as={FiChevronDown} color="green.500" mt={1} />
                      <Text fontSize="sm" color="green.700" flex={1} noOfLines={2}>
                        {pair.sourceClaim.claim_text}
                      </Text>
                    </HStack>

                    {/* Publisher Info */}
                    <HStack fontSize="xs" color="gray.500" pl={6}>
                      <Text>Source: {pair.sourceClaim.publisher}</Text>
                      {pair.confidence && (
                        <Text>• Confidence: {Math.round(pair.confidence * 100)}%</Text>
                      )}
                    </HStack>
                  </VStack>
                </Box>

                {/* Expanded Details */}
                {isExpanded && (
                  <Box
                    p={4}
                    pt={0}
                    borderTopWidth="1px"
                    borderColor={borderColor}
                    bg={hoverBg}
                  >
                    <VStack spacing={3} align="stretch">
                      {/* Stance Badge */}
                      <HStack justify="center">
                        <Badge
                          colorScheme={
                            isSupport
                              ? 'green'
                              : isRefute
                                ? 'red'
                                : 'blue'
                          }
                          fontSize="sm"
                          px={4}
                          py={1}
                        >
                          {isSupport
                            ? 'SUPPORTED'
                            : isRefute
                              ? 'REFUTED'
                              : 'NUANCED'}
                        </Badge>
                      </HStack>

                      {/* Case Claim Full */}
                      <Box>
                        <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                          CASE CLAIM — {pair.caseClaim.publisher}
                        </Text>
                        <Text fontSize="sm">{pair.caseClaim.claim_text}</Text>
                        {pair.caseClaim.url && (
                          <Text
                            fontSize="xs"
                            color="blue.500"
                            as="a"
                            href={pair.caseClaim.url}
                            target="_blank"
                            _hover={{ textDecor: 'underline' }}
                          >
                            View source
                          </Text>
                        )}
                      </Box>

                      {/* Source Claim Full */}
                      <Box>
                        <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                          SOURCE CLAIM — {pair.sourceClaim.publisher}
                        </Text>
                        <Text fontSize="sm">{pair.sourceClaim.claim_text}</Text>
                        {pair.sourceClaim.url && (
                          <Text
                            fontSize="xs"
                            color="blue.500"
                            as="a"
                            href={pair.sourceClaim.url}
                            target="_blank"
                            _hover={{ textDecor: 'underline' }}
                          >
                            View source
                          </Text>
                        )}
                      </Box>

                      {/* Rationale */}
                      {pair.rationale && (
                        <Box>
                          <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                            AI RATIONALE
                          </Text>
                          <Text fontSize="sm" fontStyle="italic" color="gray.600">
                            {pair.rationale}
                          </Text>
                        </Box>
                      )}

                      {/* Metrics */}
                      <HStack spacing={4} fontSize="xs" color="gray.500">
                        <Text>
                          Verimeter: <strong>{Math.round(pair.verimeter_score * 100)}</strong>
                        </Text>
                        {pair.support_level !== undefined && (
                          <Text>
                            Support: <strong>{Math.round(pair.support_level * 100)}%</strong>
                          </Text>
                        )}
                        {pair.confidence !== undefined && (
                          <Text>
                            Confidence: <strong>{Math.round(pair.confidence * 100)}%</strong>
                          </Text>
                        )}
                      </HStack>
                    </VStack>
                  </Box>
                )}
              </Box>
            );
          })}
        </VStack>
      </Collapse>
    </Box>
  );
};

export default ClaimPairsDetail;
