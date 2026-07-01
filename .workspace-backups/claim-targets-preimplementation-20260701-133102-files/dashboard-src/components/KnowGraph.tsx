// src/components/KnowGraph.tsx
// Phase 1: Core structure and data integration
import React, { useEffect, useState, useMemo } from 'react';
import { Box, Spinner, Center, Text } from '@chakra-ui/react';
import { GraphNode, Link } from '../../../shared/entities/types';

interface KnowGraphProps {
  nodes: GraphNode[];
  links: Link[];
  centerNodeId?: string;
  onNodeClick?: (node: GraphNode) => void;
  currentUserId?: number | null;
}

interface LayoutNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  layer: number;
  url?: string;
  content_id?: number;
  claim_id?: number;
  publisher_id?: number;
  author_id?: number;
  group?: number;
}

interface ProcessedEdge {
  source: LayoutNode;
  target: LayoutNode;
  type: 'support' | 'refute' | 'nuance' | 'meta';
  original: Link;
}

/**
 * Determines edge type based on link properties
 */
function getEdgeType(link: Link): 'support' | 'refute' | 'nuance' | 'meta' {
  const linkType = link.type?.toLowerCase() || '';
  const relation = link.relation?.toLowerCase() || '';

  // Metadata relationships (author, publisher)
  if (linkType.includes('author') || linkType.includes('publisher')) {
    return 'meta';
  }

  // Claim relationships based on relation
  if (relation.includes('support')) return 'support';
  if (relation.includes('refute')) return 'refute';
  if (relation.includes('nuance') || relation.includes('related')) return 'nuance';

  // Default based on link type
  if (linkType.includes('support')) return 'support';
  if (linkType.includes('refute')) return 'refute';

  return 'meta';
}

/**
 * Assign nodes to layers for knowledge graph layout
 * Layer 0 (left): Case/Task
 * Layer 1: Task Claims
 * Layer 2: Source Claims (from references)
 * Layer 3: Sources/References
 * Layer 4 (right): Authors/Publishers
 */
function assignNodesToLayers(nodes: GraphNode[]): Map<string, number> {
  const layerMap = new Map<string, number>();

  nodes.forEach(node => {
    if (node.type === 'task') {
      layerMap.set(node.id, 0);
    } else if (node.type === 'taskClaim') {
      layerMap.set(node.id, 1);
    } else if (node.type === 'refClaim') {
      layerMap.set(node.id, 2);
    } else if (node.type === 'reference') {
      layerMap.set(node.id, 3);
    } else if (node.type === 'author' || node.type === 'publisher') {
      layerMap.set(node.id, 4);
    } else {
      // Fallback
      layerMap.set(node.id, 2);
    }
  });

  return layerMap;
}

/**
 * Calculate positions for knowledge graph layout
 */
function calculateKnowledgeGraphLayout(
  nodes: GraphNode[],
  width: number,
  height: number
): LayoutNode[] {
  const layers = assignNodesToLayers(nodes);
  const padding = 80;
  const effectiveWidth = width - 2 * padding;
  const effectiveHeight = height - 2 * padding;

  // Group nodes by layer
  const nodesByLayer = new Map<number, GraphNode[]>();
  nodes.forEach(node => {
    const layer = layers.get(node.id) || 2;
    if (!nodesByLayer.has(layer)) {
      nodesByLayer.set(layer, []);
    }
    nodesByLayer.get(layer)!.push(node);
  });

  // Calculate x positions for each layer (5 layers: 0-4)
  const layerXPositions = [
    padding + effectiveWidth * 0.1,   // Layer 0: Case (left)
    padding + effectiveWidth * 0.3,   // Layer 1: Task Claims
    padding + effectiveWidth * 0.5,   // Layer 2: Source Claims (center)
    padding + effectiveWidth * 0.7,   // Layer 3: Sources
    padding + effectiveWidth * 0.9,   // Layer 4: Metadata (right)
  ];

  const layoutNodes: LayoutNode[] = [];

  // Position nodes within each layer
  nodesByLayer.forEach((layerNodes, layer) => {
    const layerHeight = effectiveHeight;
    const spacing = layerNodes.length > 1 ? layerHeight / (layerNodes.length + 1) : layerHeight / 2;

    layerNodes.forEach((node, index) => {
      const y = padding + spacing * (index + 1);
      const x = layerXPositions[layer] || padding + effectiveWidth / 2;

      layoutNodes.push({
        ...node,
        x,
        y,
        layer,
      });
    });
  });

  return layoutNodes;
}

const KnowGraph: React.FC<KnowGraphProps> = ({
  nodes,
  links,
  centerNodeId,
  onNodeClick,
  currentUserId,
}) => {
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);

  // Calculate layout
  const layoutNodes = useMemo(() => {
    if (!nodes || nodes.length === 0) return [];
    return calculateKnowledgeGraphLayout(nodes, dimensions.width, dimensions.height);
  }, [nodes, dimensions.width, dimensions.height]);

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    layoutNodes.forEach(n => map.set(n.id, n));
    return map;
  }, [layoutNodes]);

  // Process edges
  const processedEdges = useMemo(() => {
    const edges: ProcessedEdge[] = [];

    links.forEach(link => {
      const sourceNode = nodeMap.get(link.source);
      const targetNode = nodeMap.get(link.target);

      if (sourceNode && targetNode) {
        edges.push({
          source: sourceNode,
          target: targetNode,
          type: getEdgeType(link),
          original: link,
        });
      }
    });

    return edges;
  }, [links, nodeMap]);

  // Handle window resize
  useEffect(() => {
    const updateDimensions = () => {
      const container = document.getElementById('knowgraph-container');
      if (container) {
        setDimensions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleNodeClick = (node: LayoutNode) => {
    setSelectedNode(node);

    // Convert LayoutNode back to GraphNode for the callback
    if (onNodeClick) {
      const graphNode = new GraphNode(
        node.id,
        node.label,
        node.type,
        node.x,
        node.y,
        node.url,
        node.content_id,
        node.claim_id,
        node.publisher_id,
        node.author_id
      );
      onNodeClick(graphNode);
    }
  };

  if (!nodes || nodes.length === 0) {
    return (
      <Center h="full">
        <Text color="gray.400">No graph data available</Text>
      </Center>
    );
  }

  return (
    <Box
      id="knowgraph-container"
      position="relative"
      width="100%"
      height="100%"
      bg="transparent"
    >
      <svg
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        style={{ display: 'block' }}
      >
        {/* Render edges first (below nodes) */}
        <g className="edges">
          {processedEdges.map((edge, i) => (
            <KnowGraphEdge key={`edge-${i}`} edge={edge} />
          ))}
        </g>

        {/* Render nodes */}
        <g className="nodes">
          {layoutNodes.map(node => (
            <KnowGraphNode
              key={node.id}
              node={node}
              isSelected={selectedNode?.id === node.id}
              onClick={() => handleNodeClick(node)}
            />
          ))}
        </g>
      </svg>
    </Box>
  );
};

/**
 * Edge component with curved paths
 */
interface KnowGraphEdgeProps {
  edge: ProcessedEdge;
}

const KnowGraphEdge: React.FC<KnowGraphEdgeProps> = ({ edge }) => {
  const { source, target, type } = edge;

  // Create curved path
  const midX = (source.x + target.x) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const curvature = Math.min(Math.abs(dx) * 0.3, 100);

  const path = `M ${source.x} ${source.y} C ${source.x + curvature} ${source.y}, ${target.x - curvature} ${target.y}, ${target.x} ${target.y}`;

  // Edge colors and styles
  const edgeStyles = {
    support: {
      stroke: '#62f0a8',
      opacity: 0.7,
      filter: 'drop-shadow(0 0 5px rgba(98, 240, 168, 0.36))',
      strokeDasharray: undefined,
    },
    refute: {
      stroke: '#ff7a7a',
      opacity: 0.7,
      filter: 'drop-shadow(0 0 5px rgba(255, 122, 122, 0.28))',
      strokeDasharray: undefined,
    },
    nuance: {
      stroke: '#66a3ff',
      opacity: 0.7,
      filter: 'drop-shadow(0 0 5px rgba(102, 163, 255, 0.3))',
      strokeDasharray: undefined,
    },
    meta: {
      stroke: 'rgba(172, 189, 220, 0.28)',
      opacity: 0.55,
      strokeDasharray: '6 7',
      filter: 'none',
    },
  };

  const style = edgeStyles[type];

  return (
    <path
      d={path}
      fill="none"
      stroke={style.stroke}
      strokeWidth={2.5}
      opacity={style.opacity}
      strokeDasharray={style.strokeDasharray}
      style={{ filter: style.filter }}
    />
  );
};

/**
 * Node component with type-specific rendering
 */
interface KnowGraphNodeProps {
  node: LayoutNode;
  isSelected: boolean;
  onClick: () => void;
}

const KnowGraphNode: React.FC<KnowGraphNodeProps> = ({ node, isSelected, onClick }) => {
  const nodeColors = {
    task: '#6ea8ff',
    taskClaim: '#8f7cff',
    refClaim: '#58d6ff',
    reference: '#63f0b0',
    author: '#ff8fb7',
    publisher: '#ffbf69',
  };

  const color = nodeColors[node.type as keyof typeof nodeColors] || '#8ca1c6';

  // Different shapes for different node types
  if (node.type === 'task') {
    // Large circle for case/task
    return (
      <g className="node case" cursor="pointer" onClick={onClick}>
        <circle
          cx={node.x}
          cy={node.y}
          r={50}
          fill={color}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={isSelected ? 3 : 1.2}
          style={{
            filter: `drop-shadow(0 0 ${isSelected ? 20 : 14}px ${color}66)`,
          }}
        />
        <text
          x={node.x}
          y={node.y - 5}
          textAnchor="middle"
          fill="#eff5ff"
          fontSize={13}
          fontWeight={700}
        >
          CASE
        </text>
        <text
          x={node.x}
          y={node.y + 10}
          textAnchor="middle"
          fill="rgba(239, 245, 255, 0.76)"
          fontSize={10}
        >
          {node.label?.slice(0, 20)}
        </text>
      </g>
    );
  }

  if (node.type === 'taskClaim' || node.type === 'refClaim') {
    // Rounded rectangles for claims
    const width = 120;
    const height = 50;
    return (
      <g className="node claim" cursor="pointer" onClick={onClick}>
        <rect
          x={node.x - width / 2}
          y={node.y - height / 2}
          width={width}
          height={height}
          rx={14}
          fill={color}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={isSelected ? 3 : 1.2}
          style={{
            filter: `drop-shadow(0 0 ${isSelected ? 20 : 14}px ${color}66)`,
          }}
        />
        <text
          x={node.x}
          y={node.y - 5}
          textAnchor="middle"
          fill="#eff5ff"
          fontSize={11}
          fontWeight={700}
        >
          {node.type === 'taskClaim' ? 'Case Claim' : 'Source Claim'}
        </text>
        <text
          x={node.x}
          y={node.y + 10}
          textAnchor="middle"
          fill="rgba(239, 245, 255, 0.76)"
          fontSize={9}
        >
          {node.label?.slice(0, 18)}
        </text>
      </g>
    );
  }

  if (node.type === 'reference') {
    // Diamond for sources
    const size = 35;
    const points = `${node.x},${node.y - size} ${node.x + size},${node.y} ${node.x},${node.y + size} ${node.x - size},${node.y}`;

    return (
      <g className="node source" cursor="pointer" onClick={onClick}>
        <polygon
          points={points}
          fill={color}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={isSelected ? 3 : 1.2}
          style={{
            filter: `drop-shadow(0 0 ${isSelected ? 20 : 14}px ${color}66)`,
          }}
        />
        <text
          x={node.x}
          y={node.y - 5}
          textAnchor="middle"
          fill="#eff5ff"
          fontSize={10}
          fontWeight={700}
        >
          Source
        </text>
        <text
          x={node.x}
          y={node.y + 8}
          textAnchor="middle"
          fill="rgba(239, 245, 255, 0.76)"
          fontSize={8}
        >
          {node.label?.slice(0, 12)}
        </text>
      </g>
    );
  }

  // Small circles for authors and publishers
  return (
    <g className="node metadata" cursor="pointer" onClick={onClick}>
      <circle
        cx={node.x}
        cy={node.y}
        r={22}
        fill={color}
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth={isSelected ? 3 : 1.2}
        style={{
          filter: `drop-shadow(0 0 ${isSelected ? 16 : 10}px ${color}55)`,
        }}
      />
      <text
        x={node.x}
        y={node.y + 4}
        textAnchor="middle"
        fill="#eff5ff"
        fontSize={9}
        fontWeight={700}
      >
        {node.type === 'author' ? 'Author' : 'Pub'}
      </text>
    </g>
  );
};

export default KnowGraph;
