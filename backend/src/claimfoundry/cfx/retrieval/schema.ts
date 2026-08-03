import { z } from "zod";

const modelQuerySchema = z.object({
  queryId: z.enum(["Q2", "Q4", "Q5"]),
  queryIntent: z.enum([
    "entity_predicate", "independent_evidence", "counterevidence", "qualification",
  ]),
  query: z.string().min(1).max(300),
  provider: z.enum(["web", "pubmed"]),
  rationale: z.string().min(1).max(500),
}).strict();

export const cfxQueryPlanningOutputSchema = z.object({
  plans: z.array(z.object({
    propositionId: z.string().regex(/^P[0-9]+$/),
    queries: z.array(modelQuerySchema).length(3),
  }).strict()).length(12),
}).strict();

export const CFX_QUERY_PLANNING_JSON_SCHEMA = Object.freeze({
  name: "cfx_initial_query_planning_v2",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["plans"],
    properties: {
      plans: {
        type: "array",
        minItems: 12,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["propositionId", "queries"],
          properties: {
            propositionId: {
              type: "string",
              pattern: "^P[0-9]+$",
            },
            queries: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["queryId", "queryIntent", "query", "provider", "rationale"],
                properties: {
                  queryId: {
                    type: "string",
                    enum: ["Q2", "Q4", "Q5"],
                  },
                  queryIntent: {
                    type: "string",
                    enum: [
                      "entity_predicate", "independent_evidence",
                      "counterevidence", "qualification",
                    ],
                  },
                  query: {
                    type: "string",
                    minLength: 1,
                    maxLength: 300,
                  },
                  provider: {
                    type: "string",
                    enum: ["web", "pubmed"],
                  },
                  rationale: {
                    type: "string",
                    minLength: 1,
                    maxLength: 500,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

export type CfxQueryPlanningOutput = z.infer<
  typeof cfxQueryPlanningOutputSchema
>;
