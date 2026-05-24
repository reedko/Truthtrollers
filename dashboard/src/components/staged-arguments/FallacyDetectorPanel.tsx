/**
 * Fallacy Detector Panel
 *
 * Displays detected logical fallacies with Minority Report HUD styling
 */

import React from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Icon,
  Flex,
  Collapse,
  useDisclosure,
  useColorModeValue,
  IconButton,
} from '@chakra-ui/react';
import { FiAlertTriangle, FiChevronDown, FiChevronUp, FiInfo } from 'react-icons/fi';

interface Fallacy {
  type: string;
  name: string;
  description: string;
  excerpt?: string;
  confidence?: number;
}

interface Props {
  fallacies: Fallacy[];
}

const FallacyDetectorPanel: React.FC<Props> = ({ fallacies }) => {
  const hudBg = useColorModeValue('rgba(0, 20, 40, 0.7)', 'rgba(0, 10, 20, 0.9)');
  const textColor = useColorModeValue('cyan.50', 'cyan.100');
  const labelColor = useColorModeValue('cyan.300', 'cyan.200');

  if (fallacies.length === 0) {
    return null;
  }

  return (
    <Box
      bg={hudBg}
      p={4}
      borderRadius="md"
      borderWidth="2px"
      borderColor="orange.400"
      boxShadow="0 0 15px orange40"
    >
      <VStack spacing={3} align="stretch">
        {/* Header */}
        <Flex align="center" gap={2}>
          <Icon as={FiAlertTriangle} color="orange.400" boxSize={5} />
          <Text
            fontSize="md"
            fontWeight="bold"
            color={labelColor}
            textTransform="uppercase"
            letterSpacing="wider"
          >
            Logical Fallacies Detected
          </Text>
          <Badge colorScheme="orange" ml="auto">
            {fallacies.length}
          </Badge>
        </Flex>

        {/* Fallacy List */}
        <VStack spacing={2} align="stretch">
          {fallacies.map((fallacy, index) => (
            <FallacyItem key={index} fallacy={fallacy} />
          ))}
        </VStack>
      </VStack>
    </Box>
  );
};

const FallacyItem: React.FC<{ fallacy: Fallacy }> = ({ fallacy }) => {
  const { isOpen, onToggle } = useDisclosure();
  const textColor = useColorModeValue('cyan.50', 'cyan.100');

  return (
    <Box
      p={3}
      bg="rgba(255, 165, 0, 0.1)"
      borderRadius="md"
      borderLeft="3px solid"
      borderColor="orange.400"
    >
      <Flex justify="space-between" align="start">
        <Box flex={1}>
          <HStack spacing={2} mb={1}>
            <Text fontSize="sm" fontWeight="bold" color="orange.300">
              {fallacy.name}
            </Text>
            {fallacy.confidence && (
              <Badge colorScheme="orange" fontSize="xs">
                {fallacy.confidence}% confidence
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color={textColor}>
            {fallacy.description}
          </Text>

          {/* Collapsible Excerpt */}
          {fallacy.excerpt && (
            <>
              <IconButton
                aria-label="Toggle details"
                icon={isOpen ? <FiChevronUp /> : <FiChevronDown />}
                size="xs"
                variant="ghost"
                colorScheme="orange"
                onClick={onToggle}
                mt={2}
              />
              <Collapse in={isOpen} animateOpacity>
                <Box
                  mt={2}
                  p={2}
                  bg="rgba(0, 0, 0, 0.3)"
                  borderRadius="md"
                  borderLeft="2px solid"
                  borderColor="orange.600"
                >
                  <Text fontSize="xs" color="orange.200" fontStyle="italic">
                    "{fallacy.excerpt}"
                  </Text>
                </Box>
              </Collapse>
            </>
          )}
        </Box>
      </Flex>
    </Box>
  );
};

export default FallacyDetectorPanel;
