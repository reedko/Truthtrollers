// src/pages/KnowGraphPage.tsx
// Phase 2: Page layout with side panels and unified header
import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardBody,
  Grid,
  VStack,
  HStack,
  Heading,
  Text,
  Badge,
  Spinner,
  Center,
  useColorMode,
  Divider,
} from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTaskStore, ViewScope } from '../store/useTaskStore';
import { ViewerScopeBadge } from '../components/ViewerScopeBadge';
import { VerimeterModeToggle } from '../components/VerimeterModeToggle';
import UnifiedHeader from '../components/UnifiedHeader';
import StickyTitleBar from '../components/StickyTitleBar';
import CytoscapeKnowGraph from '../components/CytoscapeKnowGraph';
import { fetchNewGraphDataFromLegacyRoute } from '../services/api';
import { GraphNode, Link } from '../../../shared/entities/types';

const KnowGraphPage = () => {
  const { colorMode } = useColorMode();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: Link[] }>({
    nodes: [],
    links: [],
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);

  // Read URL params on mount
  useEffect(() => {
    const viewerParam = searchParams.get('viewer');
    const scopeParam = searchParams.get('scope') as ViewScope | null;

    if (viewerParam) {
      const viewerNum = viewerParam === 'null' ? null : parseInt(viewerParam, 10);
      if (!isNaN(viewerNum as number) || viewerNum === null) {
        setViewingUserId(viewerNum);
      }
    }

    if (scopeParam && (scopeParam === 'user' || scopeParam === 'all' || scopeParam === 'admin')) {
      setViewScope(scopeParam);
    }
  }, [searchParams, setViewingUserId, setViewScope]);

  // Set redirect
  useEffect(() => {
    setRedirect('/knowgraph');
  }, [setRedirect]);

  // Load graph data
  useEffect(() => {
    const loadGraph = async () => {
      if (!selectedTask) {
        console.warn('❌ No selected task');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Create a GraphNode from the selected task
        const taskNode = new GraphNode(
          `task-${selectedTask.content_id}`,
          selectedTask.content_name || 'Case',
          'task',
          0,
          0,
          undefined,
          selectedTask.content_id
        );
        const result = await fetchNewGraphDataFromLegacyRoute(taskNode);
        setGraphData(result);
      } catch (err) {
        console.error('🔥 Error loading graph data:', err);
      } finally {
        setLoading(false);
      }
    };

    if (!selectedTask) {
      console.warn('❌ No selected task — redirecting to /tasks');
      navigate('/tasks', { state: { redirectTo: '/knowgraph' } });
      return;
    }

    loadGraph();
  }, [selectedTask, navigate]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  // Calculate metrics
  const metrics = React.useMemo(() => {
    const caseClaims = graphData.nodes.filter(n => n.type === 'taskClaim').length;
    const sourceClaims = graphData.nodes.filter(n => n.type === 'refClaim').length;
    const sources = graphData.nodes.filter(n => n.type === 'reference').length;
    const authors = graphData.nodes.filter(n => n.type === 'author').length;
    const publishers = graphData.nodes.filter(n => n.type === 'publisher').length;

    const supportLinks = graphData.links.filter(l =>
      l.relation?.toLowerCase().includes('support') || l.type?.toLowerCase().includes('support')
    ).length;
    const refuteLinks = graphData.links.filter(l =>
      l.relation?.toLowerCase().includes('refute') || l.type?.toLowerCase().includes('refute')
    ).length;
    const nuanceLinks = graphData.links.filter(l =>
      l.relation?.toLowerCase().includes('related')
    ).length;

    return {
      caseClaims,
      sourceClaims,
      sources,
      authors,
      publishers,
      supportLinks,
      refuteLinks,
      nuanceLinks,
      totalNodes: graphData.nodes.length,
      totalEdges: graphData.links.length,
    };
  }, [graphData]);

  if (loading) {
    return (
      <Center h="80vh">
        <Spinner size="xl" color="teal.400" />
      </Center>
    );
  }

  return (
    <Box
      minH="100vh"
      bg={
        colorMode === 'dark'
          ? `radial-gradient(circle at 18% 18%, rgba(111, 140, 255, 0.22), transparent 24%),
             radial-gradient(circle at 80% 22%, rgba(88, 214, 255, 0.14), transparent 22%),
             radial-gradient(circle at 50% 100%, rgba(143, 124, 255, 0.18), transparent 28%),
             linear-gradient(180deg, #040812, #081120 55%, #02050a 100%)`
          : 'gray.50'
      }
      p={4}
    >
      {/* Sticky Title Bar */}
      <StickyTitleBar alwaysVisible={true} />

      {/* Unified Header */}
      <Card mb={2} mt={2}>
        <CardBody>
          <UnifiedHeader
            pivotType="task"
            pivotId={selectedTask?.content_id}
          />
        </CardBody>
      </Card>

      {/* Control Bar */}
      <Box
        mb={4}
        display="flex"
        gap={4}
        alignItems="center"
        justifyContent="space-between"
        p={4}
        borderRadius="12px"
        bg={
          colorMode === 'dark'
            ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))'
            : 'linear-gradient(135deg, rgba(100, 116, 139, 0.25) 0%, rgba(148, 163, 184, 0.3) 50%, rgba(71, 85, 105, 0.25) 100%)'
        }
        backdropFilter="blur(20px)"
        border="1px solid"
        borderColor={colorMode === 'dark' ? 'rgba(0, 162, 255, 0.4)' : 'rgba(71, 85, 105, 0.4)'}
        boxShadow={
          colorMode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
            : '0 4px 16px rgba(71, 85, 105, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.4)'
        }
      >
        <Box
          bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.50'}
          px={3}
          py={2}
          borderRadius="md"
          backdropFilter="blur(8px)"
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.200'}
        >
          <Heading size="md">Knowledge Graph</Heading>
        </Box>

        <VerimeterModeToggle compact />
        <ViewerScopeBadge />
      </Box>

      {/* Main layout - full width graph with floating panels */}
      <Box
        height="calc(100vh - 300px)"
        minH="900px"
        position="relative"
      >
        {/* Center: Graph - Full Width */}
        <Card
          bg={
            colorMode === 'dark'
              ? 'linear-gradient(180deg, rgba(12, 20, 34, 0.9), rgba(7, 12, 22, 0.96))'
              : 'white'
          }
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
          borderRadius="24px"
          boxShadow={
            colorMode === 'dark'
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 60px rgba(0, 0, 0, 0.45)'
              : 'md'
          }
          overflow="hidden"
          position="relative"
          h="100%"
        >
          <CardBody p={0} h="100%">
            {/* Floating title */}
            <Box
              position="absolute"
              top={4}
              left={4}
              zIndex={3}
              bg="rgba(8, 14, 24, 0.74)"
              border="1px solid rgba(255, 255, 255, 0.07)"
              borderRadius="16px"
              p={3}
              backdropFilter="blur(8px)"
              boxShadow="0 0 0 1px rgba(255, 255, 255, 0.08), 0 0 18px rgba(120, 160, 255, 0.18)"
            >
              <Heading size="sm" color="cyan.300">
                Case-centric Investigation Graph
              </Heading>
              <Text fontSize="xs" color="gray.400" mt={1}>
                Case claims fan into source claims, which roll up into sources
              </Text>
            </Box>

            {/* Empty state or graph */}
            {graphData.nodes.length === 0 ? (
              <Center h="full">
                <VStack spacing={4}>
                  <Text fontSize="lg" color="gray.400">
                    No graph data available
                  </Text>
                  <Text fontSize="sm" color="gray.500">
                    Selected Task: {selectedTask?.content_name || 'None'}
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    Check the browser console for debugging info
                  </Text>
                </VStack>
              </Center>
            ) : (
              <CytoscapeKnowGraph
                nodes={graphData.nodes}
                links={graphData.links}
                centerNodeId={selectedNode?.id}
                onNodeClick={handleNodeClick}
                currentUserId={viewerId}
              />
            )}

            {/* Footer note */}
            <Box
              position="absolute"
              bottom={4}
              right={4}
              zIndex={3}
              maxW="360px"
              p={3}
              borderRadius="16px"
              bg="rgba(9, 15, 26, 0.76)"
              border="1px solid rgba(255, 255, 255, 0.07)"
              backdropFilter="blur(8px)"
            >
              <Text fontSize="xs" color="gray.400" lineHeight={1.45}>
                A semantic network with typed entities, typed relationships, and enough ontology to
                make graph people squint and say, "yeah, that's a graph."
              </Text>
            </Box>
          </CardBody>
        </Card>

        {/* Floating Legend - Top Left */}
        <Box
          position="absolute"
          top={4}
          left={4}
          zIndex={10}
          bg="rgba(8, 14, 24, 0.85)"
          border="1px solid rgba(255, 255, 255, 0.1)"
          borderRadius="16px"
          p={3}
          backdropFilter="blur(12px)"
          boxShadow="0 4px 20px rgba(0, 0, 0, 0.3)"
          maxW="240px"
        >
          <Text fontSize="xs" color="cyan.300" fontWeight={600} mb={2}>
            Ontology Sketch
          </Text>
          <VStack align="stretch" spacing={1}>
            <LegendItem color="#6ea8ff" label="Case" />
            <LegendItem color="#8f7cff" label="Case Claim" />
            <LegendItem color="#58d6ff" label="Source Claim" />
            <LegendItem color="#63f0b0" label="Source" />
            <LegendItem color="#ff8fb7" label="Author" />
            <LegendItem color="#ffbf69" label="Publisher" />
            <EdgeLegendItem color="#62f0a8" label="supports" />
            <EdgeLegendItem color="#ff7a7a" label="refutes" />
            <EdgeLegendItem color="#66a3ff" label="related" />
          </VStack>
        </Box>

        {/* Floating Metrics - Top Right */}
        <Box
          position="absolute"
          top={4}
          right={4}
          zIndex={10}
          bg="rgba(8, 14, 24, 0.85)"
          border="1px solid rgba(255, 255, 255, 0.1)"
          borderRadius="16px"
          p={3}
          backdropFilter="blur(12px)"
          boxShadow="0 4px 20px rgba(0, 0, 0, 0.3)"
          minW="180px"
        >
          <Text fontSize="xs" color="cyan.300" fontWeight={600} mb={2}>
            Graph Metrics
          </Text>
          <VStack align="stretch" spacing={1}>
            <MetricRow label="Case claims" value={metrics.caseClaims} />
            <MetricRow label="Source claims" value={metrics.sourceClaims} />
            <MetricRow label="Sources" value={metrics.sources} />
            <MetricRow label="Support links" value={metrics.supportLinks} color="green.400" />
            <MetricRow label="Refute links" value={metrics.refuteLinks} color="red.400" />
          </VStack>
        </Box>
      </Box>
    </Box>
  );
};

// Left Panel Component
const LeftPanel = ({ metrics, colorMode }: any) => (
  <Card
    bg={
      colorMode === 'dark'
        ? 'linear-gradient(180deg, rgba(12, 20, 34, 0.9), rgba(7, 12, 22, 0.96))'
        : 'white'
    }
    border="1px solid"
    borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
    borderRadius="24px"
    boxShadow={
      colorMode === 'dark'
        ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 60px rgba(0, 0, 0, 0.45)'
        : 'md'
    }
    overflow="auto"
  >
    <CardBody p={4}>
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text
            fontSize="xs"
            letterSpacing="wider"
            textTransform="uppercase"
            color="cyan.300"
            mb={2}
          >
            TruthTrollers • Semantic Network
          </Text>
          <Heading size="lg" mb={2}>
            Knowledge Graph
          </Heading>
          <Text fontSize="sm" color="gray.400">
            Not just claims and references floating around like confetti. A real graph with typed
            nodes, typed edges, and enough ontology to make sense of the chaos.
          </Text>
        </Box>

        <HStack spacing={2} flexWrap="wrap">
          <Badge colorScheme="purple" fontSize="xs">
            Nodes: Case, Claim, Source
          </Badge>
          <Badge colorScheme="blue" fontSize="xs">
            Metadata: Author, Publisher
          </Badge>
          <Badge colorScheme="green" fontSize="xs">
            Edges: supports, refutes, nuances
          </Badge>
        </HStack>

        <Divider borderColor="whiteAlpha.200" />

        <Box>
          <Text
            fontSize="xs"
            letterSpacing="wider"
            textTransform="uppercase"
            color="cyan.300"
            mb={3}
          >
            Why This Reads as a Knowledge Graph
          </Text>

          <VStack align="stretch" spacing={3}>
            <InfoCard
              title="Typed Things"
              description="Different shapes and colors signal that a case is not a claim, a claim is not a source claim, and a source is not just another box."
            />
            <InfoCard
              title="Typed Relationships"
              description="Support, refute, nuance, authorship, and publication are visually distinct. The edges carry semantics, not just adjacency."
            />
            <InfoCard
              title="Hub Structure"
              description="One source can emit many source claims. One case can contain many claims. Evaluation becomes a graph-derived state."
            />
          </VStack>
        </Box>
      </VStack>
    </CardBody>
  </Card>
);

// Right Panel Component
const RightPanel = ({ metrics, selectedNode, colorMode }: any) => (
  <Card
    bg={
      colorMode === 'dark'
        ? 'linear-gradient(180deg, rgba(12, 20, 34, 0.9), rgba(7, 12, 22, 0.96))'
        : 'white'
    }
    border="1px solid"
    borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
    borderRadius="24px"
    boxShadow={
      colorMode === 'dark'
        ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 60px rgba(0, 0, 0, 0.45)'
        : 'md'
    }
    overflow="auto"
  >
    <CardBody p={4}>
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text
            fontSize="xs"
            letterSpacing="wider"
            textTransform="uppercase"
            color="cyan.300"
            mb={3}
          >
            Ontology Sketch
          </Text>

          <Grid templateColumns="1fr 1fr" gap={2}>
            <LegendItem color="#6ea8ff" label="Case" />
            <LegendItem color="#8f7cff" label="Case Claim" />
            <LegendItem color="#58d6ff" label="Source Claim" />
            <LegendItem color="#63f0b0" label="Source" />
            <LegendItem color="#ff8fb7" label="Author" />
            <LegendItem color="#ffbf69" label="Publisher" />
          </Grid>

          <Box mt={3}>
            <EdgeLegendItem color="#62f0a8" label="supports" />
            <EdgeLegendItem color="#ff7a7a" label="refutes" />
            <EdgeLegendItem color="#66a3ff" label="nuances" />
            <EdgeLegendItem color="rgba(172, 189, 220, 0.4)" label="metadata" dashed />
          </Box>
        </Box>

        <Divider borderColor="whiteAlpha.200" />

        <Box>
          <Text
            fontSize="xs"
            letterSpacing="wider"
            textTransform="uppercase"
            color="cyan.300"
            mb={3}
          >
            Graph Metrics
          </Text>

          <VStack align="stretch" spacing={2}>
            <MetricRow label="Case claims" value={metrics.caseClaims} />
            <MetricRow label="Source claims" value={metrics.sourceClaims} />
            <MetricRow label="Sources" value={metrics.sources} />
            <MetricRow label="Authors" value={metrics.authors} />
            <MetricRow label="Publishers" value={metrics.publishers} />
            <Divider borderColor="whiteAlpha.100" />
            <MetricRow label="Support links" value={metrics.supportLinks} color="green.400" />
            <MetricRow label="Refute links" value={metrics.refuteLinks} color="red.400" />
            <MetricRow label="Nuance links" value={metrics.nuanceLinks} color="blue.400" />
            <Divider borderColor="whiteAlpha.100" />
            <MetricRow label="Total nodes" value={metrics.totalNodes} />
            <MetricRow label="Total edges" value={metrics.totalEdges} />
          </VStack>
        </Box>

        {selectedNode && (
          <>
            <Divider borderColor="whiteAlpha.200" />
            <Box>
              <Text
                fontSize="xs"
                letterSpacing="wider"
                textTransform="uppercase"
                color="cyan.300"
                mb={2}
              >
                Selected Node
              </Text>
              <Box
                p={3}
                bg="rgba(19, 30, 50, 0.6)"
                borderRadius="lg"
                border="1px solid rgba(120, 170, 255, 0.12)"
              >
                <Text fontSize="sm" fontWeight="bold" color="cyan.200" mb={1}>
                  {selectedNode.type}
                </Text>
                <Text fontSize="xs" color="gray.300">
                  {selectedNode.label}
                </Text>
              </Box>
            </Box>
          </>
        )}
      </VStack>
    </CardBody>
  </Card>
);

// Helper Components
const InfoCard = ({ title, description }: { title: string; description: string }) => (
  <Box
    p={3}
    bg="rgba(19, 30, 50, 0.88)"
    borderRadius="lg"
    border="1px solid rgba(120, 170, 255, 0.12)"
  >
    <Heading size="xs" color="cyan.200" mb={1}>
      {title}
    </Heading>
    <Text fontSize="xs" color="gray.400" lineHeight={1.45}>
      {description}
    </Text>
  </Box>
);

const LegendItem = ({ color, label }: { color: string; label: string }) => (
  <HStack spacing={2}>
    <Box w="11px" h="11px" borderRadius="full" bg={color} boxShadow={`0 0 10px ${color}44`} />
    <Text fontSize="xs" color="gray.300">
      {label}
    </Text>
  </HStack>
);

const EdgeLegendItem = ({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) => (
  <HStack spacing={2} mt={1}>
    <Box
      w="22px"
      h="0"
      borderTop={`3px ${dashed ? 'dashed' : 'solid'} ${color}`}
      borderRadius="full"
    />
    <Text fontSize="xs" color="gray.300">
      {label}
    </Text>
  </HStack>
);

const MetricRow = ({
  label,
  value,
  color = 'gray.300',
}: {
  label: string;
  value: number | string;
  color?: string;
}) => (
  <HStack justify="space-between" py={1} borderBottom="1px solid rgba(255, 255, 255, 0.05)">
    <Text fontSize="xs" color="gray.400">
      {label}
    </Text>
    <Text fontSize="xs" color={color} fontWeight="medium">
      {value}
    </Text>
  </HStack>
);

export default KnowGraphPage;
