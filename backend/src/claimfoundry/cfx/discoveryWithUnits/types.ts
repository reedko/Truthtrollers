import type {
  CfxDiagnostic,
  CfxProviderConfig,
  CfxUsage,
} from "../types/index.js";

export type CfxUnitAwareProposition = {
  propositionId: string;
  assertion: string;
  assertionSource: string;
  whyItMattersToArticleThesis: string;
  groundingUnitIds: string[];
};

export type CfxUnitAwareInventory = {
  schemaVersion: "cfx.unitAwarePropositions.v1";
  fixtureId: string;
  propositions: CfxUnitAwareProposition[];
};

export type CfxUnitAwareDiscoveryResult = {
  status: "completed" | "failed";
  providerCallCount: 1;
  inventory: CfxUnitAwareInventory | null;
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
