import type {
  CfxCanonicalInventory,
  CfxFrozenArticle,
  CfxGroundingComparison,
  CfxS2ArmResult,
} from "../../types/index.js";

export type CfxS2ReportInput = {
  runId: string;
  fixtureId: string;
  generatedAt: string;
  provider: "OpenAI";
  model: string;
  promptId: string;
  promptHash: string;
  schemaHash: string;
  article: CfxFrozenArticle;
  canonicalInventory: CfxCanonicalInventory;
  wholeArticle: CfxS2ArmResult;
  perProposition: CfxS2ArmResult;
  comparison: CfxGroundingComparison;
  artifactPaths: string[];
  artifactHashes: Array<{ path: string; sha256: string }>;
};
