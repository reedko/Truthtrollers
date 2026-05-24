/**
 * Citation Manager
 *
 * Manages citations with relevance scoring and visual feedback
 */

import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Input,
  Button,
  IconButton,
  Progress,
  Badge,
  Flex,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react';
import { FiPlus, FiTrash2, FiExternalLink, FiCheck } from 'react-icons/fi';

interface Citation {
  url: string;
  title?: string;
  quote_text?: string;
  context_summary?: string;
  relevance_score: number;
}

interface Props {
  citations: Citation[];
  onAddCitation: (citation: Citation) => void;
  onRemoveCitation: (index: number) => void;
  claim: string;
  reasoning: string;
}

const CitationManager: React.FC<Props> = ({
  citations,
  onAddCitation,
  onRemoveCitation,
  claim,
  reasoning,
}) => {
  const toast = useToast();
  const [newUrl, setNewUrl] = useState('');
  const [newQuote, setNewQuote] = useState('');
  const [isScoring, setIsScoring] = useState(false);

  const hudBg = useColorModeValue('rgba(0, 20, 40, 0.5)', 'rgba(0, 10, 20, 0.7)');
  const glowColor = useColorModeValue('cyan.400', 'cyan.300');
  const textColor = useColorModeValue('cyan.50', 'cyan.100');
  const labelColor = useColorModeValue('cyan.300', 'cyan.200');

  const handleAddCitation = async () => {
    if (!newUrl) {
      toast({
        title: 'URL Required',
        description: 'Please enter a citation URL',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setIsScoring(true);
    try {
      // Simulated relevance scoring (would call API in real implementation)
      const mockRelevanceScore = Math.floor(Math.random() * 40) + 60; // 60-100

      const citation: Citation = {
        url: newUrl,
        quote_text: newQuote || undefined,
        relevance_score: mockRelevanceScore,
      };

      onAddCitation(citation);

      setNewUrl('');
      setNewQuote('');

      toast({
        title: 'Citation Added',
        description: `Relevance score: ${mockRelevanceScore}%`,
        status: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Error adding citation:', error);
      toast({
        title: 'Error',
        description: 'Failed to score citation',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsScoring(false);
    }
  };

  const getRelevanceColor = (score: number) => {
    if (score > 75) return 'green';
    if (score > 55) return 'yellow';
    return 'red';
  };

  return (
    <Box>
      <Text
        fontSize="sm"
        color={labelColor}
        mb={3}
        textTransform="uppercase"
        letterSpacing="wide"
      >
        Citations & Evidence
      </Text>

      <VStack spacing={3} align="stretch">
        {/* Existing Citations */}
        {citations.map((citation, index) => (
          <Box
            key={index}
            p={3}
            bg={hudBg}
            borderRadius="md"
            borderWidth="1px"
            borderColor={
              citation.relevance_score > 55 ? 'green.600' : 'orange.600'
            }
            position="relative"
          >
            <Flex justify="space-between" align="start" mb={2}>
              <HStack spacing={2} flex={1}>
                <IconButton
                  aria-label="Open link"
                  icon={<FiExternalLink />}
                  size="xs"
                  variant="ghost"
                  colorScheme="cyan"
                  onClick={() => window.open(citation.url, '_blank')}
                />
                <Box flex={1}>
                  <Text fontSize="xs" color={textColor} noOfLines={1}>
                    {citation.url}
                  </Text>
                  {citation.quote_text && (
                    <Text fontSize="xs" color="cyan.400" noOfLines={2} mt={1}>
                      "{citation.quote_text}"
                    </Text>
                  )}
                </Box>
              </HStack>
              <IconButton
                aria-label="Remove citation"
                icon={<FiTrash2 />}
                size="xs"
                variant="ghost"
                colorScheme="red"
                onClick={() => onRemoveCitation(index)}
              />
            </Flex>

            {/* Relevance Meter */}
            <Box>
              <Flex justify="space-between" mb={1}>
                <Text fontSize="xs" color={labelColor}>
                  Relevance
                </Text>
                <HStack spacing={2}>
                  <Text fontSize="xs" color={textColor} fontWeight="bold">
                    {citation.relevance_score}%
                  </Text>
                  {citation.relevance_score > 55 && (
                    <Icon as={FiCheck} color="green.400" boxSize={3} />
                  )}
                </HStack>
              </Flex>
              <Progress
                value={citation.relevance_score}
                colorScheme={getRelevanceColor(citation.relevance_score)}
                height="4px"
                borderRadius="full"
                bg="rgba(0, 0, 0, 0.5)"
                sx={{
                  '& > div': {
                    boxShadow: `0 0 8px ${getRelevanceColor(citation.relevance_score)}`,
                  },
                }}
              />
            </Box>
          </Box>
        ))}

        {/* Add New Citation */}
        <Box
          p={4}
          bg="rgba(0, 255, 255, 0.05)"
          borderRadius="md"
          borderWidth="1px"
          borderColor="cyan.700"
          borderStyle="dashed"
        >
          <VStack spacing={3} align="stretch">
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Citation URL..."
              size="sm"
              bg="rgba(0, 0, 0, 0.3)"
              borderColor="cyan.700"
              color={textColor}
              _placeholder={{ color: 'cyan.700' }}
              _hover={{ borderColor: 'cyan.500' }}
              _focus={{
                borderColor: 'cyan.400',
                boxShadow: `0 0 8px ${glowColor}40`,
              }}
            />
            <Input
              value={newQuote}
              onChange={(e) => setNewQuote(e.target.value)}
              placeholder="Quote from source (optional)..."
              size="sm"
              bg="rgba(0, 0, 0, 0.3)"
              borderColor="cyan.700"
              color={textColor}
              _placeholder={{ color: 'cyan.700' }}
              _hover={{ borderColor: 'cyan.500' }}
              _focus={{
                borderColor: 'cyan.400',
                boxShadow: `0 0 8px ${glowColor}40`,
              }}
            />
            <Button
              leftIcon={<FiPlus />}
              size="sm"
              colorScheme="cyan"
              onClick={handleAddCitation}
              isLoading={isScoring}
              loadingText="Scoring..."
            >
              Add Citation
            </Button>
          </VStack>
        </Box>

        {/* Citation Requirement Indicator */}
        <Flex
          align="center"
          gap={2}
          p={2}
          bg={
            citations.filter(c => c.relevance_score > 55).length >= 1
              ? 'rgba(0, 255, 0, 0.1)'
              : 'rgba(255, 165, 0, 0.1)'
          }
          borderRadius="md"
          borderLeft="3px solid"
          borderColor={
            citations.filter(c => c.relevance_score > 55).length >= 1
              ? 'green.400'
              : 'orange.400'
          }
        >
          <Text fontSize="xs" color={textColor}>
            {citations.filter(c => c.relevance_score > 55).length} / 1 required
            citations (relevance &gt; 55%)
          </Text>
        </Flex>
      </VStack>
    </Box>
  );
};

export default CitationManager;
