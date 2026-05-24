/**
 * SocialMediaComposer Component
 *
 * Generate and post structured discussion units to X/Twitter
 * Breaks content analysis into tweet-friendly claims, evidence, and summaries
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  IconButton,
  Checkbox,
  Textarea,
  Input,
  Select,
  Badge,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Progress,
  Divider,
  useToast,
  Tooltip,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Spinner,
  Link,
  Flex,
  Code,
  useColorModeValue,
} from '@chakra-ui/react';
import {
  FiTwitter,
  FiRefreshCw,
  FiEdit2,
  FiCheck,
  FiX,
  FiAlertCircle,
  FiExternalLink,
  FiSettings,
} from 'react-icons/fi';
import type {
  DiscussionBundle,
  DiscussionUnit,
  PostingTone,
  SocialPlatform,
} from '../../../shared/entities/types';

interface SocialMediaComposerProps {
  contentId: number;
  contentName: string;
  originalUrl?: string;
  onClose?: () => void;
}

const SocialMediaComposer: React.FC<SocialMediaComposerProps> = ({
  contentId,
  contentName,
  originalUrl = '',
  onClose,
}) => {
  const toast = useToast();

  // State
  const [bundle, setBundle] = useState<DiscussionBundle | null>(null);
  const [units, setUnits] = useState<DiscussionUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Configuration
  const [tone, setTone] = useState<PostingTone>('neutral');
  const [tweetUrl, setTweetUrl] = useState(originalUrl);
  const [delayBetweenPosts, setDelayBetweenPosts] = useState(5);

  // X Auth status
  const [xConnected, setXConnected] = useState(false);
  const [xUsername, setXUsername] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Editing
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  // Posting results
  const [showResults, setShowResults] = useState(false);
  const [postResults, setPostResults] = useState<any[]>([]);

  // Colors
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const hoverBg = useColorModeValue('gray.50', 'gray.700');

  // Check X auth status on mount
  useEffect(() => {
    checkXAuthStatus();
  }, []);

  // Load existing bundle or generate new one
  useEffect(() => {
    if (xConnected) {
      loadOrGenerateBundle();
    }
  }, [contentId, xConnected]);

  /**
   * Check if user has connected X account
   */
  const checkXAuthStatus = async () => {
    setCheckingAuth(true);
    try {
      const response = await fetch('/api/x-auth/status', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      const data = await response.json();

      if (data.connected) {
        setXConnected(true);
        setXUsername(data.x_username);
      } else {
        setXConnected(false);
      }
    } catch (error) {
      console.error('Failed to check X auth status:', error);
    } finally {
      setCheckingAuth(false);
    }
  };

  /**
   * Connect X account
   */
  const connectXAccount = async () => {
    try {
      const response = await fetch('/api/x-auth/connect', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      const data = await response.json();

      if (data.success && data.auth_url) {
        // Open OAuth flow in popup
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;

        const popup = window.open(
          data.auth_url,
          'X Authentication',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Poll for completion
        const checkInterval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkInterval);
            checkXAuthStatus(); // Refresh auth status
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to connect X account:', error);
      toast({
        title: 'Connection failed',
        description: 'Could not initiate X authentication',
        status: 'error',
        duration: 5000,
      });
    }
  };

  /**
   * Load existing bundle or generate new one
   */
  const loadOrGenerateBundle = async () => {
    setLoading(true);
    try {
      // Try to load existing bundle
      const response = await fetch(`/api/discussion/${contentId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setBundle(data.bundle);
        setUnits(data.bundle.units || []);
      } else {
        // No bundle exists, generate one
        await generateBundle();
      }
    } catch (error) {
      console.error('Failed to load bundle:', error);
      toast({
        title: 'Error',
        description: 'Failed to load discussion units',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Generate discussion bundle
   */
  const generateBundle = async () => {
    setGenerating(true);
    try {
      const response = await fetch('/api/discussion/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          contentId,
          tone,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      const data = await response.json();

      setBundle({
        bundle_id: data.bundle_id,
        content_id: contentId,
        created_by: 0, // Will be filled from server
        units: data.units,
      });
      setUnits(data.units);

      toast({
        title: 'Generated',
        description: `Created ${data.units_count} discussion units`,
        status: 'success',
        duration: 3000,
      });
    } catch (error: any) {
      console.error('Failed to generate bundle:', error);
      toast({
        title: 'Generation failed',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Toggle unit selection
   */
  const toggleUnitSelection = async (unit: DiscussionUnit) => {
    if (!unit.unit_id) return;

    const newSelection = !unit.is_selected_for_posting;

    try {
      const response = await fetch(`/api/discussion/units/${unit.unit_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          is_selected_for_posting: newSelection,
        }),
      });

      if (!response.ok) throw new Error('Update failed');

      // Update local state
      setUnits((prev) =>
        prev.map((u) =>
          u.unit_id === unit.unit_id
            ? { ...u, is_selected_for_posting: newSelection }
            : u
        )
      );
    } catch (error) {
      console.error('Failed to toggle selection:', error);
      toast({
        title: 'Error',
        description: 'Failed to update selection',
        status: 'error',
        duration: 3000,
      });
    }
  };

  /**
   * Start editing unit
   */
  const startEditing = (unit: DiscussionUnit) => {
    setEditingUnitId(unit.unit_id!);
    setEditText(unit.unit_text);
  };

  /**
   * Save edited unit
   */
  const saveEdit = async (unit: DiscussionUnit) => {
    if (!unit.unit_id) return;

    try {
      const response = await fetch(`/api/discussion/units/${unit.unit_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          unit_text: editText,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Update failed');
      }

      // Update local state
      setUnits((prev) =>
        prev.map((u) =>
          u.unit_id === unit.unit_id ? { ...u, unit_text: editText, is_edited: true } : u
        )
      );

      setEditingUnitId(null);
      setEditText('');

      toast({
        title: 'Saved',
        status: 'success',
        duration: 2000,
      });
    } catch (error: any) {
      console.error('Failed to save edit:', error);
      toast({
        title: 'Save failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    }
  };

  /**
   * Cancel editing
   */
  const cancelEdit = () => {
    setEditingUnitId(null);
    setEditText('');
  };

  /**
   * Post to X
   */
  const postToX = async () => {
    if (!bundle?.bundle_id) return;

    const selectedCount = units.filter((u) => u.is_selected_for_posting).length;

    if (selectedCount === 0) {
      toast({
        title: 'No units selected',
        description: 'Please select at least one unit to post',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    if (selectedCount > 5) {
      toast({
        title: 'Too many units',
        description: 'Maximum 5 units per post to avoid spam',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setPosting(true);
    try {
      const response = await fetch('/api/discussion/post-to-x', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          bundleId: bundle.bundle_id,
          originalPostUrl: tweetUrl,
          delayBetweenPosts,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Posting failed');
      }

      const data = await response.json();

      setPostResults(data.results);
      setShowResults(true);

      toast({
        title: 'Posted!',
        description: `${data.posted_count} tweets posted successfully`,
        status: 'success',
        duration: 5000,
      });
    } catch (error: any) {
      console.error('Failed to post:', error);
      toast({
        title: 'Posting failed',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    } finally {
      setPosting(false);
    }
  };

  // Unit type colors
  const getUnitTypeColor = (type: string) => {
    switch (type) {
      case 'claim':
        return 'blue';
      case 'support':
        return 'green';
      case 'counter':
        return 'orange';
      case 'summary':
        return 'purple';
      default:
        return 'gray';
    }
  };

  // Render loading state
  if (checkingAuth) {
    return (
      <Box p={6} textAlign="center">
        <Spinner size="xl" color="blue.500" />
        <Text mt={4}>Checking X authentication...</Text>
      </Box>
    );
  }

  // Render X connection prompt
  if (!xConnected) {
    return (
      <Box p={6} bg={bgColor} borderRadius="md" borderWidth="1px" borderColor={borderColor}>
        <VStack spacing={4} align="stretch">
          <HStack>
            <FiTwitter size={32} color="#1DA1F2" />
            <Heading size="md">Connect X/Twitter Account</Heading>
          </HStack>

          <Text color="gray.600">
            To post discussion units to X/Twitter, you need to connect your account first.
          </Text>

          <Alert status="info" borderRadius="md">
            <AlertIcon />
            <Box>
              <AlertTitle>What will this do?</AlertTitle>
              <AlertDescription>
                We'll securely authenticate with X using OAuth 2.0. You'll be able to post
                fact-checked claims and evidence directly to X as threaded replies.
              </AlertDescription>
            </Box>
          </Alert>

          <Button
            leftIcon={<FiTwitter />}
            colorScheme="twitter"
            size="lg"
            onClick={connectXAccount}
          >
            Connect X Account
          </Button>

          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
        </VStack>
      </Box>
    );
  }

  // Render main composer
  return (
    <Box>
      <VStack spacing={6} align="stretch">
        {/* Header */}
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <Heading size="md">Social Media Composer</Heading>
            <Text fontSize="sm" color="gray.600">
              {contentName}
            </Text>
          </VStack>

          <HStack>
            <Badge colorScheme="twitter">
              <HStack spacing={1}>
                <FiTwitter />
                <Text>@{xUsername}</Text>
              </HStack>
            </Badge>

            {onClose && (
              <IconButton
                aria-label="Close"
                icon={<FiX />}
                variant="ghost"
                onClick={onClose}
              />
            )}
          </HStack>
        </HStack>

        {/* Configuration */}
        <Box
          p={4}
          bg={bgColor}
          borderRadius="md"
          borderWidth="1px"
          borderColor={borderColor}
        >
          <VStack spacing={4} align="stretch">
            <HStack spacing={4}>
              <Box flex={1}>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Tone
                </Text>
                <Select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as PostingTone)}
                  isDisabled={generating || posting}
                >
                  <option value="neutral">Neutral</option>
                  <option value="assertive">Assertive</option>
                  <option value="question">Question-based</option>
                </Select>
              </Box>

              <Box flex={1}>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Delay (seconds)
                </Text>
                <Input
                  type="number"
                  value={delayBetweenPosts}
                  onChange={(e) => setDelayBetweenPosts(Number(e.target.value))}
                  min={2}
                  max={30}
                  isDisabled={posting}
                />
              </Box>
            </HStack>

            <Box>
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                Original Post URL (optional)
              </Text>
              <Input
                placeholder="https://twitter.com/user/status/1234567890"
                value={tweetUrl}
                onChange={(e) => setTweetUrl(e.target.value)}
                isDisabled={posting}
              />
              <Text fontSize="xs" color="gray.500" mt={1}>
                If provided, posts will reply to this tweet
              </Text>
            </Box>

            <Button
              leftIcon={<FiRefreshCw />}
              onClick={generateBundle}
              isLoading={generating}
              loadingText="Generating..."
              variant="outline"
              size="sm"
            >
              Regenerate Units
            </Button>
          </VStack>
        </Box>

        {/* Loading */}
        {loading && (
          <Box textAlign="center" py={8}>
            <Spinner size="xl" />
            <Text mt={4}>Loading discussion units...</Text>
          </Box>
        )}

        {/* Units */}
        {!loading && units.length > 0 && (
          <VStack spacing={3} align="stretch">
            {units.map((unit, index) => (
              <Box
                key={unit.unit_id || index}
                p={4}
                bg={unit.is_selected_for_posting ? bgColor : hoverBg}
                borderRadius="md"
                borderWidth="2px"
                borderColor={
                  unit.is_selected_for_posting ? getUnitTypeColor(unit.unit_type) : borderColor
                }
                opacity={unit.is_selected_for_posting ? 1 : 0.6}
              >
                <HStack align="start" spacing={3}>
                  {/* Selection checkbox */}
                  <Checkbox
                    isChecked={unit.is_selected_for_posting}
                    onChange={() => toggleUnitSelection(unit)}
                    size="lg"
                    mt={1}
                    isDisabled={posting}
                  />

                  <VStack flex={1} align="stretch" spacing={2}>
                    {/* Type badge */}
                    <HStack>
                      <Badge colorScheme={getUnitTypeColor(unit.unit_type)}>
                        {unit.unit_type.toUpperCase()}
                      </Badge>
                      {unit.is_edited && <Badge colorScheme="yellow">EDITED</Badge>}
                      <Text fontSize="xs" color="gray.500">
                        {unit.unit_text.length} / 280 chars
                      </Text>
                    </HStack>

                    {/* Text */}
                    {editingUnitId === unit.unit_id ? (
                      <VStack align="stretch" spacing={2}>
                        <Textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={4}
                          maxLength={280}
                        />
                        <HStack>
                          <Button
                            size="sm"
                            leftIcon={<FiCheck />}
                            colorScheme="green"
                            onClick={() => saveEdit(unit)}
                          >
                            Save
                          </Button>
                          <Button size="sm" leftIcon={<FiX />} onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </HStack>
                      </VStack>
                    ) : (
                      <Text whiteSpace="pre-wrap">{unit.unit_text}</Text>
                    )}

                    {/* Sources */}
                    {unit.sources && unit.sources.length > 0 && (
                      <VStack align="start" spacing={1} fontSize="xs">
                        {unit.sources.map((source: any, i: number) => (
                          <Link
                            key={i}
                            href={source.url}
                            isExternal
                            color="blue.500"
                            display="flex"
                            alignItems="center"
                            gap={1}
                          >
                            <FiExternalLink />
                            {source.title}
                          </Link>
                        ))}
                      </VStack>
                    )}
                  </VStack>

                  {/* Edit button */}
                  {editingUnitId !== unit.unit_id && (
                    <IconButton
                      aria-label="Edit"
                      icon={<FiEdit2 />}
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing(unit)}
                      isDisabled={posting}
                    />
                  )}
                </HStack>
              </Box>
            ))}
          </VStack>
        )}

        {/* Post button */}
        {!loading && units.length > 0 && (
          <Box>
            <Divider mb={4} />
            <HStack justify="space-between">
              <VStack align="start" spacing={0}>
                <Text fontSize="sm" fontWeight="medium">
                  {units.filter((u) => u.is_selected_for_posting).length} units selected
                </Text>
                <Text fontSize="xs" color="gray.500">
                  Max 5 units per post
                </Text>
              </VStack>

              <Button
                leftIcon={<FiTwitter />}
                colorScheme="twitter"
                size="lg"
                onClick={postToX}
                isLoading={posting}
                loadingText="Posting..."
                isDisabled={units.filter((u) => u.is_selected_for_posting).length === 0}
              >
                Post to X
              </Button>
            </HStack>
          </Box>
        )}

        {/* Empty state */}
        {!loading && units.length === 0 && (
          <Alert status="info" borderRadius="md">
            <AlertIcon />
            <Box>
              <AlertTitle>No discussion units</AlertTitle>
              <AlertDescription>
                Click "Generate Units" to create tweet-friendly discussion units from this
                content's claims and evidence.
              </AlertDescription>
            </Box>
          </Alert>
        )}
      </VStack>

      {/* Results modal */}
      <Modal isOpen={showResults} onClose={() => setShowResults(false)} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Posting Results</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={3} align="stretch">
              {postResults.map((result, index) => (
                <Box
                  key={index}
                  p={3}
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor={result.success ? 'green.300' : 'red.300'}
                  bg={result.success ? 'green.50' : 'red.50'}
                >
                  <HStack justify="space-between">
                    <HStack>
                      {result.success ? (
                        <FiCheck color="green" />
                      ) : (
                        <FiAlertCircle color="red" />
                      )}
                      <Text fontWeight="medium">Tweet {result.position}</Text>
                    </HStack>
                    {result.success && result.url && (
                      <Link href={result.url} isExternal color="blue.500" fontSize="sm">
                        View <FiExternalLink />
                      </Link>
                    )}
                  </HStack>
                  {result.error && (
                    <Text fontSize="sm" color="red.600" mt={2}>
                      {result.error}
                    </Text>
                  )}
                </Box>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setShowResults(false)}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default SocialMediaComposer;
