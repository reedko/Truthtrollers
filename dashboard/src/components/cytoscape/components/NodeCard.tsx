import React from "react";
import cytoscape from "cytoscape";
import { colorSchemes, getColorScheme } from "../styles/colorSchemes";
import { DisplayMode, NodeData } from "../types";
import { API_BASE_URL } from "../constants";

interface NodeCardProps {
  node: cytoscape.NodeSingular;
  containerRect: DOMRect;
  zoom: number;
  allNodes: NodeData[];
  allLinks?: any[];
  pinnedReferenceIds?: Set<number>;
  onTogglePin?: (contentId: number) => void;
  displayMode?: DisplayMode;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onCycleDisplayMode?: (nodeId: string) => void;
}

export const NodeCard: React.FC<NodeCardProps> = ({
  node,
  containerRect,
  zoom,
  allNodes,
  allLinks,
  pinnedReferenceIds,
  onTogglePin,
  displayMode: globalDisplayMode = "mr_cards",
  nodeSettings,
  onCycleDisplayMode,
}) => {
  const pos = node.renderedPosition();
  const data = node.data();
  const type = data.type;
  const id = node.id();

  const isPinned =
    type === "reference" &&
    data.content_id &&
    pinnedReferenceIds?.has(data.content_id);

  const isDimmed = data.dimmed;

  const linkData = allLinks?.find(
    (link: any) => link.source === id || link.target === id,
  );
  const rationale = linkData?.rationale;
  const stance = linkData?.stance;
  const [showRationale, setShowRationale] = React.useState(false);

  const displayMode = nodeSettings?.[id]?.displayMode || globalDisplayMode;
  const currentDisplayMode = displayMode;

  // CIRCLES MODE
  if (displayMode === "circles") {
    const veracityScore = data.veracity_score ?? data.rating;
    const claimCount = data.claimCount;
    const confidence = data.confidence_level;

    return (
      <>
        {showRationale && rationale && (
          <div
            style={{
              position: "absolute",
              left: `${pos.x - 100}px`,
              top: `${pos.y - 100}px`,
              width: "200px",
              background: "rgba(15, 23, 42, 0.98)",
              backdropFilter: "blur(12px)",
              border: "2px solid rgba(139, 92, 246, 0.5)",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "11px",
              lineHeight: "1.5",
              color: "#e2e8f0",
              boxShadow:
                "0 8px 32px rgba(0, 0, 0, 0.8), 0 0 20px rgba(139, 92, 246, 0.3)",
              pointerEvents: "none",
              transform: `scale(${zoom})`,
              transformOrigin: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: "700",
                color: "#a78bfa",
                marginBottom: "6px",
              }}
            >
              {stance?.toUpperCase()} - RATIONALE:
            </div>
            {rationale}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            left: `${pos.x}px`,
            top: `${pos.y + 80}px`,
            transform: `translate(-50%, 0) scale(${zoom})`,
            transformOrigin: "top center",
            display: "flex",
            gap: "4px",
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {veracityScore != null && (
            <div
              style={{
                background:
                  "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15))",
                border: "1px solid rgba(99, 102, 241, 0.4)",
                borderRadius: "12px",
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: "700",
                color: "#a5b4fc",
                backdropFilter: "blur(8px)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
              }}
            >
              {typeof veracityScore === "number"
                ? `${Math.round(veracityScore * 100)}%`
                : veracityScore}
            </div>
          )}
          {claimCount != null && claimCount > 0 && (
            <div
              style={{
                background:
                  "linear-gradient(135deg, rgba(249, 115, 22, 0.2), rgba(234, 88, 12, 0.15))",
                border: "1px solid rgba(249, 115, 22, 0.4)",
                borderRadius: "12px",
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: "700",
                color: "#fed7aa",
                backdropFilter: "blur(8px)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
              }}
            >
              {claimCount} {claimCount === 1 ? "claim" : "claims"}
            </div>
          )}
          {confidence != null && (
            <div
              style={{
                background:
                  "linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.15))",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                borderRadius: "12px",
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: "700",
                color: "#6ee7b7",
                backdropFilter: "blur(8px)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
              }}
            >
              {Math.round(confidence * 100)}% conf
            </div>
          )}
        </div>
      </>
    );
  }

  // COMPACT MODE
  if (displayMode === "compact") {
    const scheme = getColorScheme(type);
    const veracityScore = data.veracity_score ?? data.rating;
    const claimCount = data.claimCount;

    const metrics = [];
    if (veracityScore != null) {
      metrics.push({
        label: "Score",
        value:
          typeof veracityScore === "number"
            ? `${Math.round(veracityScore * 100)}%`
            : veracityScore,
      });
    }
    if (claimCount != null && claimCount > 0) {
      metrics.push({
        label: "Claims",
        value: claimCount,
      });
    }

    return (
      <div
        style={{
          position: "absolute",
          left: `${pos.x - 60}px`,
          top: `${pos.y - 70}px`,
          width: "120px",
          height: "140px",
          background: scheme.bg,
          backdropFilter: "blur(4px)",
          border: `1px solid ${scheme.border}`,
          borderRadius: "10px",
          boxShadow: `${scheme.glow}, 0 4px 16px rgba(0, 0, 0, 0.2)`,
          pointerEvents: "none",
          padding: "8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
          opacity: isDimmed ? 0.3 : 1.0,
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: "600",
            color: scheme.text,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {data.label}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {metrics.map((metric, i) => (
            <div
              key={i}
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                borderRadius: "4px",
                padding: "4px",
                fontSize: "10px",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#94a3b8", fontSize: "9px" }}>
                {metric.label}
              </div>
              <div style={{ fontSize: "12px", marginTop: "2px" }}>
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        {type === "reference" && onTogglePin && data.content_id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(data.content_id);
            }}
            style={{
              position: "absolute",
              top: "4px",
              right: "4px",
              background: isPinned
                ? "rgba(251, 191, 36, 0.3)"
                : "rgba(100, 116, 139, 0.3)",
              border: "none",
              borderRadius: "4px",
              padding: "2px 4px",
              cursor: "pointer",
              fontSize: "12px",
              pointerEvents: "auto",
            }}
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
        )}

        {onCycleDisplayMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCycleDisplayMode(id);
            }}
            style={{
              position: "absolute",
              top: "4px",
              left: "4px",
              background: "rgba(99, 102, 241, 0.3)",
              border: "1px solid rgba(99, 102, 241, 0.5)",
              borderRadius: "4px",
              padding: "2px 4px",
              cursor: "pointer",
              fontSize: "10px",
              pointerEvents: "auto",
              color: scheme.text,
            }}
            title="Cycle display mode"
          >
            {currentDisplayMode === "circles"
              ? "⚪"
              : currentDisplayMode === "compact"
                ? "📊"
                : "🎴"}
          </button>
        )}
      </div>
    );
  }

  // MR_CARDS MODE (default)
  let scheme = getColorScheme(type);

  const group =
    type === "author"
      ? 1
      : type === "task" || type === "reference"
        ? 2
        : type === "publisher"
          ? 3
          : 0;

  let thumbnailUrl;
  if (type === "author") {
    const authorId = data.author_id || id.replace("autho-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/authors/${authorId}`;
  } else if (type === "task" || type === "reference") {
    const contentId = data.content_id || id.replace("conte-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/content/${contentId}`;
  } else if (type === "publisher") {
    const publisherId = data.publisher_id || id.replace("publi-", "");
    thumbnailUrl = `${API_BASE_URL}/api/image/publishers/${publisherId}`;
  } else {
    thumbnailUrl = `${API_BASE_URL}/assets/images/ttlogo11.png`;
  }

  // Special handling for unified claim cards
  if (type === "unifiedClaim") {
    const relation = data.relation || "related";
    const refClaimText = data.refClaimLabel || "";
    const taskClaimText = data.taskClaimLabel || "";

    return (
      <div
        style={{
          position: "absolute",
          left: `${pos.x - 130}px`,
          top: `${pos.y - 160}px`,
          width: "260px",
          height: "320px",
          background: scheme.bg,
          backdropFilter: "blur(6px)",
          border: `1.5px solid ${scheme.border}`,
          borderRadius: "16px",
          boxShadow: `${scheme.glow}, 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
          pointerEvents: "none",
          transition: "all 0.3s ease",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "60%",
            height: "60%",
            backgroundImage: `url(${thumbnailUrl})`,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            opacity: 0.08,
            zIndex: 0,
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "20px",
            height: "100%",
            background: scheme.leftEdge,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "8px",
          }}
        >
          <div
            style={{
              flex: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px",
              background: "rgba(16, 185, 129, 0.1)",
              borderRadius: "8px",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                color: "#6ee7b7",
                fontSize: "32px",
                fontWeight: "600",
                lineHeight: "1.4",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textShadow: `0 0 6px rgba(110, 231, 183, 0.4), 0 1px 2px rgba(0, 0, 0, 0.8)`,
              }}
            >
              {refClaimText}
            </div>
          </div>

          <div
            style={{
              padding: "4px 8px",
              background:
                relation === "supports"
                  ? "rgba(16, 185, 129, 0.2)"
                  : relation === "refutes"
                    ? "rgba(239, 68, 68, 0.2)"
                    : "rgba(251, 191, 36, 0.2)",
              borderRadius: "6px",
              textAlign: "center",
              fontSize: "11px",
              fontWeight: "700",
              color: "#e2e8f0",
              marginBottom: "6px",
            }}
          >
            {relation === "supports"
              ? "✅ SUPPORTS"
              : relation === "refutes"
                ? "❌ REFUTES"
                : "↔️ RELATED"}
          </div>

          <div
            style={{
              flex: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px",
              background: "rgba(99, 102, 241, 0.1)",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                color: "#a5b4fc",
                fontSize: "12px",
                fontWeight: "600",
                lineHeight: "1.4",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textShadow: `0 0 6px rgba(165, 180, 252, 0.4), 0 1px 2px rgba(0, 0, 0, 0.8)`,
              }}
            >
              {taskClaimText}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standard MR Card for other node types
  return (
    <div
      style={{
        position: "absolute",
        left: `${pos.x - 100}px`,
        top: `${pos.y - 120}px`,
        width: "200px",
        height: "240px",
        background: scheme.bg,
        backdropFilter: "blur(12px)",
        border: `1.5px solid ${scheme.border}`,
        borderRadius: "16px",
        boxShadow: `${scheme.glow}, 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
        pointerEvents: "none",
        transition: "all 0.3s ease",
        overflow: "hidden",
        transform: `scale(${zoom})`,
        transformOrigin: "center center",
        opacity: isDimmed ? 0.3 : 1.0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "20px",
          height: "100%",
          background: scheme.leftEdge,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "140px",
          backgroundImage: `url(${thumbnailUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.6,
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "100px",
          background: scheme.titleBg,
          backdropFilter: "blur(8px)",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          zIndex: 2,
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: "700",
            color: scheme.text,
            lineHeight: "1.3",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            textShadow: `0 0 6px ${scheme.text}40, 0 1px 2px rgba(0, 0, 0, 0.8)`,
          }}
        >
          {data.label}
        </div>

        {(data.veracity_score != null || data.claimCount != null) && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {data.veracity_score != null && (
              <div
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(99, 102, 241, 0.3)",
                  color: "#a5b4fc",
                  fontWeight: "600",
                }}
              >
                {Math.round(data.veracity_score * 100)}%
              </div>
            )}
            {data.claimCount != null && data.claimCount > 0 && (
              <div
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(249, 115, 22, 0.3)",
                  color: "#fed7aa",
                  fontWeight: "600",
                }}
              >
                {data.claimCount} claims
              </div>
            )}
          </div>
        )}
      </div>

      {type === "reference" && onTogglePin && data.content_id && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            zIndex: 10,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(data.content_id);
            }}
            style={{
              background: isPinned
                ? "linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(251, 191, 36, 0.2))"
                : "linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(100, 116, 139, 0.2))",
              border: `1px solid ${isPinned ? "rgba(251, 191, 36, 0.6)" : "rgba(100, 116, 139, 0.4)"}`,
              borderRadius: "8px",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "18px",
              pointerEvents: "auto",
              transition: "all 0.2s ease",
              boxShadow: isPinned
                ? "0 0 10px rgba(251, 191, 36, 0.3)"
                : "0 2px 8px rgba(0, 0, 0, 0.3)",
            }}
            title={isPinned ? "Unpin from view" : "Pin to view"}
          >
            {isPinned ? "📌" : "📍"}
          </button>
        </div>
      )}
    </div>
  );
};
