// Test-only Call 1A schema ablation. It is byte-for-byte the Simple V2
// discovery schema except for one required diagnostic field emitted immediately
// before claimText. The field is observation-only: host finalization continues
// to construct the live inventory from the established live-schema fields.
import { CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA }
  from "./splitCall1aDiscoverySchemaV1.js";

function deriveAtomicityTraceSchema() {
  const schema = structuredClone(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA);
  schema.name = "cf1_semantic_inventory_split_discovery_atomicity_trace_v1";
  const claim = schema.schema.properties.candidateClaims.items;
  claim.properties = {
    atomicityBasis: {
      type: "string", minLength: 10, maxLength: 220,
      description: "Identify the one independently testable relationship this candidate will state. If another clause could receive a different support/refute verdict, it must be emitted as a separate candidate.",
    },
    ...claim.properties,
  };
  claim.required = ["atomicityBasis", ...claim.required];
  return Object.freeze(schema);
}

export const CF1_SPLIT_CALL1A_ATOMICITY_TRACE_SCHEMA = deriveAtomicityTraceSchema();

export function splitCall1aAtomicityTraceSchemaForArticle() {
  return structuredClone(CF1_SPLIT_CALL1A_ATOMICITY_TRACE_SCHEMA);
}
