// Test-only wrapper around Simple V2. System and user prose are returned
// unchanged; only the response schema is replaced by the atomicity trace schema.
import { buildSplitCall1aPrompt as buildSimpleV2Prompt }
  from "./splitCall1aDiscoveryPromptSimpleV2.js";
import { splitCall1aAtomicityTraceSchemaForArticle }
  from "./splitCall1aDiscoverySchemaAtomicityV1.js";

export function buildSplitCall1aAtomicityPrompt(context) {
  const baseline = buildSimpleV2Prompt(context);
  return { ...baseline, responseSchema: splitCall1aAtomicityTraceSchemaForArticle() };
}
