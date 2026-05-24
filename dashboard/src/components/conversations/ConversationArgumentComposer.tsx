/**
 * Conversation Argument Composer
 *
 * Lightweight argument builder for conversation mode (before staging)
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  HStack,
  Flex,
  Text,
  Textarea,
  Select,
  Button,
  IconButton,
  Input,
  FormControl,
  FormLabel,
  useToast,
  useColorModeValue,
  Badge,
  Collapse,
  Spinner,
} from '@chakra-ui/react';
import { FiX, FiPlus, FiSend, FiChevronDown, FiChevronRight, FiCheck, FiExternalLink } from 'react-icons/fi';
import { ArgumentStance, ConversationArgument, ArgumentValidationResult, TTLiveThread, LitReference } from '../../../../shared/entities/types';
import ArgumentValidationPanel from '../staged-arguments/ArgumentValidationPanel';
import ReferenceModal from '../modals/ReferenceModal';

interface Props {
  threadId: string;
  replyTo?: ConversationArgument | null;
  onArgumentCreated?: (argument: ConversationArgument) => void;
  onCancel?: () => void;
}

const ConversationArgumentComposer: React.FC<Props> = ({
  threadId,
  replyTo,
  onArgumentCreated,
  onCancel,
}) => {
  const toast = useToast();

  const [claim, setClaim] = useState('');
  const [stance, setStance] = useState<ArgumentStance>('support');
  const [reasoning, setReasoning] = useState('');
  const [citations, setCitations] = useState<{ url: string; title?: string }[]>([]);
  const [newCitationUrl, setNewCitationUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validation state
  const [validation, setValidation] = useState<ArgumentValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Thread data with claim pairs
  const [thread, setThread] = useState<TTLiveThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [showEvidencePicker, setShowEvidencePicker] = useState(true);

  // Reference modal state
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);

  // Load thread data on mount
  useEffect(() => {
    loadThreadData();
  }, [threadId]);

  // Auto-validation on changes
  useEffect(() => {
    if (claim && reasoning) {
      const debounceTimer = setTimeout(() => {
        runValidation();
      }, 1000);

      return () => clearTimeout(debounceTimer);
    }
  }, [claim, reasoning, citations]);

  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const evidenceBg = useColorModeValue('gray.50', 'gray.700');
  const hoverBg = useColorModeValue('blue.50', 'blue.900');

  const loadThreadData = async () => {
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/ttlive/threads/${threadId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load thread');
      }

      const data = await response.json();
      setThread(data.thread);
    } catch (error) {
      console.error('Failed to load thread data:', error);
    } finally {
      setLoadingThread(false);
    }
  };

  const runValidation = async () => {
    setIsValidating(true);
    try {
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
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Validation failed');
      }

      const validationResult = await response.json();
      setValidation(validationResult);
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddCitation = () => {
    if (newCitationUrl.trim()) {
      setCitations([...citations, { url: newCitationUrl.trim() }]);
      setNewCitationUrl('');
    }
  };

  const handleRemoveCitation = (index: number) => {
    setCitations(citations.filter((_, i) => i !== index));
  };

  const handleAddSourceClaimCitation = (claimPair: any) => {
    const url = claimPair.sourceClaim.url;
    const title = `${claimPair.sourceClaim.publisher}: ${claimPair.sourceClaim.claim_text.substring(0, 60)}...`;

    // Check if already added
    if (citations.some(c => c.url === url)) {
      toast({
        title: 'Already added',
        description: 'This source is already in your citations',
        status: 'info',
        duration: 2000,
      });
      return;
    }

    setCitations([...citations, { url, title }]);
    toast({
      title: 'Source added',
      status: 'success',
      duration: 1500,
    });
  };

  const handleSelectReference = (ref: LitReference) => {
    const url = ref.url;
    const title = ref.content_name;

    // Check if already added
    if (citations.some(c => c.url === url)) {
      toast({
        title: 'Already added',
        description: 'This source is already in your citations',
        status: 'info',
        duration: 2000,
      });
      return;
    }

    setCitations([...citations, { url, title }]);
    toast({
      title: 'Source added',
      status: 'success',
      duration: 1500,
    });
  };

  const handleSubmit = async () => {
    if (!claim.trim() || !reasoning.trim()) {
      toast({
        title: 'Missing fields',
        description: 'Please provide both claim and reasoning',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/ttlive/conversations/${threadId}/arguments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          claim,
          stance,
          reasoning,
          reply_to_conv_argument_id: replyTo?.conv_argument_id,
          citations,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create argument');
      }

      const data = await response.json();

      toast({
        title: 'Argument posted!',
        status: 'success',
        duration: 2000,
      });

      if (onArgumentCreated) {
        onArgumentCreated(data.argument);
      }

      // Reset form
      setClaim('');
      setReasoning('');
      setCitations([]);
      setStance('support');
    } catch (error) {
      console.error('Failed to create argument:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to post argument',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box
      bg={cardBg}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="md"
      p={4}
      shadow="sm"
    >
      <VStack align="stretch" spacing={4}>
        {/* Header */}
        <HStack justify="space-between">
          <Text fontWeight="bold">
            {replyTo ? `Replying to ${replyTo.author_username}` : 'New Argument'}
          </Text>
          {onCancel && (
            <IconButton
              aria-label="Cancel"
              icon={<FiX />}
              size="sm"
              variant="ghost"
              onClick={onCancel}
            />
          )}
        </HStack>

        {/* Citations Section with Source Browser */}
        <FormControl>
          <FormLabel fontSize="sm">Citations</FormLabel>
          <VStack align="stretch" spacing={2}>
            {citations.map((citation, index) => (
              <HStack key={index} p={2} bg={evidenceBg} borderRadius="md">
                <VStack align="start" flex={1} spacing={0}>
                  <Text fontSize="sm" fontWeight="medium" noOfLines={1}>
                    {citation.title || citation.url}
                  </Text>
                  <Text fontSize="xs" color="gray.500" noOfLines={1}>
                    {citation.url}
                  </Text>
                </VStack>
                <IconButton
                  aria-label="Remove citation"
                  icon={<FiX />}
                  size="xs"
                  variant="ghost"
                  onClick={() => handleRemoveCitation(index)}
                />
              </HStack>
            ))}

            <Button
              size="sm"
              variant="outline"
              leftIcon={<FiPlus />}
              onClick={() => setIsReferenceModalOpen(true)}
              w="full"
            >
              Add Source from Scrape
            </Button>
          </VStack>
        </FormControl>

        {/* Split Layout: Left - Form | Right - Validation */}
        <Flex gap={6} align="flex-start">
          {/* Left: Argument Form */}
          <VStack flex={1} spacing={4} align="stretch">
            {/* Stance Selector */}
            <FormControl>
              <FormLabel fontSize="sm">Stance</FormLabel>
              <Select
                value={stance}
                onChange={(e) => setStance(e.target.value as ArgumentStance)}
                size="sm"
              >
                <option value="support">Support</option>
                <option value="refute">Refute</option>
                <option value="nuance">Nuance</option>
                <option value="question">Question</option>
              </Select>
            </FormControl>

            {/* Claim */}
            <FormControl>
              <FormLabel fontSize="sm">Claim</FormLabel>
              <Textarea
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                placeholder="State your main point..."
                rows={2}
                size="sm"
              />
            </FormControl>

            {/* Reasoning */}
            <FormControl>
              <FormLabel fontSize="sm">Reasoning</FormLabel>
              <Textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder="Explain your thinking..."
                rows={4}
                size="sm"
              />
            </FormControl>

          </VStack>

          {/* Right: Live Validation Panel */}
          <Box flex={1}>
            <ArgumentValidationPanel
              validation={validation}
              isValidating={isValidating}
            />
          </Box>
        </Flex>

        {/* Actions */}
        <HStack justify="flex-end" spacing={2}>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            colorScheme="blue"
            leftIcon={<FiSend />}
            onClick={handleSubmit}
            isLoading={isSubmitting}
            isDisabled={!claim.trim() || !reasoning.trim()}
          >
            Post Argument
          </Button>
        </HStack>
      </VStack>

      {/* Reference Modal for selecting sources */}
      {thread?.content_id && (
        <ReferenceModal
          isOpen={isReferenceModalOpen}
          onClose={() => setIsReferenceModalOpen(false)}
          taskId={thread.content_id}
          onSelectReference={handleSelectReference}
        />
      )}
    </Box>
  );
};

export default ConversationArgumentComposer;
