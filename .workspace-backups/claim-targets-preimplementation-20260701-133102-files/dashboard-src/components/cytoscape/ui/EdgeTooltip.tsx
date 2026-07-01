import React from "react";
import { createPortal } from "react-dom";
import { HoveredEdgeTooltip } from "../types";

interface EdgeTooltipProps {
  tooltip: HoveredEdgeTooltip | null;
}

export const EdgeTooltip: React.FC<EdgeTooltipProps> = ({ tooltip }) => {
  if (!tooltip) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: tooltip.y + 10,
        left: tooltip.x + 10,
        background: "#333",
        color: "#fff",
        padding: "0.5em 1em",
        borderRadius: 6,
        fontSize: "0.85em",
        pointerEvents: "none",
        zIndex: 1000,
        whiteSpace: "nowrap",
        boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
      }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
};
