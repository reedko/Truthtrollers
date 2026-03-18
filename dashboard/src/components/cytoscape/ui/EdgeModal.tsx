import React from "react";
import { createPortal } from "react-dom";
import { SelectedEdge } from "../types";

interface EdgeModalProps {
  edge: SelectedEdge | null;
  onClose: () => void;
}

export const EdgeModal: React.FC<EdgeModalProps> = ({ edge, onClose }) => {
  if (!edge) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#222",
        color: "#fff",
        padding: "1rem",
        borderRadius: 12,
        boxShadow: "0 0 20px rgba(0,0,0,0.6)",
        zIndex: 1000,
        width: "min(92vw, 560px)",
        maxHeight: "min(78vh, 640px)",
        overflowY: "auto",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        WebkitOverflowScrolling: "touch",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <h3
        style={{
          marginBottom: "0.5em",
          fontSize: "1rem",
          lineHeight: 1.2,
        }}
      >
        {edge.relation === "supports"
          ? "✅ Supports"
          : edge.relation === "refutes"
            ? "❌ Refutes"
            : "↔️ Related"}{" "}
        ({Math.round(Math.abs(edge.value) * 100)}% confidence)
      </h3>
      <p>
        <strong>From:</strong> {edge.sourceLabel}
      </p>
      <p>
        <strong>To:</strong> {edge.targetLabel}
      </p>
      <p style={{ marginTop: "1em" }}>
        <strong>Notes:</strong>
      </p>
      <p>{edge.notes || "—"}</p>
      <button
        onClick={onClose}
        style={{
          marginTop: 16,
          background: "#6c5ce7",
          color: "#fff",
          padding: "0.6em 1em",
          borderRadius: 8,
          width: "100%",
          fontSize: "0.95rem",
          cursor: "pointer",
          border: "none",
        }}
      >
        Close
      </button>
    </div>,
    document.body,
  );
};
