/**
 * Argument Signoff Panel
 *
 * Shows participant signoffs and allows users to approve/endorse arguments
 */

import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Avatar,
  Badge,
  Flex,
  Textarea,
  useColorModeValue,
  useToast,
  Progress,
} from '@chakra-ui/react';
import { FiCheck, FiThumbsUp, FiAlertCircle } from 'react-icons/fi';
import { ArgumentSignoff } from '../../../../shared/entities/types';

interface Props {
  argumentId: string;
  signoffs: ArgumentSignoff[];
  signoffThreshold: number;
  currentUserId: number;
  status: string;
  onSignoffAdded?: () => void;
}

const ArgumentSignoffPanel: React.FC<Props> = ({
  argumentId,
  signoffs,
  signoffThreshold,
  currentUserId,
  status,
  onSignoffAdded,
}) => {
  const toast = useToast();
  const [isSigningOff, setIsSigningOff] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const hudBg = useColorModeValue('rgba(0, 20, 40, 0.7)', 'rgba(0, 10, 20, 0.9)');
  const glowColor = useColorModeValue('cyan.400', 'cyan.300');
  const textColor = useColorModeValue('cyan.50', 'cyan.100');
  const labelColor = useColorModeValue('cyan.300', 'cyan.200');

  const userHasSignedOff = signoffs.some(s => s.user_id === currentUserId);
  const approveSignoffs = signoffs.filter(s => s.signoff_type === 'approve' || s.signoff_type === 'endorse');
  const progressPercent = (approveSignoffs.length / signoffThreshold) * 100;

  const handleSignoff = async (signoffType: 'approve' | 'endorse' | 'challenge') => {
    setIsSigningOff(true);
    try {
      const response = await fetch(`/api/ttlive/arguments/${argumentId}/signoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          signoff_type: signoffType,
          feedback_text: feedbackText || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to sign off');
      }

      toast({
        title: 'Signoff Added',
        description: `You have ${signoffType}d this argument`,
        status: 'success',
        duration: 3000,
      });

      setFeedbackText('');

      if (onSignoffAdded) {
        onSignoffAdded();
      }
    } catch (error) {
      console.error('Error signing off:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sign off',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsSigningOff(false);
    }
  };

  if (status !== 'approved' && status !== 'signed_off') {
    return null;
  }

  return (
    <Box
      bg={hudBg}
      p={5}
      borderRadius="md"
      borderWidth="2px"
      borderColor={status === 'signed_off' ? 'green.400' : 'cyan.600'}
      boxShadow={`0 0 15px ${status === 'signed_off' ? 'green' : 'cyan'}40`}
    >
      <VStack spacing={4} align="stretch">
        {/* Header */}
        <Flex justify="space-between" align="center">
          <Text
            fontSize="md"
            fontWeight="bold"
            color={labelColor}
            textTransform="uppercase"
            letterSpacing="wider"
          >
            Participant Signoffs
          </Text>
          {status === 'signed_off' ? (
            <Badge colorScheme="green" fontSize="sm">
              SIGNED OFF
            </Badge>
          ) : (
            <Badge colorScheme="cyan" fontSize="sm">
              {approveSignoffs.length} / {signoffThreshold}
            </Badge>
          )}
        </Flex>

        {/* Progress Bar */}
        <Box>
          <Flex justify="space-between" mb={2}>
            <Text fontSize="xs" color={labelColor}>
              Consensus Progress
            </Text>
            <Text fontSize="xs" color={textColor} fontWeight="bold">
              {Math.round(progressPercent)}%
            </Text>
          </Flex>
          <Progress
            value={progressPercent}
            colorScheme={status === 'signed_off' ? 'green' : 'cyan'}
            height="8px"
            borderRadius="full"
            bg="rgba(0, 0, 0, 0.3)"
            sx={{
              '& > div': {
                boxShadow: `0 0 10px ${status === 'signed_off' ? 'green' : 'cyan'}`,
              },
            }}
          />
        </Box>

        {/* Signoff List */}
        {signoffs.length > 0 && (
          <VStack spacing={2} align="stretch">
            {signoffs.map((signoff, index) => (
              <Flex
                key={index}
                align="center"
                gap={3}
                p={2}
                bg="rgba(0, 255, 255, 0.05)"
                borderRadius="md"
              >
                <Avatar size="xs" name={signoff.username} src={signoff.user_avatar} />
                <Box flex={1}>
                  <Text fontSize="sm" color={textColor} fontWeight="bold">
                    {signoff.username}
                  </Text>
                  {signoff.feedback_text && (
                    <Text fontSize="xs" color="cyan.300">
                      {signoff.feedback_text}
                    </Text>
                  )}
                </Box>
                <Badge
                  colorScheme={
                    signoff.signoff_type === 'approve'
                      ? 'green'
                      : signoff.signoff_type === 'endorse'
                        ? 'blue'
                        : 'orange'
                  }
                  fontSize="xs"
                >
                  {signoff.signoff_type}
                </Badge>
              </Flex>
            ))}
          </VStack>
        )}

        {/* Signoff Actions */}
        {!userHasSignedOff && status === 'approved' && (
          <Box
            p={4}
            bg="rgba(0, 255, 255, 0.05)"
            borderRadius="md"
            borderWidth="1px"
            borderColor="cyan.700"
          >
            <VStack spacing={3} align="stretch">
              <Textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Optional feedback (visible to all participants)..."
                size="sm"
                rows={2}
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
              <HStack spacing={2}>
                <Button
                  leftIcon={<FiCheck />}
                  size="sm"
                  colorScheme="green"
                  onClick={() => handleSignoff('approve')}
                  isLoading={isSigningOff}
                  flex={1}
                >
                  Approve
                </Button>
                <Button
                  leftIcon={<FiThumbsUp />}
                  size="sm"
                  colorScheme="blue"
                  onClick={() => handleSignoff('endorse')}
                  isLoading={isSigningOff}
                  flex={1}
                >
                  Endorse
                </Button>
                <Button
                  leftIcon={<FiAlertCircle />}
                  size="sm"
                  colorScheme="orange"
                  onClick={() => handleSignoff('challenge')}
                  isLoading={isSigningOff}
                  flex={1}
                >
                  Challenge
                </Button>
              </HStack>
            </VStack>
          </Box>
        )}

        {userHasSignedOff && (
          <Flex
            align="center"
            gap={2}
            p={3}
            bg="rgba(0, 255, 0, 0.1)"
            borderRadius="md"
            borderLeft="3px solid"
            borderColor="green.400"
          >
            <FiCheck color="green" />
            <Text fontSize="sm" color={textColor}>
              You have signed off on this argument
            </Text>
          </Flex>
        )}
      </VStack>
    </Box>
  );
};

export default ArgumentSignoffPanel;
