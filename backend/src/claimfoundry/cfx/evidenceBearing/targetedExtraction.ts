import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Cf7StructuredModelRequest,
  Cf7StructuredProvider,
} from "../../shared/provider/index.js";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import {
  loadCfxPrompt,
  type CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import {
  CFX_EVIDENCE_BEARING_JSON_SCHEMA,
  cfxEvidenceBearingExtractionSchema,
} from "./schema.js";
import type {
  CfxEvidenceBearingExtraction,
  CfxEvidenceBlock,
  CfxEvidenceTextAccess,
} from "./types.js";

export const CFX_TARGETED_BEARING_PROMPT_SHA256 =
  "f8142707d30de05141b0cd208d41dd95d31925fd5b03398b08cbdb4323b496c7";

export async function loadCfxTargetedBearingPrompt(): Promise<
  CfxGovernedPrompt
> {
  return loadCfxPrompt({
    filePath: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "targeted-bearing-v1.json",
    ),
    expectedPromptId: "cfx-targeted-bearing-extraction-v1",
    expectedPromptHash: CFX_TARGETED_BEARING_PROMPT_SHA256,
  });
}

export function buildCfxEvidenceBlocks(text: string): CfxEvidenceBlock[] {
  const blocks: CfxEvidenceBlock[] = [];
  const pattern = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const charStart = match.index;
    blocks.push({
      blockId: `E${String(blocks.length + 1).padStart(4, "0")}`,
      text: value,
      charStart,
      charEnd: charStart + value.length,
    });
  }
  if (blocks.length === 0 && text.length > 0) {
    return [{
      blockId: "E0001",
      text,
      charStart: 0,
      charEnd: text.length,
    }];
  }
  return blocks;
}

export function buildCfxTargetedBearingRequest(input: {
  candidateId: string;
  propositionId: string;
  targetAssertion: string;
  access: CfxEvidenceTextAccess;
  prompt: CfxGovernedPrompt;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): {
  request: Cf7StructuredModelRequest;
  blocks: CfxEvidenceBlock[];
} {
  if (
    input.access.accessLevel === "metadata_only"
    || input.access.accessLevel === "unavailable"
    || input.access.text === null
  ) {
    throw new Error(
      `Access level ${input.access.accessLevel} cannot be model-extracted`,
    );
  }
  const blocks = buildCfxEvidenceBlocks(input.access.text);
  const projection = blocks.map(
    (block) => `[${block.blockId}]\n${block.text}`,
  ).join("\n\n");
  return {
    blocks,
    request: {
      system: "",
      user: [
        input.prompt.prompt.replace(
          "<immutable fixture assertion>",
          input.targetAssertion,
        ),
        "",
        "IMMUTABLE_IDENTIFIERS:",
        `propositionId: ${input.propositionId}`,
        `candidateId: ${input.candidateId}`,
        `accessLevel: ${input.access.accessLevel}`,
        "",
        "SUPPLIED_EVIDENCE_TEXT:",
        projection,
      ].join("\n"),
      responseSchema: CFX_EVIDENCE_BEARING_JSON_SCHEMA,
      model: input.model,
      temperature: input.temperature,
      retryCount: 0,
      store: false,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
    },
  };
}

export type CfxBearingValidationDiagnostic = {
  code: string;
  path: string;
  message: string;
  comparison?: Record<string, unknown>;
};

export function validateCfxTargetedBearingExtraction(input: {
  rawOutput: unknown;
  candidateId: string;
  propositionId: string;
  access: CfxEvidenceTextAccess;
  blocks: CfxEvidenceBlock[];
}): {
  accepted: CfxEvidenceBearingExtraction | null;
  diagnostics: CfxBearingValidationDiagnostic[];
} {
  const parsed = cfxEvidenceBearingExtractionSchema.safeParse(input.rawOutput);
  if (!parsed.success) {
    return {
      accepted: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        code: "BEARING_SCHEMA_VIOLATION",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const diagnostics: CfxBearingValidationDiagnostic[] = [];
  const row = parsed.data;
  if (row.candidateId !== input.candidateId) {
    diagnostics.push({
      code: "CANDIDATE_ID_MISMATCH",
      path: "candidateId",
      message: "Returned candidateId does not match the immutable input",
      comparison: { expected: input.candidateId, returned: row.candidateId },
    });
  }
  if (row.propositionId !== input.propositionId) {
    diagnostics.push({
      code: "PROPOSITION_ID_MISMATCH",
      path: "propositionId",
      message: "Returned propositionId does not match the immutable input",
      comparison: {
        expected: input.propositionId,
        returned: row.propositionId,
      },
    });
  }
  if (row.accessLevel !== input.access.accessLevel) {
    diagnostics.push({
      code: "ACCESS_LEVEL_MISMATCH",
      path: "accessLevel",
      message: "The model cannot upgrade or change the acquired access level",
      comparison: {
        expected: input.access.accessLevel,
        returned: row.accessLevel,
      },
    });
  }
  if (row.noBearingAssertionsFound !== (row.assertions.length === 0)) {
    diagnostics.push({
      code: "NO_BEARING_CONTRADICTION",
      path: "noBearingAssertionsFound",
      message:
        "noBearingAssertionsFound must be true exactly when assertions is empty",
    });
  }
  const text = input.access.text ?? "";
  const blocks = new Map(input.blocks.map((block) => [
    block.blockId,
    block,
  ]));
  row.assertions.forEach((assertion, index) => {
    const prefix = `assertions.${index}`;
    const excerptStart = text.indexOf(assertion.exactExcerpt);
    if (excerptStart < 0) {
      diagnostics.push({
        code: "EXACT_EXCERPT_NOT_FOUND",
        path: `${prefix}.exactExcerpt`,
        message: "exactExcerpt is not a literal substring of supplied text",
      });
    }
    const { blockId, charStart, charEnd } = assertion.sourceLocation;
    if (blockId !== null) {
      const block = blocks.get(blockId);
      if (!block) {
        diagnostics.push({
          code: "UNKNOWN_EVIDENCE_BLOCK",
          path: `${prefix}.sourceLocation.blockId`,
          message: `Unknown evidence block ${blockId}`,
        });
      } else if (!block.text.includes(assertion.exactExcerpt)) {
        diagnostics.push({
          code: "EXCERPT_NOT_IN_DECLARED_BLOCK",
          path: `${prefix}.sourceLocation.blockId`,
          message: "The exact excerpt is absent from the declared block",
        });
      }
    }
    if ((charStart === null) !== (charEnd === null)) {
      diagnostics.push({
        code: "PARTIAL_CHARACTER_RANGE",
        path: `${prefix}.sourceLocation`,
        message: "charStart and charEnd must both be present or both be null",
      });
    } else if (charStart !== null && charEnd !== null) {
      if (
        charEnd < charStart
        || text.slice(charStart, charEnd) !== assertion.exactExcerpt
      ) {
        diagnostics.push({
          code: "CHARACTER_RANGE_MISMATCH",
          path: `${prefix}.sourceLocation`,
          message: "Character offsets do not resolve to exactExcerpt",
          comparison: {
            charStart,
            charEnd,
            resolvedText: text.slice(charStart, charEnd),
          },
        });
      }
    }
  });
  return {
    accepted: diagnostics.length === 0
      ? row as CfxEvidenceBearingExtraction
      : null,
    diagnostics,
  };
}

export function cfxTargetedBearingSchemaHash(): string {
  return canonicalHash(CFX_EVIDENCE_BEARING_JSON_SCHEMA);
}

export async function runCfxTargetedBearingExtraction(input: {
  candidateId: string;
  propositionId: string;
  targetAssertion: string;
  access: CfxEvidenceTextAccess;
  prompt: CfxGovernedPrompt;
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
}) {
  const built = buildCfxTargetedBearingRequest(input);
  await input.beforeInvoke?.(built.request);
  const startedAt = performance.now();
  try {
    const response = await input.provider.invokeStructured(built.request);
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
    const validation = validateCfxTargetedBearingExtraction({
      rawOutput: response.output,
      candidateId: input.candidateId,
      propositionId: input.propositionId,
      access: input.access,
      blocks: built.blocks,
    });
    return {
      status: validation.accepted ? "completed" as const : "failed" as const,
      extraction: validation.accepted,
      diagnostics: validation.diagnostics,
      rawOutput: response.output,
      requestHash: canonicalHash(built.request),
      promptHash: input.prompt.promptHash,
      schemaHash: cfxTargetedBearingSchemaHash(),
      responseId: response.responseId,
      requestId: response.requestId,
      model: response.model,
      usage: response.usage,
      latencyMs,
      providerCallCount: 1 as const,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      extraction: null,
      diagnostics: [{
        code: "BEARING_PROVIDER_FAILURE",
        path: "",
        message: error instanceof Error ? error.message : String(error),
      }],
      rawOutput: null,
      requestHash: canonicalHash(built.request),
      promptHash: input.prompt.promptHash,
      schemaHash: cfxTargetedBearingSchemaHash(),
      responseId: null,
      requestId: null,
      model: input.model,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      latencyMs: Math.round(performance.now() - startedAt),
      providerCallCount: 1 as const,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
