import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cf7StructuredModelRequest } from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import type { CfxRetrievedPacket } from "../singleAssertionPacketExtraction/extraction.js";

export const CFX_MULTI_DOCUMENT_ASSERTION_SYSTEM = `You extract explicit assertions from supplied source passages that directly address one supplied case assertion.

Use only the supplied passages. Do not fact-check, decide truth, judge source quality, or use outside knowledge.

Do not treat shared topic alone as relevance.

Return strict JSON matching the supplied schema.`;

// This is the successful single-assertion semantic prompt with only the
// structurally required removal of documentId/packetIds and block-only labels.
export const CFX_MULTI_DOCUMENT_ASSERTION_USER_TEMPLATE = `CASE ASSERTION

ASSERTION_ID: {{assertionId}}
ASSERTION_TEXT: {{assertionText}}

SELECTED SOURCE PASSAGES

{{selectedBlocks}}

TASK

Process every supplied block independently.

Treat each block as a separate extraction task.

Judge relevance within each block without considering whether the same point, a stronger point, or a more direct point was already returned from another block.

Do not deduplicate across blocks.

A relevant assertion in one block must still be returned even when another block contains a clearer or substantially similar assertion.

Return exactly one blockResult for every supplied BLOCK_ID, in the same order they were provided.

For each block:

- return its blockId;
- return every directly relevant source assertion found in that block;
- when the block contains no directly relevant source assertion, return that blockId with assertions: [].

Do not omit any block.
Do not combine results from different blocks.
Copy each blockId exactly as supplied.

Extract every explicit source assertion in the supplied passages that directly addresses the case assertion.

A source assertion directly addresses the case assertion when it explicitly:

- states substantially the same assertion;
- denies or contradicts it;
- reports that a person or organization made it;
- gives a reason or evidence for or against it;
- explains a disputed method, exclusion, comparison, mechanism, or result relevant to it.

Do not return a passage merely because it discusses the same broad topic.

When the passages contain opposing assertions, return them separately.

For each source assertion return:

- exactExcerpt
- sourceAssertion
- relevanceType
- reason

Use one of these relevanceType values:

- affirms
- contradicts
- reports_allegation
- provides_reason
- explains_method
- qualifies

The exactExcerpt must occur literally in the supplied passages.

Return an empty assertions array when the supplied passages contain no explicit source assertion that directly addresses the case assertion.

Do not infer what missing portions of the document might say.`;

const relevanceTypes = [
  "affirms", "contradicts", "reports_allegation", "provides_reason", "explains_method", "qualifies",
] as const;

const rowSchema = z.object({
  exactExcerpt: z.string().min(1),
  sourceAssertion: z.string().min(1),
  relevanceType: z.enum(relevanceTypes),
  reason: z.string().min(1),
}).strict();

const blockResultSchema = z.object({
  blockId: z.string().min(1),
  assertions: z.array(rowSchema),
}).strict();

export const CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA = Object.freeze({
  name: "cfx_single_assertion_multi_document_extraction_v3",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["assertionId", "blockResults"],
    properties: {
      assertionId: { type: "string" },
      blockResults: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["blockId", "assertions"],
          properties: {
            blockId: { type: "string" },
            assertions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["exactExcerpt", "sourceAssertion", "relevanceType", "reason"],
                properties: {
                  exactExcerpt: { type: "string" },
                  sourceAssertion: { type: "string" },
                  relevanceType: { type: "string", enum: relevanceTypes },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
});

export type CfxAssertionDocumentPackets = { documentId: string; selectedPackets: CfxRetrievedPacket[] };

export type CfxGlobalPassageBlock = {
  globalBlockId: string;
  documentId: string;
  originalPacketId: string;
  originalBlockIds: string[];
  documentCharStart: number;
  documentCharEnd: number;
  text: string;
};

export type CfxGlobalProvenanceMap = Record<string, {
  documentId: string;
  packetId: string;
  originalSourceBlockIds: string[];
  documentCharStart: number;
  documentCharEnd: number;
}>;

export type CfxMultiDocumentGroupedInput = {
  assertionId: string;
  assertionText: string;
  documents: CfxAssertionDocumentPackets[];
};

export type CfxPreparedMultiDocumentInput = {
  assertionId: string;
  assertionText: string;
  blocks: CfxGlobalPassageBlock[];
  provenance: CfxGlobalProvenanceMap;
};

export type CfxNormalizedSourceAssertion = {
  sourceAssertionId: string;
  caseAssertionId: string;
  documentId: string;
  sourceAssertion: string;
  exactExcerpt: string;
  relevanceType: typeof relevanceTypes[number];
  reason: string;
  globalBlockIds: string[];
  originalPacketIds: string[];
  originalBlockIds: string[];
  blockRelativeSpans: Array<{
    globalBlockId: string;
    blockCharStart: number;
    blockCharEnd: number;
    documentCharStart: number;
    documentCharEnd: number;
  }>;
  documentCharStart: number;
  documentCharEnd: number;
  modelCallId: string;
};

export type CfxMultiDocumentRejectedRow = {
  caseAssertionId: string;
  blockResultIndex?: number | null;
  rowIndex: number | null;
  rawRow: unknown;
  reasons: Array<{ code: string; message: string; comparison?: Record<string, unknown> }>;
};

const normalized = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const normalizedKey = (value: string): string => normalized(value).toLocaleLowerCase("en-US");

export function prepareCfxMultiDocumentInput(input: CfxMultiDocumentGroupedInput): CfxPreparedMultiDocumentInput {
  if (!/^P[0-9]+$/u.test(input.assertionId) || !input.assertionText.trim() || input.documents.length === 0) throw new TypeError("one P-number assertion and at least one document are required");
  const seenDocuments = new Set<string>();
  const blocks: CfxGlobalPassageBlock[] = [];
  const provenance: CfxGlobalProvenanceMap = {};
  for (const document of input.documents) {
    if (!document.documentId.trim() || seenDocuments.has(document.documentId) || document.selectedPackets.length === 0) throw new TypeError("document IDs must be unique and each document must have packets");
    seenDocuments.add(document.documentId);
    document.selectedPackets.forEach((packet, index) => {
      const globalBlockId = `${document.documentId}::${packet.packetId}::BLOCK-${String(index + 1).padStart(4, "0")}`;
      if (provenance[globalBlockId]) throw new TypeError(`duplicate global block ID ${globalBlockId}`);
      provenance[globalBlockId] = {
        documentId: document.documentId,
        packetId: packet.packetId,
        originalSourceBlockIds: [...packet.blockIds],
        documentCharStart: packet.charStart,
        documentCharEnd: packet.charEnd,
      };
      blocks.push({
        globalBlockId,
        documentId: document.documentId,
        originalPacketId: packet.packetId,
        originalBlockIds: [...packet.blockIds],
        documentCharStart: packet.charStart,
        documentCharEnd: packet.charEnd,
        text: packet.text,
      });
    });
  }
  return { assertionId: input.assertionId, assertionText: input.assertionText, blocks, provenance };
}

export function serializeCfxGlobalBlocks(blocks: CfxGlobalPassageBlock[]): string {
  return blocks.map((block) => [
    `[BLOCK_ID: ${block.globalBlockId}]`,
    block.text,
    `[END_BLOCK: ${block.globalBlockId}]`,
  ].join("\n")).join("\n\n");
}

export function buildCfxMultiDocumentAssertionRequest(input: CfxPreparedMultiDocumentInput & {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Cf7StructuredModelRequest {
  return {
    system: CFX_MULTI_DOCUMENT_ASSERTION_SYSTEM,
    user: CFX_MULTI_DOCUMENT_ASSERTION_USER_TEMPLATE
      .replace("{{assertionId}}", input.assertionId)
      .replace("{{assertionText}}", input.assertionText)
      .replace("{{selectedBlocks}}", serializeCfxGlobalBlocks(input.blocks)),
    responseSchema: CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA,
    model: input.model,
    temperature: input.temperature,
    retryCount: 0,
    store: false,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  };
}

export const cfxMultiDocumentAssertionPromptHash = (): string => createHash("sha256")
  .update(`${CFX_MULTI_DOCUMENT_ASSERTION_SYSTEM}\n\n${CFX_MULTI_DOCUMENT_ASSERTION_USER_TEMPLATE}`).digest("hex");
export const cfxMultiDocumentAssertionSchemaHash = (): string => canonicalHash(CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA);

function sourceAssertionId(input: { caseAssertionId: string; documentId: string; exactExcerpt: string; sourceAssertion: string }): string {
  return `SA-${canonicalHash({
    caseAssertionId: input.caseAssertionId,
    documentId: input.documentId,
    normalizedExactExcerpt: normalizedKey(input.exactExcerpt),
    normalizedSourceAssertion: normalizedKey(input.sourceAssertion),
  }).slice(0, 24)}`;
}

export function validateCfxMultiDocumentAssertionExtraction(input: {
  prepared: CfxPreparedMultiDocumentInput;
  modelCallId: string;
  rawOutput: unknown;
}): { acceptedRows: CfxNormalizedSourceAssertion[]; rejectedRows: CfxMultiDocumentRejectedRow[] } {
  const acceptedRows: CfxNormalizedSourceAssertion[] = [];
  const rejectedRows: CfxMultiDocumentRejectedRow[] = [];
  const root = input.rawOutput !== null && typeof input.rawOutput === "object" && !Array.isArray(input.rawOutput)
    ? input.rawOutput as Record<string, unknown> : null;
  if (!root || root.assertionId !== input.prepared.assertionId || !Array.isArray(root.blockResults)) {
    rejectedRows.push({ caseAssertionId: input.prepared.assertionId, blockResultIndex: null, rowIndex: null, rawRow: input.rawOutput, reasons: [{ code: "INVALID_RESPONSE_ENVELOPE", message: "assertionId must match and blockResults must be an array", comparison: { expected: input.prepared.assertionId, returned: root?.assertionId } }] });
    return { acceptedRows, rejectedRows };
  }
  const blockMap = new Map(input.prepared.blocks.map((block) => [block.globalBlockId, block]));
  const seen = new Set<string>();
  const expectedBlockIds = input.prepared.blocks.map((block) => block.globalBlockId);
  const blockResults = root.blockResults as unknown[];
  const returnedBlockIds = blockResults.map((raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).blockId : null);
  if (blockResults.length < expectedBlockIds.length) {
    expectedBlockIds.slice(blockResults.length).forEach((blockId, offset) => rejectedRows.push({
      caseAssertionId: input.prepared.assertionId,
      blockResultIndex: blockResults.length + offset,
      rowIndex: null,
      rawRow: null,
      reasons: [{ code: "MISSING_BLOCK_RESULT", message: "every supplied block requires one ordered blockResult", comparison: { expectedBlockId: blockId } }],
    }));
  }
  if (blockResults.length > expectedBlockIds.length) {
    blockResults.slice(expectedBlockIds.length).forEach((rawRow, offset) => rejectedRows.push({
      caseAssertionId: input.prepared.assertionId,
      blockResultIndex: expectedBlockIds.length + offset,
      rowIndex: null,
      rawRow,
      reasons: [{ code: "EXTRA_BLOCK_RESULT", message: "blockResults exceeds the supplied block count" }],
    }));
  }
  blockResults.slice(0, expectedBlockIds.length).forEach((rawBlockResult, blockResultIndex) => {
    const parsedBlock = blockResultSchema.safeParse(rawBlockResult);
    if (!parsedBlock.success) {
      rejectedRows.push({ caseAssertionId: input.prepared.assertionId, blockResultIndex, rowIndex: null, rawRow: rawBlockResult, reasons: parsedBlock.error.issues.map((issue) => ({ code: "INVALID_BLOCK_RESULT_SCHEMA", message: `${issue.path.join(".")}: ${issue.message}` })) });
      return;
    }
    const expectedBlockId = expectedBlockIds[blockResultIndex];
    const blockReasons: CfxMultiDocumentRejectedRow["reasons"] = [];
    if (!blockMap.has(parsedBlock.data.blockId)) blockReasons.push({ code: "UNKNOWN_BLOCK_ID", message: "blockId must have been supplied", comparison: { returnedBlockId: parsedBlock.data.blockId } });
    if (parsedBlock.data.blockId !== expectedBlockId) blockReasons.push({ code: "BLOCK_RESULT_ORDER_MISMATCH", message: "blockResults must return supplied block IDs in the same order", comparison: { expectedBlockId, returnedBlockId: parsedBlock.data.blockId } });
    if (returnedBlockIds.indexOf(parsedBlock.data.blockId) !== blockResultIndex) blockReasons.push({ code: "DUPLICATE_OR_REORDERED_BLOCK_RESULT", message: "each supplied blockId must appear exactly once in its original position" });
    if (blockReasons.length) {
      rejectedRows.push({ caseAssertionId: input.prepared.assertionId, blockResultIndex, rowIndex: null, rawRow: rawBlockResult, reasons: blockReasons });
      return;
    }
    const block = blockMap.get(parsedBlock.data.blockId)!;
    parsedBlock.data.assertions.forEach((parsed, rowIndex) => {
      const reasons: CfxMultiDocumentRejectedRow["reasons"] = [];
      const blockCharStart = block.text.indexOf(parsed.exactExcerpt);
      if (blockCharStart < 0) reasons.push({ code: "EXACT_EXCERPT_NOT_LITERAL", message: "exactExcerpt must occur literally inside its returned block" });
      const duplicateKey = `${input.prepared.assertionId}\u0000${block.documentId}\u0000${normalizedKey(parsed.exactExcerpt)}`;
      if (seen.has(duplicateKey)) reasons.push({ code: "DUPLICATE_NORMALIZED_EXCERPT", message: "normalized excerpt duplicates an earlier row for this assertion and document" });
      seen.add(duplicateKey);
      if (reasons.length || blockCharStart < 0) {
        rejectedRows.push({ caseAssertionId: input.prepared.assertionId, blockResultIndex, rowIndex, rawRow: parsed, reasons });
        return;
      }
      const documentCharStart = block.documentCharStart + blockCharStart;
      const cleanSourceAssertion = normalized(parsed.sourceAssertion);
      acceptedRows.push({
        sourceAssertionId: sourceAssertionId({ caseAssertionId: input.prepared.assertionId, documentId: block.documentId, exactExcerpt: parsed.exactExcerpt, sourceAssertion: cleanSourceAssertion }),
        caseAssertionId: input.prepared.assertionId,
        documentId: block.documentId,
        sourceAssertion: cleanSourceAssertion,
        exactExcerpt: parsed.exactExcerpt,
        relevanceType: parsed.relevanceType,
        reason: parsed.reason,
        globalBlockIds: [block.globalBlockId],
        originalPacketIds: [block.originalPacketId],
        originalBlockIds: [...block.originalBlockIds],
        blockRelativeSpans: [{ globalBlockId: block.globalBlockId, blockCharStart, blockCharEnd: blockCharStart + parsed.exactExcerpt.length, documentCharStart, documentCharEnd: documentCharStart + parsed.exactExcerpt.length }],
        documentCharStart,
        documentCharEnd: documentCharStart + parsed.exactExcerpt.length,
        modelCallId: input.modelCallId,
      });
    });
  });
  return { acceptedRows, rejectedRows };
}
