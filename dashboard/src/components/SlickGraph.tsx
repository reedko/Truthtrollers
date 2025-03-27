// src/components/SlickGraph.tsx
import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { motion, AnimatePresence } from "framer-motion";

interface NodeType {
  id: string;
  type: string;
  label: string;
  x?: number;
  y?: number;
  relation?: "supports" | "refutes";
}

const initialNodes: NodeType[] = [
  { id: "task-1", type: "task", label: "Main Task" },
  { id: "claim-1", type: "claim", label: "Claim A", relation: "supports" },
  { id: "claim-2", type: "claim", label: "Claim B", relation: "refutes" },
  { id: "claim-3", type: "claim", label: "Claim C", relation: "supports" },
];

const SlickGraph: React.FC = () => {
  const width = 800;
  const height = 600;
  const centerX = width / 2;
  const centerY = height / 2;

  const [nodes, setNodes] = useState<NodeType[]>(initialNodes);
  const [selectedClaim, setSelectedClaim] = useState<NodeType | null>(null);

  useEffect(() => {
    const task = nodes.find((n) => n.type === "task");
    if (!task) return;

    const claims = nodes.filter((n) => n.type === "claim");
    const angleStep = (2 * Math.PI) / claims.length;
    const claimRadius = 60;

    const positionedClaims = claims.map((claim, i) => {
      const angle = i * angleStep;
      return {
        ...claim,
        x: centerX + claimRadius * Math.cos(angle),
        y: centerY + claimRadius * Math.sin(angle),
      };
    });

    setNodes([{ ...task, x: centerX, y: centerY }, ...positionedClaims]);
  }, []);

  return (
    <div style={{ border: "2px solid #ccc", padding: 8, maxWidth: width }}>
      <svg width={width} height={height} style={{ background: "#111" }}>
        <AnimatePresence>
          {nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: node.type === "claim" ? "pointer" : "default" }}
              onClick={() =>
                node.type === "claim" ? setSelectedClaim(node) : undefined
              }
            >
              {node.type === "task" ? (
                <motion.circle
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1.4, opacity: 1 }}
                  transition={{ duration: 0.6 }}
                  r={40}
                  fill="#6c5ce7"
                  stroke="#fff"
                  strokeWidth={3}
                />
              ) : (
                <motion.circle
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  r={10}
                  fill={node.relation === "supports" ? "#00ff99" : "#ff3b3b"}
                  stroke="#111"
                  strokeWidth={1.5}
                />
              )}
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
            marginTop: 12,
            background: "#222",
            color: "#fff",
            padding: "1em",
            borderRadius: 8,
            maxWidth: 400,
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

export default SlickGraph;
