/**
 * TT Live Thread Detail Page
 *
 * Shows full thread timeline with posts and composer
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Badge,
  Spinner,
  Alert,
  AlertIcon,
  useColorModeValue,
  IconButton,
  Divider,
  useToast,
  Avatar,
} from '@chakra-ui/react';
import { FiArrowLeft, FiLock, FiRefreshCw, FiMessageSquare, FiUsers, FiCheckCircle } from 'react-icons/fi';
import { useNavigate, useParams } from 'react-router-dom';
import { TTLiveThread, TTLiveTimelinePost, ConversationArgument } from '../../../shared/entities/types';
import TTLivePostCard from '../components/ttlive/TTLivePostCard';
import TTLivePostComposer from '../components/ttlive/TTLivePostComposer';
import StagedArgumentBuilder from '../components/staged-arguments/StagedArgumentBuilder';
import PointCounterpointView from '../components/conversations/PointCounterpointView';
import ConversationArgumentComposer from '../components/conversations/ConversationArgumentComposer';
import ClaimPairsDetail from '../components/ttlive/ClaimPairsDetail';

const TTLiveThreadPage: React.FC = () => {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [thread, setThread] = useState<TTLiveThread | null>(null);
  const [posts, setPosts] = useState<TTLiveTimelinePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [replyToPost, setReplyToPost] = useState<TTLiveTimelinePost | null>(null);
  const [useArgumentMode, setUseArgumentMode] = useState(true); // Default to Staged Argument Mode
  const [viewMode, setViewMode] = useState<'source' | 'conversation'>('conversation'); // New: view mode toggle
  const [replyToArgument, setReplyToArgument] = useState<ConversationArgument | null>(null);

  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const cardBgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const claimBgColor = useColorModeValue('blue.50', 'blue.900');

  useEffect(() => {
    if (threadId) {
      loadThread();
      loadPosts();
    }
  }, [threadId]);

  const loadThread = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ttlive/threads/${threadId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Thread not found');
      }

      const data = await response.json();
      setThread(data.thread);
    } catch (error) {
      console.error('Failed to load thread:', error);
      toast({
        title: 'Error loading thread',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPosts = async () => {
    setLoadingPosts(true);
    try {
      const response = await fetch(`/api/ttlive/threads/${threadId}/timeline`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      const data = await response.json();
      setPosts(data.posts || []);
    } catch (error) {
      console.error('Failed to load posts:', error);
    } finally {
      setLoadingPosts(false);
    }
  };

  const handlePostCreated = () => {
    setShowComposer(false);
    setReplyToPost(null);
    loadPosts();
    loadThread(); // Refresh stats
  };

  const handleArgumentCreated = (argument: any) => {
    setShowComposer(false);
    setReplyToPost(null);
    loadPosts();
    loadThread(); // Refresh stats
  };

  const handleReply = (post: TTLiveTimelinePost) => {
    setReplyToPost(post);
    setShowComposer(true);
    setUseArgumentMode(true); // Always use argument mode for replies
  };

  if (loading) {
    return (
      <Box bg={bgColor} minH="100vh" py={8}>
        <Container maxW="container.lg">
          <Box textAlign="center" py={12}>
            <Spinner size="xl" />
            <Text mt={4}>Loading thread...</Text>
          </Box>
        </Container>
      </Box>
    );
  }

  if (!thread) {
    return (
      <Box bg={bgColor} minH="100vh" py={8}>
        <Container maxW="container.lg">
          <Alert status="error">
            <AlertIcon />
            Thread not found
          </Alert>
        </Container>
      </Box>
    );
  }

  return (
    <Box bg={bgColor} minH="100vh">
      <Container maxW="container.lg" py={4}>
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <HStack justify="space-between">
            <HStack>
              <IconButton
                aria-label="Back to feed"
                icon={<FiArrowLeft />}
                variant="ghost"
                onClick={() => navigate('/ttlive')}
              />
              <Heading size="md">Thread</Heading>
            </HStack>
            <HStack spacing={2}>
              {/* View Mode Toggle */}
              <Button
                size="sm"
                variant={viewMode === 'source' ? 'solid' : 'outline'}
                onClick={() => setViewMode('source')}
              >
                Source Posts
              </Button>
              <Button
                size="sm"
                leftIcon={<FiUsers />}
                variant={viewMode === 'conversation' ? 'solid' : 'outline'}
                colorScheme="purple"
                onClick={() => setViewMode('conversation')}
              >
                Conversation
              </Button>

              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                variant="ghost"
                onClick={() => {
                  loadThread();
                  loadPosts();
                }}
                isLoading={loadingPosts}
              />
              <Button
                leftIcon={<FiMessageSquare />}
                colorScheme="blue"
                size="sm"
                onClick={() => {
                  setReplyToArgument(null);
                  setShowComposer(true);
                }}
                isDisabled={thread?.is_locked}
              >
                Add Argument
              </Button>
            </HStack>
          </HStack>

          {/* Thread Info Card */}
          <Box
            bg={cardBgColor}
            borderWidth="1px"
            borderColor={borderColor}
            borderRadius="lg"
            p={6}
          >
            <VStack align="stretch" spacing={3}>
              {/* Badges */}
              <HStack spacing={2} flexWrap="wrap">
                <Badge colorScheme="blue">
                  {thread.thread_type.replace('_', ' ')}
                </Badge>
                {thread.is_pinned && <Badge colorScheme="red">Pinned</Badge>}
                {thread.is_locked && <Badge colorScheme="orange">Locked</Badge>}
                {thread.is_archived && <Badge colorScheme="gray">Archived</Badge>}
              </HStack>

              {/* Title */}
              <Heading size="lg">{thread.thread_title || 'Untitled Thread'}</Heading>

              {/* Author */}
              {thread.author && (
                <HStack spacing={3}>
                  <Avatar
                    size="sm"
                    src={thread.author.avatar_url}
                    name={thread.author.display_name}
                  />
                  <VStack align="start" spacing={0}>
                    <HStack spacing={1}>
                      <Text fontWeight="bold" fontSize="sm">
                        {thread.author.display_name}
                      </Text>
                      {thread.author.verified && (
                        <FiCheckCircle color="blue" size={14} />
                      )}
                    </HStack>
                    <Text fontSize="xs" color="gray.500">
                      @{thread.author.username}
                    </Text>
                  </VStack>
                </HStack>
              )}

              {/* Full Thread Content */}
              {thread.full_content && (
                <Box
                  mt={4}
                  p={4}
                  bg={useColorModeValue('gray.50', 'gray.700')}
                  borderRadius="md"
                  whiteSpace="pre-wrap"
                  fontSize="sm"
                  maxH="400px"
                  overflowY="auto"
                >
                  {thread.full_content}
                </Box>
              )}

              {/* Claim Pairs - AI-verified evidence */}
              {thread.claim_pairs && thread.claim_pairs.claim_pairs.length > 0 && (
                <Box mt={4}>
                  <ClaimPairsDetail claimPairsData={thread.claim_pairs} />
                </Box>
              )}

              {/* Source */}
              {thread.source_url && (
                <Text fontSize="sm" color="blue.500" as="a" href={thread.source_url} target="_blank">
                  View on {thread.source_platform || 'X'}
                </Text>
              )}

              {/* Stats */}
              <HStack spacing={6} fontSize="sm" color="gray.600">
                <Text>{thread.total_posts} posts</Text>
                <Text>{thread.total_participants} participants</Text>
                {thread.verimeter_score !== null && thread.verimeter_score !== undefined && (
                  <Text fontWeight="bold" color={thread.verimeter_score > 0.5 ? 'green.600' : thread.verimeter_score > 0 ? 'yellow.600' : 'red.600'}>
                    Verimeter: {(thread.verimeter_score * 100).toFixed(0)}%
                  </Text>
                )}
              </HStack>
            </VStack>
          </Box>

          {/* Thread Lock Warning */}
          {thread.is_locked && (
            <Box
              bg={cardBgColor}
              borderWidth="1px"
              borderColor={borderColor}
              borderRadius="lg"
              p={4}
            >
              <Alert status="warning" size="sm">
                <FiLock />
                <Text ml={2}>This thread is locked. No new posts allowed.</Text>
              </Alert>
            </Box>
          )}

          {/* Argument Composer */}
          {showComposer && !thread.is_locked && viewMode === 'conversation' && (
            <ConversationArgumentComposer
              threadId={thread.thread_id!}
              replyTo={replyToArgument}
              onArgumentCreated={(arg) => {
                setShowComposer(false);
                setReplyToArgument(null);
                // Trigger refresh in PointCounterpointView
              }}
              onCancel={() => {
                setShowComposer(false);
                setReplyToArgument(null);
              }}
            />
          )}

          <Divider />

          {/* Content Area - Toggle between Source Posts and Conversation */}
          {viewMode === 'source' ? (
            <VStack spacing={4} align="stretch">
              <Heading size="sm" color="gray.600">
                Source Posts ({posts.length})
              </Heading>

              {loadingPosts ? (
                <Box textAlign="center" py={8}>
                  <Spinner />
                </Box>
              ) : posts.length === 0 ? (
                <Alert status="info">
                  <AlertIcon />
                  No posts yet.
                </Alert>
              ) : (
                posts.map((post) => (
                  <TTLivePostCard
                    key={post.post_id}
                    post={post}
                    onReply={handleReply}
                    onUpdate={loadPosts}
                  />
                ))
              )}
            </VStack>
          ) : (
            <VStack spacing={4} align="stretch">
              <Heading size="sm" color="gray.600">
                Conversation (Point/Counterpoint)
              </Heading>

              <PointCounterpointView
                threadId={thread.thread_id!}
                onReply={(arg) => {
                  setReplyToArgument(arg);
                  setShowComposer(true);
                }}
                onStageArgument={async (arg) => {
                  try {
                    const response = await fetch(`/api/ttlive/conversations/${thread.thread_id}/arguments/${arg.conv_argument_id}/stage`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${localStorage.getItem('jwt')}`,
                      },
                      body: JSON.stringify({}),
                    });

                    if (response.ok) {
                      toast({
                        title: 'Argument staged!',
                        description: 'Moved to staging pipeline for validation',
                        status: 'success',
                        duration: 3000,
                      });
                    }
                  } catch (error) {
                    toast({
                      title: 'Error',
                      description: 'Failed to stage argument',
                      status: 'error',
                      duration: 3000,
                    });
                  }
                }}
              />
            </VStack>
          )}
        </VStack>
      </Container>
    </Box>
  );
};

export default TTLiveThreadPage;
