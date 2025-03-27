// src/components/MoleculeGraph.tsx
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface NodeType {
  id: string;
  type: "task" | "claim";
  label: string;
  relation?: "supports" | "refutes";
  x?: number;
  y?: number;
}

const initialNodes: NodeType[] = [
  { id: "task-1", type: "task", label: "Main Task" },
  { id: "claim-1", type: "claim", label: "Claim A", relation: "supports" },
  { id: "claim-2", type: "claim", label: "Claim B", relation: "refutes" },
  { id: "claim-3", type: "claim", label: "Claim C", relation: "supports" },
];

const MoleculeGraph: React.FC = () => {
  const width = 600;
  const height = 400;
  const centerX = width / 2;
  const centerY = height / 2;

  const [nodes, setNodes] = useState<NodeType[]>(initialNodes);
  const [selectedClaim, setSelectedClaim] = useState<NodeType | null>(null);

  useEffect(() => {
    const task = nodes.find((n) => n.type === "task");
    if (!task) return;

    const claims = nodes.filter((n) => n.type === "claim");
    const angleStep = (2 * Math.PI) / claims.length;
    const radius = 60;

    const positionedClaims = claims.map((claim, i) => {
      const angle = i * angleStep;
      return {
        ...claim,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    setNodes([{ ...task, x: centerX, y: centerY }, ...positionedClaims]);
  }, []);

  return (
    <div style={{ maxWidth: width, margin: "0 auto" }}>
      <svg width={width} height={height} style={{ background: "#111" }}>
        <AnimatePresence>
          {nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: node.type === "claim" ? "pointer" : "default" }}
              onClick={() => node.type === "claim" && setSelectedClaim(node)}
            >
              <motion.circle
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{
                  scale: node.type === "task" ? 1.4 : 1,
                  opacity: 1,
                }}
                transition={{ duration: 0.6 }}
                r={node.type === "task" ? 40 : 10}
                fill={
                  node.type === "task"
                    ? "#6c5ce7"
                    : node.relation === "supports"
                    ? "#00ff99"
                    : "#ff3b3b"
                }
                stroke="#fff"
                strokeWidth={2}
              />
              {node.type === "task" && (
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fill="#fff"
                  fontSize="14"
                  style={{ pointerEvents: "none" }}
                >
                  {node.label}
                </text>
              )}
            </g>
          ))}
        </AnimatePresence>
      </svg>
      {selectedClaim && (
        <div
          style={{
            background: "#222",
            color: "#fff",
            padding: "1em",
            borderRadius: 8,
            maxWidth: 400,
            margin: "1em auto",
          }}
        >
          <strong>
            {selectedClaim.relation === "supports"
              ? "✅ Supports"
              : "❌ Refutes"}
          </strong>
          <p style={{ marginTop: 8 }}>{selectedClaim.label}</p>
          <button
            onClick={() => setSelectedClaim(null)}
            style={{ marginTop: 10 }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default MoleculeGraph;
