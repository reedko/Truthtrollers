// src/pages/NewKnowGraphPage.tsx
// New Force Graph implementation with Bloom-style design
import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  Select,
  Flex,
} from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3-force';
import { useTaskStore, ViewScope } from '../store/useTaskStore';
import { ViewerScopeBadge } from '../components/ViewerScopeBadge';
import { VerimeterModeToggle } from '../components/VerimeterModeToggle';
import UnifiedHeader from '../components/UnifiedHeader';
import StickyTitleBar from '../components/StickyTitleBar';
import { fetchNewGraphDataFromLegacyRoute } from '../services/api';
import { GraphNode, Link } from '../../../shared/entities/types';

// Color scheme matching the HTML demo
const COLORS = {
  bg: '#f5f7fb',
  panel: '#ffffff',
  border: '#d9e1ee',
  grid: '#edf2f8',
  text: '#213042',
  muted: '#617389',
  case: '#5b8def',
  caseClaim: '#7c5ce6',
  sourceClaim: '#18a4c7',
  source: '#20b26b',
  support: '#1f9d58',
  refute: '#d64545',
  nuance: '#4979e8',
  taskClaim: '#f59e0b',
  author: '#a78bfa',
  publisher: '#60a5fa',
};

// Force graph node type
interface ForceGraphNode {
  id: string;
  label: string;
  type: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
  url?: string;
  content_id?: number;
  claim_id?: number;
  author_id?: number;
  publisher_id?: number;
  group?: number;
  added_by_user_id?: number | null;
  is_system?: boolean;
}

interface ForceGraphLink {
  source: string | ForceGraphNode;
  target: string | ForceGraphNode;
  relation?: string;
  type?: string;
  value?: number;
}

const NewKnowGraphPage = () => {
  const { colorMode } = useColorMode();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fgRef = useRef<any>();

  const selectedTask = useTaskStore((s) => s.selectedTask);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);

  const [graphData, setGraphData] = useState<{ nodes: ForceGraphNode[]; links: ForceGraphLink[] }>({
    nodes: [],
    links: [],
  });
  const [selectedNode, setSelectedNode] = useState<ForceGraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<ForceGraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'linked' | 'all' | 'ai' | 'all_with_ai'>('linked');

  // Debug: Log graph data changes
  useEffect(() => {
    console.log('📊 Graph Data Updated:', {
      nodeCount: graphData.nodes.length,
      linkCount: graphData.links.length,
      viewMode,
      nodes: graphData.nodes.map(n => ({ id: n.id, type: n.type })),
      links: graphData.links.map(l => ({ source: l.source, target: l.target, relation: l.relation })),
    });
  }, [graphData, viewMode]);

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
    setRedirect('/newknowgraph');
  }, [setRedirect]);

  // Load graph data
  useEffect(() => {
    const loadGraph = async () => {
      if (!selectedTask) {
        console.warn('❌ No selected task');
        setLoading(false);
        return;
      }

      console.log('📊 Loading force graph for task:', selectedTask);
      setLoading(true);
      try {
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
        console.log('✅ ForceGraph data loaded - nodes:', result.nodes.length, 'links:', result.links.length);
        console.log('📊 Nodes:', result.nodes);
        console.log('🔗 Links:', result.links);

        // EXACTLY like KnowGraph - use all nodes and links from backend
        // Position them for wider, shorter layout
        const nodes: ForceGraphNode[] = result.nodes.map((node, index) => ({
          ...node,
          x: index * 150, // Wider spacing (was 100)
          y: index * 30,  // Shorter spacing (was 50)
          fx: node.fx ?? undefined, // Convert null to undefined
          fy: node.fy ?? undefined, // Convert null to undefined
        }));

        const links: ForceGraphLink[] = result.links.map((link) => ({
          source: link.source,
          target: link.target,
          relation: link.relation || link.type,
          type: link.type || link.relation,
          value: link.value || 1,
        }));

        console.log('📊 Using ALL nodes from backend:', nodes.length);
        console.log('🔗 Using ALL links from backend:', links.length);

        setGraphData({ nodes, links });
      } catch (err) {
        console.error('🔥 Error loading graph data:', err);
      } finally {
        setLoading(false);
      }
    };

    if (!selectedTask) {
      console.warn('❌ No selected task — redirecting to /tasks');
      navigate('/tasks', { state: { redirectTo: '/newknowgraph' } });
      return;
    }

    loadGraph();
  }, [selectedTask, navigate, viewMode, viewerId]);

  // Node click handler
  const handleNodeClick = useCallback((node: ForceGraphNode) => {
    console.log('Node clicked:', node);
    setSelectedNode(node);

    // Center on node
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 1000);
      fgRef.current.zoom(2, 1000);
    }
  }, []);

  // Node hover handlers
  const handleNodeHover = useCallback((node: ForceGraphNode | null) => {
    setHoveredNode(node);
  }, []);

  // Get node color based on type
  const getNodeColor = useCallback((node: ForceGraphNode) => {
    switch (node.type) {
      case 'task':
        return COLORS.case;
      case 'taskClaim':
        return COLORS.taskClaim;
      case 'refClaim':
        return COLORS.sourceClaim;
      case 'reference':
        return COLORS.source;
      case 'author':
        return COLORS.author;
      case 'publisher':
        return COLORS.publisher;
      default:
        return COLORS.case;
    }
  }, []);

  // Get node size based on type - DEFINED FIRST before any function that uses it
  const getNodeSize = useCallback((node: ForceGraphNode) => {
    switch (node.type) {
      case 'task':
        return 60;
      case 'reference':
        return 50;
      case 'taskClaim':
      case 'refClaim':
        return 40;
      case 'author':
      case 'publisher':
        return 45;
      default:
        return 45;
    }
  }, []);

  // Get link color based on relation
  const getLinkColor = useCallback((link: ForceGraphLink) => {
    const relation = link.relation || link.type;
    if (relation?.toLowerCase().includes('support')) return COLORS.support;
    if (relation?.toLowerCase().includes('refute')) return COLORS.refute;
    if (relation?.toLowerCase().includes('related')) return COLORS.nuance;
    return '#96a7bd'; // neutral
  }, []);

  // Custom link canvas renderer - draws VERY VISIBLE links between nodes
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    // DEBUG: Log every call
    if (Math.random() < 0.01) { // Log 1% to avoid spam
      console.log('🎨 paintLink called:', link);
    }

    const start = link.source;
    const end = link.target;

    // Safety check - make sure we have positioned nodes
    if (!start || !end || typeof start !== 'object' || typeof end !== 'object') {
      console.warn('⚠️ paintLink: Invalid link object', link);
      return;
    }
    if (start.x === undefined || start.y === undefined || end.x === undefined || end.y === undefined) {
      console.warn('⚠️ paintLink: Node missing position', { start, end });
      return;
    }

    // Get link color based on relation type
    const relation = (link.relation || link.type || '').toLowerCase();
    let color = '#00d4ff'; // BRIGHT CYAN for structural (default)

    // Semantic relationships (from claim_links)
    if (relation.includes('support')) color = '#00ff88'; // BRIGHT GREEN
    if (relation.includes('refute')) color = '#ff3366'; // BRIGHT RED
    if (relation.includes('related') || relation.includes('nuance')) color = '#6699ff'; // BRIGHT BLUE

    // Structural relationships (added manually)
    if (relation.includes('contains')) color = '#9d9d9d'; // GRAY for Case → Case Claim
    if (relation.includes('references')) color = '#9d9d9d'; // GRAY for Source Claim → Source
    if (relation.includes('authored')) color = '#a78bfa'; // PURPLE for Source → Author
    if (relation.includes('published')) color = '#60a5fa'; // BLUE for Source → Publisher

    // Calculate node radii for edge-to-edge drawing
    const sourceRadius = getNodeSize(start) + 5;
    const targetRadius = getNodeSize(end) + 5;

    // Calculate the vector from source to target
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1) {
      console.warn('⚠️ paintLink: Nodes too close', { start: start.id, end: end.id, distance });
      return;
    }

    // Normalize the vector
    const nx = dx / distance;
    const ny = dy / distance;

    // Start point: at the edge of source node
    const startX = start.x + nx * sourceRadius;
    const startY = start.y + ny * sourceRadius;

    // End point: at the edge of target node
    const endX = end.x - nx * targetRadius;
    const endY = end.y - ny * targetRadius;

    // Draw VERY THICK VISIBLE line
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8; // THICK - don't scale, always visible
    ctx.globalAlpha = 1.0; // FULLY OPAQUE
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Draw glow/shadow for extra visibility
    ctx.strokeStyle = color;
    ctx.lineWidth = 12;
    ctx.globalAlpha = 0.3;
    ctx.stroke();

    // Draw directional arrow at the end
    const arrowLength = 25;
    const arrowWidth = 12;

    ctx.globalAlpha = 1.0;
    ctx.translate(endX, endY);
    ctx.rotate(Math.atan2(dy, dx));

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.moveTo(0, 0);
    ctx.lineTo(-arrowLength, arrowWidth);
    ctx.lineTo(-arrowLength, -arrowWidth);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }, [getNodeSize]);

  // Helper function to wrap text
  const wrapText = (text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  };

  // Custom node canvas renderer - draw nodes OVER links
  const paintNode = useCallback((node: ForceGraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label || '';
    const nodeSize = getNodeSize(node);
    const isSelected = hoveredNode?.id === node.id || selectedNode?.id === node.id;

    // Calculate font size that scales with zoom
    const baseFontSize = nodeSize / 3.5;
    const fontSize = baseFontSize / globalScale;
    ctx.font = `700 ${fontSize}px Inter, sans-serif`;

    // Draw shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    // Fill color
    ctx.fillStyle = getNodeColor(node);
    ctx.beginPath();

    if (node.type === 'taskClaim' || node.type === 'refClaim') {
      // Rounded rectangle for claims
      const width = nodeSize * 2.0;
      const height = nodeSize * 1.4;
      const radius = 12;
      const x = node.x! - width / 2;
      const y = node.y! - height / 2;

      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    } else if (node.type === 'reference') {
      // Diamond for sources
      const size = nodeSize * 1.3;
      ctx.moveTo(node.x!, node.y! - size);
      ctx.lineTo(node.x! + size, node.y!);
      ctx.lineTo(node.x!, node.y! + size);
      ctx.lineTo(node.x! - size, node.y!);
      ctx.closePath();
    } else {
      // Circle for case, authors, publishers
      ctx.arc(node.x!, node.y!, nodeSize, 0, 2 * Math.PI, false);
    }

    ctx.fill();
    ctx.restore();

    // White border
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isSelected ? 6 : 4;
    ctx.stroke();
    ctx.restore();

    // Glow effect for selected
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = getNodeColor(node);
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.restore();
    }

    // Draw text INSIDE the node
    ctx.save();
    const maxTextWidth = node.type === 'taskClaim' || node.type === 'refClaim'
      ? nodeSize * 1.7
      : nodeSize * 1.5;

    const lines = wrapText(label, maxTextWidth, ctx);
    const maxLines = 2;
    const displayLines = lines.slice(0, maxLines);

    // Add ellipsis if truncated
    if (lines.length > maxLines) {
      const lastLine = displayLines[maxLines - 1];
      displayLines[maxLines - 1] = lastLine.substring(0, Math.max(0, lastLine.length - 3)) + '...';
    }

    // Center text in node
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 4 / globalScale;

    const lineHeight = fontSize * 1.3;
    const totalTextHeight = displayLines.length * lineHeight;
    const startY = node.y! - totalTextHeight / 2 + lineHeight / 2;

    displayLines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      // Outline for readability
      ctx.strokeText(line, node.x!, y);
      ctx.fillText(line, node.x!, y);
    });
    ctx.restore();
  }, [getNodeColor, getNodeSize, hoveredNode, selectedNode]);

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
        <Flex gap={4} alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <Box
            bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.50'}
            px={3}
            py={2}
            borderRadius="md"
            backdropFilter="blur(8px)"
            border="1px solid"
            borderColor={colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.200'}
          >
            <Heading size="md">Force Graph (Bloom Style)</Heading>
          </Box>

          <Flex gap={2} alignItems="center">
            <Text fontSize="sm" fontWeight="medium">View:</Text>
            <Select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as typeof viewMode)}
              size="sm"
              width="200px"
              bg={colorMode === 'dark' ? 'whiteAlpha.100' : 'white'}
              borderColor={colorMode === 'dark' ? 'whiteAlpha.300' : 'gray.300'}
            >
              <option value="linked">Linked Claims</option>
              <option value="all">All Claims</option>
              <option value="ai">AI Links</option>
              <option value="all_with_ai">All (AI + Linked)</option>
            </Select>
          </Flex>

          <Flex gap={2}>
            <VerimeterModeToggle compact />
            <ViewerScopeBadge />
          </Flex>
        </Flex>
      </Box>

      {/* Main Three-Column Layout */}
      <Grid
        templateColumns={{ base: '1fr', lg: '280px 1fr 280px' }}
        gap={4}
        minH="600px"
      >
        {/* Left Panel - Info */}
        <Card
          bg={colorMode === 'dark' ? 'rgba(12, 20, 34, 0.9)' : 'white'}
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
          borderRadius="16px"
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
                  Enterprise Graph View
                </Text>
                <Heading size="lg" mb={2}>
                  Knowledge Graph
                </Heading>
                <Text fontSize="sm" color="gray.400">
                  Force-directed graph with typed nodes, typed edges, and Bloom-style design.
                  Click nodes to explore, drag to rearrange.
                </Text>
              </Box>

              <Divider borderColor="whiteAlpha.200" />

              <Box>
                <Text fontSize="xs" color="cyan.300" fontWeight={600} mb={3}>
                  Graph Metrics
                </Text>
                <VStack align="stretch" spacing={2}>
                  <MetricRow label="Case nodes" value={1} />
                  <MetricRow label="Case claims" value={metrics.caseClaims} />
                  <MetricRow label="Source claims" value={metrics.sourceClaims} />
                  <MetricRow label="Sources" value={metrics.sources} />
                  <MetricRow label="Total edges" value={metrics.totalEdges} />
                </VStack>
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500" lineHeight={1.5}>
                  This version uses react-force-graph for physics-based layouts.
                  Less dashboard theater, more graph-database respectability.
                </Text>
              </Box>
            </VStack>
          </CardBody>
        </Card>

        {/* Center Panel - Graph */}
        <Card
          bg={colorMode === 'dark' ? 'rgba(12, 20, 34, 0.9)' : 'white'}
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
          borderRadius="16px"
          boxShadow={
            colorMode === 'dark'
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 60px rgba(0, 0, 0, 0.45)'
              : 'md'
          }
          overflow="hidden"
          position="relative"
          h="600px"
          w="100%"
        >
          <CardBody p={0} h="100%" w="100%">
            {graphData.nodes.length === 0 ? (
              <Center h="full">
                <VStack spacing={4}>
                  <Text fontSize="lg" color="gray.400">
                    No graph data available
                  </Text>
                </VStack>
              </Center>
            ) : (
              <Box w="100%" h="100%" ref={(el) => {
                if (el) {
                  const rect = el.getBoundingClientRect();
                  console.log('📐 Viewport dimensions:', {
                    width: rect.width,
                    height: rect.height,
                    centerX: rect.width / 2,
                    centerY: rect.height / 2
                  });
                }
              }}>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={graphData}
                  nodeLabel="label"
                  nodeCanvasObject={paintNode}
                  nodeCanvasObjectMode={() => 'replace'}
                  linkCanvasObject={paintLink}
                  linkCanvasObjectMode={() => 'replace'}
                  onNodeClick={handleNodeClick}
                  onNodeHover={handleNodeHover}
                  nodePointerAreaPaint={(node, color, ctx) => {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(node.x!, node.y!, getNodeSize(node) * 2.5, 0, 2 * Math.PI);
                    ctx.fill();
                  }}
                  backgroundColor={colorMode === 'dark' ? '#0c1422' : '#f9fbff'}
                  warmupTicks={100}
                  cooldownTicks={200}
                  d3VelocityDecay={0.3}
                  d3AlphaDecay={0.02}
                  enableNodeDrag={true}
                  enableZoomInteraction={true}
                  enablePanInteraction={true}
                  onEngineStop={() => {
                    if (fgRef.current && graphData.nodes.length > 0) {
                      setTimeout(() => {
                        // STEP 1: Get viewport dimensions (actual pixel size)
                        const viewport = fgRef.current.getContainerDimensions();
                        console.log('📐 STEP 1 - Viewport dimensions (pixels):', {
                          width: viewport.width,
                          height: viewport.height
                        });

                        // STEP 2: Calculate graph bounding box (in graph coordinates)
                        const xs = graphData.nodes.map(n => n.x || 0);
                        const ys = graphData.nodes.map(n => n.y || 0);
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minY = Math.min(...ys);
                        const maxY = Math.max(...ys);

                        // Add node size padding to bounding box
                        const nodePadding = 80; // Account for node radius + some margin
                        const graphWidth = (maxX - minX) + nodePadding * 2;
                        const graphHeight = (maxY - minY) + nodePadding * 2;
                        const graphCenterX = (minX + maxX) / 2;
                        const graphCenterY = (minY + maxY) / 2;

                        console.log('📊 STEP 2 - Graph bounding box (graph coords):', {
                          minX, maxX, minY, maxY,
                          width: graphWidth,
                          height: graphHeight,
                          centerX: graphCenterX,
                          centerY: graphCenterY
                        });

                        // STEP 3: Calculate zoom to fit with 10% padding on each side
                        const paddingPercent = 0.90; // Use 90% of viewport (10% padding)
                        const availableWidth = viewport.width * paddingPercent;
                        const availableHeight = viewport.height * paddingPercent;

                        const zoomToFitWidth = availableWidth / graphWidth;
                        const zoomToFitHeight = availableHeight / graphHeight;

                        // Use the smaller zoom to ensure everything fits
                        const optimalZoom = Math.min(zoomToFitWidth, zoomToFitHeight);

                        console.log('🔍 STEP 3 - Zoom calculation:', {
                          availableWidth,
                          availableHeight,
                          zoomToFitWidth,
                          zoomToFitHeight,
                          optimalZoom
                        });

                        // STEP 4: Apply center and zoom
                        fgRef.current.centerAt(graphCenterX, graphCenterY, 1000);
                        fgRef.current.zoom(optimalZoom, 1000);

                        console.log('✅ STEP 4 - Applied: center =', { x: graphCenterX, y: graphCenterY }, 'zoom =', optimalZoom);
                      }, 100);
                    }
                  }}
                />
              </Box>
            )}
          </CardBody>
        </Card>

        {/* Right Panel - Legend & Details */}
        <Card
          bg={colorMode === 'dark' ? 'rgba(12, 20, 34, 0.9)' : 'white'}
          border="1px solid"
          borderColor={colorMode === 'dark' ? 'rgba(123, 163, 255, 0.12)' : 'gray.200'}
          borderRadius="16px"
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
                <Text fontSize="xs" color="cyan.300" fontWeight={600} mb={3}>
                  Legend
                </Text>
                <Grid templateColumns="1fr 1fr" gap={2}>
                  <LegendItem color={COLORS.case} label="Case" />
                  <LegendItem color={COLORS.taskClaim} label="Case Claim" />
                  <LegendItem color={COLORS.sourceClaim} label="Source Claim" />
                  <LegendItem color={COLORS.source} label="Source" />
                  <LegendItem color={COLORS.author} label="Author" />
                  <LegendItem color={COLORS.publisher} label="Publisher" />
                </Grid>

                <Box mt={3}>
                  <Text fontSize="xs" color="gray.500" mb={1}>Edge Types:</Text>
                  <EdgeLegendItem color="#9d9d9d" label="structural (case→claim, claim→source)" />
                  <EdgeLegendItem color="#00ff88" label="supports" />
                  <EdgeLegendItem color="#ff3366" label="refutes" />
                  <EdgeLegendItem color="#6699ff" label="nuances/related" />
                  <EdgeLegendItem color="#a78bfa" label="authored by" />
                  <EdgeLegendItem color="#60a5fa" label="published by" />
                </Box>
              </Box>

              <Divider borderColor="whiteAlpha.200" />

              {selectedNode ? (
                <Box>
                  <Text fontSize="xs" color="cyan.300" fontWeight={600} mb={2}>
                    Selected Node
                  </Text>
                  <Box
                    p={3}
                    bg="rgba(19, 30, 50, 0.6)"
                    borderRadius="lg"
                    border="1px solid rgba(120, 170, 255, 0.12)"
                  >
                    <Badge colorScheme="blue" mb={2}>
                      {selectedNode.type}
                    </Badge>
                    <Text fontSize="sm" fontWeight="bold" color="cyan.200" mb={1}>
                      {selectedNode.label}
                    </Text>
                    {selectedNode.url && (
                      <Text fontSize="xs" color="gray.400" noOfLines={2}>
                        {selectedNode.url}
                      </Text>
                    )}
                  </Box>

                  {selectedNode.url && (
                    <Button
                      size="sm"
                      mt={2}
                      as="a"
                      href={selectedNode.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      colorScheme="blue"
                      width="100%"
                    >
                      Open Link
                    </Button>
                  )}
                </Box>
              ) : (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontStyle="italic">
                    Click a node to see details
                  </Text>
                </Box>
              )}

              <Box
                p={3}
                bg="rgba(19, 30, 50, 0.6)"
                borderRadius="lg"
                border="1px solid rgba(120, 170, 255, 0.12)"
              >
                <Text fontSize="xs" color="gray.400" lineHeight={1.5}>
                  💡 Tip: Click nodes to explore, drag to rearrange, scroll to zoom.
                  The graph will settle into a natural layout based on connections.
                </Text>
              </Box>
            </VStack>
          </CardBody>
        </Card>
      </Grid>
    </Box>
  );
};

// Helper Components
const LegendItem = ({ color, label }: { color: string; label: string }) => (
  <HStack spacing={2}>
    <Box w="12px" h="12px" borderRadius="full" bg={color} boxShadow={`0 0 10px ${color}44`} />
    <Text fontSize="xs" color="gray.300">
      {label}
    </Text>
  </HStack>
);

const EdgeLegendItem = ({ color, label }: { color: string; label: string }) => (
  <HStack spacing={2} mt={1}>
    <Box
      w="24px"
      h="0"
      borderTop={`3px solid ${color}`}
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

export default NewKnowGraphPage;
