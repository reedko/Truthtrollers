import { CF1_AGENT_DRAFT_SCHEMA } from "./agentDraftSchema.js";

const strings = (maxItems = 30, maxLength = 1_000) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

const proposition = {
  type: "object", additionalProperties: false, required: ["text", "sourceBlockIds"],
  properties: { text: { type: "string", maxLength: 2_000 }, sourceBlockIds: strings(20, 100) },
};

export const CF1_ORIENTATION_SCHEMA = Object.freeze({
  name: "cf1_agent_orientation_v1", strict: true, schema: {
    type: "object", additionalProperties: false,
    required: ["theme", "thesis", "pillars", "opponentPositions", "qualifications", "argumentSummary", "warnings"],
    properties: {
      theme: { type: "string", maxLength: 1_000 }, thesis: proposition,
      pillars: { type: "array", maxItems: 12, items: { ...proposition,
        required: ["label", ...proposition.required], properties: { label: { type: "string", maxLength: 300 }, ...proposition.properties } } },
      opponentPositions: { type: "array", maxItems: 12, items: proposition },
      qualifications: { type: "array", maxItems: 12, items: proposition },
      argumentSummary: { type: "string", maxLength: 4_000 }, warnings: strings(20),
    },
  },
});

export const CF1_CRITIC_SCHEMA = Object.freeze({
  name: "cf1_semantic_critic_v1", strict: true, schema: {
    type: "object", additionalProperties: false,
    required: ["summary", "findings", "portfolioAssessment"],
    properties: {
      summary: { type: "string", maxLength: 3_000 },
      findings: { type: "array", maxItems: 50, items: {
        type: "object", additionalProperties: false,
        required: ["findingId", "type", "severity", "description", "affectedClaimIds", "sourceBlockIds", "recommendedAction"],
        properties: {
          findingId: { type: "string", maxLength: 100 },
          type: { type: "string", enum: ["missing_central_claim", "weak_thesis_coverage", "duplicate_or_fragmented",
            "ungrounded_claim", "trivial_overselection", "missing_attribution", "weak_evidence_target", "unrepresentative_portfolio"] },
          severity: { type: "string", enum: ["blocking", "material", "minor"] },
          description: { type: "string", maxLength: 2_000 }, affectedClaimIds: strings(30, 100),
          sourceBlockIds: strings(30, 100), recommendedAction: { type: "string", maxLength: 2_000 },
        },
      } },
      portfolioAssessment: { type: "object", additionalProperties: false,
        required: ["centralClaimCoverage", "pillarCoverage", "claimCount", "recommendedClaimCount", "requiresRevision"],
        properties: { centralClaimCoverage: { type: "string", enum: ["strong", "partial", "weak"] },
          pillarCoverage: { type: "string", enum: ["strong", "partial", "weak"] },
          claimCount: { type: "integer", minimum: 0 }, recommendedClaimCount: { type: "integer", minimum: 0, maximum: 20 },
          requiresRevision: { type: "boolean" } },
      },
    },
  },
});

export const CF1_REVISED_DRAFT_SCHEMA = CF1_AGENT_DRAFT_SCHEMA;

const draft = CF1_AGENT_DRAFT_SCHEMA.schema.properties;
export const CF1_TARGETS_SCHEMA = Object.freeze({
  name: "cf1_agent_targets_v1", strict: true, schema: {
    type: "object", additionalProperties: false, required: ["phase3Targets", "evidenceNeedCards"],
    properties: { phase3Targets: draft.phase3Targets, evidenceNeedCards: draft.evidenceNeedCards },
  },
});
