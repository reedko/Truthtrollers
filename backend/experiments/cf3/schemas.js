// CF3 strict schemas — v2. Transcribed verbatim from the CF3 Revision Spec
// (2026-07-24, "complete new state"). Discovery splits challenged vs other assertions
// into two arrays (no per-item boolean); the argument output field is testableAssertion.

// Two arrays. challengedAssertions is FIRST in property order, deliberately (the Set F
// committed-section census pattern). maxItems values are transport brakes, never in
// prose. maxItems: 8 on groundingUnitIds is the runaway-ID brake. No per-item
// `challenged` boolean — challenged status is carried by which array an item is in;
// the host sets challenged: true on merge for challengedAssertions items.
export const CF3_DISCOVERY_SCHEMA_V2 = Object.freeze({
  name: "cf3_discovery_v2",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["challengedAssertions", "assertions"],
    properties: {
      challengedAssertions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assertionText", "groundingUnitIds"],
          properties: {
            assertionText: { type: "string" },
            groundingUnitIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
          },
        },
      },
      assertions: {
        type: "array",
        maxItems: 60,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assertionText", "groundingUnitIds"],
          properties: {
            assertionText: { type: "string" },
            groundingUnitIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
          },
        },
      },
    },
  },
});

// Property order carries stance-before-source (§8.4): thesisEffect and articleTreatment
// precede assertionSource. testableAssertion is a fresh field (not assertionText); the
// model never re-emits inventory text.
export const CF3_ARGUMENT_SCHEMA_V2 = Object.freeze({
  name: "cf3_argument_v2",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["stanceAnchor", "selectedAssertionIds", "selectedAssertions", "argumentBranches"],
    properties: {
      stanceAnchor: { type: "string" },
      selectedAssertionIds: { type: "array", items: { type: "string" } },
      selectedAssertions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assertionId", "testableAssertion", "thesisEffect", "articleTreatment", "assertionSource", "argumentBranchId"],
          properties: {
            assertionId: { type: "string" },
            testableAssertion: { type: "string" },
            thesisEffect: { type: "string", enum: ["strengthens", "weakens", "no_effect"] },
            articleTreatment: { type: "string", enum: ["adopted", "challenged", "reported"] },
            // sourceUnitIds dropped: host fills it deterministically from the grounding
            // join. citedWorks dropped: host-derived from the ArticleDocument citation
            // structure (empty on plaintext inputs; populated on HTML).
            assertionSource: {
              type: "object",
              additionalProperties: false,
              required: ["name", "kind"],
              properties: {
                name: { type: "string" },
                kind: { type: "string", enum: ["article_voice", "person", "institution", "study", "document", "unknown"] },
              },
            },
            argumentBranchId: { type: "string" },
          },
        },
      },
      argumentBranches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["branchId", "branchQuestion"],
          properties: {
            branchId: { type: "string" },
            branchQuestion: { type: "string" },
          },
        },
      },
    },
  },
});

export const CF3_THESIS_EFFECTS = Object.freeze(["strengthens", "weakens", "no_effect"]);
export const CF3_ARTICLE_TREATMENTS = Object.freeze(["adopted", "challenged", "reported"]);
export const CF3_SOURCE_KINDS = Object.freeze([
  "article_voice", "person", "institution", "study", "document", "unknown",
]);
export const CF3_CITED_WORK_TYPES = Object.freeze([
  "study", "dataset", "report", "law", "document", "researcher",
]);
