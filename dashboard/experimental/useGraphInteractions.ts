// src/hooks/useGraphInteractions.ts
import { useState } from "react";
import { GraphNode } from "../../../shared/entities/types.ts";
import { transformData } from "../services/dataTransform";
import { fetchNewGraphData } from "../services/api";

export const useGraphInteractions = (
  initialNodes: GraphNode[],
  initialLinks: any[]
) => {
  const [nodes, setNodes] = useState(initialNodes);
  const [links, setLinks] = useState(initialLinks);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const handleNodeClick = async (node: GraphNode) => {
    setSelectedNode(node);
  };

  const reframeGraph = async () => {
    if (!selectedNode) return;

    const { nodes: newNodes, links: newLinks } = await fetchNewGraphData(
      selectedNode
    );
    setNodes(newNodes);
    setLinks(newLinks);
  };

  return {
    nodes,
    links,
    selectedNode,
    handleNodeClick,
    reframeGraph,
  };
};
