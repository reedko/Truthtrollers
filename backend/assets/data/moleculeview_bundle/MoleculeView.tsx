// src/pages/MoleculeView.tsx
import React, { useState } from "react";
import CytoscapeMolecule from "../components/CytoscapeMolecule";
import { GraphNode } from "../../../shared/entities/types";

const mockNodes: GraphNode[] = [
  { id: "conte-1", label: "Task", type: "task" },
  { id: "ref-1", label: "Ref 1", type: "reference", content_id: 1 },
];
const mockLinks = [
  { id: "link-1", source: "ref-1", target: "conte-1", relation: "supports" },
];

const MoleculeView: React.FC = () => {
  const [centerNodeId, setCenterNodeId] = useState<string | undefined>(
    mockNodes.find((n) => n.type === "task")?.id
  );

  return (
    <div style={{ padding: "1rem" }}>
      <h2>🔬 Molecule Graph View</h2>
      <CytoscapeMolecule
        nodes={mockNodes}
        links={mockLinks}
        centerNodeId={centerNodeId}
        onRequestReframe={(nodeId) => setCenterNodeId(nodeId)}
      />
    </div>
  );
};

export default MoleculeView;
