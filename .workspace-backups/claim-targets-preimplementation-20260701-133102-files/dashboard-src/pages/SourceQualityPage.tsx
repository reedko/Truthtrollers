import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Text,
  Badge,
  Progress,
  Spinner,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Button,
  Divider,
  Grid,
  GridItem,
  useToast,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Card,
  CardHeader,
  CardBody,
  Flex,
} from '@chakra-ui/react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';

interface QualityScores {
  content_id: number;
  author_transparency: number | null;
  publisher_transparency: number | null;
  evidence_density: number | null;
  claim_specificity: number | null;
  correction_behavior: number | null;
  domain_reputation: number | null;
  sensationalism_score: number | null;
  monetization_pressure: number | null;
  original_reporting: number | null;
  quality_score: number | null;
  risk_score: number | null;
  quality_tier: 'high' | 'mid' | 'low' | 'unreliable' | null;
  scored_at: string | null;
  scoring_model: string | null;
  // Metadata
  content_name: string | null;
  url: string | null;
  media_source: string | null;
  author_name: string | null;
  author_credentials: string | null;
  citation_count: number | null;
}

const SourceQualityPage: React.FC = () => {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [scores, setScores] = useState<QualityScores | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (contentId) {
      fetchQualityScores();
    }
  }, [contentId]);

  const fetchQualityScores = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/api/claims/quality-scores/${contentId}`);
      setScores(response.data);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError('No quality scores found. Click "Run Quality Analysis" to generate scores.');
      } else {
        setError(err.response?.data?.error || 'Failed to fetch quality scores');
      }
    } finally {
      setLoading(false);
    }
  };

  const runQualityAnalysis = async () => {
    try {
      setRunning(true);
      const response = await api.post(`/api/claims/run-quality-analysis/${contentId}`);

      toast({
        title: 'Quality Analysis Complete',
        description: `Source quality: ${response.data.scores?.quality_tier || 'unknown'} (${response.data.scores?.quality_score || 0}/10)`,
        status: 'success',
        duration: 3000,
      });

      // Refresh scores
      await fetchQualityScores();
    } catch (err: any) {
      toast({
        title: 'Analysis Failed',
        description: err.response?.data?.error || err.response?.data?.hint || 'Failed to run quality analysis',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setRunning(false);
    }
  };

  const getQualityColor = (tier: string | null) => {
    switch (tier) {
      case 'high': return 'green';
      case 'mid': return 'blue';
      case 'low': return 'yellow';
      case 'unreliable': return 'red';
      default: return 'gray';
    }
  };

  const getRiskColor = (score: number | null) => {
    if (!score) return 'gray';
    if (score < 3) return 'green';
    if (score < 5) return 'yellow';
    if (score < 7) return 'orange';
    return 'red';
  };

  const ScoreBar: React.FC<{ label: string; value: number | null; max?: number; isRisk?: boolean }> = ({
    label,
    value,
    max = 10,
    isRisk = false,
  }) => {
    if (value === null) return null;

    const percentage = (value / max) * 100;
    let colorScheme = 'green';

    if (isRisk) {
      // Risk: higher is worse
      if (value >= 7) colorScheme = 'red';
      else if (value >= 5) colorScheme = 'orange';
      else if (value >= 3) colorScheme = 'yellow';
    } else {
      // Quality: higher is better
      if (value >= 7) colorScheme = 'green';
      else if (value >= 5) colorScheme = 'blue';
      else if (value >= 3) colorScheme = 'yellow';
      else colorScheme = 'red';
    }

    return (
      <Box>
        <Flex justify="space-between" mb={1}>
          <Text fontSize="sm" fontWeight="medium">{label}</Text>
          <Text fontSize="sm" fontWeight="bold">{value.toFixed(1)}/10</Text>
        </Flex>
        <Progress
          value={percentage}
          colorScheme={colorScheme}
          size="sm"
          borderRadius="md"
        />
      </Box>
    );
  };

  if (loading) {
    return (
      <Container maxW="container.xl" py={8}>
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" />
          <Text>Loading quality scores...</Text>
        </VStack>
      </Container>
    );
  }

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={6} align="stretch">
        {/* Header */}
        <HStack justify="space-between">
          <Heading size="lg">Source Quality Analysis</Heading>
          <HStack>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(-1)}
            >
              Back
            </Button>
            <Button
              size="sm"
              colorScheme="blue"
              onClick={runQualityAnalysis}
              isLoading={running}
              loadingText="Running..."
            >
              {scores ? 'Re-run Analysis' : 'Run Quality Analysis'}
            </Button>
          </HStack>
        </HStack>

        {/* Error Alert */}
        {error && (
          <Alert status="warning" borderRadius="md">
            <AlertIcon />
            <Box flex="1">
              <AlertTitle>No Scores Available</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Box>
          </Alert>
        )}

        {/* Quality Scores Display */}
        {scores && (
          <>
            {/* Content Metadata */}
            <Card>
              <CardHeader>
                <Heading size="md">{scores.content_name || 'Unknown Content'}</Heading>
              </CardHeader>
              <CardBody>
                <VStack align="stretch" spacing={2}>
                  {scores.author_name && (
                    <HStack>
                      <Text fontWeight="bold" minW="120px">Author:</Text>
                      <Text>
                        {scores.author_name}
                        {scores.author_credentials && ` (${scores.author_credentials})`}
                      </Text>
                    </HStack>
                  )}
                  {scores.media_source && (
                    <HStack>
                      <Text fontWeight="bold" minW="120px">Publisher:</Text>
                      <Text>{scores.media_source}</Text>
                    </HStack>
                  )}
                  {scores.citation_count !== null && scores.citation_count !== undefined && (
                    <HStack>
                      <Text fontWeight="bold" minW="120px">Citations Found:</Text>
                      <Badge colorScheme={scores.citation_count >= 10 ? 'green' : scores.citation_count >= 5 ? 'blue' : 'yellow'}>
                        {scores.citation_count} citations
                      </Badge>
                    </HStack>
                  )}
                  {scores.url && (
                    <HStack>
                      <Text fontWeight="bold" minW="120px">URL:</Text>
                      <Text fontSize="sm" color="blue.500" isTruncated>
                        <a href={scores.url} target="_blank" rel="noopener noreferrer">
                          {scores.url}
                        </a>
                      </Text>
                    </HStack>
                  )}
                </VStack>
              </CardBody>
            </Card>

            {/* Overall Scores */}
            <Grid templateColumns="repeat(3, 1fr)" gap={6}>
              <GridItem>
                <Card>
                  <CardHeader pb={2}>
                    <Text fontSize="sm" color="gray.500">Overall Quality</Text>
                  </CardHeader>
                  <CardBody pt={0}>
                    <Stat>
                      <StatNumber fontSize="4xl">
                        {scores.quality_score?.toFixed(1) || 'N/A'}
                        <Text as="span" fontSize="xl" color="gray.500">/10</Text>
                      </StatNumber>
                      <StatHelpText>
                        <Badge colorScheme={getQualityColor(scores.quality_tier)} fontSize="md">
                          {scores.quality_tier?.toUpperCase() || 'UNKNOWN'}
                        </Badge>
                      </StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
              </GridItem>

              <GridItem>
                <Card>
                  <CardHeader pb={2}>
                    <Text fontSize="sm" color="gray.500">Risk Score</Text>
                  </CardHeader>
                  <CardBody pt={0}>
                    <Stat>
                      <StatNumber fontSize="4xl">
                        {scores.risk_score?.toFixed(1) || 'N/A'}
                        <Text as="span" fontSize="xl" color="gray.500">/10</Text>
                      </StatNumber>
                      <StatHelpText>
                        <Badge colorScheme={getRiskColor(scores.risk_score)} fontSize="md">
                          {scores.risk_score && scores.risk_score < 3 ? 'LOW' :
                           scores.risk_score && scores.risk_score < 5 ? 'MEDIUM' :
                           scores.risk_score && scores.risk_score < 7 ? 'HIGH' : 'CRITICAL'}
                        </Badge>
                      </StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
              </GridItem>

              <GridItem>
                <Card>
                  <CardHeader pb={2}>
                    <Text fontSize="sm" color="gray.500">Last Scored</Text>
                  </CardHeader>
                  <CardBody pt={0}>
                    <Stat>
                      <StatNumber fontSize="lg">
                        {scores.scored_at
                          ? new Date(scores.scored_at).toLocaleDateString()
                          : 'Never'}
                      </StatNumber>
                      <StatHelpText>
                        {scores.scoring_model || 'AI-based scoring'}
                      </StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>

            <Divider />

            {/* Quality Dimensions */}
            <Card>
              <CardHeader>
                <Heading size="md">Quality Dimensions</Heading>
                <Text fontSize="sm" color="gray.500">Higher scores indicate better quality (0-10 scale)</Text>
              </CardHeader>
              <CardBody>
                <VStack spacing={4} align="stretch">
                  <ScoreBar label="Author Transparency" value={scores.author_transparency} />
                  <ScoreBar label="Publisher Transparency" value={scores.publisher_transparency} />
                  <ScoreBar label="Evidence Density" value={scores.evidence_density} />
                  <ScoreBar label="Claim Specificity" value={scores.claim_specificity} />
                  <ScoreBar label="Correction Behavior" value={scores.correction_behavior} />
                  <ScoreBar label="Domain Reputation" value={scores.domain_reputation} />
                  <ScoreBar label="Original Reporting" value={scores.original_reporting} />
                </VStack>
              </CardBody>
            </Card>

            {/* Risk Dimensions */}
            <Card>
              <CardHeader>
                <Heading size="md">Risk Indicators</Heading>
                <Text fontSize="sm" color="gray.500">Higher scores indicate higher risk (0-10 scale)</Text>
              </CardHeader>
              <CardBody>
                <VStack spacing={4} align="stretch">
                  <ScoreBar label="Sensationalism Score" value={scores.sensationalism_score} isRisk />
                  <ScoreBar label="Monetization Pressure" value={scores.monetization_pressure} isRisk />
                </VStack>
              </CardBody>
            </Card>

            {/* Explanation */}
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <Box>
                <AlertTitle>About These Scores</AlertTitle>
                <AlertDescription>
                  Quality scores are calculated using AI analysis of the source content across 9 dimensions.
                  Scores range from 0-10, with higher quality scores being better and higher risk scores being worse.
                  These scores help identify credible sources and flag potential misinformation.
                </AlertDescription>
              </Box>
            </Alert>
          </>
        )}
      </VStack>
    </Container>
  );
};

export default SourceQualityPage;
