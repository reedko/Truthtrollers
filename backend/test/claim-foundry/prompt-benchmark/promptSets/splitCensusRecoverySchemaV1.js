import { CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA }
  from "./splitCall1aDiscoverySchemaV1.js";

function deriveRecoverySchema() {
  const discoveryClaim = structuredClone(
    CF1_SPLIT_CALL1A_DISCOVERY_SCHEMA.schema.properties.candidateClaims.items);
  discoveryClaim.properties = {
    censusIds: { type: "array", minItems: 1, maxItems: 6,
      items: { type: "string", minLength: 6, maxLength: 20 } },
    ...discoveryClaim.properties,
  };
  discoveryClaim.required = ["censusIds", ...discoveryClaim.required];
  return Object.freeze({ name: "cf1_split_census_recovery_v1", strict: true,
    schema: { type: "object", additionalProperties: false,
      required: ["candidateClaims"],
      properties: { candidateClaims: { type: "array", items: discoveryClaim } } } });
}

export const CF1_SPLIT_CENSUS_RECOVERY_SCHEMA = deriveRecoverySchema();
