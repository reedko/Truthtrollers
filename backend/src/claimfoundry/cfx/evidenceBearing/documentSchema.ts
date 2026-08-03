import { z } from "zod";

const nullableLocation = z.number().int().nonnegative().nullable();
const nonEmpty = z.string().min(1).max(20_000);

export const cfxDocumentBearingAssertionSchema = z.object({
  evidenceAssertion: nonEmpty,
  bearingRelation: z.enum(["supports", "challenges", "qualifies", "mixed"]),
  exactExcerpt: nonEmpty,
  sourceLocation: z.object({
    page: z.number().int().positive().nullable(),
    section: z.string().max(1_000).nullable(),
    paragraph: z.number().int().positive().nullable(),
    blockId: z.string().regex(/^E[0-9]+$/u).nullable(),
    charStart: nullableLocation,
    charEnd: nullableLocation,
  }).strict(),
  whyItBears: nonEmpty,
  confidence: z.number().min(0).max(1),
  quality: z.number().min(0).max(1.2),
  limitationsVisibleInText: z.array(z.string().min(1).max(4_000)),
}).strict();

export const cfxDocumentBearingExtractionSchema = z.object({
  documentId: z.string().min(1).max(200),
  accessLevel: z.enum(["full_text", "substantial_excerpt", "abstract"]),
  targets: z.array(z.object({
    propositionId: z.string().regex(/^P[0-9]+$/u),
    noBearingAssertionsFound: z.boolean(),
    assertions: z.array(cfxDocumentBearingAssertionSchema).max(100),
  }).strict()).min(1).max(50),
}).strict();

const assertionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "evidenceAssertion", "bearingRelation", "exactExcerpt", "sourceLocation",
    "whyItBears", "confidence", "quality", "limitationsVisibleInText",
  ],
  properties: {
    evidenceAssertion: { type: "string", minLength: 1, maxLength: 20_000 },
    bearingRelation: {
      type: "string",
      enum: ["supports", "challenges", "qualifies", "mixed"],
    },
    exactExcerpt: { type: "string", minLength: 1, maxLength: 20_000 },
    sourceLocation: {
      type: "object",
      additionalProperties: false,
      required: ["page", "section", "paragraph", "blockId", "charStart", "charEnd"],
      properties: {
        page: { type: ["integer", "null"], minimum: 1 },
        section: { type: ["string", "null"], maxLength: 1_000 },
        paragraph: { type: ["integer", "null"], minimum: 1 },
        blockId: { type: ["string", "null"], pattern: "^E[0-9]+$" },
        charStart: { type: ["integer", "null"], minimum: 0 },
        charEnd: { type: ["integer", "null"], minimum: 0 },
      },
    },
    whyItBears: { type: "string", minLength: 1, maxLength: 20_000 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    quality: { type: "number", minimum: 0, maximum: 1.2 },
    limitationsVisibleInText: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 4_000 },
    },
  },
};

export const CFX_DOCUMENT_BEARING_JSON_SCHEMA = Object.freeze({
  name: "cfx_document_centric_bearing_v2",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["documentId", "accessLevel", "targets"],
    properties: {
      documentId: { type: "string", minLength: 1, maxLength: 200 },
      accessLevel: {
        type: "string",
        enum: ["full_text", "substantial_excerpt", "abstract"],
      },
      targets: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["propositionId", "noBearingAssertionsFound", "assertions"],
          properties: {
            propositionId: { type: "string", pattern: "^P[0-9]+$" },
            noBearingAssertionsFound: { type: "boolean" },
            assertions: { type: "array", maxItems: 100, items: assertionJsonSchema },
          },
        },
      },
    },
  },
});
