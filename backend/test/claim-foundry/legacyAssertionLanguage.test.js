import test from "node:test";
import assert from "node:assert/strict";
import {
  assertionMappingSchema,
  restoreCall1ClaimKeys,
  restoreMappingClaimKeys,
  toAssertionPacketKeys,
  toAssertionLanguage,
} from "./prompt-benchmark/legacyAssertionLanguage.js";

test("model-facing terminology replaces prose and contract claim names", () => {
  const transformed = toAssertionLanguage(
    'CLAIMS: claims claim Claim "claimText" "objectClaim" "evidenceClaims" claimed',
  );
  assert.equal(transformed,
    'ASSERTIONS: assertions assertion Assertion "assertionText" "objectAssertion" "evidenceAssertions" claimed');
});

test("packet-key conversion does not rewrite source text values", () => {
  const converted = toAssertionPacketKeys({ claimId: 1,
    claimText: "The article claims this happened.", localArticleContext: "A claim appears." });
  assert.deepEqual(converted, { assertionId: 1,
    assertionText: "The article claims this happened.", localArticleContext: "A claim appears." });
});

test("Call 1 assertion keys normalize back to platform claim keys", () => {
  const restored = restoreCall1ClaimKeys({
    assertions: [{ assertionText: "A", assertionKind: "evidence" }],
    reasoningStack: { evidenceAssertions: [{ text: "B" }] },
    searchAssertions: [{ assertion: "C" }],
  });
  assert.deepEqual(restored, {
    claims: [{ claimText: "A", claimKind: "evidence" }],
    reasoningStack: { evidenceClaims: [{ text: "B" }] },
    searchAssertions: [{ assertion: "C" }],
  });
});

test("mapping schema and response use assertion field names", () => {
  const schema = {
    name: "claim_map",
    schema: { properties: { items: { items: {
      required: ["claimId", "claimText", "objectClaim", "stance"],
      properties: { claimId: {}, claimText: {}, objectClaim: {}, stance: {} },
    } } } },
  };
  const converted = assertionMappingSchema(schema);
  const item = converted.schema.properties.items.items;
  assert.deepEqual(item.required,
    ["assertionId", "assertionText", "objectAssertion", "stance"]);
  assert.equal("claimId" in item.properties, false);
  assert.deepEqual(restoreMappingClaimKeys({ assertionId: 2,
    assertionText: "A", objectAssertion: "B" }).claimId, 2);
});
