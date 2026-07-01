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
  Button,
  Icon,
  useToast,
} from '@chakra-ui/react';
import { FiCamera } from 'react-icons/fi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTaskStore, ViewScope } from '../store/useTaskStore';
import { ViewerScopeBadge } from '../components/ViewerScopeBadge';
import { VerimeterModeToggle } from '../components/VerimeterModeToggle';
import GraphControlBar, { GraphMetricPill } from '../components/GraphControlBar';
import UnifiedHeader from '../components/UnifiedHeader';
import StickyTitleBar from '../components/StickyTitleBar';
import CytoscapeKnowGraph from '../components/CytoscapeKnowGraph';
import { api } from '../services/api';
import {
  fetchClaimsAndLinkedReferencesForTask,
  fetchAuthors,
  fetchClaimsWithEvidence,
  fetchPublishers,
  fetchReferencesWithClaimsForTask,
} from '../services/useDashboardAPI';
import { captureElementAsPng } from '../utils/domSnapshot';
import { ensureArray } from '../utils/normalize';
import { Claim, ClaimLinks, GraphNode, Link, ReferenceWithClaims } from '../../../shared/entities/types';

function relationForClaimLink(link: ClaimLinks): "supports" | "refutes" | "related" {
  if (link.relationship === "supports" || link.relationship === "refutes") return link.relationship;
  return "related";
}

function supportValueForClaimLink(link: ClaimLinks): number {
  const value = Number(link.support_level ?? link.confidence ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) > 1 ? value / 100 : value;
}

function buildKnowGraphFromWorkspaceLinks({
  task,
  caseClaims,
  references,
  claimLinks,
}: {
  task: { content_id: number; content_name?: string; url?: string; authors?: any[]; publishers?: any[] };
  caseClaims: Claim[];
  references: ReferenceWithClaims[];
  claimLinks: ClaimLinks[];
}): { nodes: GraphNode[]; links: Link[] } {
  const nodesById = new Map<string, GraphNode>();
  const links: Link[] = [];
  const linksById = new Set<string>();
  const referencesById = new Map(references.map((reference) => [reference.reference_content_id, reference]));

  const addNode = (node: GraphNode) => {
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  };
  const addLink = (link: Link) => {
    if (linksById.has(link.id)) return;
    linksById.add(link.id);
    links.push(link);
  };

  addNode(new GraphNode(
    `task-${task.content_id}`,
    task.content_name || "Case",
    "task",
    0,
    0,
    task.url,
    task.content_id,
  ));

  const taskAuthors = ensureArray<any>(task.authors);
  const taskPublishers = ensureArray<any>(task.publishers);

  taskAuthors.forEach((author) => {
    const authorName = [author.author_first_name, author.author_last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!author.author_id || !authorName) return;
    const authorNode = new GraphNode(
      `author-${author.author_id}`,
      authorName,
      "author",
      0,
      0,
      undefined,
      task.content_id,
      undefined,
      undefined,
      author.author_id,
    );
    Object.assign(authorNode, {
      description: author.description,
      author_profile_pic: author.author_profile_pic,
      author_title: author.author_title,
    });
    addNode(authorNode);
    addLink({
      id: `task-${task.content_id}-author-${author.author_id}`,
      source: `task-${task.content_id}`,
      target: authorNode.id,
      type: "authored_by",
      content_id: task.content_id,
    });
  });

  taskPublishers.forEach((publisher) => {
    if (!publisher.publisher_id || !publisher.publisher_name) return;
    const publisherNode = new GraphNode(
      `publisher-${publisher.publisher_id}`,
      publisher.publisher_name,
      "publisher",
      0,
      0,
      undefined,
      task.content_id,
      undefined,
      publisher.publisher_id,
      undefined,
    );
    Object.assign(publisherNode, {
      admiralty_code: publisher.admiralty_code ?? null,
    });
    addNode(publisherNode);
    addLink({
      id: `task-${task.content_id}-publisher-${publisher.publisher_id}`,
      source: `task-${task.content_id}`,
      target: publisherNode.id,
      type: "published_by",
      content_id: task.content_id,
    });
  });

  caseClaims.forEach((claim) => {
    const node = new GraphNode(
      `claim-${claim.claim_id}`,
      claim.claim_text,
      "taskClaim",
      0,
      0,
      undefined,
      task.content_id,
      claim.claim_id,
    );
    Object.assign(node, {
      veracity_score: claim.veracity_score,
      confidence_level: claim.confidence_level,
    });
    addNode(node);
  });

  claimLinks.forEach((claimLink) => {
    const reference = referencesById.get(claimLink.right_reference_id);
    const sourceClaim = reference?.claims?.find((claim) => claim.claim_id === claimLink.source_claim_id);
    const sourceClaimNodeId = `claim-link-source-${claimLink.id || claimLink.claim_link_id}`;

    const sourceClaimNode = new GraphNode(
      sourceClaimNodeId,
      sourceClaim?.claim_text || `Source claim ${claimLink.source_claim_id}`,
      "refClaim",
      0,
      0,
      reference?.url,
      claimLink.right_reference_id,
      claimLink.source_claim_id,
      reference?.publisher_id,
      reference?.author_id,
    );
    Object.assign(sourceClaimNode, {
      veracity_score: sourceClaim?.veracity_score,
      confidence_level: sourceClaim?.confidence_level,
    });
    addNode(sourceClaimNode);

    const sourceNode = new GraphNode(
      `reference-${claimLink.right_reference_id}`,
      reference?.content_name || `Source ${claimLink.right_reference_id}`,
      "reference",
      0,
      0,
      reference?.url,
      claimLink.right_reference_id,
      undefined,
      reference?.publisher_id,
      reference?.author_id,
    );
    Object.assign(sourceNode, {
      rating: reference?.publisher_veracity ?? undefined,
      admiralty_code: reference?.admiralty_code ?? null,
      added_by_user_id: reference?.added_by_user_id,
      is_system: reference?.is_system,
      reference: reference ?? null,
      sourceClaims: reference?.claims?.map((claim, index) => ({
        id: claim.claim_id,
        label: `SC${index + 1}`,
        text: claim.claim_text,
        sourceName: reference.content_name,
        sourceUrl: reference.url,
        reference,
      })) ?? [],
    });
    addNode(sourceNode);

    if (reference?.author_id && reference.author_name?.trim()) {
      const authorNode = new GraphNode(
        `author-${reference.author_id}`,
        reference.author_name.trim(),
        "author",
        0,
        0,
        undefined,
        reference.reference_content_id,
        undefined,
        undefined,
        reference.author_id,
      );
      addNode(authorNode);
      addLink({
        id: `reference-${reference.reference_content_id}-author-${reference.author_id}`,
        source: `reference-${reference.reference_content_id}`,
        target: authorNode.id,
        type: "authored_by",
        content_id: reference.reference_content_id,
      });
    }

    if (reference?.publisher_id && reference.publisher_name?.trim()) {
      const publisherNode = new GraphNode(
        `publisher-${reference.publisher_id}`,
        reference.publisher_name.trim(),
        "publisher",
        0,
        0,
        reference.url,
        reference.reference_content_id,
        undefined,
        reference.publisher_id,
        undefined,
      );
      Object.assign(publisherNode, {
        rating: reference.publisher_veracity ?? undefined,
        admiralty_code: reference.admiralty_code ?? null,
      });
      addNode(publisherNode);
      addLink({
        id: `reference-${reference.reference_content_id}-publisher-${reference.publisher_id}`,
        source: `reference-${reference.reference_content_id}`,
        target: publisherNode.id,
        type: "published_by",
        content_id: reference.reference_content_id,
      });
    }

    const relation = relationForClaimLink(claimLink);
    const supportLevel = supportValueForClaimLink(claimLink);
    addLink({
      id: `claim-link-${claimLink.id || claimLink.claim_link_id}`,
      source: `claim-${claimLink.left_claim_id}`,
      target: sourceClaimNodeId,
      type: relation,
      relation,
      value: Math.abs(supportLevel),
      support_level: supportLevel,
      notes: claimLink.notes || "",
      content_id: task.content_id,
      created_by_ai: Boolean(claimLink.created_by_ai),
    });
  });

  return {
    nodes: Array.from(nodesById.values()),
    links,
  };
}

const KnowGraphPage = () => {
  const { colorMode } = useColorMode();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const viewScope = useTaskStore((s) => s.viewScope);
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
  const [savingSnapshot, setSavingSnapshot] = useState(false);

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
        const [caseClaims, references, claimLinks, taskAuthors, taskPublishers] = await Promise.all([
          fetchClaimsWithEvidence(selectedTask.content_id, viewerId, viewScope),
          fetchReferencesWithClaimsForTask(selectedTask.content_id, viewerId, viewScope),
          fetchClaimsAndLinkedReferencesForTask(selectedTask.content_id, viewerId, viewScope),
          fetchAuthors(selectedTask.content_id),
          fetchPublishers(selectedTask.content_id),
        ]);
        const result = buildKnowGraphFromWorkspaceLinks({
          task: {
            ...selectedTask,
            authors: taskAuthors,
            publishers: taskPublishers,
          },
          caseClaims,
          references,
          claimLinks,
        });
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
  }, [selectedTask, viewerId, viewScope, navigate]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read snapshot image.'));
      reader.readAsDataURL(blob);
    });

  const captureKnowledgeGraphDataUrl = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const cy = window.__veristrataKnowGraphCy;
    if (cy && !cy.destroyed()) {
      return cy.png({
        full: false,
        scale: 2,
        bg: colorMode === 'dark' ? '#061020' : '#f8fafc',
        output: 'base64uri',
      } as any) as string;
    }

    const target = document.querySelector<HTMLElement>('.veristrata-knowgraph-snapshot-target');
    if (!target) throw new Error('Knowledge graph snapshot target was not found.');
    const blob = await captureElementAsPng(target, {
      backgroundColor: colorMode === 'dark' ? '#061020' : '#f8fafc',
      pixelRatio: 2,
      maxWidth: 1800,
    });
    return blobToDataUrl(blob);
  };

  const handleSaveSnapshot = async () => {
    if (!selectedTaskId) return;
    try {
      setSavingSnapshot(true);
      const dataUrl = await captureKnowledgeGraphDataUrl();
      const response = await api.post('/api/review-articles/workspace-snapshot', {
        content_id: selectedTaskId,
        data_url: dataUrl,
        module_id: 'knowledge_graph_image',
      });
      toast({
        title: 'Knowledge graph snapshot saved',
        description: response.data?.body_updated
          ? 'The Knowledge Graph Image module was updated.'
          : 'The image asset was saved and attached to the review article.',
        status: 'success',
        duration: 4000,
      });
    } catch (error: any) {
      console.error('Attach knowledge graph snapshot failed:', error);
      toast({
        title: 'Could not attach snapshot',
        description: error.response?.data?.error || error.message || 'The knowledge graph image was not attached.',
        status: 'error',
        duration: 5500,
      });
    } finally {
      setSavingSnapshot(false);
    }
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

      <Box mb={3}>
      <GraphControlBar
        title="Knowledge Graph"
        metrics={
          <>
            <GraphMetricPill tone="purple" label="Case Claims" value={metrics.caseClaims} />
            <GraphMetricPill tone="blue" label="Source Claims" value={metrics.sourceClaims} />
            <GraphMetricPill tone="green" label="Sources" value={metrics.sources} />
            <GraphMetricPill tone="cyan" label="Support" value={metrics.supportLinks} />
            <GraphMetricPill tone="red" label="Refute" value={metrics.refuteLinks} />
          </>
        }
      >
        <VerimeterModeToggle compact />
        <ViewerScopeBadge />

        <Button
          className="mr-button"
          size="sm"
          flexShrink={0}
          minW="142px"
          px={3}
          leftIcon={<Icon as={FiCamera} />}
          onClick={handleSaveSnapshot}
          isLoading={savingSnapshot}
          loadingText="Saving"
          isDisabled={!selectedTaskId || graphData.nodes.length === 0}
          whiteSpace="nowrap"
        >
          Save Snapshot
        </Button>
      </GraphControlBar>
      </Box>

      {/* Main layout - full width graph with floating panels */}
      <Box
        className="veristrata-knowgraph-snapshot-target"
        height="calc(100vh - 280px)"
        position="relative"
      >
        {/* Center: Graph - Full Width */}
        <Card
          bg={
            colorMode === 'dark'
              ? `radial-gradient(circle at 20% 20%, rgba(111,140,255,0.2), transparent 36%), radial-gradient(circle at 76% 78%, rgba(74,222,128,0.14), transparent 30%), linear-gradient(180deg, rgba(10,18,34,0.93), rgba(6,12,22,0.97))`
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
          </CardBody>
        </Card>

        {/* Floating Legend - Responsive, shrinks at 1024 */}
        <Box
          className="mr-card mr-card-blue"
          position="absolute"
          top={{ base: 2, xl: 4 }}
          left={{ base: 2, xl: 4 }}
          zIndex={1000}
          border="1px solid rgba(113,219,255,0.22)"
          borderRadius="24px"
          p={{ base: 1.5, xl: 2.5 }}
          boxShadow="0 18px 54px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
          maxW={{ base: "140px", xl: "260px" }}
          overflow="visible"
          style={{ background: "linear-gradient(135deg, rgba(8, 22, 58, 0.92), rgba(14, 32, 72, 0.86))" }}
          sx={{
            "&::before": {
              content: '""',
              position: "absolute",
              left: 0,
              top: 0,
              width: "20px",
              height: "100%",
              background: "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
              borderRadius: "24px 0 0 24px",
              pointerEvents: "none",
              zIndex: 1,
            },
          }}
        >
          <Text
            fontSize={{ base: "8px", xl: "10px" }}
            color="cyan.300"
            fontWeight={600}
            mb={{ base: 0.5, xl: 1.5 }}
            letterSpacing="wide"
          >
            ONTOLOGY
          </Text>
          <Grid templateColumns="1fr 1fr" gap={{ base: 0.5, xl: 1.5 }} mb={{ base: 1, xl: 2 }}>
            <LegendItem color="#6ea8ff" label="Case" />
            <LegendItem color="#8f7cff" label="Case Claim" />
            <LegendItem color="#58d6ff" label="Source Claim" />
            <LegendItem color="#63f0b0" label="Source" />
            <LegendItem color="#ff8fb7" label="Author" />
            <LegendItem color="#ffbf69" label="Publisher" />
          </Grid>
          <VStack align="stretch" spacing={{ base: 0, xl: 0.5 }}>
            <EdgeLegendItem color="#62f0a8" label="supports" />
            <EdgeLegendItem color="#ff7a7a" label="refutes" />
            <EdgeLegendItem color="#66a3ff" label="related" />
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
    className="mr-card mr-card-blue"
    bg="rgba(3,10,24,0.78)"
    border="1px solid rgba(113,219,255,0.22)"
    borderRadius="24px"
    boxShadow="0 18px 54px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)"
    overflow="auto"
  >
    <CardBody p={4}>
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text
            fontSize="11px"
            fontWeight="900"
            letterSpacing="0.12em"
            textTransform="uppercase"
            color="#71dbff"
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
            <Divider borderColor="rgba(255,255,255,0.08)" />
            <Box>
              <Text
                fontSize="11px"
                fontWeight="900"
                letterSpacing="0.12em"
                textTransform="uppercase"
                color="#71dbff"
                mb={2}
              >
                Selected Node
              </Text>
              <Box
                p={3}
                bg="rgba(10, 18, 30, 0.82)"
                borderRadius="14px"
                border="1px solid rgba(113,219,255,0.18)"
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
    bg="rgba(10, 18, 30, 0.82)"
    borderRadius="14px"
    border="1px solid rgba(113,219,255,0.18)"
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
  <HStack spacing={{ base: 0.5, xl: 2 }}>
    <Box
      w={{ base: "6px", xl: "11px" }}
      h={{ base: "6px", xl: "11px" }}
      borderRadius="full"
      bg={color}
      boxShadow={`0 0 10px ${color}44`}
    />
    <Text fontSize={{ base: "9px", xl: "xs" }} color="gray.300">
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
  <HStack spacing={{ base: 0.5, xl: 2 }} mt={{ base: 0.5, xl: 1 }}>
    <Box
      w={{ base: "12px", xl: "22px" }}
      h="0"
      borderTop={{ base: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, xl: `3px ${dashed ? 'dashed' : 'solid'} ${color}` }}
      borderRadius="full"
    />
    <Text fontSize={{ base: "9px", xl: "xs" }} color="gray.300">
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
