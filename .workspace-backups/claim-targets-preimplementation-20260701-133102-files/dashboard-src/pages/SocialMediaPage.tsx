/**
 * Social Media Discussion Units - Demo Page
 *
 * Test page for the social media posting feature
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Select,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Badge,
  Divider,
  useColorModeValue,
  Card,
  CardHeader,
  CardBody,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Code,
} from '@chakra-ui/react';
import { FiTwitter, FiRefreshCw } from 'react-icons/fi';
import SocialMediaComposer from '../components/SocialMediaComposer';

const SocialMediaPage: React.FC = () => {
  const [contentId, setContentId] = useState<number | null>(null);
  const [contentList, setContentList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [xAuthStatus, setXAuthStatus] = useState<any>(null);

  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');

  // Load content list on mount
  useEffect(() => {
    loadContent();
    checkXAuthStatus();
  }, []);

  const loadContent = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/content?limit=20', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();
      setContentList(data.results || []);
    } catch (error) {
      console.error('Failed to load content:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkXAuthStatus = async () => {
    try {
      const response = await fetch('/api/x-auth/status', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();
      setXAuthStatus(data);
    } catch (error) {
      console.error('Failed to check X auth status:', error);
    }
  };

  const selectedContent = contentList.find(c => c.content_id === contentId);

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Header */}
        <Box>
          <HStack spacing={4} mb={2}>
            <FiTwitter size={40} color="#1DA1F2" />
            <Heading size="xl">Social Media Discussion Units</Heading>
          </HStack>
          <Text color="gray.600" fontSize="lg">
            Convert fact-checked content into tweet-friendly discussion threads
          </Text>
        </Box>

        {/* Feature Overview */}
        <Alert status="info" borderRadius="md">
          <AlertIcon />
          <Box>
            <AlertTitle>What is this?</AlertTitle>
            <AlertDescription>
              This feature uses AI to convert TruthTrollers analysis into structured,
              evidence-based discussion units that can be posted to X/Twitter as threaded
              replies. Each unit includes claims, supporting evidence, counter evidence,
              and summaries with source citations.
            </AlertDescription>
          </Box>
        </Alert>

        {/* X Auth Status */}
        <Card>
          <CardHeader>
            <Heading size="md">X/Twitter Connection Status</Heading>
          </CardHeader>
          <CardBody>
            {xAuthStatus ? (
              xAuthStatus.connected ? (
                <HStack>
                  <Badge colorScheme="green" fontSize="md" p={2}>
                    ✓ Connected as @{xAuthStatus.x_username}
                  </Badge>
                  {xAuthStatus.needs_refresh && (
                    <Badge colorScheme="yellow">Token needs refresh</Badge>
                  )}
                </HStack>
              ) : (
                <VStack align="stretch" spacing={3}>
                  <Alert status="warning">
                    <AlertIcon />
                    Not connected to X/Twitter
                  </Alert>
                  <Button
                    leftIcon={<FiTwitter />}
                    colorScheme="twitter"
                    onClick={() => {
                      window.location.href = '/api/x-auth/connect';
                    }}
                  >
                    Connect X Account
                  </Button>
                  <Text fontSize="sm" color="gray.600">
                    You'll be redirected to X to authorize TruthTrollers
                  </Text>
                </VStack>
              )
            ) : (
              <Text>Loading...</Text>
            )}
          </CardBody>
        </Card>

        {/* Content Selection */}
        <Card>
          <CardHeader>
            <Heading size="md">Select Content to Analyze</Heading>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              <Select
                placeholder="Select content with claims..."
                value={contentId || ''}
                onChange={(e) => setContentId(Number(e.target.value))}
                size="lg"
              >
                {contentList.map((content) => (
                  <option key={content.content_id} value={content.content_id}>
                    {content.content_name}
                  </option>
                ))}
              </Select>

              {selectedContent && (
                <Box p={4} borderWidth="1px" borderRadius="md">
                  <VStack align="start" spacing={2}>
                    <Text fontWeight="bold">{selectedContent.content_name}</Text>
                    <Text fontSize="sm" color="gray.600">
                      Source: {selectedContent.media_source || 'Unknown'}
                    </Text>
                    {selectedContent.url && (
                      <Code fontSize="xs">{selectedContent.url}</Code>
                    )}
                  </VStack>
                </Box>
              )}

              <Button
                leftIcon={<FiTwitter />}
                colorScheme="twitter"
                size="lg"
                onClick={() => setShowComposer(true)}
                isDisabled={!contentId}
              >
                Generate Discussion Units
              </Button>
            </VStack>
          </CardBody>
        </Card>

        {/* Show Composer */}
        {showComposer && selectedContent && (
          <Card>
            <CardHeader>
              <HStack justify="space-between">
                <Heading size="md">Discussion Composer</Heading>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowComposer(false)}
                >
                  Close
                </Button>
              </HStack>
            </CardHeader>
            <CardBody>
              <SocialMediaComposer
                contentId={contentId!}
                contentName={selectedContent.content_name}
                originalUrl={selectedContent.url}
              />
            </CardBody>
          </Card>
        )}

        {/* Feature Stats */}
        <Card>
          <CardHeader>
            <Heading size="md">How It Works</Heading>
          </CardHeader>
          <CardBody>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
              <Stat>
                <StatLabel>Step 1</StatLabel>
                <StatNumber fontSize="md">Extract Claims</StatNumber>
                <StatHelpText>AI identifies factual claims</StatHelpText>
              </Stat>
              <Stat>
                <StatLabel>Step 2</StatLabel>
                <StatNumber fontSize="md">Find Evidence</StatNumber>
                <StatHelpText>Search for supporting/refuting sources</StatHelpText>
              </Stat>
              <Stat>
                <StatLabel>Step 3</StatLabel>
                <StatNumber fontSize="md">Generate Units</StatNumber>
                <StatHelpText>Create tweet-friendly text (≤280 chars)</StatHelpText>
              </Stat>
              <Stat>
                <StatLabel>Step 4</StatLabel>
                <StatNumber fontSize="md">Post Thread</StatNumber>
                <StatHelpText>User reviews & posts to X</StatHelpText>
              </Stat>
            </SimpleGrid>
          </CardBody>
        </Card>

        {/* Safety Features */}
        <Card>
          <CardHeader>
            <Heading size="md">Safety & Anti-Spam Features</Heading>
          </CardHeader>
          <CardBody>
            <VStack align="start" spacing={2}>
              <HStack>
                <Badge colorScheme="green">✓</Badge>
                <Text>Manual approval required for each post</Text>
              </HStack>
              <HStack>
                <Badge colorScheme="green">✓</Badge>
                <Text>Rate limited: Max 10 posts/hour</Text>
              </HStack>
              <HStack>
                <Badge colorScheme="green">✓</Badge>
                <Text>All evidence cited with sources</Text>
              </HStack>
              <HStack>
                <Badge colorScheme="green">✓</Badge>
                <Text>User can edit any text before posting</Text>
              </HStack>
              <HStack>
                <Badge colorScheme="green">✓</Badge>
                <Text>Max 5 units per bundle to avoid spam</Text>
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        <Divider />

        {/* Documentation Links */}
        <Box>
          <Heading size="sm" mb={4}>
            Documentation
          </Heading>
          <VStack align="start" spacing={2}>
            <Text>
              📄 <strong>SOCIAL_MEDIA_DISCUSSION_FEATURE.md</strong> - Complete technical guide
            </Text>
            <Text>
              📄 <strong>VERIMETER_INTEGRATION_GUIDE.md</strong> - Reputation system integration
            </Text>
            <Text>
              📄 <strong>DEPLOYMENT_CHECKLIST.md</strong> - Pre-launch checklist
            </Text>
          </VStack>
        </Box>
      </VStack>
    </Container>
  );
};

export default SocialMediaPage;
