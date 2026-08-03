import type {
  CfxDiagnostic,
  CfxProviderConfig,
  CfxUsage,
} from "../types/index.js";
import type {
  CfxEvidenceSearchHandoff,
} from "../evidenceSearch/types.js";

export type CfxSubstantiveReviewRow = {
  propositionId: string;
  substantiveAssertion: string;
  assertionSource: string;
  articleStance: "adopts" | "challenges" | "reports";
  evidenceSearchHandoff?: CfxEvidenceSearchHandoff;
};

export type CfxSubstantiveReviewInventory = {
  schemaVersion: "cfx.substantiveReview.v1";
  sourceUnitAwareInventoryHash: string;
  results: CfxSubstantiveReviewRow[];
};

export type CfxSubstantiveReviewResult = {
  status: "completed" | "failed";
  providerCallCount: 1;
  inventory: CfxSubstantiveReviewInventory | null;
  rawOutput: unknown;
  diagnostics: CfxDiagnostic[];
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: CfxUsage;
  latencyMs: number;
  requestHash: string;
  promptHash: string;
  schemaHash: string;
  error: { name: string; message: string } | null;
  configuration: CfxProviderConfig;
};
