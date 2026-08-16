import type {
  AIEvidenceLink,
  ClaimLinks,
} from "../../../shared/entities/types.js";

export type WorkspaceEvidenceRelation =
  | "support"
  | "refute"
  | "nuance"
  | "unassessed";

export type WorkspaceEvidenceLinkKind =
  | "human"
  | "assertion-bearing"
  | "document-bearing"
  | "document-discovery";

export interface WorkspaceClaimLink {
  id?: string;
  claim_link_id?: number;
  claimId: number;
  referenceId: number;
  sourceClaimId: number;
  relation: WorkspaceEvidenceRelation;
  confidence: number;
  score?: number;
  pairConfidence?: number;
  supportLevel?: number;
  notes?: string;
  verimeter_score?: number;
  linkKind: WorkspaceEvidenceLinkKind;
  provisional: boolean;
  scoreEligible: boolean;
  discoveryStatus?: string;
}

export interface WorkspaceRelationPresentation {
  label: string;
  baseColor: string;
  aiStrokeColor: string;
  dotted: boolean;
  scoreEligible: boolean;
}

const SUPPORT = new Set(["support", "supports"]);
const REFUTE = new Set(["refute", "refutes", "challenge", "challenges"]);
const NUANCE = new Set(["nuance", "qualify", "qualifies", "mixed"]);

const finiteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Normalize only assertion-to-assertion bearing. Unknown and non-bearing states
 * remain unassessed; they must never silently become nuance.
 */
export function normalizeAssertionBearingRelation(
  value: unknown,
): WorkspaceEvidenceRelation {
  const relation = String(value ?? "").trim().toLowerCase();
  if (SUPPORT.has(relation)) return "support";
  if (REFUTE.has(relation)) return "refute";
  if (NUANCE.has(relation)) return "nuance";
  return "unassessed";
}

export function mapAssertionLinkForWorkspace(
  row: ClaimLinks,
): WorkspaceClaimLink {
  const relation = normalizeAssertionBearingRelation(row.relationship);
  const aiAuthored = row.created_by_ai === true || row.created_by_ai === 1;
  return {
    id: String(row.id),
    claim_link_id: row.claim_link_id,
    claimId: row.left_claim_id,
    referenceId: row.right_reference_id,
    sourceClaimId: row.source_claim_id,
    relation,
    confidence: finiteNumber(row.confidence),
    score: row.score == null ? undefined : finiteNumber(row.score),
    pairConfidence: row.pair_confidence == null
      ? undefined
      : finiteNumber(row.pair_confidence),
    supportLevel: row.support_level == null
      ? finiteNumber(row.confidence)
      : finiteNumber(row.support_level),
    notes: row.notes || "",
    verimeter_score: row.verimeter_score ?? undefined,
    linkKind: aiAuthored ? "assertion-bearing" : "human",
    provisional: false,
    scoreEligible: relation !== "unassessed",
  };
}

/**
 * A document row begins as neutral discovery provenance. Once the governed
 * bearing lifecycle publishes all three legacy metrics, it becomes an assessed
 * document relation while remaining visually distinct from assertion bearing.
 */
export function mapDocumentDiscoveryLinkForWorkspace(
  row: AIEvidenceLink,
): WorkspaceClaimLink {
  const relation = normalizeAssertionBearingRelation(row.stance);
  const assessed = relation !== "unassessed"
    && row.score !== null && row.score !== undefined
    && row.confidence !== null && row.confidence !== undefined
    && row.support_level !== null && row.support_level !== undefined;
  return {
    id: `ai-${row.link_id}`,
    claimId: row.task_claim_id,
    referenceId: row.reference_content_id,
    sourceClaimId: 0,
    relation: assessed ? relation : "unassessed",
    confidence: assessed ? finiteNumber(row.confidence) : 0,
    score: assessed ? finiteNumber(row.score) : undefined,
    pairConfidence: assessed ? finiteNumber(row.confidence) : undefined,
    supportLevel: assessed ? finiteNumber(row.support_level) : undefined,
    notes: row.rationale || "",
    verimeter_score: assessed ? finiteNumber(row.support_level) : undefined,
    linkKind: assessed ? "document-bearing" : "document-discovery",
    provisional: !assessed,
    scoreEligible: assessed,
    discoveryStatus: row.scrape_status || "unassessed",
  };
}

export function relationPresentation(
  relation: WorkspaceEvidenceRelation,
  linkKind: WorkspaceEvidenceLinkKind,
): WorkspaceRelationPresentation {
  const aiAuthored = linkKind !== "human";
  if (relation === "support") {
    return {
      label: "Supports",
      baseColor: "green",
      aiStrokeColor: "rgba(100, 255, 100, 0.5)",
      dotted: aiAuthored,
      scoreEligible: linkKind !== "document-discovery",
    };
  }
  if (relation === "refute") {
    return {
      label: "Refutes",
      baseColor: "red",
      aiStrokeColor: "rgba(255, 100, 100, 0.5)",
      dotted: aiAuthored,
      scoreEligible: linkKind !== "document-discovery",
    };
  }
  if (relation === "nuance") {
    return {
      label: "Qualifies",
      baseColor: "blue",
      aiStrokeColor: "rgba(100, 150, 255, 0.5)",
      dotted: aiAuthored,
      scoreEligible: linkKind !== "document-discovery",
    };
  }
  return {
    label: "Unassessed evidence candidate",
    baseColor: "#718096",
    aiStrokeColor: "rgba(113, 128, 150, 0.72)",
    dotted: true,
    scoreEligible: false,
  };
}
