import { CF1_ARTICLE_STANCES, CF1_ARTICLE_USES, CF1_ASSERTION_FORMS, CF1_SEMANTIC_FUNCTIONS } from "../contract.js";
import { CF1_BLOCK_OBSERVATION_SCHEMA } from "./blockObservationSchema.js";

export function buildBlockObservationPrompt({ article, batchId, blocks }) {
  const system = `You are Claim Foundry CF1 observing one bounded portion of a long article.
Record grounded local observations only. Do not select final claims, build a thesis, judge truth, browse, search, fetch, or add outside facts.
Preserve exact block and source-unit IDs, attribution, scope, and uncertainty.`;
  const user = `BATCH ${batchId}
Article title: ${article.title}

SOURCE BLOCKS
${JSON.stringify(blocks.map(({ blockId, order, heading, structuralType, text, sourceUnits }) => (
  { blockId, order, heading, structuralType, text, sourceUnits })))}

Annotate every supplied block. Extract material candidate assertions without deciding final selection. Record named works and identifiers only when literally present. Suggest cross-block links only among supplied block IDs; whole-article synthesis will resolve global relationships.

Use batch-local unique candidate IDs. Every candidate assertion and named work must cite supplied sourceUnitIds in document order.
semanticFunction: ${CF1_SEMANTIC_FUNCTIONS.join(" | ")}
articleStance: ${CF1_ARTICLE_STANCES.join(" | ")}
assertionForm: ${CF1_ASSERTION_FORMS.join(" | ")}
articleUse: ${CF1_ARTICLE_USES.join(" | ")}`;
  return { system, user, responseSchema: CF1_BLOCK_OBSERVATION_SCHEMA };
}
