import { Cf1InputError } from "../errors.js";
import { sha256Hex } from "../canonicalJson.js";

export const STRUCTURE_PROFILE_SCHEMA = "cf1.structureProfile.v1";
export const STRUCTURE_PROFILE_RULE_LIMIT = 250;
const NAME = /^[a-z][a-z0-9._-]{1,95}$/;
const ID = /^[A-Za-z][A-Za-z0-9._-]{2,63}$/;

const fail = (code, message) => { throw new Cf1InputError(code, message); };

export function validateSourceFamily(value) {
  const family = String(value ?? "").trim().toLowerCase();
  if (!NAME.test(family)) fail("CF1_SOURCE_FAMILY", "Source family must be a portable namespaced identifier");
  return family;
}

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > STRUCTURE_PROFILE_RULE_LIMIT) {
    fail("CF1_STRUCTURE_PROFILE_RULES", "Structure profile rules must be a bounded array");
  }
  const ids = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || !ID.test(rule.ruleId ?? "")
      || !NAME.test(rule.signal ?? "") || !NAME.test(rule.action ?? "") || ids.has(rule.ruleId)) {
      fail("CF1_STRUCTURE_PROFILE_RULE", "Structure profile rules require unique IDs, signals, and actions");
    }
    ids.add(rule.ruleId);
  }
  try { sha256Hex(rules); } catch { fail("CF1_STRUCTURE_PROFILE_RULE_JSON", "Structure profile rules must be canonical JSON"); }
}

function hashPayload(profile) {
  return { schemaVersion: profile.schemaVersion, profileId: profile.profileId,
    profileKey: profile.profileKey, version: profile.version, sourceFamily: profile.sourceFamily,
    scope: profile.scope, rules: profile.rules };
}

export function structureProfileHash(profile) {
  return sha256Hex(hashPayload(profile));
}

export function createStructureProfile({ profileId, profileKey, version = 1, sourceFamily,
  scope = { kind: "global", value: null }, rules = [] }) {
  const family = validateSourceFamily(sourceFamily);
  if (!ID.test(profileId ?? "") || !NAME.test(profileKey ?? "")
    || !Number.isInteger(version) || version < 1) {
    fail("CF1_STRUCTURE_PROFILE_IDENTITY", "Structure profile identity or version is invalid");
  }
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || !NAME.test(scope.kind ?? "")
    || !(scope.value === null || typeof scope.value === "string")) {
    fail("CF1_STRUCTURE_PROFILE_SCOPE", "Structure profile scope is invalid");
  }
  validateRules(rules);
  const profile = { schemaVersion: STRUCTURE_PROFILE_SCHEMA, profileId, profileKey,
    version, sourceFamily: family, scope: structuredClone(scope), rules: structuredClone(rules) };
  return Object.freeze({ ...profile, profileHash: structureProfileHash(profile) });
}

export function assertStructureProfile(profile, expectedFamily) {
  const normalized = createStructureProfile(profile ?? {});
  if (normalized.profileHash !== profile?.profileHash) {
    fail("CF1_STRUCTURE_PROFILE_HASH", "Structure profile hash does not match its immutable payload");
  }
  if (expectedFamily && normalized.sourceFamily !== validateSourceFamily(expectedFamily)) {
    fail("CF1_STRUCTURE_PROFILE_FAMILY", "Structure profile does not match the source family");
  }
  return normalized;
}
