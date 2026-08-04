// Reusable fresh-article case-assertion stage:
//
//   fresh scraped article text
//     -> S0 normalization and source-unit grounding (freezeCfxArticleFromText)
//     -> S1 discovery (the unit-aware runCfxDiscoveryWithUnits -- the only S1
//        whose output type-checks as input to the S2 below)
//     -> S2 substantive review (runCfxSubstantiveReview), which internally
//        attaches evidenceSearchHandoff/query hints deterministically
//     -> exactly 12 case assertions with grounding and evidence-search handoff
//
// This module performs no DB writes, no retrieval, no acquisition, no packet
// selection, no bearing extraction, no SourceCrest, and no final linking. It
// is not a CLI script -- it exports one reusable async function with an
// injectable provider, so it can be tested with mocked model responses and
// wired into a real caller later without change.

import type {
  Cf7StructuredModelRequest,
} from "../../shared/provider/index.js";
import { sha256 } from "../artifacts/immutableArtifacts.js";
import {
  freezeCfxArticleFromText,
} from "../input/freezeArticle.js";
import {
  loadCfxDiscoveryWithUnitsPrompt,
  loadCfxSubstantiveReviewPrompt,
} from "../prompts/governedPrompts.js";
import {
  runCfxDiscoveryWithUnits,
} from "../discoveryWithUnits/runDiscoveryWithUnits.js";
import type {
  CfxUnitAwareDiscoveryResult,
  CfxUnitAwareInventory,
} from "../discoveryWithUnits/types.js";
import {
  runCfxSubstantiveReview,
} from "../substantiveReview/runSubstantiveReview.js";
import type {
  CfxSubstantiveReviewResult,
  CfxSubstantiveReviewRow,
} from "../substantiveReview/types.js";
import type {
  CfxFrozenArticle,
  CfxProviderConfig,
  CfxStructuredProvider,
} from "../types/index.js";

export type CfxFreshArticleCaseAssertionsResult = {
  status: "completed" | "failed";
  article: CfxFrozenArticle;
  discovery: CfxUnitAwareDiscoveryResult;
  sourceInventory: CfxUnitAwareInventory | null;
  substantiveReview: CfxSubstantiveReviewResult | null;
  /** Exactly 12 accepted case assertions with evidenceSearchHandoff attached, or null if either stage failed. */
  caseAssertions: CfxSubstantiveReviewRow[] | null;
  failedStage: "S1" | "S2" | null;
};

type InvokeHooks = {
  beforeInvoke?: (request: Cf7StructuredModelRequest) => Promise<void>;
  afterResponse?: (value: {
    rawResponse: unknown;
    parsedOutput: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
};

/**
 * Runs S0 -> S1 (unit-aware discovery) -> S2 (substantive review) for a
 * freshly scraped article and returns exactly 12 case assertions, each with
 * grounding unit IDs and an evidenceSearchHandoff (query hints) preserved.
 * Fails closed: if S1 or S2 does not produce a valid, exactly-12-row result,
 * caseAssertions is null and failedStage identifies which stage rejected.
 */
export async function runCfxFreshArticleCaseAssertions(input: {
  title: string;
  text: string;
  sourceUrl?: string;
  contentId?: number;
  provider: CfxStructuredProvider;
  discoveryConfig?: CfxProviderConfig;
  substantiveReviewConfig?: CfxProviderConfig;
  discoveryHooks?: InvokeHooks;
  substantiveReviewHooks?: InvokeHooks;
}): Promise<CfxFreshArticleCaseAssertionsResult> {
  const article = freezeCfxArticleFromText({
    title: input.title,
    text: input.text,
    sourceUrl: input.sourceUrl,
    contentId: input.contentId,
  });

  const discoveryPrompt = await loadCfxDiscoveryWithUnitsPrompt();
  const discovery = await runCfxDiscoveryWithUnits({
    article,
    prompt: discoveryPrompt,
    provider: input.provider,
    config: input.discoveryConfig,
    beforeInvoke: input.discoveryHooks?.beforeInvoke,
    afterResponse: input.discoveryHooks?.afterResponse,
  });

  if (discovery.status !== "completed" || !discovery.inventory) {
    return {
      status: "failed",
      article,
      discovery,
      sourceInventory: null,
      substantiveReview: null,
      caseAssertions: null,
      failedStage: "S1",
    };
  }

  const sourceInventoryHash = sha256(JSON.stringify(discovery.inventory));
  const reviewPrompt = await loadCfxSubstantiveReviewPrompt();
  const substantiveReview = await runCfxSubstantiveReview({
    article,
    inventory: discovery.inventory,
    sourceInventoryHash,
    prompt: reviewPrompt,
    provider: input.provider,
    config: input.substantiveReviewConfig,
    beforeInvoke: input.substantiveReviewHooks?.beforeInvoke,
    afterResponse: input.substantiveReviewHooks?.afterResponse,
  });

  if (
    substantiveReview.status !== "completed"
    || !substantiveReview.inventory
    || substantiveReview.inventory.results.length !== 12
  ) {
    return {
      status: "failed",
      article,
      discovery,
      sourceInventory: discovery.inventory,
      substantiveReview,
      caseAssertions: null,
      failedStage: "S2",
    };
  }

  return {
    status: "completed",
    article,
    discovery,
    sourceInventory: discovery.inventory,
    substantiveReview,
    caseAssertions: substantiveReview.inventory.results,
    failedStage: null,
  };
}
