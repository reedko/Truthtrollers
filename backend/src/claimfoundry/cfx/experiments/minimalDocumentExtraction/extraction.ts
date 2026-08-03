import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cf7StructuredModelRequest } from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import { buildCfxDocumentBearingBlocks } from "../../evidenceBearing/documentExtraction.js";
import type { CfxEvidenceBlock } from "../../evidenceBearing/types.js";

export const CFX_MINIMAL_EXTRACTION_SYSTEM =
  "You extract explicit assertions from an evidence document and identify which supplied case assertions they directly address.\n\n" +
  "Use only the supplied document. Do not fact-check, decide truth, judge source quality, or use outside knowledge.\n\n" +
  "Return strict JSON matching the supplied schema.";

export const CFX_MINIMAL_EXTRACTION_TASK = `TASK

Extract every passage that explicitly:
- states a supplied case assertion;
- denies or contradicts it;
- reports that someone made it;
- gives a reason for or against it;
- explains a disputed method, exclusion, comparison, mechanism, or result.

Do not infer relevance from shared topic alone.

For each passage return only:
- targetAssertionId
- exactExcerpt
- relation: supports, challenges, qualifies, or reports_allegation
- reason

When the document contains opposing statements, return them separately.

Return no rows for an assertion when the document contains no explicit passage that directly addresses it.`;

const rowSchema = z.object({
  targetAssertionId: z.string().min(1),
  exactExcerpt: z.string().min(1),
  relation: z.enum(["supports", "challenges", "qualifies", "reports_allegation"]),
  reason: z.string().min(1),
}).strict();

export const CFX_MINIMAL_EXTRACTION_JSON_SCHEMA = Object.freeze({
  name: "cfx_ranked_minimal_assertion_extraction_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["documentId", "rows"],
    properties: {
      documentId: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["targetAssertionId", "exactExcerpt", "relation", "reason"],
          properties: {
            targetAssertionId: { type: "string" },
            exactExcerpt: { type: "string" },
            relation: {
              type: "string",
              enum: ["supports", "challenges", "qualifies", "reports_allegation"],
            },
            reason: { type: "string" },
          },
        },
      },
    },
  },
});

export type CfxMinimalTarget = {
  propositionId: string;
  assertion: string;
};

export type CfxMinimalAcceptedRow = z.infer<typeof rowSchema> & {
  documentId: string;
  blockId: string;
  charStart: number;
  charEnd: number;
};

export type CfxMinimalRejectedRow = {
  documentId: string;
  rowIndex: number | null;
  rawRow: unknown;
  reasons: Array<{
    code: string;
    message: string;
    comparison?: Record<string, unknown>;
  }>;
};

function exactTargets(targets: CfxMinimalTarget[]): CfxMinimalTarget[] {
  const seen = new Set<string>();
  return targets.map((target) => {
    if (!/^P[0-9]+$/u.test(target.propositionId) || seen.has(target.propositionId)) {
      throw new TypeError("Target IDs must be unique P-number identifiers");
    }
    if (!target.assertion.trim()) throw new TypeError("Target assertions must be non-empty");
    seen.add(target.propositionId);
    return { ...target };
  });
}

export function cfxMinimalExtractionPromptHash(): string {
  return createHash("sha256")
    .update(`${CFX_MINIMAL_EXTRACTION_SYSTEM}\n\n${CFX_MINIMAL_EXTRACTION_TASK}`)
    .digest("hex");
}

export function cfxMinimalExtractionSchemaHash(): string {
  return canonicalHash(CFX_MINIMAL_EXTRACTION_JSON_SCHEMA);
}

export function buildCfxMinimalExtractionRequest(input: {
  documentId: string;
  accessLevel: string;
  text: string;
  targets: CfxMinimalTarget[];
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): { request: Cf7StructuredModelRequest; blocks: CfxEvidenceBlock[] } {
  if (!input.documentId.trim() || !input.text.trim()) {
    throw new TypeError("documentId and acquired text are required");
  }
  const targets = exactTargets(input.targets);
  const blocks = buildCfxDocumentBearingBlocks(input.text, 180_000);
  const caseAssertions = targets.map((target) =>
    `${target.propositionId}\n${target.assertion}`).join("\n\n");
  const documentBlocks = blocks.map((block) =>
    `[${block.blockId}]\n${block.text}`).join("\n\n");
  return {
    blocks,
    request: {
      system: CFX_MINIMAL_EXTRACTION_SYSTEM,
      user: [
        "CASE ASSERTIONS",
        "",
        caseAssertions,
        "",
        "EVIDENCE DOCUMENT",
        "",
        `DOCUMENT_ID: ${input.documentId}`,
        `ACCESS_LEVEL: ${input.accessLevel}`,
        "",
        documentBlocks,
        "",
        CFX_MINIMAL_EXTRACTION_TASK,
      ].join("\n"),
      responseSchema: CFX_MINIMAL_EXTRACTION_JSON_SCHEMA,
      model: input.model,
      temperature: input.temperature,
      retryCount: 0,
      store: false,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
    },
  };
}

function literalAnchor(excerpt: string, blocks: CfxEvidenceBlock[]) {
  for (const block of blocks) {
    const localStart = block.text.indexOf(excerpt);
    if (localStart < 0) continue;
    const charStart = block.charStart + localStart;
    return {
      blockId: block.blockId,
      charStart,
      charEnd: charStart + excerpt.length,
    };
  }
  return null;
}

export function validateCfxMinimalExtraction(input: {
  documentId: string;
  targets: CfxMinimalTarget[];
  blocks: CfxEvidenceBlock[];
  rawOutput: unknown;
}): {
  acceptedRows: CfxMinimalAcceptedRow[];
  rejectedRows: CfxMinimalRejectedRow[];
} {
  const targetIds = new Set(exactTargets(input.targets).map((target) => target.propositionId));
  const acceptedRows: CfxMinimalAcceptedRow[] = [];
  const rejectedRows: CfxMinimalRejectedRow[] = [];
  const root = input.rawOutput !== null && typeof input.rawOutput === "object"
    && !Array.isArray(input.rawOutput)
    ? input.rawOutput as Record<string, unknown>
    : null;
  if (!root || root.documentId !== input.documentId || !Array.isArray(root.rows)) {
    rejectedRows.push({
      documentId: input.documentId,
      rowIndex: null,
      rawRow: input.rawOutput,
      reasons: [{
        code: "INVALID_RESPONSE_ENVELOPE",
        message: "documentId must match and rows must be an array",
        comparison: { expectedDocumentId: input.documentId, returnedDocumentId: root?.documentId },
      }],
    });
    return { acceptedRows, rejectedRows };
  }

  const seen = new Set<string>();
  root.rows.forEach((rawRow, rowIndex) => {
    const parsed = rowSchema.safeParse(rawRow);
    if (!parsed.success) {
      rejectedRows.push({
        documentId: input.documentId,
        rowIndex,
        rawRow,
        reasons: parsed.error.issues.map((issue) => ({
          code: "INVALID_ROW_SCHEMA",
          message: `${issue.path.join(".")}: ${issue.message}`,
        })),
      });
      return;
    }
    const reasons: CfxMinimalRejectedRow["reasons"] = [];
    if (!targetIds.has(parsed.data.targetAssertionId)) {
      reasons.push({
        code: "UNKNOWN_TARGET_ASSERTION_ID",
        message: "targetAssertionId is not in the fixed case inventory",
        comparison: { returned: parsed.data.targetAssertionId },
      });
    }
    const anchor = literalAnchor(parsed.data.exactExcerpt, input.blocks);
    if (!anchor) {
      reasons.push({
        code: "EXACT_EXCERPT_NOT_LITERAL",
        message: "exactExcerpt does not occur literally in the submitted evidence blocks",
        comparison: { returned: parsed.data.exactExcerpt },
      });
    }
    const duplicateKey = [input.documentId, parsed.data.targetAssertionId, parsed.data.exactExcerpt].join("\u0000");
    if (seen.has(duplicateKey)) {
      reasons.push({
        code: "DUPLICATE_EXTRACTION_ROW",
        message: "documentId, targetAssertionId, and exactExcerpt duplicate an earlier row",
      });
    }
    seen.add(duplicateKey);
    if (reasons.length > 0 || !anchor) {
      rejectedRows.push({ documentId: input.documentId, rowIndex, rawRow, reasons });
      return;
    }
    acceptedRows.push({
      documentId: input.documentId,
      ...parsed.data,
      ...anchor,
    });
  });
  return { acceptedRows, rejectedRows };
}
