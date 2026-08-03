import type {
  Cf7StructuredModelRequest,
} from "../../shared/provider/index.js";
import {
  CFX_GROUNDING_JSON_SCHEMA,
} from "../schemas/groundingSchema.js";
import type {
  CfxCanonicalProposition,
  CfxFrozenArticle,
  CfxProviderConfig,
} from "../types/index.js";
import type {
  CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";

export function buildCfxGroundingRequest(input: {
  article: CfxFrozenArticle;
  propositions: CfxCanonicalProposition[];
  prompt: CfxGovernedPrompt;
  config: CfxProviderConfig;
}): Cf7StructuredModelRequest {
  if (input.propositions.length < 1 || input.propositions.length > 12) {
    throw new Error("CFX grounding requests require between 1 and 12 propositions");
  }
  const modelVisiblePropositions = input.propositions.map((proposition) => ({
    propositionId: proposition.propositionId,
    assertion: proposition.assertion,
    assertionSource: proposition.assertionSource,
    whyItMattersToArticleThesis:
      proposition.whyItMattersToArticleThesis,
  }));
  return {
    system: "",
    user: [
      input.prompt.prompt,
      "FIXED PROPOSITIONS",
      JSON.stringify(modelVisiblePropositions, null, 2),
      "COMPLETE ARTICLE SOURCE UNITS",
      input.article.unitProjection,
    ].join("\n\n"),
    responseSchema: CFX_GROUNDING_JSON_SCHEMA,
    model: input.config.model,
    temperature: input.config.temperature,
    retryCount: input.config.retryCount,
    store: input.config.store,
    maxOutputTokens: input.config.maxOutputTokens,
    timeoutMs: input.config.timeoutMs,
  };
}
