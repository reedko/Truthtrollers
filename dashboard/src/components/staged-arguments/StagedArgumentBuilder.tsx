/**
 * Staged Argument Builder
 *
 * Futuristic HUD-style interface for constructing evidence-backed arguments
 * Minority Report aesthetic with real-time validation feedback
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Textarea,
  Select,
  Button,
  IconButton,
  Badge,
  Divider,
  useToast,
  useColorModeValue,
  Flex,
  Progress,
} from '@chakra-ui/react';
import { FiX, FiCheck, FiAlertTriangle, FiPlus, FiSend } from 'react-icons/fi';
import {
  StagedArgument,
  ArgumentStance,
  TTLiveTimelinePost,
  ArgumentValidationResult,
} from '../../../../shared/entities/types';
import ArgumentValidationPanel from './ArgumentValidationPanel';
import CitationManager from './CitationManager';
import FallacyDetectorPanel from './FallacyDetectorPanel';

interface Props {
  threadId: string;
  replyToPost?: TTLiveTimelinePost | null;
  replyToArgument?: StagedArgument | null;
  onArgumentCreated?: (argument: StagedArgument) => void;
  onCancel?: () => void;
}

const StagedArgumentBuilder: React.FC<Props> = ({
  threadId,
  replyToPost,
  replyToArgument,
  onArgumentCreated,
  onCancel,
}) => {
  const toast = useToast();

  // Argument state
  const [claim, setClaim] = useState('');
  const [stance, setStance] = useState<ArgumentStance>('support');
  const [reasoning, setReasoning] = useState('');
  const [citations, setCitations] = useState<any[]>([]);

  // Validation state
  const [validation, setValidation] = useState<ArgumentValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-validation on changes
  useEffect(() => {
    if (claim && reasoning) {
      const debounceTimer = setTimeout(() => {
        runValidation();
      }, 1000);

      return () => clearTimeout(debounceTimer);
    }
  }, [claim, reasoning, citations]);

  // Minority Report HUD colors
  const hudBg = useColorModeValue('rgba(0, 20, 40, 0.95)', 'rgba(0, 10, 20, 0.98)');
  const hudBorder = useColorModeValue(
    'linear(to-r, cyan.400, blue.500)',
    'linear(to-r, cyan.300, blue.400)'
  );
  const glowColor = useColorModeValue('cyan.400', 'cyan.300');
  const textColor = useColorModeValue('cyan.50', 'cyan.100');
  const labelColor = useColorModeValue('cyan.300', 'cyan.200');

  const runValidation = async () => {
    setIsValidating(true);
    try {
      // Call backend validation API
      const response = await fetch('/api/ttlive/arguments/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          claim,
          reasoning,
          citations: citations.map(c => ({
            url: c.url,
            title: c.title,
            quote_text: c.quote_text,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Validation failed');
      }

      const validationResult = await response.json();
      setValidation(validationResult);
    } catch (error) {
      console.error('Validation failed:', error);
      // Fallback to basic client-side validation if API fails
      const civilityPassed = !/(idiot|stupid|dumb|moron|suck|libs suck|you suck)/gi.test(claim + reasoning);
      const minCitationsMet = citations.filter(c => c.relevance_score > 55).length >= 1;

      const fallbackValidation: ArgumentValidationResult = {
        civility_passed: civilityPassed,
        flagged_terms: civilityPassed ? [] : ['potentially uncivil language detected'],
        fallacy_check_passed: true,
        detected_fallacies: [],
        min_citations_met: minCitationsMet,
        citation_count: citations.filter(c => c.relevance_score > 55).length,
        clarity_score: claim.length > 20 ? 75 : 50,
        logical_strength_score: reasoning.length > 100 ? 80 : 60,
        evidence_support_score: citations.length > 0 ? 85 : 30,
        overall_quality_score: 65,
        can_approve: civilityPassed && minCitationsMet,
        issues: [
          ...(!civilityPassed ? ['Civility check failed'] : []),
          ...(!minCitationsMet ? ['Need at least 1 citation with relevance > 55%'] : []),
        ],
      };

      setValidation(fallbackValidation);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!validation?.can_approve) {
      toast({
        title: 'Validation Required',
        description: 'Argument must pass all validation checks before submission',
        status: 'warning',
        duration: 5000,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/ttlive/arguments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          thread_id: threadId,
          claim,
          stance,
          reasoning,
          reply_to_post_id: replyToPost?.post_id,
          reply_to_argument_id: replyToArgument?.argument_id,
          citations: citations.map(c => ({
            url: c.url,
            title: c.title,
            quote_text: c.quote_text,
            context_summary: c.context_summary,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create argument');
      }

      const data = await response.json();

      toast({
        title: 'Argument Created',
        description: 'Your argument has been staged for review',
        status: 'success',
        duration: 3000,
      });

      if (onArgumentCreated) {
        onArgumentCreated(data.argument);
      }
    } catch (error) {
      console.error('Error creating argument:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create argument',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const addCitation = (citation: any) => {
    setCitations([...citations, citation]);
  };

  const removeCitation = (index: number) => {
    setCitations(citations.filter((_, i) => i !== index));
  };

  return (
    <Box
      bg={hudBg}
      borderWidth="2px"
      borderStyle="solid"
      borderImage={hudBorder}
      borderImageSlice={1}
      borderRadius="md"
      p={6}
      position="relative"
      boxShadow={`0 0 20px ${glowColor}40, inset 0 0 20px ${glowColor}10`}
      _before={{
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'md',
        background: `radial-gradient(circle at top right, ${glowColor}15, transparent 60%)`,
        pointerEvents: 'none',
      }}
    >
      {/* Header */}
      <Flex justify="space-between" align="center" mb={4}>
        <HStack spacing={3}>
          <Text
            fontSize="xl"
            fontWeight="bold"
            color={labelColor}
            textTransform="uppercase"
            letterSpacing="wider"
            textShadow={`0 0 10px ${glowColor}`}
          >
            Construct Argument
          </Text>
          {replyToPost && (
            <Badge
              colorScheme="cyan"
              variant="outline"
              fontSize="xs"
              textTransform="none"
            >
              Replying to post
            </Badge>
          )}
        </HStack>
        {onCancel && (
          <IconButton
            aria-label="Cancel"
            icon={<FiX />}
            size="sm"
            variant="ghost"
            colorScheme="cyan"
            onClick={onCancel}
          />
        )}
      </Flex>

      <VStack spacing={6} align="stretch">
        {/* Context Display */}
        {replyToPost && (
          <Box
            p={4}
            bg="rgba(0, 255, 255, 0.05)"
            borderLeft="3px solid"
            borderColor="cyan.400"
            borderRadius="md"
          >
            <Text fontSize="sm" color="cyan.200" mb={2}>
              Context:
            </Text>
            <Text fontSize="sm" color={textColor} noOfLines={3}>
              {replyToPost.post_text}
            </Text>
          </Box>
        )}

        {/* Split Layout: Left - Input | Right - Validation */}
        <Flex gap={6}>
          {/* Left: Argument Builder */}
          <VStack flex={1} spacing={4} align="stretch">
            {/* Stance Selector */}
            <Box>
              <Text
                fontSize="sm"
                color={labelColor}
                mb={2}
                textTransform="uppercase"
                letterSpacing="wide"
              >
                Stance
              </Text>
              <Select
                value={stance}
                onChange={(e) => setStance(e.target.value as ArgumentStance)}
                bg="rgba(0, 255, 255, 0.05)"
                borderColor="cyan.600"
                color={textColor}
                _hover={{ borderColor: 'cyan.400' }}
                _focus={{
                  borderColor: 'cyan.400',
                  boxShadow: `0 0 10px ${glowColor}40`,
                }}
              >
                <option value="support" style={{ background: '#001020' }}>
                  Support
                </option>
                <option value="refute" style={{ background: '#001020' }}>
                  Refute
                </option>
                <option value="nuance" style={{ background: '#001020' }}>
                  Nuance
                </option>
                <option value="question" style={{ background: '#001020' }}>
                  Question
                </option>
              </Select>
            </Box>

            {/* Claim Input */}
            <Box>
              <Text
                fontSize="sm"
                color={labelColor}
                mb={2}
                textTransform="uppercase"
                letterSpacing="wide"
              >
                Claim
              </Text>
              <Textarea
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                placeholder="State your primary claim or thesis..."
                rows={3}
                bg="rgba(0, 255, 255, 0.05)"
                borderColor="cyan.600"
                color={textColor}
                _placeholder={{ color: 'cyan.700' }}
                _hover={{ borderColor: 'cyan.400' }}
                _focus={{
                  borderColor: 'cyan.400',
                  boxShadow: `0 0 10px ${glowColor}40`,
                }}
              />
            </Box>

            {/* Reasoning Input */}
            <Box>
              <Text
                fontSize="sm"
                color={labelColor}
                mb={2}
                textTransform="uppercase"
                letterSpacing="wide"
              >
                Reasoning
              </Text>
              <Textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder="Provide detailed logical reasoning supporting your claim..."
                rows={8}
                bg="rgba(0, 255, 255, 0.05)"
                borderColor="cyan.600"
                color={textColor}
                _placeholder={{ color: 'cyan.700' }}
                _hover={{ borderColor: 'cyan.400' }}
                _focus={{
                  borderColor: 'cyan.400',
                  boxShadow: `0 0 10px ${glowColor}40`,
                }}
              />
            </Box>

            {/* Citation Manager */}
            <CitationManager
              citations={citations}
              onAddCitation={addCitation}
              onRemoveCitation={removeCitation}
              claim={claim}
              reasoning={reasoning}
            />
          </VStack>

          {/* Right: Live Validation Panel */}
          <Box flex={1}>
            <ArgumentValidationPanel
              validation={validation}
              isValidating={isValidating}
            />

            {validation && validation.detected_fallacies && validation.detected_fallacies.length > 0 && (
              <Box mt={4}>
                <FallacyDetectorPanel fallacies={validation.detected_fallacies} />
              </Box>
            )}
          </Box>
        </Flex>

        <Divider borderColor="cyan.800" />

        {/* Action Buttons */}
        <Flex justify="space-between" align="center">
          <HStack spacing={2}>
            {validation && (
              <>
                {validation.can_approve ? (
                  <Badge colorScheme="green" fontSize="sm" p={2}>
                    <HStack spacing={1}>
                      <FiCheck />
                      <Text>Ready to Submit</Text>
                    </HStack>
                  </Badge>
                ) : (
                  <Badge colorScheme="orange" fontSize="sm" p={2}>
                    <HStack spacing={1}>
                      <FiAlertTriangle />
                      <Text>{validation.issues.length} Issue(s)</Text>
                    </HStack>
                  </Badge>
                )}
              </>
            )}
          </HStack>

          <HStack spacing={3}>
            {onCancel && (
              <Button
                variant="outline"
                colorScheme="cyan"
                onClick={onCancel}
                size="md"
              >
                Cancel
              </Button>
            )}
            <Button
              leftIcon={<FiSend />}
              colorScheme="cyan"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={!validation?.can_approve}
              size="md"
              bg="cyan.600"
              _hover={{ bg: 'cyan.500', boxShadow: `0 0 20px ${glowColor}60` }}
              _active={{ bg: 'cyan.700' }}
            >
              Submit to Staging
            </Button>
          </HStack>
        </Flex>
      </VStack>
    </Box>
  );
};

export default StagedArgumentBuilder;
