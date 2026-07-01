/**
 * TT Live Thread Card
 *
 * Card showing thread preview with stats
 */

import React from 'react';
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Icon,
  useColorModeValue,
} from '@chakra-ui/react';
import { FiMessageCircle, FiUsers, FiTrendingUp, FiTwitter } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { TTLiveThread } from '../../../../shared/entities/types';

interface TTLiveThreadCardProps {
  thread: TTLiveThread;
}

const TTLiveThreadCard: React.FC<TTLiveThreadCardProps> = ({ thread }) => {
  const navigate = useNavigate();

  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const hoverBg = useColorModeValue('gray.50', 'gray.750');

  const getThreadTypeColor = (type: string) => {
    switch (type) {
      case 'imported_x':
        return 'blue';
      case 'native_tt':
        return 'green';
      case 'hybrid':
        return 'purple';
      default:
        return 'gray';
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'x':
      case 'twitter':
        return FiTwitter;
      default:
        return FiMessageCircle;
    }
  };

  return (
    <Box
      bg={cardBg}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      p={4}
      cursor="pointer"
      _hover={{ bg: hoverBg, shadow: 'md' }}
      transition="all 0.2s"
      onClick={() => navigate(`/ttlive/thread/${thread.thread_id}`)}
    >
      <VStack align="stretch" spacing={3}>
        {/* Header */}
        <HStack justify="space-between">
          <HStack spacing={2}>
            <Icon as={getPlatformIcon(thread.source_platform)} boxSize={4} />
            <Badge colorScheme={getThreadTypeColor(thread.thread_type)}>
              {thread.thread_type.replace('_', ' ')}
            </Badge>
            {thread.is_pinned && (
              <Badge colorScheme="red">Pinned</Badge>
            )}
          </HStack>
          <Text fontSize="sm" color="gray.500">
            {thread.last_activity_at ? new Date(thread.last_activity_at).toLocaleDateString() : ''}
          </Text>
        </HStack>

        {/* Title */}
        <Text fontSize="lg" fontWeight="semibold" noOfLines={2}>
          {thread.thread_title || 'Untitled Thread'}
        </Text>

        {/* Stats */}
        <HStack spacing={6} fontSize="sm" color="gray.600">
          <HStack>
            <Icon as={FiMessageCircle} />
            <Text>{thread.total_posts} posts</Text>
          </HStack>
          <HStack>
            <Icon as={FiUsers} />
            <Text>{thread.total_participants} participants</Text>
          </HStack>
          {thread.avg_verimeter_score && (
            <HStack>
              <Icon as={FiTrendingUp} />
              <Text>Verimeter {thread.avg_verimeter_score.toFixed(1)}</Text>
            </HStack>
          )}
        </HStack>

        {/* Breakdown */}
        {(thread.total_imported_posts > 0 || thread.total_exported_posts > 0) && (
          <HStack fontSize="xs" color="gray.500">
            {thread.total_imported_posts > 0 && (
              <Text>{thread.total_imported_posts} imported</Text>
            )}
            {thread.total_tt_posts > 0 && (
              <Text>{thread.total_tt_posts} TT posts</Text>
            )}
            {thread.total_exported_posts > 0 && (
              <Text>{thread.total_exported_posts} exported</Text>
            )}
          </HStack>
        )}
      </VStack>
    </Box>
  );
};

export default TTLiveThreadCard;
