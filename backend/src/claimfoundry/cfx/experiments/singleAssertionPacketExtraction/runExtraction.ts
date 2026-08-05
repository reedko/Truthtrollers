// Reusable runner for the proven single-assertion packet-extraction contract
// (one case assertion + one acquired document + only its selected packets ->
// one model call, schema cfx_single_assertion_packet_extraction_v1). The
// prompt, schema, and validation rules are the exact, unmodified exports of
// ./extraction.ts; this file only adds the reusable-function shape (injectable
// provider, beforeInvoke/afterResponse hooks) proven by
// evidenceBearing/targetedExtraction.ts's runCfxTargetedBearingExtraction,
// without adapting that file's schema.

import { createHash } from "node:crypto";
import type { Cf7StructuredModelRequest, Cf7StructuredProvider } from "../../../shared/provider/index.js";
import {
  buildCfxSingleAssertionPacketRequest,
  cfxSingleAssertionPacketPromptHash,
  cfxSingleAssertionPacketSchemaHash,
  validateCfxSingleAssertionPacketExtraction,
  type CfxAcceptedPacketAssertion,
  type CfxRejectedPacketAssertion,
  type CfxRetrievedPacket,
} from "./extraction.js";

export type CfxSingleAssertionPacketExtractionUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CfxSingleAssertionPacketExtractionResult = {
  status: "completed" | "empty" | "failed";
  acceptedRows: CfxAcceptedPacketAssertion[];
  rejectedRows: CfxRejectedPacketAssertion[];
  rawOutput: unknown;
  requestHash: string | null;
  promptHash: string;
  schemaHash: string;
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: CfxSingleAssertionPacketExtractionUsage;
  latencyMs: number;
  providerCallCount: 0 | 1;
  error: { name: string; message: string } | null;
};

const zeroUsage: CfxSingleAssertionPacketExtractionUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/**
 * Matches the hashing scheme the golden 9-call run recorded per request:
 * sha256(JSON.stringify(request, null, 2) + "\n").
 */
function hashCfxSingleAssertionPacketRequest(request: Cf7StructuredModelRequest): string {
  return createHash("sha256").update(`${JSON.stringify(request, null, 2)}\n`).digest("hex");
}

/**
 * Runs the proven single-assertion packet-extraction contract for one case
 * assertion and one acquired document. Accepts caller-supplied selected
 * packets only -- there is no whole-document fallback, and the type
 * signature admits exactly one assertion per call. An empty packet list
 * short-circuits before building a request, making no model call.
 */
export async function runCfxSingleAssertionPacketExtraction(input: {
  assertionId: string;
  assertionText: string;
  documentId: string;
  selectedPackets: CfxRetrievedPacket[];
  provider: Cf7StructuredProvider;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  beforeInvoke?: (request: Cf7StructuredModelRequest) => Promise<void>;
  afterResponse?: (value: {
    rawResponse: unknown;
    parsedOutput: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<CfxSingleAssertionPacketExtractionResult> {
  if (input.selectedPackets.length === 0) {
    return {
      status: "empty",
      acceptedRows: [],
      rejectedRows: [],
      rawOutput: null,
      requestHash: null,
      promptHash: cfxSingleAssertionPacketPromptHash(),
      schemaHash: cfxSingleAssertionPacketSchemaHash(),
      responseId: null,
      requestId: null,
      model: input.model,
      usage: zeroUsage,
      latencyMs: 0,
      providerCallCount: 0,
      error: null,
    };
  }

  const submitted = {
    assertionId: input.assertionId,
    assertionText: input.assertionText,
    documentId: input.documentId,
    selectedPackets: input.selectedPackets,
  };
  const request = buildCfxSingleAssertionPacketRequest({
    ...submitted,
    model: input.model,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  });
  const requestHash = hashCfxSingleAssertionPacketRequest(request);
  await input.beforeInvoke?.(request);
  const startedAt = performance.now();
  try {
    const response = await input.provider.invokeStructured(request);
    const latencyMs = Math.round(performance.now() - startedAt);
    await input.afterResponse?.({
      rawResponse: response.rawResponse ?? response,
      parsedOutput: response.output,
      metadata: {
        responseId: response.responseId,
        providerRequestId: response.requestId,
        model: response.model,
        usage: response.usage,
        latencyMs,
        capturedBeforeValidation: true,
      },
    });
    const validation = validateCfxSingleAssertionPacketExtraction({
      submitted,
      rawOutput: response.output,
    });
    return {
      status: "completed",
      acceptedRows: validation.acceptedRows,
      rejectedRows: validation.rejectedRows,
      rawOutput: response.output,
      requestHash,
      promptHash: cfxSingleAssertionPacketPromptHash(),
      schemaHash: cfxSingleAssertionPacketSchemaHash(),
      responseId: response.responseId,
      requestId: response.requestId,
      model: response.model,
      usage: response.usage,
      latencyMs,
      providerCallCount: 1,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      acceptedRows: [],
      rejectedRows: [],
      rawOutput: null,
      requestHash,
      promptHash: cfxSingleAssertionPacketPromptHash(),
      schemaHash: cfxSingleAssertionPacketSchemaHash(),
      responseId: null,
      requestId: null,
      model: input.model,
      usage: zeroUsage,
      latencyMs: Math.round(performance.now() - startedAt),
      providerCallCount: 1,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
