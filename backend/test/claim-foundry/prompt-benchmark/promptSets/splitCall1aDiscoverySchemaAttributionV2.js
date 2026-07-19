// Attribution-preserving extension of the short 1A discovery contract.
// 1A still does not decide assertionSource. It only identifies the local units
// that carry attribution context so the later source judge can inspect them.
import { CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA }
  from "./splitCall1aDiscoverySchemaV1.js";

function deriveAttributionDiscoverySchema() {
  const schema = structuredClone(CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA);
  schema.name = "cf1_semantic_inventory_split_discovery_attribution_v2";
  const claim = schema.schema.properties.candidateClaims.items;
  const attributionContextUnitIds = {
    type: "array", maxItems: 8,
    items: { type: "string", pattern: "^U\\d{4}$" },
  };
  // Structured Outputs follow schema key order. Place provenance immediately
  // after grounding so it is decided while the local occurrence is still active.
  claim.properties = Object.fromEntries(Object.entries(claim.properties)
    .flatMap(([field, definition]) => field === "sourceUnitIds"
      ? [[field, definition], ["attributionContextUnitIds", attributionContextUnitIds]]
      : [[field, definition]]));
  const sourceIndex = claim.required.indexOf("sourceUnitIds");
  claim.required.splice(sourceIndex + 1, 0, "attributionContextUnitIds");
  return Object.freeze(schema);
}

export const CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA = deriveAttributionDiscoverySchema();

export function splitCall1aAttributionSchemaForArticle() {
  return structuredClone(CF1_SPLIT_CALL1A_ATTRIBUTION_SCHEMA);
}
