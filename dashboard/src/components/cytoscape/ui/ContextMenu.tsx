import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95))",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(0, 162, 255, 0.4)",
        borderRadius: "8px",
        boxShadow:
          "0 8px 32px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
        zIndex: 10000,
        minWidth: "180px",
        overflow: "hidden",
        animation: "contextMenuFadeIn 0.15s ease-out",
      }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
          disabled={item.disabled}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: "transparent",
            border: "none",
            color: item.disabled ? "#64748b" : "#e2e8f0",
            fontSize: "14px",
            fontWeight: "500",
            textAlign: "left",
            cursor: item.disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            transition: "background 0.15s ease",
            borderBottom:
              index < items.length - 1 ? "1px solid rgba(100, 116, 139, 0.2)" : "none",
            opacity: item.disabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              e.currentTarget.style.background = "rgba(0, 162, 255, 0.15)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.icon && (
            <span style={{ fontSize: "16px", width: "20px", textAlign: "center" }}>
              {item.icon}
            </span>
          )}
          <span>{item.label}</span>
        </button>
      ))}

      <style>
        {`
          @keyframes contextMenuFadeIn {
            from {
              opacity: 0;
              transform: scale(0.95) translateY(-5px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `}
      </style>
    </div>,
    document.body,
  );
};
