/**
 * Argument Validation Panel
 *
 * Real-time validation feedback with HUD-style gauges and indicators
 */

import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Progress,
  Badge,
  Icon,
  Flex,
  useColorModeValue,
  Collapse,
} from '@chakra-ui/react';
import { FiCheck, FiX, FiAlertCircle, FiLoader, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { ArgumentValidationResult } from '../../../../shared/entities/types';

interface Props {
  validation: ArgumentValidationResult | null;
  isValidating: boolean;
}

const ArgumentValidationPanel: React.FC<Props> = ({ validation, isValidating }) => {
  const hudBg = useColorModeValue('rgba(0, 20, 40, 0.7)', 'rgba(0, 10, 20, 0.9)');
  const glowColor = useColorModeValue('cyan.400', 'cyan.300');
  const textColor = useColorModeValue('cyan.50', 'cyan.100');
  const labelColor = useColorModeValue('cyan.300', 'cyan.200');

  if (isValidating) {
    return (
      <Box
        bg={hudBg}
        p={6}
        borderRadius="md"
        borderWidth="1px"
        borderColor="cyan.700"
        textAlign="center"
      >
        <VStack spacing={3}>
          <Icon as={FiLoader} boxSize={8} color="cyan.400" className="spin" />
          <Text color={labelColor} fontSize="sm">
            Analyzing argument...
          </Text>
        </VStack>
      </Box>
    );
  }

  if (!validation) {
    return (
      <Box
        bg={hudBg}
        p={6}
        borderRadius="md"
        borderWidth="1px"
        borderColor="cyan.700"
        textAlign="center"
      >
        <Text color="cyan.600" fontSize="sm">
          Start typing to see validation feedback
        </Text>
      </Box>
    );
  }

  return (
    <Box
      bg={hudBg}
      p={6}
      borderRadius="md"
      borderWidth="2px"
      borderColor={validation.can_approve ? 'green.400' : 'orange.400'}
      boxShadow={`0 0 15px ${validation.can_approve ? 'green' : 'orange'}40`}
    >
      <VStack spacing={5} align="stretch">
        {/* Header */}
        <Flex justify="space-between" align="center">
          <Text
            fontSize="md"
            fontWeight="bold"
            color={labelColor}
            textTransform="uppercase"
            letterSpacing="wider"
          >
            Validation Status
          </Text>
          {validation.can_approve ? (
            <Badge colorScheme="green" fontSize="sm">
              APPROVED
            </Badge>
          ) : (
            <Badge colorScheme="orange" fontSize="sm">
              NEEDS REVISION
            </Badge>
          )}
        </Flex>

        {/* Validation Checks */}
        <VStack spacing={3} align="stretch">
          {/* Civility Check */}
          <ValidationItem
            label="Civility"
            passed={validation.civility_passed}
            details={
              validation.civility_passed
                ? 'No offensive language detected'
                : `Flagged: ${validation.flagged_terms.join(', ')}`
            }
          />

          {/* Fallacy Check */}
          <FallacyValidationItem
            passed={validation.fallacy_check_passed}
            fallacies={validation.detected_fallacies}
          />

          {/* Citation Check */}
          <ValidationItem
            label="Evidence Support"
            passed={validation.min_citations_met}
            details={
              validation.min_citations_met
                ? `${validation.citation_count} relevant citation(s)`
                : 'Need at least 1 citation with relevance > 55%'
            }
          />
        </VStack>

        {/* AI Quality Scores */}
        <Box>
          <Text
            fontSize="sm"
            color={labelColor}
            mb={3}
            textTransform="uppercase"
            letterSpacing="wide"
          >
            Quality Metrics
          </Text>
          <VStack spacing={3} align="stretch">
            <QualityGauge
              label="Clarity"
              score={validation.clarity_score}
              color="blue"
            />
            <QualityGauge
              label="Logical Strength"
              score={validation.logical_strength_score}
              color="purple"
            />
            <QualityGauge
              label="Evidence Support"
              score={validation.evidence_support_score}
              color="green"
            />
          </VStack>
        </Box>

        {/* Overall Score */}
        <Box
          p={4}
          bg="rgba(0, 255, 255, 0.05)"
          borderRadius="md"
          borderWidth="1px"
          borderColor="cyan.600"
        >
          <Flex justify="space-between" align="center" mb={2}>
            <Text fontSize="sm" color={labelColor} fontWeight="bold">
              OVERALL QUALITY
            </Text>
            <Text fontSize="2xl" color={glowColor} fontWeight="bold">
              {Math.round(validation.overall_quality_score)}
            </Text>
          </Flex>
          <Progress
            value={validation.overall_quality_score}
            colorScheme={
              validation.overall_quality_score > 75
                ? 'green'
                : validation.overall_quality_score > 50
                  ? 'yellow'
                  : 'red'
            }
            height="8px"
            borderRadius="full"
            bg="rgba(0, 0, 0, 0.3)"
          />
        </Box>

        {/* Issues */}
        {validation.issues.length > 0 && (
          <Box>
            <Text
              fontSize="sm"
              color="orange.300"
              mb={2}
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Issues to Address
            </Text>
            <VStack spacing={2} align="stretch">
              {validation.issues.map((issue, index) => (
                <Flex
                  key={index}
                  align="center"
                  gap={2}
                  p={2}
                  bg="rgba(255, 165, 0, 0.1)"
                  borderRadius="md"
                  borderLeft="3px solid"
                  borderColor="orange.400"
                >
                  <Icon as={FiAlertCircle} color="orange.400" boxSize={4} />
                  <Text fontSize="xs" color={textColor}>
                    {issue}
                  </Text>
                </Flex>
              ))}
            </VStack>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

// Sub-component: Validation Item
const ValidationItem: React.FC<{
  label: string;
  passed: boolean;
  details: string;
}> = ({ label, passed, details }) => {
  const textColor = useColorModeValue('cyan.50', 'cyan.100');

  return (
    <Flex
      align="center"
      gap={3}
      p={3}
      bg={passed ? 'rgba(0, 255, 0, 0.05)' : 'rgba(255, 165, 0, 0.05)'}
      borderRadius="md"
      borderLeft="3px solid"
      borderColor={passed ? 'green.400' : 'orange.400'}
    >
      <Icon
        as={passed ? FiCheck : FiX}
        color={passed ? 'green.400' : 'orange.400'}
        boxSize={5}
      />
      <Box flex={1}>
        <Text fontSize="sm" fontWeight="bold" color={textColor}>
          {label}
        </Text>
        <Text fontSize="xs" color={passed ? 'green.200' : 'orange.200'}>
          {details}
        </Text>
      </Box>
    </Flex>
  );
};

// Sub-component: Fallacy Validation Item with expandable details
const FallacyValidationItem: React.FC<{
  passed: boolean;
  fallacies: Array<{
    type: string;
    name: string;
    description: string;
    excerpt: string;
  }>;
}> = ({ passed, fallacies }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const textColor = useColorModeValue('cyan.50', 'cyan.100');

  return (
    <Box>
      <Flex
        align="center"
        gap={3}
        p={3}
        bg={passed ? 'rgba(0, 255, 0, 0.05)' : 'rgba(255, 165, 0, 0.05)'}
        borderRadius="md"
        borderLeft="3px solid"
        borderColor={passed ? 'green.400' : 'orange.400'}
        cursor={!passed && fallacies.length > 0 ? 'pointer' : 'default'}
        onClick={() => !passed && fallacies.length > 0 && setIsExpanded(!isExpanded)}
      >
        <Icon
          as={passed ? FiCheck : FiX}
          color={passed ? 'green.400' : 'orange.400'}
          boxSize={5}
        />
        <Box flex={1}>
          <Text fontSize="sm" fontWeight="bold" color={textColor}>
            Logical Validity
          </Text>
          <Text fontSize="xs" color={passed ? 'green.200' : 'orange.200'}>
            {passed
              ? 'No logical fallacies detected'
              : `${fallacies.length} fallac${fallacies.length === 1 ? 'y' : 'ies'} detected`}
          </Text>
        </Box>
        {!passed && fallacies.length > 0 && (
          <Icon
            as={isExpanded ? FiChevronDown : FiChevronRight}
            color="orange.400"
            boxSize={4}
          />
        )}
      </Flex>

      {/* Expandable Fallacy Details */}
      {!passed && fallacies.length > 0 && (
        <Collapse in={isExpanded} animateOpacity>
          <VStack spacing={2} mt={2} align="stretch">
            {fallacies.map((fallacy, index) => (
              <Box
                key={index}
                p={3}
                bg="rgba(255, 165, 0, 0.1)"
                borderRadius="md"
                borderLeft="3px solid"
                borderColor="orange.500"
              >
                <VStack spacing={2} align="stretch">
                  <HStack>
                    <Badge colorScheme="orange" fontSize="xs">
                      {fallacy.type}
                    </Badge>
                    <Text fontSize="sm" fontWeight="bold" color={textColor}>
                      {fallacy.name}
                    </Text>
                  </HStack>
                  <Text fontSize="xs" color="orange.200">
                    {fallacy.description}
                  </Text>
                  {fallacy.excerpt && (
                    <Box
                      p={2}
                      bg="rgba(0, 0, 0, 0.2)"
                      borderRadius="sm"
                      borderLeft="2px solid"
                      borderColor="orange.400"
                    >
                      <Text fontSize="xs" color={textColor} fontStyle="italic">
                        "{fallacy.excerpt}"
                      </Text>
                    </Box>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        </Collapse>
      )}
    </Box>
  );
};

// Sub-component: Quality Gauge
const QualityGauge: React.FC<{
  label: string;
  score: number;
  color: string;
}> = ({ label, score, color }) => {
  const textColor = useColorModeValue('cyan.50', 'cyan.100');

  return (
    <Box>
      <Flex justify="space-between" mb={1}>
        <Text fontSize="xs" color={textColor}>
          {label}
        </Text>
        <Text fontSize="xs" color={textColor} fontWeight="bold">
          {Math.round(score)}
        </Text>
      </Flex>
      <Progress
        value={score}
        colorScheme={color}
        height="6px"
        borderRadius="full"
        bg="rgba(0, 0, 0, 0.3)"
        sx={{
          '& > div': {
            boxShadow: `0 0 8px ${color}`,
          },
        }}
      />
    </Box>
  );
};

export default ArgumentValidationPanel;
