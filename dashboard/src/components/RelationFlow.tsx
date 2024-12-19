import React, { useState } from "react";
import ReactFlow, {
  addEdge,
  MiniMap,
  Controls,
  Background,
  Edge,
  Node,
  Connection,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from "reactflow";
import { Box, Button } from "@chakra-ui/react";
import EditableNode from "./EditableNode";
import "reactflow/dist/style.css";

/**
 * For demonstration, we define some static nodes and edges.
 * In a real scenario, you'd derive these from `references` or `claims` data.
 */

const nodeTypes = {
  editableNode: EditableNode,
};

const initialNodes: Node[] = [
  {
    id: "1",
    type: "editableNode",
    data: { label: 'Claim: "X is true."' },
    position: { x: 0, y: 0 },
  },
];

const initialEdges: Edge[] = [];

const RelationFlow = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = (params: any) =>
    setEdges((eds: any) => addEdge(params, eds));

  const addNode = () => {
    const newNodeId = (nodes.length + 1).toString();
    const newNode: Node = {
      id: newNodeId,
      position: { x: Math.random() * 400, y: Math.random() * 200 },
      data: { label: `Node ${newNodeId}` },
      type: "editableNode",
    };
    setNodes((nds: any) => nds.concat(newNode));
  };

  return (
    <div style={{ width: "100%", height: "500px" }}>
      <Box w="100%" h="500px">
        <Button onClick={addNode} mb={2}>
          Add Node
        </Button>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            style={{ border: "1px solid #ddd", borderRadius: "4px" }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </ReactFlowProvider>
      </Box>
    </div>
  );
};

export default RelationFlow;
