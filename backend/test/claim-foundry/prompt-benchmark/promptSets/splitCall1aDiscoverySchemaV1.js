// Call 1A schema for the Call-1 split arm (pipeline-y-canonical-relation-split-v1).
// 1A does canonical proposition DISCOVERY only: it finds and preserves each P and
// never decides how the article feels about it. To guarantee it reuses live field
// names with zero drift and zero duplication, this schema is DERIVED from the live
// cf1_semantic_inventory_v1 by removing exactly the posture/source fields 1A must
// not touch — never a hand-copied field list. There is no propositionCore here:
// claimText is the canonical P, same field the host preserves downstream.
import { CF1_SEMANTIC_INVENTORY_SCHEMA } from "../../../../src/claim-foundry/prompts/semanticInventorySchema.js";

// Posture/source/effects fields 1A is explicitly forbidden from emitting. 1B owns
// posture and source; the host derives scoreTransform; no warrant field exists.
export const EXCLUDED_FROM_1A = Object.freeze([
  "articleRole", "articleUse", "assertionSource",
  "ifSupportedEffect", "ifRefutedEffect", "scoreTransformCheck", "warrant",
]);

function deriveDiscoverySchema() {
  const schema = structuredClone(CF1_SEMANTIC_INVENTORY_SCHEMA);
  schema.name = "cf1_semantic_inventory_split_discovery_v1";
  // Call 1A is an unbounded recall inventory. The deterministic selector, not
  // the model schema, owns the later Call 1B and final-portfolio ceilings. The
  // streamed transport guards exact repetition loops and the request retains an
  // output-token limit.
  delete schema.schema.properties.candidateClaims.minItems;
  delete schema.schema.properties.candidateClaims.maxItems;
  const claim = schema.schema.properties.candidateClaims.items;
  for (const field of EXCLUDED_FROM_1A) {
    delete claim.properties[field];
  }
  claim.required = claim.required.filter((field) => !EXCLUDED_FROM_1A.includes(field));
  return Object.freeze(schema);
}

export const CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA = deriveDiscoverySchema();

export function splitCall1aDiscoverySchemaForArticle() {
  return structuredClone(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA);
}
