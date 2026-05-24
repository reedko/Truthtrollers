/**
 * TT Live Post Composer
 *
 * Form for creating posts in threads
 */

import React, { useState } from 'react';
import {
  VStack,
  HStack,
  Textarea,
  Button,
  Select,
  FormControl,
  FormLabel,
  Text,
  Alert,
  AlertIcon,
  useToast,
  Badge,
} from '@chakra-ui/react';
import { TTLiveTimelinePost, TTLiveStance, TTLiveTone } from '../../../../shared/entities/types';

interface TTLivePostComposerProps {
  threadId: string;
  replyToPost?: TTLiveTimelinePost | null;
  onPostCreated: () => void;
  onCancel: () => void;
}

const TTLivePostComposer: React.FC<TTLivePostComposerProps> = ({
  threadId,
  replyToPost,
  onPostCreated,
  onCancel,
}) => {
  const [postText, setPostText] = useState('');
  const [stance, setStance] = useState<TTLiveStance>('neutral');
  const [tone, setTone] = useState<TTLiveTone>('neutral');
  const [posting, setPosting] = useState(false);
  const toast = useToast();

  const handleSubmit = async () => {
    if (!postText.trim()) {
      toast({
        title: 'Post text required',
        status: 'error',
        duration: 3000,
      });
      return;
    }

    setPosting(true);
    try {
      const payload: any = {
        thread_id: threadId,
        post_text: postText.trim(),
        stance,
        tone,
      };

      // Add reply info if replying
      if (replyToPost) {
        if (replyToPost.post_source === 'imported') {
          payload.reply_to_imported_post_id = replyToPost.post_id;
        } else {
          payload.reply_to_post_id = replyToPost.post_id;
        }
      }

      const response = await fetch('/api/ttlive/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create post');
      }

      toast({
        title: 'Post created!',
        status: 'success',
        duration: 3000,
      });

      setPostText('');
      setStance('neutral');
      setTone('neutral');
      onPostCreated();
    } catch (error) {
      console.error('Failed to create post:', error);
      toast({
        title: 'Failed to create post',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setPosting(false);
    }
  };

  return (
    <VStack spacing={4} align="stretch">
      {/* Reply Info */}
      {replyToPost && (
        <Alert status="info" size="sm">
          <AlertIcon />
          <Text fontSize="sm">
            Replying to <strong>@{replyToPost.author_username}</strong>
          </Text>
        </Alert>
      )}

      {/* Post Text */}
      <FormControl isRequired>
        <FormLabel fontSize="sm">Your Post</FormLabel>
        <Textarea
          placeholder="Share your thoughts with evidence..."
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
          rows={4}
        />
        <Text fontSize="xs" color="gray.500" mt={1}>
          {postText.length} characters
        </Text>
      </FormControl>

      {/* Stance & Tone */}
      <HStack spacing={4}>
        <FormControl>
          <FormLabel fontSize="sm">Stance</FormLabel>
          <Select
            value={stance}
            onChange={(e) => setStance(e.target.value as TTLiveStance)}
            size="sm"
          >
            <option value="neutral">💬 Neutral</option>
            <option value="support">✅ Support</option>
            <option value="refute">❌ Refute</option>
            <option value="nuance">⚖️ Nuance</option>
            <option value="question">❓ Question</option>
          </Select>
        </FormControl>

        <FormControl>
          <FormLabel fontSize="sm">Tone</FormLabel>
          <Select
            value={tone}
            onChange={(e) => setTone(e.target.value as TTLiveTone)}
            size="sm"
          >
            <option value="neutral">Neutral</option>
            <option value="assertive">Assertive</option>
            <option value="questioning">Questioning</option>
            <option value="educational">Educational</option>
          </Select>
        </FormControl>
      </HStack>

      {/* Stance Explanation */}
      <Alert status="info" variant="subtle" size="sm">
        <VStack align="start" spacing={1} fontSize="xs">
          <Text>
            <Badge colorScheme="green">Support</Badge> - Agree with claim/evidence
          </Text>
          <Text>
            <Badge colorScheme="red">Refute</Badge> - Disagree with claim/evidence
          </Text>
          <Text>
            <Badge colorScheme="purple">Nuance</Badge> - Add context or complexity
          </Text>
          <Text>
            <Badge colorScheme="orange">Question</Badge> - Seek clarification
          </Text>
        </VStack>
      </Alert>

      {/* Actions */}
      <HStack justify="flex-end">
        <Button variant="ghost" onClick={onCancel} size="sm">
          Cancel
        </Button>
        <Button
          colorScheme="blue"
          onClick={handleSubmit}
          isLoading={posting}
          size="sm"
        >
          Post
        </Button>
      </HStack>
    </VStack>
  );
};

export default TTLivePostComposer;
