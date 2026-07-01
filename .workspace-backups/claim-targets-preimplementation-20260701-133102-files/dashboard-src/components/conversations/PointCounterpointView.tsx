/**
 * Point/Counterpoint Conversation View
 *
 * Visual debate interface showing support/refute/nuance/question arguments
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Button,
  Icon,
  Avatar,
  Divider,
  Collapse,
  useColorModeValue,
  Flex,
  IconButton,
  Tooltip,
  useToast,
} from '@chakra-ui/react';
import {
  FiThumbsUp,
  FiThumbsDown,
  FiMessageCircle,
  FiCheckCircle,
  FiXCircle,
  FiHelpCircle,
  FiZap,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
} from 'react-icons/fi';
import { ConversationArgument, ArgumentStance } from '../../../../shared/entities/types';

interface Props {
  threadId: string;
  onReply?: (argument: ConversationArgument) => void;
  onStageArgument?: (argument: ConversationArgument) => void;
}

const PointCounterpointView: React.FC<Props> = ({ threadId, onReply, onStageArgument }) => {
  const [conversationArgs, setConversationArgs] = useState<ConversationArgument[]>([]);
  const [expandedArgs, setExpandedArgs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  useEffect(() => {
    loadArguments();
  }, [threadId]);

  const loadArguments = async () => {
    try {
      const response = await fetch(`/api/ttlive/conversations/${threadId}/arguments`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load arguments');
      }

      const data = await response.json();
      setConversationArgs(data.arguments || []);

      // Auto-expand root arguments
      const rootArgs = data.arguments?.filter((a: ConversationArgument) => !a.reply_to_conv_argument_id) || [];
      setExpandedArgs(new Set(rootArgs.map((a: ConversationArgument) => a.conv_argument_id)));
    } catch (error) {
      console.error('Failed to load arguments:', error);
      toast({
        title: 'Error',
        description: 'Failed to load conversation arguments',
        status: 'error',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (argumentId: string, voteType: 'up' | 'down') => {
    try {
      await fetch(`/api/ttlive/conversations/${threadId}/arguments/${argumentId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({ vote_type: voteType }),
      });

      loadArguments(); // Refresh
    } catch (error) {
      console.error('Vote failed:', error);
    }
  };

  const toggleExpand = (argumentId: string) => {
    setExpandedArgs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(argumentId)) {
        newSet.delete(argumentId);
      } else {
        newSet.add(argumentId);
      }
      return newSet;
    });
  };

  const getStanceColor = (stance: ArgumentStance) => {
    switch (stance) {
      case 'support':
        return 'green';
      case 'refute':
        return 'red';
      case 'nuance':
        return 'blue';
      case 'question':
        return 'purple';
      default:
        return 'gray';
    }
  };

  const getStanceIcon = (stance: ArgumentStance) => {
    switch (stance) {
      case 'support':
        return FiCheckCircle;
      case 'refute':
        return FiXCircle;
      case 'nuance':
        return FiZap;
      case 'question':
        return FiHelpCircle;
      default:
        return FiMessageCircle;
    }
  };

  const renderArgument = (argument: ConversationArgument, depth: number = 0) => {
    const isExpanded = expandedArgs.has(argument.conv_argument_id);
    const replies = conversationArgs.filter((a) => a.reply_to_conv_argument_id === argument.conv_argument_id);
    const stanceColor = getStanceColor(argument.stance);
    const StanceIcon = getStanceIcon(argument.stance);

    return (
      <Box key={argument.conv_argument_id} ml={depth > 0 ? 8 : 0}>
        <Box
          bg={cardBg}
          borderWidth="1px"
          borderColor={borderColor}
          borderLeftWidth="4px"
          borderLeftColor={`${stanceColor}.500`}
          borderRadius="md"
          p={4}
          mb={3}
          _hover={{ shadow: 'md' }}
          transition="all 0.2s"
        >
          <VStack align="stretch" spacing={3}>
            {/* Header */}
            <Flex justify="space-between" align="start">
              <HStack spacing={3}>
                <Avatar size="sm" name={argument.author_username} src={argument.author_avatar} />
                <VStack align="start" spacing={0}>
                  <Text fontWeight="bold" fontSize="sm">
                    {argument.author_username}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    {new Date(argument.created_at).toLocaleString()}
                  </Text>
                </VStack>
              </HStack>

              <HStack spacing={1}>
                <Badge colorScheme={stanceColor} variant="subtle">
                  <HStack spacing={1}>
                    <Icon as={StanceIcon} />
                    <Text>{argument.stance.toUpperCase()}</Text>
                  </HStack>
                </Badge>
                {argument.is_staged && (
                  <Tooltip label="Moved to staging pipeline">
                    <Badge colorScheme="cyan">STAGED</Badge>
                  </Tooltip>
                )}
              </HStack>
            </Flex>

            {/* Claim */}
            <Box>
              <Text fontWeight="bold" fontSize="md" mb={1}>
                {argument.claim}
              </Text>
              <Text fontSize="sm" color="gray.600">
                {argument.reasoning}
              </Text>
            </Box>

            {/* Citations */}
            {argument.citations && argument.citations.length > 0 && (
              <Box>
                <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                  EVIDENCE:
                </Text>
                {argument.citations.map((citation) => (
                  <HStack key={citation.citation_id} spacing={2} fontSize="xs">
                    <Icon as={FiExternalLink} color="blue.500" />
                    <Text
                      as="a"
                      href={citation.url}
                      target="_blank"
                      color="blue.500"
                      _hover={{ textDecor: 'underline' }}
                      noOfLines={1}
                    >
                      {citation.title || citation.url}
                    </Text>
                  </HStack>
                ))}
              </Box>
            )}

            <Divider />

            {/* Actions */}
            <Flex justify="space-between" align="center">
              <HStack spacing={4}>
                <HStack spacing={1}>
                  <IconButton
                    aria-label="Upvote"
                    icon={<FiThumbsUp />}
                    size="xs"
                    variant="ghost"
                    onClick={() => handleVote(argument.conv_argument_id, 'up')}
                  />
                  <Text fontSize="sm">{argument.upvotes}</Text>
                </HStack>
                <HStack spacing={1}>
                  <IconButton
                    aria-label="Downvote"
                    icon={<FiThumbsDown />}
                    size="xs"
                    variant="ghost"
                    onClick={() => handleVote(argument.conv_argument_id, 'down')}
                  />
                  <Text fontSize="sm">{argument.downvotes}</Text>
                </HStack>
                {replies.length > 0 && (
                  <HStack spacing={1}>
                    <Icon as={FiMessageCircle} boxSize={3} />
                    <Text fontSize="sm">{replies.length}</Text>
                  </HStack>
                )}
              </HStack>

              <HStack spacing={2}>
                {onReply && (
                  <Button
                    size="xs"
                    variant="outline"
                    leftIcon={<FiMessageCircle />}
                    onClick={() => onReply(argument)}
                  >
                    Reply
                  </Button>
                )}
                {!argument.is_staged && onStageArgument && (
                  <Button
                    size="xs"
                    colorScheme="cyan"
                    variant="outline"
                    onClick={() => onStageArgument(argument)}
                  >
                    Stage
                  </Button>
                )}
                {replies.length > 0 && (
                  <IconButton
                    aria-label={isExpanded ? 'Collapse replies' : 'Expand replies'}
                    icon={isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                    size="xs"
                    variant="ghost"
                    onClick={() => toggleExpand(argument.conv_argument_id)}
                  />
                )}
              </HStack>
            </Flex>
          </VStack>
        </Box>

        {/* Replies */}
        <Collapse in={isExpanded && replies.length > 0} animateOpacity>
          <VStack align="stretch" spacing={2} mt={2}>
            {replies.map((reply) => renderArgument(reply, depth + 1))}
          </VStack>
        </Collapse>
      </Box>
    );
  };

  // Group arguments by stance for point/counterpoint view
  const rootArguments = conversationArgs.filter((a) => !a.reply_to_conv_argument_id);
  const supportArgs = rootArguments.filter((a) => a.stance === 'support');
  const refuteArgs = rootArguments.filter((a) => a.stance === 'refute');
  const nuanceArgs = rootArguments.filter((a) => a.stance === 'nuance');
  const questionArgs = rootArguments.filter((a) => a.stance === 'question');

  if (loading) {
    return (
      <Box textAlign="center" py={8}>
        <Text>Loading conversation...</Text>
      </Box>
    );
  }

  return (
    <VStack align="stretch" spacing={6}>
      {/* Support Arguments */}
      {supportArgs.length > 0 && (
        <Box>
          <HStack mb={3}>
            <Icon as={FiCheckCircle} color="green.500" />
            <Text fontWeight="bold" color="green.600">
              SUPPORTING ({supportArgs.length})
            </Text>
          </HStack>
          {supportArgs.map((arg) => renderArgument(arg))}
        </Box>
      )}

      {/* Refute Arguments */}
      {refuteArgs.length > 0 && (
        <Box>
          <HStack mb={3}>
            <Icon as={FiXCircle} color="red.500" />
            <Text fontWeight="bold" color="red.600">
              REFUTING ({refuteArgs.length})
            </Text>
          </HStack>
          {refuteArgs.map((arg) => renderArgument(arg))}
        </Box>
      )}

      {/* Nuance Arguments */}
      {nuanceArgs.length > 0 && (
        <Box>
          <HStack mb={3}>
            <Icon as={FiZap} color="blue.500" />
            <Text fontWeight="bold" color="blue.600">
              NUANCED ({nuanceArgs.length})
            </Text>
          </HStack>
          {nuanceArgs.map((arg) => renderArgument(arg))}
        </Box>
      )}

      {/* Question Arguments */}
      {questionArgs.length > 0 && (
        <Box>
          <HStack mb={3}>
            <Icon as={FiHelpCircle} color="purple.500" />
            <Text fontWeight="bold" color="purple.600">
              QUESTIONS ({questionArgs.length})
            </Text>
          </HStack>
          {questionArgs.map((arg) => renderArgument(arg))}
        </Box>
      )}

      {conversationArgs.length === 0 && (
        <Box textAlign="center" py={8} color="gray.500">
          <Text>No arguments yet. Be the first to contribute!</Text>
        </Box>
      )}
    </VStack>
  );
};

export default PointCounterpointView;
