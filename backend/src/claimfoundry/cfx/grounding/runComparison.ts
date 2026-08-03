import type {
  CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import type {
  CfxCanonicalInventory,
  CfxFrozenArticle,
  CfxGroundingComparison,
  CfxProviderConfig,
  CfxS2ArmResult,
  CfxStructuredProvider,
} from "../types/index.js";
import { createCfxS2ForensicHooks } from "../artifacts/s2Forensics.js";
import { compareCfxGroundingArms } from "./comparison.js";
import {
  DEFAULT_CFX_GROUNDING_CONFIG,
  runCfxGroundingArm,
} from "./runGrounding.js";

export type CfxS2ComparisonResult = {
  wholeArticle: CfxS2ArmResult;
  perProposition: CfxS2ArmResult;
  comparison: CfxGroundingComparison;
  providerCallCount: 13;
};

export async function runCfxS2Comparison(input: {
  artifactRoot: string;
  article: CfxFrozenArticle;
  canonicalInventory: CfxCanonicalInventory;
  prompt: CfxGovernedPrompt;
  provider: CfxStructuredProvider;
  config?: CfxProviderConfig;
}): Promise<CfxS2ComparisonResult> {
  const config = input.config ?? DEFAULT_CFX_GROUNDING_CONFIG;
  const wholeArticle = await runCfxGroundingArm({
    mode: "wholeArticle",
    article: input.article,
    canonicalInventory: input.canonicalInventory,
    prompt: input.prompt,
    provider: input.provider,
    config,
    hooks: createCfxS2ForensicHooks({
      root: input.artifactRoot,
      mode: "wholeArticle",
    }),
  });
  const perProposition = await runCfxGroundingArm({
    mode: "perProposition",
    article: input.article,
    canonicalInventory: input.canonicalInventory,
    prompt: input.prompt,
    provider: input.provider,
    config,
    hooks: createCfxS2ForensicHooks({
      root: input.artifactRoot,
      mode: "perProposition",
    }),
  });
  return {
    wholeArticle,
    perProposition,
    comparison: compareCfxGroundingArms({
      wholeArticle,
      perProposition,
      propositionIds: input.canonicalInventory.propositions.map(
        (item) => item.propositionId,
      ),
    }),
    providerCallCount: 13,
  };
}
