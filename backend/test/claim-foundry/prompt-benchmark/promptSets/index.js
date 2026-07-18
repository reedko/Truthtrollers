// Component/pair registry for the CF1 prompt benchmark (coder plan §6).
// Prompts register as Call COMPONENTS referenced by PAIR PROFILES so a Phase-4
// cross-pair references two approved components without copying prompt text.
// Fail closed: unknown, duplicate, placeholder, or schema-drifted entries throw.
import crypto from "node:crypto";
import { CF1_SEMANTIC_INVENTORY_SCHEMA } from "../../../../src/claim-foundry/prompts/semanticInventorySchema.js";
import { CF1_SELECTED_ENRICHMENT_SCHEMA, CF1_SELECTED_ENRICHMENT_WARRANT_SCHEMA }
  from "../../../../src/claim-foundry/prompts/selectedEnrichmentSchema.js";
import { SET_CONTROL_CURRENT_V1 } from "./setControlCurrentV1.js";
import { SET_A_RECALL_REASONING_V1 } from "./setARecallReasoningV1.js";
import { SET_B_FIDELITY_LADDER_V1 } from "./setBFidelityLadderV1.js";
import { SET_C_CLAIM_CONTRACT_V1 } from "./setCClaimContractV1.js";
import { SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V1 }
  from "./setDOrientationFirstPostureTraceV1.js";
import { CF1_ORIENTATION_FIRST_POSTURE_TRACE_SCHEMA }
  from "./setDOrientationFirstPostureTraceSchemaV1.js";
import { SET_E_POSTURE_FIRST_ORDER_V1 } from "./setEPostureFirstOrderV1.js";
import { CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA }
  from "./setEPostureFirstOrderSchemaV1.js";
import { SET_F_RECALL_POSTURE_SOURCE_V1 } from "./setFRecallPostureSourceV1.js";
import { CF1_RECALL_POSTURE_SOURCE_SCHEMA }
  from "./setFRecallPostureSourceSchemaV1.js";
import { CF1_SEMANTIC_INVENTORY_PROPOSITION_V2 }
  from "./propositionInventorySchemaV2.js";
import { SET_B_FIDELITY_LADDER_V2, SET_C_CLAIM_CONTRACT_V2,
  SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V2, SET_E_POSTURE_FIRST_ORDER_V2,
  SET_E2_C_FULL_V1 }
  from "./setCorrectedBCDEV2.js";
import { SET_E2_C_WARRANT_V1 } from "./setE2CWarrantV1.js";
import { CF1_POSTURE_FIRST_SOURCE_STABLE_SCHEMA_V3 }
  from "./postureFirstSourceStableSchemaV3.js";
import { SET_H_CONSOLIDATED_SOURCE_POSTURE_V1 } from "./setHConsolidatedSourcePostureV1.js";
import { CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1, CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V2, CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V3 }
  from "./canonicalPropositionInventorySchemaV1.js";
import { SET_E_CANONICAL_PROPOSITION_V1, SET_E_CANONICAL_PROPOSITION_V2, SET_E_CANONICAL_PROPOSITION_V3 } from "./setECanonicalPropositionV1.js";
import { SET_E_SOURCE_PROPOSITION_RESPONSE_V1, SET_X_SOURCE_PROPOSITION_RESPONSE_V1 } from "./setECanonicalPropositionV1.js";
import { CF1_SOURCE_PROPOSITION_RESPONSE_SCHEMA_V1, CF1_SOURCE_PROPOSITION_RESPONSE_SCHEMA_V2 } from "./sourcePropositionResponseSchemaV1.js";

export const canonicalSchemaHash = (schema) =>
  crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex");

const AUDITED_SCHEMAS = Object.freeze({
  cf1_semantic_inventory_v1: CF1_SEMANTIC_INVENTORY_SCHEMA,
  cf1_semantic_inventory_order_trace_v1: CF1_ORIENTATION_FIRST_POSTURE_TRACE_SCHEMA,
  cf1_semantic_inventory_posture_first_trace_v1: CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA,
  cf1_semantic_inventory_recall_posture_source_v1: CF1_RECALL_POSTURE_SOURCE_SCHEMA,
  cf1_semantic_inventory_proposition_v2: CF1_SEMANTIC_INVENTORY_PROPOSITION_V2,
  cf1_selected_enrichment_v3: CF1_SELECTED_ENRICHMENT_SCHEMA,
  cf1_selected_enrichment_v4: CF1_SELECTED_ENRICHMENT_WARRANT_SCHEMA,
  cf1_semantic_inventory_posture_first_source_stable_v3: CF1_POSTURE_FIRST_SOURCE_STABLE_SCHEMA_V3,
  cf1_semantic_inventory_canonical_proposition_v1: CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1,
  cf1_semantic_inventory_canonical_proposition_v2: CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V2,
  cf1_semantic_inventory_canonical_proposition_v3: CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V3,
  cf1_semantic_inventory_source_proposition_response_v1: CF1_SOURCE_PROPOSITION_RESPONSE_SCHEMA_V1,
  cf1_semantic_inventory_source_proposition_response_v2: CF1_SOURCE_PROPOSITION_RESPONSE_SCHEMA_V2,
});

// Static allowlist. Cross-pair finalists are added here as explicit new entries
// referencing existing components (never by copying prompt text).
const PAIR_PROFILES = Object.freeze([
  SET_CONTROL_CURRENT_V1,
  SET_A_RECALL_REASONING_V1,
  SET_B_FIDELITY_LADDER_V1,
  SET_C_CLAIM_CONTRACT_V1,
  SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V1,
  SET_E_POSTURE_FIRST_ORDER_V1,
  SET_F_RECALL_POSTURE_SOURCE_V1,
  SET_B_FIDELITY_LADDER_V2,
  SET_C_CLAIM_CONTRACT_V2,
  SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V2,
  SET_E_POSTURE_FIRST_ORDER_V2,
  SET_E2_C_FULL_V1,
  SET_E2_C_WARRANT_V1,
  SET_H_CONSOLIDATED_SOURCE_POSTURE_V1,
  SET_E_CANONICAL_PROPOSITION_V1,
  SET_E_CANONICAL_PROPOSITION_V2,
  SET_E_CANONICAL_PROPOSITION_V3,
  SET_E_SOURCE_PROPOSITION_RESPONSE_V1,
  SET_X_SOURCE_PROPOSITION_RESPONSE_V1,
]);

const PROFILE_ID = /^set-[a-z0-9]+(?:-[a-z0-9]+)*-v\d+$/;
const STATUSES = new Set(["control", "experimental", "finalist"]);

function registryError(message) {
  return Object.assign(new Error(message), { code: "CF1_PROMPT_REGISTRY_INVALID" });
}

function validateComponent(profileId, role, component) {
  if (!component || typeof component !== "object") throw registryError(`${profileId} ${role} missing`);
  if (typeof component.version !== "string" || !component.version.trim()
    || /placeholder/i.test(component.version)) {
    throw registryError(`${profileId} ${role} version invalid`);
  }
  const audited = AUDITED_SCHEMAS[component.schemaName];
  if (!audited) throw registryError(`${profileId} ${role} declares unknown schema ${component.schemaName}`);
  if (component.schemaHash !== canonicalSchemaHash(audited)) {
    throw registryError(`${profileId} ${role} schema hash does not match the audited schema`);
  }
  if (typeof component.build !== "function") throw registryError(`${profileId} ${role} build missing`);
  if (component.adaptOutput !== undefined && typeof component.adaptOutput !== "function") {
    throw registryError(`${profileId} ${role} output adapter is invalid`);
  }
}

export function validatePromptRegistry(profiles = PAIR_PROFILES) {
  const seen = new Set();
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== "string" || !PROFILE_ID.test(profile.id)
      || /placeholder/i.test(profile.id)) {
      throw registryError(`Malformed or placeholder profile ID: ${profile?.id}`);
    }
    if (seen.has(profile.id)) throw registryError(`Duplicate profile ID: ${profile.id}`);
    seen.add(profile.id);
    if (!STATUSES.has(profile.status)) throw registryError(`${profile.id} has invalid status`);
    validateComponent(profile.id, "call1", profile.call1);
    validateComponent(profile.id, "call2", profile.call2);
  }
  return profiles;
}

export function listPairProfiles() {
  return validatePromptRegistry().map(({ id, status, call1Only = false, call1, call2 }) => ({ id, status,
    call1Only,
    call1Version: call1.version, call2Version: call2.version }));
}

export function getPairProfile(id) {
  const profile = validatePromptRegistry().find((item) => item.id === id);
  if (!profile) throw registryError(`Unknown prompt profile: ${id}`);
  return profile;
}

// Injection shape for runClaimFoundry({ dependencies: { promptBuilders } }).
export function profilePromptBuilders(id) {
  const profile = getPairProfile(id);
  if (profile.call1Only) {
    throw registryError(`${id} is a test-only Call 1 profile and cannot run the full pipeline`);
  }
  return { buildCall1: profile.call1.build, buildCall2: profile.call2.build,
    adaptCall1Output: profile.call1.adaptOutput,
    identity: { profileId: profile.id, call1Version: profile.call1.version,
      call2Version: profile.call2.version } };
}

export function promptFingerprints(prompt) {
  const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
  return { systemSha256: hash(prompt.system), userSha256: hash(prompt.user),
    schemaSha256: canonicalSchemaHash(prompt.responseSchema) };
}
