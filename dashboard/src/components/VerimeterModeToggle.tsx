// src/components/VerimeterModeToggle.tsx
import React from 'react';
import {
  Box,
  Button,
  ButtonGroup,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverArrow,
  PopoverCloseButton,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Text,
  VStack,
  HStack,
  Badge,
  Tooltip,
} from '@chakra-ui/react';
import { useVerimeterMode, VerimeterMode } from '../contexts/VerimeterModeContext';

interface VerimeterModeToggleProps {
  compact?: boolean;
}

export const VerimeterModeToggle: React.FC<VerimeterModeToggleProps> = ({ compact = false }) => {
  const { mode, setMode, aiWeight, setAIWeight } = useVerimeterMode();

  const getModeLabel = (m: VerimeterMode) => {
    switch (m) {
      case 'ai':
        return 'AI';
      case 'user':
        return 'User';
      case 'combined':
        return 'AI+User';
    }
  };

  const getModeDescription = (m: VerimeterMode) => {
    switch (m) {
      case 'ai':
        return 'Scores based only on AI evidence analysis';
      case 'user':
        return 'Scores based only on human evaluations';
      case 'combined':
        return 'Blended scores from both AI and user inputs';
    }
  };

  const getModeColor = (m: VerimeterMode) => {
    switch (m) {
      case 'ai':
        return 'purple';
      case 'user':
        return 'blue';
      case 'combined':
        return 'teal';
    }
  };

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger>
          <Button size="sm" colorScheme={getModeColor(mode)} variant="outline">
            {getModeLabel(mode)}
          </Button>
        </PopoverTrigger>
        <PopoverContent zIndex={2000}>
          <PopoverArrow />
          <PopoverCloseButton />
          <PopoverHeader fontWeight="semibold">Verimeter Mode</PopoverHeader>
          <PopoverBody>
            <VStack spacing={3} align="stretch">
              <ButtonGroup size="sm" isAttached variant="outline" w="full">
                <Button
                  flex={1}
                  colorScheme={mode === 'ai' ? 'purple' : 'gray'}
                  onClick={() => setMode('ai')}
                  isActive={mode === 'ai'}
                >
                  AI
                </Button>
                <Button
                  flex={1}
                  colorScheme={mode === 'user' ? 'blue' : 'gray'}
                  onClick={() => setMode('user')}
                  isActive={mode === 'user'}
                >
                  User
                </Button>
                <Button
                  flex={1}
                  colorScheme={mode === 'combined' ? 'teal' : 'gray'}
                  onClick={() => setMode('combined')}
                  isActive={mode === 'combined'}
                >
                  Combined
                </Button>
              </ButtonGroup>

              <Text fontSize="xs" color="gray.600">
                {getModeDescription(mode)}
              </Text>

              {mode === 'combined' && (
                <Box>
                  <Text fontSize="xs" fontWeight="medium" mb={2}>
                    AI Weight: {Math.round(aiWeight * 100)}%
                  </Text>
                  <Slider
                    value={aiWeight}
                    onChange={setAIWeight}
                    min={0}
                    max={1}
                    step={0.1}
                    colorScheme="teal"
                  >
                    <SliderTrack>
                      <SliderFilledTrack />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <HStack justify="space-between" mt={1}>
                    <Text fontSize="xs" color="gray.500">0% AI</Text>
                    <Text fontSize="xs" color="gray.500">100% AI</Text>
                  </HStack>
                </Box>
              )}
            </VStack>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Box
      p={4}
      bg="rgba(0, 0, 0, 0.3)"
      borderRadius="md"
      border="1px solid"
      borderColor="rgba(0, 162, 255, 0.3)"
    >
      <VStack spacing={4} align="stretch">
        <HStack justify="space-between">
          <Text fontWeight="semibold" color="gray.100">Verimeter Source</Text>
          <Tooltip label={getModeDescription(mode)}>
            <Badge colorScheme={getModeColor(mode)} fontSize="sm">
              {getModeLabel(mode)}
            </Badge>
          </Tooltip>
        </HStack>

        <ButtonGroup size="md" isAttached variant="outline" w="full">
          <Button
            flex={1}
            colorScheme={mode === 'ai' ? 'purple' : 'gray'}
            onClick={() => setMode('ai')}
            isActive={mode === 'ai'}
            bg={mode === 'ai' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0, 0, 0, 0.3)'}
            color={mode === 'ai' ? 'purple.300' : 'gray.300'}
            borderColor={mode === 'ai' ? 'purple.500' : 'gray.600'}
            _hover={{
              bg: mode === 'ai' ? 'rgba(139, 92, 246, 0.3)' : 'rgba(0, 162, 255, 0.1)',
              borderColor: mode === 'ai' ? 'purple.400' : 'cyan.500'
            }}
          >
            AI Only
          </Button>
          <Button
            flex={1}
            colorScheme={mode === 'user' ? 'blue' : 'gray'}
            onClick={() => setMode('user')}
            isActive={mode === 'user'}
            bg={mode === 'user' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0, 0, 0, 0.3)'}
            color={mode === 'user' ? 'blue.300' : 'gray.300'}
            borderColor={mode === 'user' ? 'blue.500' : 'gray.600'}
            _hover={{
              bg: mode === 'user' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(0, 162, 255, 0.1)',
              borderColor: mode === 'user' ? 'blue.400' : 'cyan.500'
            }}
          >
            User Only
          </Button>
          <Button
            flex={1}
            colorScheme={mode === 'combined' ? 'teal' : 'gray'}
            onClick={() => setMode('combined')}
            isActive={mode === 'combined'}
            bg={mode === 'combined' ? 'rgba(20, 184, 166, 0.2)' : 'rgba(0, 0, 0, 0.3)'}
            color={mode === 'combined' ? 'teal.300' : 'gray.300'}
            borderColor={mode === 'combined' ? 'teal.500' : 'gray.600'}
            _hover={{
              bg: mode === 'combined' ? 'rgba(20, 184, 166, 0.3)' : 'rgba(0, 162, 255, 0.1)',
              borderColor: mode === 'combined' ? 'teal.400' : 'cyan.500'
            }}
          >
            AI + User
          </Button>
        </ButtonGroup>

        <Text fontSize="sm" color="gray.300">
          {getModeDescription(mode)}
        </Text>

        {mode === 'combined' && (
          <Box pt={2}>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" fontWeight="medium" color="gray.200">
                AI Weight
              </Text>
              <Text fontSize="sm" color="gray.300">
                {Math.round(aiWeight * 100)}% AI / {Math.round((1 - aiWeight) * 100)}% User
              </Text>
            </HStack>
            <Slider
              value={aiWeight}
              onChange={setAIWeight}
              min={0}
              max={1}
              step={0.1}
              colorScheme="teal"
            >
              <SliderTrack bg="rgba(255, 255, 255, 0.1)">
                <SliderFilledTrack />
              </SliderTrack>
              <SliderThumb boxShadow="0 0 10px rgba(20, 184, 166, 0.6)" />
            </Slider>
            <HStack justify="space-between" mt={1}>
              <Text fontSize="xs" color="gray.400">100% User</Text>
              <Text fontSize="xs" color="gray.400">50/50</Text>
              <Text fontSize="xs" color="gray.400">100% AI</Text>
            </HStack>
          </Box>
        )}
      </VStack>
    </Box>
  );
};
