import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cf7StructuredModelRequest } from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";

export const CFX_SINGLE_ASSERTION_PACKET_SYSTEM = `You extract explicit assertions from supplied source passages that directly address one supplied case assertion.

Use only the supplied passages. Do not fact-check, decide truth, judge source quality, or use outside knowledge.

Do not treat shared topic alone as relevance.

Return strict JSON matching the supplied schema.`;

export const CFX_SINGLE_ASSERTION_PACKET_USER_TEMPLATE = `CASE ASSERTION

ASSERTION_ID: {{assertionId}}
ASSERTION_TEXT: {{assertionText}}

SOURCE DOCUMENT

DOCUMENT_ID: {{documentId}}

SELECTED SOURCE PASSAGES

{{selectedPackets}}

TASK

Extract every explicit source assertion in the supplied passages that directly addresses the case assertion.

A source assertion directly addresses the case assertion when it explicitly:

- states substantially the same assertion;
- denies or contradicts it;
- reports that a person or organization made it;
- gives a reason or evidence for or against it;
- explains a disputed method, exclusion, comparison, mechanism, or result relevant to it.

Do not return a passage merely because it discusses the same broad topic.

When the passages contain opposing assertions, return them separately.

For each result return:

- exactExcerpt
- sourceAssertion
- relevanceType
- reason
- packetIds
- blockIds

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
  "affirms",
  "contradicts",
  "reports_allegation",
  "provides_reason",
  "explains_method",
  "qualifies",
] as const;

const extractionRowSchema = z.object({
  exactExcerpt: z.string().min(1),
  sourceAssertion: z.string().min(1),
  relevanceType: z.enum(relevanceTypes),
  reason: z.string().min(1),
  packetIds: z.array(z.string().min(1)).min(1),
  blockIds: z.array(z.string().min(1)).min(1),
}).strict();

export const CFX_SINGLE_ASSERTION_PACKET_JSON_SCHEMA = Object.freeze({
  name: "cfx_single_assertion_packet_extraction_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["assertionId", "documentId", "assertions"],
    properties: {
      assertionId: { type: "string" },
      documentId: { type: "string" },
      assertions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "exactExcerpt",
            "sourceAssertion",
            "relevanceType",
            "reason",
            "packetIds",
            "blockIds",
          ],
          properties: {
            exactExcerpt: { type: "string" },
            sourceAssertion: { type: "string" },
            relevanceType: { type: "string", enum: relevanceTypes },
            reason: { type: "string" },
            packetIds: { type: "array", minItems: 1, items: { type: "string" } },
            blockIds: { type: "array", minItems: 1, items: { type: "string" } },
          },
        },
      },
    },
  },
});

export type CfxRetrievedPacket = {
  packetId: string;
  blockIds: string[];
  charStart: number;
  charEnd: number;
  text: string;
};

export type CfxPacketExtractionInput = {
  assertionId: string;
  assertionText: string;
  documentId: string;
  selectedPackets: CfxRetrievedPacket[];
};

type RejectionReason = {
  code: string;
  message: string;
  comparison?: Record<string, unknown>;
};

export type CfxPacketGroundingSpan = {
  packetId: string;
  packetCharStart: number;
  packetCharEnd: number;
  documentCharStart: number;
  documentCharEnd: number;
};

export type CfxAcceptedPacketAssertion = z.infer<typeof extractionRowSchema> & {
  assertionId: string;
  documentId: string;
  rowIndex: number;
  normalizedExcerpt: string;
  grounding: {
    mode: "single_packet" | "contiguous_packet_range";
    packetSpans: CfxPacketGroundingSpan[];
    documentCharStart: number;
    documentCharEnd: number;
  };
};

export type CfxRejectedPacketAssertion = {
  assertionId: string;
  documentId: string;
  rowIndex: number | null;
  rawRow: unknown;
  reasons: RejectionReason[];
};

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validateInput(input: CfxPacketExtractionInput): void {
  if (!/^P[0-9]+$/u.test(input.assertionId) || !input.assertionText.trim()) {
    throw new TypeError("assertionId must be a P-number and assertionText must be non-empty");
  }
  if (!input.documentId.trim() || input.selectedPackets.length === 0) {
    throw new TypeError("documentId and at least one selected packet are required");
  }
  if (!uniqueStrings(input.selectedPackets.map((packet) => packet.packetId))) {
    throw new TypeError("packetId values must be unique within a request");
  }
  for (const packet of input.selectedPackets) {
    if (!packet.packetId.trim() || !packet.text || packet.blockIds.length === 0) {
      throw new TypeError("each packet requires an ID, text, and source block IDs");
    }
    if (!uniqueStrings(packet.blockIds) || packet.charStart < 0 || packet.charEnd < packet.charStart) {
      throw new TypeError("packet block IDs must be unique and character offsets valid");
    }
  }
}

export function serializeCfxSelectedPackets(packets: CfxRetrievedPacket[]): string {
  return packets.map((packet) => [
    `[PACKET_ID: ${packet.packetId}]`,
    `SOURCE_BLOCK_IDS: ${packet.blockIds.join(", ")}`,
    packet.text,
    `[END_PACKET: ${packet.packetId}]`,
  ].join("\n")).join("\n\n");
}

export function buildCfxSingleAssertionPacketRequest(input: CfxPacketExtractionInput & {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Cf7StructuredModelRequest {
  validateInput(input);
  const selectedPackets = serializeCfxSelectedPackets(input.selectedPackets);
  const user = CFX_SINGLE_ASSERTION_PACKET_USER_TEMPLATE
    .replace("{{assertionId}}", input.assertionId)
    .replace("{{assertionText}}", input.assertionText)
    .replace("{{documentId}}", input.documentId)
    .replace("{{selectedPackets}}", selectedPackets);
  return {
    system: CFX_SINGLE_ASSERTION_PACKET_SYSTEM,
    user,
    responseSchema: CFX_SINGLE_ASSERTION_PACKET_JSON_SCHEMA,
    model: input.model,
    temperature: input.temperature,
    retryCount: 0,
    store: false,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  };
}

export function cfxSingleAssertionPacketPromptHash(): string {
  return createHash("sha256")
    .update(`${CFX_SINGLE_ASSERTION_PACKET_SYSTEM}\n\n${CFX_SINGLE_ASSERTION_PACKET_USER_TEMPLATE}`)
    .digest("hex");
}

export function cfxSingleAssertionPacketSchemaHash(): string {
  return canonicalHash(CFX_SINGLE_ASSERTION_PACKET_JSON_SCHEMA);
}

export function normalizeCfxExactExcerpt(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

type LocatedExcerpt = {
  mode: "single_packet" | "contiguous_packet_range";
  packetSpans: CfxPacketGroundingSpan[];
};

function spansForJoinedRange(
  packets: CfxRetrievedPacket[],
  joinedStart: number,
  excerptLength: number,
): CfxPacketGroundingSpan[] {
  const joinedEnd = joinedStart + excerptLength;
  const spans: CfxPacketGroundingSpan[] = [];
  let cursor = 0;
  for (const packet of packets) {
    const packetJoinedStart = cursor;
    const packetJoinedEnd = cursor + packet.text.length;
    const intersectionStart = Math.max(joinedStart, packetJoinedStart);
    const intersectionEnd = Math.min(joinedEnd, packetJoinedEnd);
    if (intersectionStart < intersectionEnd) {
      const packetCharStart = intersectionStart - packetJoinedStart;
      const packetCharEnd = intersectionEnd - packetJoinedStart;
      spans.push({
        packetId: packet.packetId,
        packetCharStart,
        packetCharEnd,
        documentCharStart: packet.charStart + packetCharStart,
        documentCharEnd: packet.charStart + packetCharEnd,
      });
    }
    cursor = packetJoinedEnd + 2;
  }
  return spans;
}

function locateLiteralExcerpt(excerpt: string, packets: CfxRetrievedPacket[]): LocatedExcerpt | null {
  for (const packet of packets) {
    const packetCharStart = packet.text.indexOf(excerpt);
    if (packetCharStart < 0) continue;
    return {
      mode: "single_packet",
      packetSpans: [{
        packetId: packet.packetId,
        packetCharStart,
        packetCharEnd: packetCharStart + excerpt.length,
        documentCharStart: packet.charStart + packetCharStart,
        documentCharEnd: packet.charStart + packetCharStart + excerpt.length,
      }],
    };
  }
  for (let start = 0; start < packets.length; start += 1) {
    for (let end = start + 2; end <= packets.length; end += 1) {
      const range = packets.slice(start, end);
      const joined = range.map((packet) => packet.text).join("\n\n");
      const joinedStart = joined.indexOf(excerpt);
      if (joinedStart < 0) continue;
      const packetSpans = spansForJoinedRange(range, joinedStart, excerpt.length);
      if (packetSpans.length > 1) return { mode: "contiguous_packet_range", packetSpans };
    }
  }
  return null;
}

function equalSets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function validateCfxSingleAssertionPacketExtraction(input: {
  submitted: CfxPacketExtractionInput;
  rawOutput: unknown;
}): {
  acceptedRows: CfxAcceptedPacketAssertion[];
  rejectedRows: CfxRejectedPacketAssertion[];
} {
  validateInput(input.submitted);
  const acceptedRows: CfxAcceptedPacketAssertion[] = [];
  const rejectedRows: CfxRejectedPacketAssertion[] = [];
  const root = input.rawOutput !== null && typeof input.rawOutput === "object"
    && !Array.isArray(input.rawOutput)
    ? input.rawOutput as Record<string, unknown>
    : null;
  if (!root || root.assertionId !== input.submitted.assertionId
    || root.documentId !== input.submitted.documentId || !Array.isArray(root.assertions)) {
    rejectedRows.push({
      assertionId: input.submitted.assertionId,
      documentId: input.submitted.documentId,
      rowIndex: null,
      rawRow: input.rawOutput,
      reasons: [{
        code: "INVALID_RESPONSE_ENVELOPE",
        message: "assertionId and documentId must match the request and assertions must be an array",
        comparison: {
          expectedAssertionId: input.submitted.assertionId,
          returnedAssertionId: root?.assertionId,
          expectedDocumentId: input.submitted.documentId,
          returnedDocumentId: root?.documentId,
        },
      }],
    });
    return { acceptedRows, rejectedRows };
  }

  const packetsById = new Map(input.submitted.selectedPackets.map((packet) => [packet.packetId, packet]));
  const allBlockIds = new Set(input.submitted.selectedPackets.flatMap((packet) => packet.blockIds));
  const seen = new Set<string>();
  root.assertions.forEach((rawRow, rowIndex) => {
    const parsed = extractionRowSchema.safeParse(rawRow);
    if (!parsed.success) {
      rejectedRows.push({
        assertionId: input.submitted.assertionId,
        documentId: input.submitted.documentId,
        rowIndex,
        rawRow,
        reasons: parsed.error.issues.map((issue) => ({
          code: "INVALID_ROW_SCHEMA",
          message: `${issue.path.join(".")}: ${issue.message}`,
        })),
      });
      return;
    }

    const reasons: RejectionReason[] = [];
    const returnedPacketIds = parsed.data.packetIds;
    const returnedBlockIds = parsed.data.blockIds;
    if (!uniqueStrings(returnedPacketIds)) {
      reasons.push({ code: "DUPLICATE_PACKET_ID", message: "packetIds must not contain duplicates" });
    }
    if (!uniqueStrings(returnedBlockIds)) {
      reasons.push({ code: "DUPLICATE_BLOCK_ID", message: "blockIds must not contain duplicates" });
    }
    const unknownPacketIds = returnedPacketIds.filter((packetId) => !packetsById.has(packetId));
    if (unknownPacketIds.length > 0) {
      reasons.push({
        code: "UNKNOWN_PACKET_ID",
        message: "every packetId must identify a supplied packet",
        comparison: { unknownPacketIds },
      });
    }
    const unknownBlockIds = returnedBlockIds.filter((blockId) => !allBlockIds.has(blockId));
    if (unknownBlockIds.length > 0) {
      reasons.push({
        code: "UNKNOWN_BLOCK_ID",
        message: "every blockId must belong to a supplied packet",
        comparison: { unknownBlockIds },
      });
    }
    const blockIdsOutsideReturnedPackets = returnedBlockIds.filter((blockId) =>
      !returnedPacketIds.some((packetId) => packetsById.get(packetId)?.blockIds.includes(blockId)));
    if (blockIdsOutsideReturnedPackets.length > 0) {
      reasons.push({
        code: "BLOCK_NOT_IN_RETURNED_PACKET",
        message: "every blockId must belong to one of the row's returned packets",
        comparison: { blockIdsOutsideReturnedPackets },
      });
    }

    const location = locateLiteralExcerpt(parsed.data.exactExcerpt, input.submitted.selectedPackets);
    if (!location) {
      reasons.push({
        code: "EXACT_EXCERPT_NOT_LITERAL",
        message: "exactExcerpt does not occur literally in one supplied packet or a contiguous packet range",
        comparison: { returnedExactExcerpt: parsed.data.exactExcerpt },
      });
    } else {
      const anchoredPacketIds = location.packetSpans.map((span) => span.packetId);
      if (!equalSets(returnedPacketIds, anchoredPacketIds)) {
        reasons.push({
          code: "PACKET_GROUNDING_MISMATCH",
          message: "packetIds must exactly identify the packet or contiguous packet range containing exactExcerpt",
          comparison: { returnedPacketIds, anchoredPacketIds },
        });
      }
      const anchoredBlockIds = [...new Set(anchoredPacketIds.flatMap(
        (packetId) => packetsById.get(packetId)?.blockIds ?? [],
      ))];
      if (!equalSets(returnedBlockIds, anchoredBlockIds)) {
        reasons.push({
          code: "BLOCK_GROUNDING_MISMATCH",
          message: "blockIds must exactly identify the source blocks for the grounded packet range",
          comparison: { returnedBlockIds, anchoredBlockIds },
        });
      }
    }

    const normalizedExcerpt = normalizeCfxExactExcerpt(parsed.data.exactExcerpt);
    const duplicateKey = `${input.submitted.assertionId}\u0000${input.submitted.documentId}\u0000${normalizedExcerpt}`;
    if (seen.has(duplicateKey)) {
      reasons.push({
        code: "DUPLICATE_EXTRACTION_ROW",
        message: "assertionId, documentId, and normalized exactExcerpt duplicate an earlier row",
      });
    }
    seen.add(duplicateKey);

    if (reasons.length > 0 || !location) {
      rejectedRows.push({
        assertionId: input.submitted.assertionId,
        documentId: input.submitted.documentId,
        rowIndex,
        rawRow,
        reasons,
      });
      return;
    }
    acceptedRows.push({
      assertionId: input.submitted.assertionId,
      documentId: input.submitted.documentId,
      rowIndex,
      ...parsed.data,
      normalizedExcerpt,
      grounding: {
        mode: location.mode,
        packetSpans: location.packetSpans,
        documentCharStart: Math.min(...location.packetSpans.map((span) => span.documentCharStart)),
        documentCharEnd: Math.max(...location.packetSpans.map((span) => span.documentCharEnd)),
      },
    });
  });
  return { acceptedRows, rejectedRows };
}
