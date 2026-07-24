const MODEL_FIELD_RENAMES = Object.freeze([
  ["fallibilityCriticalClaims", "fallibilityCriticalAssertions"],
  ["derivedFromClaimText", "derivedFromAssertionText"],
  ["backgroundClaims", "backgroundAssertions"],
  ["evidenceClaims", "evidenceAssertions"],
  ["objectClaim", "objectAssertion"],
  ["claimText", "assertionText"],
  ["claimsJson", "assertionsJson"],
  ["claimKind", "assertionKind"],
  ["claimId", "assertionId"],
]);

export function toAssertionLanguage(value) {
  let text = String(value ?? "");
  for (const [claimName, assertionName] of MODEL_FIELD_RENAMES) {
    text = text.replaceAll(claimName, assertionName);
  }
  return text
    .replace(/\bCLAIMS\b/g, "ASSERTIONS")
    .replace(/\bCLAIM\b/g, "ASSERTION")
    .replace(/\bClaims\b/g, "Assertions")
    .replace(/\bClaim\b/g, "Assertion")
    .replace(/\bclaims\b/g, "assertions")
    .replace(/\bclaim\b/g, "assertion");
}

const CALL1_KEY_RENAMES = Object.freeze({
  assertions: "claims",
  fallibilityCriticalAssertions: "fallibilityCriticalClaims",
  backgroundAssertions: "backgroundClaims",
  evidenceAssertions: "evidenceClaims",
  derivedFromAssertionText: "derivedFromClaimText",
  assertionKind: "claimKind",
  assertionText: "claimText",
  assertionId: "claimId",
  objectAssertion: "objectClaim",
});

export function restoreCall1ClaimKeys(value) {
  if (Array.isArray(value)) return value.map(restoreCall1ClaimKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    CALL1_KEY_RENAMES[key] ?? key,
    restoreCall1ClaimKeys(item),
  ]));
}

const INPUT_KEY_RENAMES = Object.freeze({
  claimId: "assertionId",
  claimText: "assertionText",
  objectClaim: "objectAssertion",
  claimKind: "assertionKind",
  derivedFromClaimText: "derivedFromAssertionText",
});

export function toAssertionPacketKeys(value) {
  if (Array.isArray(value)) return value.map(toAssertionPacketKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    INPUT_KEY_RENAMES[key] ?? key,
    toAssertionPacketKeys(item),
  ]));
}

export function assertionMappingSchema(claimSchema) {
  const copy = structuredClone(claimSchema);
  copy.name = String(copy.name ?? "mapping").replace(/claim/gi, "assertion");
  const item = copy.schema.properties.items.items;
  const renames = {
    claimId: "assertionId",
    claimText: "assertionText",
    objectClaim: "objectAssertion",
  };
  item.required = item.required.map((name) => renames[name] ?? name);
  for (const [oldName, newName] of Object.entries(renames)) {
    item.properties[newName] = item.properties[oldName];
    delete item.properties[oldName];
  }
  return copy;
}

export function restoreMappingClaimKeys(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    claimId: item.assertionId ?? item.claimId,
    claimText: item.assertionText ?? item.claimText,
    objectClaim: item.objectAssertion ?? item.objectClaim,
  };
}
