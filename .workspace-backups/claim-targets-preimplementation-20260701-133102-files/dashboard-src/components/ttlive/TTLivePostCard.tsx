/**
 * TT Live Post Card
 *
 * Individual post in thread timeline with stance indicators
 */

import React, { useState } from 'react';
import {
  Box,
  HStack,
  VStack,
  Text,
  Avatar,
  Badge,
  IconButton,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useColorModeValue,
  Icon,
  Tooltip,
} from '@chakra-ui/react';
import {
  FiThumbsUp,
  FiThumbsDown,
  FiMessageCircle,
  FiMoreVertical,
  FiTwitter,
  FiExternalLink,
  FiShield,
} from 'react-icons/fi';
import { TTLiveTimelinePost } from '../../../../shared/entities/types';

interface TTLivePostCardProps {
  post: TTLiveTimelinePost;
  onReply?: (post: TTLiveTimelinePost) => void;
  onUpdate?: () => void;
}

const TTLivePostCard: React.FC<TTLivePostCardProps> = ({
  post,
  onReply,
  onUpdate,
}) => {
  const [voting, setVoting] = useState(false);

  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const importedBg = useColorModeValue('blue.50', 'blue.900');

  const getStanceColor = (stance: string | null | undefined) => {
    switch (stance) {
      case 'support':
        return 'green';
      case 'refute':
        return 'red';
      case 'nuance':
        return 'purple';
      case 'question':
        return 'orange';
      default:
        return 'gray';
    }
  };

  const getStanceIcon = (stance: string | null | undefined) => {
    switch (stance) {
      case 'support':
        return '✅';
      case 'refute':
        return '❌';
      case 'nuance':
        return '⚖️';
      case 'question':
        return '❓';
      default:
        return '💬';
    }
  };

  const handleVote = async (voteType: 'upvote' | 'downvote') => {
    if (post.post_source === 'imported') return; // Can't vote on imported posts

    setVoting(true);
    try {
      const response = await fetch(`/api/ttlive/posts/${post.post_id}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({ vote_type: voteType }),
      });

      if (response.ok && onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error('Vote failed:', error);
    } finally {
      setVoting(false);
    }
  };

  const isImported = post.post_source === 'imported';

  return (
    <Box
      bg={isImported ? importedBg : cardBg}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      p={4}
      borderLeftWidth={isImported ? '4px' : '1px'}
      borderLeftColor={isImported ? 'blue.500' : borderColor}
    >
      <VStack align="stretch" spacing={3}>
        {/* Header */}
        <HStack justify="space-between">
          <HStack spacing={3}>
            {/* Avatar */}
            <Avatar
              size="sm"
              name={post.author_username || 'Unknown'}
              src={post.author_avatar_url || undefined}
            />

            {/* Author & Source Info */}
            <VStack align="start" spacing={0}>
              <HStack spacing={2}>
                <Text fontWeight="bold" fontSize="sm">
                  {post.author_display_name || post.author_username || 'Unknown'}
                </Text>
                {isImported && (
                  <Badge colorScheme="blue" fontSize="xs">
                    X Import
                  </Badge>
                )}
              </HStack>
              <Text fontSize="xs" color="gray.500">
                {new Date(post.created_at).toLocaleString()}
              </Text>
            </VStack>

            {/* Stance Badge */}
            {post.stance && (
              <Tooltip label={`Stance: ${post.stance}`}>
                <Badge colorScheme={getStanceColor(post.stance)}>
                  {getStanceIcon(post.stance)} {post.stance}
                </Badge>
              </Tooltip>
            )}

            {/* Verimeter */}
            {post.verimeter_score !== null && post.verimeter_score !== undefined && (
              <Tooltip label="Verimeter Score">
                <Badge colorScheme="teal">
                  <Icon as={FiShield} mr={1} />
                  {post.verimeter_score.toFixed(1)}
                </Badge>
              </Tooltip>
            )}
          </HStack>

          {/* Menu */}
          <Menu>
            <MenuButton
              as={IconButton}
              icon={<FiMoreVertical />}
              variant="ghost"
              size="sm"
            />
            <MenuList>
              {!isImported && onReply && (
                <MenuItem icon={<FiMessageCircle />} onClick={() => onReply(post)}>
                  Reply
                </MenuItem>
              )}
              {post.source_url && (
                <MenuItem
                  icon={<FiExternalLink />}
                  as="a"
                  href={post.source_url}
                  target="_blank"
                >
                  View on X
                </MenuItem>
              )}
            </MenuList>
          </Menu>
        </HStack>

        {/* Post Text */}
        <Text whiteSpace="pre-wrap">{post.post_text}</Text>

        {/* Media */}
        {post.post_media_urls && Array.isArray(post.post_media_urls) && post.post_media_urls.length > 0 && (
          <HStack spacing={2} flexWrap="wrap">
            {post.post_media_urls.map((url, idx) => (
              <Box
                key={idx}
                as="a"
                href={url}
                target="_blank"
                borderWidth="1px"
                borderRadius="md"
                overflow="hidden"
                maxW="200px"
              >
                <img src={url} alt={`Media ${idx + 1}`} style={{ width: '100%' }} />
              </Box>
            ))}
          </HStack>
        )}

        {/* Engagement Stats */}
        <HStack spacing={6} fontSize="sm" color="gray.600">
          {/* Likes */}
          <HStack>
            <IconButton
              aria-label="Upvote"
              icon={<FiThumbsUp />}
              size="xs"
              variant="ghost"
              onClick={() => handleVote('upvote')}
              isDisabled={isImported || voting}
            />
            <Text>{post.likes_count}</Text>
          </HStack>

          {/* Retweets/Shares */}
          {post.retweets_count > 0 && (
            <HStack>
              <Icon as={FiTwitter} />
              <Text>{post.retweets_count}</Text>
            </HStack>
          )}

          {/* Replies */}
          {post.replies_count > 0 && (
            <HStack>
              <Icon as={FiMessageCircle} />
              <Text>{post.replies_count}</Text>
            </HStack>
          )}
        </HStack>
      </VStack>
    </Box>
  );
};

export default TTLivePostCard;
