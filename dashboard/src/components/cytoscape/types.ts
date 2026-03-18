import cytoscape from "cytoscape";
import { GraphNode } from "../../../../shared/entities/types";

export type DisplayMode = "mr_cards" | "circles" | "compact";

export type NodeData = {
  id: string;
  label: string;
  type: string;
  claim_id?: number;
  content_id?: number;
  author_id?: number;
  publisher_id?: number;
  url?: string;
  rating?: string | number;
  veracity_score?: number;
  confidence_level?: number;
  claimCount?: number;
  refCount?: number;
  rationale?: string;
  stance?: string;
  added_by_user_id?: number | null;
  is_system?: boolean;
  dimmed?: boolean;
  relation?: string;
  refClaimLabel?: string;
  taskClaimLabel?: string;
};

export type LinkData = {
  id: string;
  source: string;
  target: string;
  relation?: "supports" | "refutes" | "related";
  notes?: string;
  value?: number;
  rationale?: string;
  stance?: string;
  claimAggregate?: {
    supportsCount: number;
    refutesCount: number;
    supportsPercent: number;
    refutesPercent: number;
    total: number;
  };
};

export interface CytoscapeMoleculeProps {
  nodes: NodeData[];
  currentUserId?: number | null;
  links: LinkData[];
  onNodeClick?: (node: GraphNode) => void;
  centerNodeId?: string;
  pinnedReferenceIds?: Set<number>;
  onTogglePin?: (contentId: number) => void;
  displayMode?: DisplayMode;
  savedPositions?: Record<string, { x: number; y: number }> | null;
  onPositionsChange?: (
    positions: Record<string, { x: number; y: number }>,
  ) => void;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onNodeSettingsChange?: (
    settings: Record<string, { displayMode: DisplayMode }>,
  ) => void;
}

export interface NodeCardProps {
  node: cytoscape.NodeSingular;
  containerRect: DOMRect;
  zoom: number;
  allNodes: NodeData[];
  allLinks?: LinkData[];
  pinnedReferenceIds?: Set<number>;
  onTogglePin?: (contentId: number) => void;
  displayMode?: DisplayMode;
  nodeSettings?: Record<string, { displayMode: DisplayMode }> | null;
  onCycleDisplayMode?: (nodeId: string) => void;
}

export interface SelectedClaim {
  id: string;
  label: string;
  taskClaimLabel?: string;
  relation: string;
  notes?: string;
}

export interface SelectedEdge {
  sourceLabel: string;
  targetLabel: string;
  relation: string;
  value: number;
  notes: string;
}

export interface HoveredEdgeTooltip {
  label: string;
  x: number;
  y: number;
}

export interface HoveredNodePopup {
  label: string;
  x: number;
  y: number;
}
