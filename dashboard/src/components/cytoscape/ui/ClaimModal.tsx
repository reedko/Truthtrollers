import React from "react";
import { createPortal } from "react-dom";
import { SelectedClaim } from "../types";

interface ClaimModalProps {
  claim: SelectedClaim | null;
  onClose: () => void;
}

export const ClaimModal: React.FC<ClaimModalProps> = ({ claim, onClose }) => {
  if (!claim) return null;

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
        width: "min(92vw, 520px)",
        maxHeight: "min(78vh, 560px)",
        overflowY: "auto",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        WebkitOverflowScrolling: "touch",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <h3
        style={{
          fontSize: "1.1rem",
          lineHeight: 1.2,
          marginBottom: "12px",
          color: "#00a2ff",
        }}
      >
        Source Claim{" "}
        {claim.relation === "supports"
          ? "✅ SUPPORTS"
          : claim.relation === "refutes"
            ? "❌ REFUTES"
            : "RELATES TO"}{" "}
        Task Claim
      </h3>

      <div style={{ marginBottom: "16px" }}>
        <strong style={{ color: "#10b981", fontSize: "0.85rem" }}>
          REF CLAIM:
        </strong>
        <p
          style={{
            marginTop: 6,
            fontSize: "0.95rem",
            lineHeight: 1.35,
            color: "#f1f5f9",
          }}
        >
          {claim.label}
        </p>
      </div>

      {claim.taskClaimLabel && (
        <div style={{ marginBottom: "16px" }}>
          <strong style={{ color: "#6366f1", fontSize: "0.85rem" }}>
            TASK CLAIM:
          </strong>
          <p
            style={{
              marginTop: 6,
              fontSize: "0.95rem",
              lineHeight: 1.35,
              color: "#f1f5f9",
            }}
          >
            {claim.taskClaimLabel}
          </p>
        </div>
      )}

      {claim.notes && (
        <div style={{ marginBottom: "16px" }}>
          <strong style={{ color: "#fbbf24", fontSize: "0.85rem" }}>
            NOTES:
          </strong>
          <p
            style={{
              marginTop: 6,
              fontSize: "0.9rem",
              lineHeight: 1.3,
              color: "#d1d5db",
              fontStyle: "italic",
            }}
          >
            {claim.notes}
          </p>
        </div>
      )}

      <button
        onClick={onClose}
        style={{
          marginTop: 16,
          background:
            "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.2))",
          border: "1px solid rgba(0, 162, 255, 0.6)",
          color: "#00a2ff",
          padding: "0.6em 1em",
          borderRadius: 8,
          width: "100%",
          fontSize: "0.95rem",
          fontWeight: "600",
          cursor: "pointer",
        }}
      >
        CLOSE
      </button>
    </div>,
    document.body,
  );
};
