import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cf7StructuredModelRequest } from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";

export const CFX_LINK_SUGGESTION_SYSTEM = `You suggest how supplied source assertions relate to one supplied case assertion.

Use only the supplied assertion texts and excerpts.

Do not fact-check, decide which assertion is true, judge source quality, or use outside knowledge.

Return one link suggestion for every supplied source assertion.

Return strict JSON matching the supplied schema.`;

export const CFX_LINK_SUGGESTION_USER_TEMPLATE = `CASE ASSERTION

ASSERTION_ID: {{caseAssertionId}}
ASSERTION_TEXT: {{caseAssertionText}}

SOURCE ASSERTIONS

{{sourceAssertions}}

TASK

For every supplied source assertion, suggest how it relates to the case assertion.

Return exactly one linkResult for every SOURCE_ASSERTION_ID, in the same order supplied.

Do not omit, combine, or deduplicate source assertions.

For each source assertion return:

- sourceAssertionId
- suggestedStance
- suggestedScore
- rationale

Use one of these suggestedStance values:

- support
- refute
- nuance
- insufficient

suggestedScore is the existing 0-to-1 bearing-strength magnitude. It describes how strongly the source assertion bears on the case assertion. Direction is expressed only by suggestedStance. A score of 0 means no material bearing; a score of 1 means direct and strong bearing.

The stance and score describe how the source assertion bears on the case assertion.

They do not describe:

- whether the source assertion is true;
- whether the source is trustworthy;
- whether the case assertion is ultimately true;
- overall verdict confidence.

When a source assertion does not materially bear on the case assertion, return insufficient with suggestedScore 0.

Copy every sourceAssertionId exactly as supplied.`;

export const CFX_LINK_STANCES = [
  "support",
  "refute",
  "nuance",
  "insufficient",
] as const;

export const CFX_LINK_SUGGESTION_JSON_SCHEMA = Object.freeze({
  name: "cfx_source_assertion_link_suggestion_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["caseAssertionId", "linkResults"],
    properties: {
      caseAssertionId: { type: "string" },
      linkResults: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "sourceAssertionId",
            "suggestedStance",
            "suggestedScore",
            "rationale",
          ],
          properties: {
            sourceAssertionId: { type: "string" },
            suggestedStance: { type: "string", enum: CFX_LINK_STANCES },
            suggestedScore: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
});

const resultSchema = z.object({
  sourceAssertionId: z.string().min(1),
  suggestedStance: z.enum(CFX_LINK_STANCES),
  suggestedScore: z.number().finite().min(0).max(1),
  rationale: z.string(),
}).strict();

export type CfxLinkStance = typeof CFX_LINK_STANCES[number];

export type CfxPersistableSourceAssertion = {
  sourceAssertionId: string;
  caseAssertionId: string;
  caseAssertionText: string;
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  sourceAssertion: string;
  exactExcerpt: string;
  documentCharStart: number;
  documentCharEnd: number;
  sourceBlockIds: string[];
  sourcePacketIds: string[];
  extractionRunId: string;
  extractionModelCallId: string;
  extractionPromptHash: string;
  extractionSchemaHash: string;
};

export type CfxAcceptedLinkSuggestion = z.infer<typeof resultSchema> & {
  caseAssertionId: string;
  rowIndex: number;
};

export type CfxRejectedLinkSuggestion = {
  caseAssertionId: string;
  rowIndex: number | null;
  rawRow: unknown;
  reasons: Array<{
    code: string;
    message: string;
    comparison?: Record<string, unknown>;
  }>;
};

function normalizedKey(value: string): string {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export function stableCfxSourceAssertionId(input: {
  caseAssertionId: string;
  documentId: string;
  exactExcerpt: string;
  sourceAssertion: string;
}): string {
  return `SA-${canonicalHash({
    caseAssertionId: input.caseAssertionId,
    documentId: input.documentId,
    normalizedExactExcerpt: normalizedKey(input.exactExcerpt),
    normalizedSourceAssertion: normalizedKey(input.sourceAssertion),
  }).slice(0, 24)}`;
}

export function serializeCfxSourceAssertions(rows: CfxPersistableSourceAssertion[]): string {
  return rows.map((row) => [
    `[SOURCE_ASSERTION_ID: ${row.sourceAssertionId}]`,
    `SOURCE_ASSERTION: ${row.sourceAssertion}`,
    `EXACT_EXCERPT: ${row.exactExcerpt}`,
    `[END_SOURCE_ASSERTION: ${row.sourceAssertionId}]`,
  ].join("\n")).join("\n\n");
}

export function buildCfxLinkSuggestionRequest(input: {
  caseAssertionId: string;
  caseAssertionText: string;
  sourceAssertions: CfxPersistableSourceAssertion[];
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Cf7StructuredModelRequest {
  if (!input.caseAssertionId.trim() || !input.caseAssertionText.trim()) {
    throw new TypeError("case assertion ID and text are required");
  }
  if (input.sourceAssertions.length === 0) throw new TypeError("at least one source assertion is required");
  if (input.sourceAssertions.some((row) => row.caseAssertionId !== input.caseAssertionId)) {
    throw new TypeError("every source assertion must belong to the submitted case assertion");
  }
  if (new Set(input.sourceAssertions.map((row) => row.sourceAssertionId)).size !== input.sourceAssertions.length) {
    throw new TypeError("sourceAssertionId values must be unique within a request");
  }
  return {
    system: CFX_LINK_SUGGESTION_SYSTEM,
    user: CFX_LINK_SUGGESTION_USER_TEMPLATE
      .replace("{{caseAssertionId}}", input.caseAssertionId)
      .replace("{{caseAssertionText}}", input.caseAssertionText)
      .replace("{{sourceAssertions}}", serializeCfxSourceAssertions(input.sourceAssertions)),
    responseSchema: CFX_LINK_SUGGESTION_JSON_SCHEMA,
    model: input.model,
    temperature: input.temperature,
    retryCount: 0,
    store: false,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  };
}

export function cfxLinkSuggestionPromptHash(): string {
  return createHash("sha256")
    .update(`${CFX_LINK_SUGGESTION_SYSTEM}\n\n${CFX_LINK_SUGGESTION_USER_TEMPLATE}`)
    .digest("hex");
}

export function cfxLinkSuggestionSchemaHash(): string {
  return canonicalHash(CFX_LINK_SUGGESTION_JSON_SCHEMA);
}

export function validateCfxLinkSuggestions(input: {
  caseAssertionId: string;
  suppliedSourceAssertionIds: string[];
  rawOutput: unknown;
}): {
  acceptedRows: CfxAcceptedLinkSuggestion[];
  rejectedRows: CfxRejectedLinkSuggestion[];
} {
  const acceptedRows: CfxAcceptedLinkSuggestion[] = [];
  const rejectedRows: CfxRejectedLinkSuggestion[] = [];
  const root = input.rawOutput && typeof input.rawOutput === "object" && !Array.isArray(input.rawOutput)
    ? input.rawOutput as Record<string, unknown> : null;
  if (!root || root.caseAssertionId !== input.caseAssertionId || !Array.isArray(root.linkResults)) {
    rejectedRows.push({
      caseAssertionId: input.caseAssertionId,
      rowIndex: null,
      rawRow: input.rawOutput,
      reasons: [{
        code: "INVALID_RESPONSE_ENVELOPE",
        message: "caseAssertionId must match and linkResults must be an array",
        comparison: { expectedCaseAssertionId: input.caseAssertionId, returnedCaseAssertionId: root?.caseAssertionId },
      }],
    });
    return { acceptedRows, rejectedRows };
  }

  const supplied = input.suppliedSourceAssertionIds;
  const suppliedSet = new Set(supplied);
  const returnedIds = (root.linkResults as unknown[]).map((row) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? String((row as Record<string, unknown>).sourceAssertionId ?? "") : "");
  const counts = new Map<string, number>();
  for (const id of returnedIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  (root.linkResults as unknown[]).forEach((rawRow, rowIndex) => {
    const parsed = resultSchema.safeParse(rawRow);
    const reasons: CfxRejectedLinkSuggestion["reasons"] = [];
    if (!parsed.success) {
      reasons.push(...parsed.error.issues.map((issue) => ({
        code: "INVALID_LINK_RESULT_SCHEMA",
        message: `${issue.path.join(".")}: ${issue.message}`,
      })));
    } else {
      const row = parsed.data;
      if (!suppliedSet.has(row.sourceAssertionId)) reasons.push({
        code: "UNKNOWN_SOURCE_ASSERTION_ID",
        message: "sourceAssertionId was not supplied",
        comparison: { returned: row.sourceAssertionId },
      });
      if ((counts.get(row.sourceAssertionId) ?? 0) > 1) reasons.push({
        code: "DUPLICATE_SOURCE_ASSERTION_ID",
        message: "sourceAssertionId must be returned exactly once",
        comparison: { returned: row.sourceAssertionId, count: counts.get(row.sourceAssertionId) },
      });
      if (supplied[rowIndex] !== row.sourceAssertionId) reasons.push({
        code: "SOURCE_ASSERTION_ORDER_MISMATCH",
        message: "linkResults must preserve supplied order",
        comparison: { expected: supplied[rowIndex] ?? null, returned: row.sourceAssertionId },
      });
      if (row.suggestedStance === "insufficient" && row.suggestedScore !== 0) reasons.push({
        code: "INSUFFICIENT_SCORE_MISMATCH",
        message: "insufficient stance requires suggestedScore 0",
        comparison: { suggestedScore: row.suggestedScore },
      });
    }
    if (reasons.length || !parsed.success) {
      rejectedRows.push({ caseAssertionId: input.caseAssertionId, rowIndex, rawRow, reasons });
    } else {
      acceptedRows.push({ ...parsed.data, caseAssertionId: input.caseAssertionId, rowIndex });
    }
  });

  for (const id of supplied) {
    if (!returnedIds.includes(id)) rejectedRows.push({
      caseAssertionId: input.caseAssertionId,
      rowIndex: null,
      rawRow: null,
      reasons: [{
        code: "MISSING_SOURCE_ASSERTION_ID",
        message: "every supplied sourceAssertionId requires one link result",
        comparison: { missing: id },
      }],
    });
  }
  if (returnedIds.length !== supplied.length) rejectedRows.push({
    caseAssertionId: input.caseAssertionId,
    rowIndex: null,
    rawRow: null,
    reasons: [{
      code: "LINK_RESULT_COUNT_MISMATCH",
      message: "linkResults count must equal supplied source-assertion count",
      comparison: { expected: supplied.length, returned: returnedIds.length },
    }],
  });
  return { acceptedRows, rejectedRows };
}

export function projectCfxSuggestedScore(input: {
  suggestedStance: CfxLinkStance;
  suggestedScore: number;
}): number {
  const score = Number(input.suggestedScore);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new TypeError("suggestedScore must be finite and between 0 and 1");
  }
  if (input.suggestedStance === "support") return score;
  if (input.suggestedStance === "refute") return -score;
  if (input.suggestedStance === "nuance") return Math.round(score * 0.5 * 1_000) / 1_000;
  if (score !== 0) throw new TypeError("insufficient stance requires suggestedScore 0");
  return 0;
}
