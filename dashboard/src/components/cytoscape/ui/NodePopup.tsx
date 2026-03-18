import React from "react";
import { HoveredNodePopup } from "../types";

interface NodePopupProps {
  popup: HoveredNodePopup | null;
}

export const NodePopup: React.FC<NodePopupProps> = ({ popup }) => {
  if (!popup) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${popup.x + 20}px`,
        top: `${popup.y - 30}px`,
        background:
          "linear-gradient(135deg, rgba(0, 0, 0, 0.92), rgba(15, 23, 42, 0.88))",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(0, 162, 255, 0.5)",
        borderRadius: "8px",
        padding: "10px 16px",
        color: "#e2e8f0",
        fontSize: "14px",
        fontWeight: "500",
        lineHeight: "1.3",
        maxWidth: "400px",
        textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
        boxShadow:
          "0 4px 24px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 162, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        pointerEvents: "none",
        zIndex: 2000,
        letterSpacing: "0.3px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {popup.label}
    </div>
  );
};
