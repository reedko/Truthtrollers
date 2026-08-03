import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Cf7StructuredModelRequest,
  Cf7StructuredProvider,
} from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";
import { loadCfxPrompt, type CfxGovernedPrompt } from "../prompts/loadPrompt.js";
import { buildCfxEvidenceBlocks } from "./targetedExtraction.js";
import {
  CFX_DOCUMENT_BEARING_JSON_SCHEMA,
  cfxDocumentBearingAssertionSchema,
} from "./documentSchema.js";
import { sha256 } from "../artifacts/immutableArtifacts.js";
import type {
  CfxBearingExtractionRow,
  CfxEvidenceBlock,
  CfxEvidenceTextAccess,
} from "./types.js";

export const CFX_DOCUMENT_BEARING_PROMPT_SHA256 =
  "1dc0ba6ad010e83d158e3de6d239198c2e8006d1012343703f8898f414fc6bc3";

export const CFX_DOCUMENT_BEARING_MAX_DOCUMENT_CHARACTERS = 60_000;

export type CfxDocumentBearingTarget = {
  propositionId: string;
  claimId: number;
  assertion: string;
};

export type CfxDocumentBearingDiagnostic = {
  code: string;
  path: string;
  message: string;
  comparison?: Record<string, unknown>;
};

export type CfxAcceptedDocumentBearingTarget = {
  propositionId: string;
  claimId: number;
  noBearingAssertionsFound: boolean;
  assertions: CfxBearingExtractionRow[];
};

export type CfxQuarantinedDocumentBearingRow = {
  propositionId: string | null;
  path: string;
  rawRow: unknown;
  diagnostics: CfxDocumentBearingDiagnostic[];
};

export type CfxDocumentBearingRequestPart = {
  partId: string;
  partIndex: number;
  partCount: number;
  blocks: CfxEvidenceBlock[];
  request: Cf7StructuredModelRequest;
  requestHash: string;
};

export async function loadCfxDocumentBearingPrompt(): Promise<CfxGovernedPrompt> {
  return loadCfxPrompt({
    filePath: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "document-bearing-v1.json",
    ),
    expectedPromptId: "cfx-document-centric-bearing-v2",
    expectedPromptHash: CFX_DOCUMENT_BEARING_PROMPT_SHA256,
  });
}

function exactTargets(targets: CfxDocumentBearingTarget[]) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError("targets must be non-empty");
  }
  const ids = new Set<string>();
  return targets.map((target) => {
    if (!/^P[0-9]+$/u.test(target.propositionId) || ids.has(target.propositionId)) {
      throw new TypeError("target proposition IDs must be unique P-number identifiers");
    }
    if (!Number.isSafeInteger(target.claimId) || target.claimId <= 0) {
      throw new TypeError("target claim IDs must be positive integers");
    }
    if (!target.assertion.trim()) throw new TypeError("target assertions must be non-empty");
    ids.add(target.propositionId);
    return { ...target };
  });
}

type CfxDocumentBearingBuildInput = {
  documentId: string;
  targets: CfxDocumentBearingTarget[];
  access: CfxEvidenceTextAccess;
  prompt: CfxGovernedPrompt;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maximumDocumentCharactersPerRequest?: number;
};

export function cfxDocumentBearingTargetInventoryHash(
  targets: CfxDocumentBearingTarget[],
): string {
  return canonicalHash(exactTargets(targets).map((target) => ({
    propositionId: target.propositionId,
    claimId: target.claimId,
    assertion: target.assertion,
  })));
}

export function cfxSelectedTextVersionHash(access: CfxEvidenceTextAccess): string {
  if (access.text === null) throw new TypeError("selected evidence text is required");
  return sha256(access.text);
}

function sentenceRanges(text: string, absoluteStart: number): Array<{
  text: string; charStart: number; charEnd: number;
}> {
  const boundaries: number[] = [];
  const pattern = /[.!?](?:["'\u2019\u201d)\]]+)?(?=\s+|$)/gu;
  for (const match of text.matchAll(pattern)) {
    boundaries.push((match.index ?? 0) + match[0].length);
  }
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
  const ranges: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let start = 0;
  for (const boundary of boundaries) {
    let end = boundary;
    while (end < text.length && /\s/u.test(text[end] ?? "")) end += 1;
    if (end > start) {
      ranges.push({
        text: text.slice(start, end),
        charStart: absoluteStart + start,
        charEnd: absoluteStart + end,
      });
    }
    start = end;
  }
  return ranges;
}

/** Split only the evidence document, never the fixed target inventory. */
export function buildCfxDocumentBearingBlocks(
  text: string,
  maximumCharacters = CFX_DOCUMENT_BEARING_MAX_DOCUMENT_CHARACTERS,
): CfxEvidenceBlock[] {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1_000) {
    throw new TypeError("maximumCharacters must be an integer of at least 1000");
  }
  const paragraphs = buildCfxEvidenceBlocks(text);
  const ranges = paragraphs.flatMap((paragraph) => {
    if (paragraph.text.length <= maximumCharacters) {
      return [{
        text: paragraph.text,
        charStart: paragraph.charStart,
        charEnd: paragraph.charEnd,
      }];
    }
    const sentences = sentenceRanges(paragraph.text, paragraph.charStart);
    const grouped: typeof sentences = [];
    let current: typeof sentences[number] | null = null;
    for (const sentence of sentences) {
      if (!current) current = { ...sentence };
      else if (sentence.charEnd - current.charStart <= maximumCharacters) {
        current = {
          text: text.slice(current.charStart, sentence.charEnd),
          charStart: current.charStart,
          charEnd: sentence.charEnd,
        };
      } else {
        grouped.push(current);
        current = { ...sentence };
      }
    }
    if (current) grouped.push(current);
    return grouped;
  });
  return ranges.map((range, index) => ({
    blockId: `E${String(index + 1).padStart(4, "0")}`,
    ...range,
  }));
}

export function buildCfxDocumentBearingRequests(
  input: CfxDocumentBearingBuildInput,
): CfxDocumentBearingRequestPart[] {
  if (!input.access.text || ![
    "full_text", "substantial_excerpt", "abstract",
  ].includes(input.access.accessLevel)) {
    throw new Error(`Access level ${input.access.accessLevel} cannot be document-extracted`);
  }
  const targets = exactTargets(input.targets);
  const maximumCharacters = input.maximumDocumentCharactersPerRequest
    ?? CFX_DOCUMENT_BEARING_MAX_DOCUMENT_CHARACTERS;
  const blocks = buildCfxDocumentBearingBlocks(input.access.text, maximumCharacters);
  const targetProjection = targets.map((target) => [
    `propositionId: ${target.propositionId}`,
    `claimId: ${target.claimId}`,
    `caseAssertion: ${target.assertion}`,
  ].join("\n")).join("\n\n");
  const groups: CfxEvidenceBlock[][] = [];
  let current: CfxEvidenceBlock[] = [];
  let currentCharacters = 0;
  for (const block of blocks) {
    const projectedCharacters = block.text.length + block.blockId.length + 4;
    if (current.length > 0 && currentCharacters + projectedCharacters > maximumCharacters) {
      groups.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(block);
    currentCharacters += projectedCharacters;
  }
  if (current.length > 0) groups.push(current);
  const targetInventoryHash = cfxDocumentBearingTargetInventoryHash(targets);
  const selectedTextVersionHash = cfxSelectedTextVersionHash(input.access);
  return groups.map((group, index) => {
    const documentProjection = group.map(
      (block) => `[${block.blockId}]\n${block.text}`,
    ).join("\n\n");
    const request: Cf7StructuredModelRequest = {
      system: "",
      user: [
        input.prompt.prompt,
        "",
        "IMMUTABLE_DOCUMENT_ID:",
        input.documentId,
        "",
        `DOCUMENT_PART: ${index + 1}/${groups.length}`,
        `TARGET_INVENTORY_SHA256: ${targetInventoryHash}`,
        `SELECTED_TEXT_VERSION_SHA256: ${selectedTextVersionHash}`,
        "",
        "ACCESS_LEVEL:",
        input.access.accessLevel,
        "",
        "COMPLETE_FIXED_CASE_ASSERTION_INVENTORY:",
        targetProjection,
        "",
        "SUPPLIED_EVIDENCE_DOCUMENT:",
        documentProjection,
      ].join("\n"),
      responseSchema: CFX_DOCUMENT_BEARING_JSON_SCHEMA,
      model: input.model,
      temperature: input.temperature,
      retryCount: 0,
      store: false,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
    };
    return {
      partId: `PART-${String(index + 1).padStart(3, "0")}`,
      partIndex: index + 1,
      partCount: groups.length,
      blocks: group,
      request,
      requestHash: canonicalHash(request),
    };
  });
}

export function buildCfxDocumentBearingRequest(
  input: CfxDocumentBearingBuildInput,
): { request: Cf7StructuredModelRequest; blocks: CfxEvidenceBlock[] } {
  const parts = buildCfxDocumentBearingRequests(input);
  if (parts.length !== 1) {
    throw new Error(
      `Document requires ${parts.length} requests; use buildCfxDocumentBearingRequests`,
    );
  }
  return { request: parts[0].request, blocks: parts[0].blocks };
}

type LiteralAnchor = {
  exactExcerpt: string;
  charStart: number;
  charEnd: number;
  blockId: string | null;
  normalizationApplied: boolean;
};

function foldLiteralWithOffsets(value: string): {
  text: string;
  starts: number[];
  ends: number[];
} {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let previousWhitespace = false;
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset);
    const source = String.fromCodePoint(codePoint ?? 0);
    const sourceEnd = offset + source.length;
    let folded = source.normalize("NFKC")
      .replace(/[\u2018\u2019]/gu, "'")
      .replace(/[\u201c\u201d]/gu, '"')
      .replace(/[\u2010-\u2015\u2212]/gu, "-");
    if (/\s/u.test(folded)) folded = " ";
    for (const character of folded) {
      if (character === " ") {
        if (previousWhitespace) continue;
        previousWhitespace = true;
      } else {
        previousWhitespace = false;
      }
      text += character;
      starts.push(offset);
      ends.push(sourceEnd);
    }
    offset = sourceEnd;
  }
  return { text, starts, ends };
}

/**
 * Resolve a model-copied excerpt back to the immutable acquired text. Character
 * offsets and block IDs are host-derived coordinates, not semantic model
 * judgments. A compatibility fold is allowed only for Unicode presentation,
 * dash/quote variants, and whitespace; the persisted quote is always the
 * original source slice.
 */
export function resolveCfxLiteralAnchor(input: {
  exactExcerpt: string;
  text: string;
  blocks: CfxEvidenceBlock[];
}): LiteralAnchor | null {
  for (const block of input.blocks) {
    const localStart = block.text.indexOf(input.exactExcerpt);
    if (localStart >= 0) {
      const charStart = block.charStart + localStart;
      const charEnd = charStart + input.exactExcerpt.length;
      return {
        exactExcerpt: input.text.slice(charStart, charEnd), charStart, charEnd,
        blockId: block.blockId, normalizationApplied: false,
      };
    }
  }
  const needle = foldLiteralWithOffsets(input.exactExcerpt).text;
  if (!needle) return null;
  for (const block of input.blocks) {
    const haystack = foldLiteralWithOffsets(block.text);
    const foldedStart = haystack.text.indexOf(needle);
    if (foldedStart < 0) continue;
    const foldedEnd = foldedStart + needle.length - 1;
    const charStart = block.charStart + haystack.starts[foldedStart];
    const charEnd = block.charStart + haystack.ends[foldedEnd];
    return {
      exactExcerpt: input.text.slice(charStart, charEnd), charStart, charEnd,
      blockId: block.blockId, normalizationApplied: true,
    };
  }
  return null;
}

function validateAssertion(input: {
  assertion: CfxBearingExtractionRow;
  path: string;
  text: string;
  blocks: CfxEvidenceBlock[];
}): {
  accepted: CfxBearingExtractionRow | null;
  diagnostics: CfxDocumentBearingDiagnostic[];
} {
  const diagnostics: CfxDocumentBearingDiagnostic[] = [];
  const { assertion, path, text, blocks } = input;
  const anchor = resolveCfxLiteralAnchor({
    exactExcerpt: assertion.exactExcerpt,
    text,
    blocks,
  });
  if (!anchor) {
    diagnostics.push({
      code: "EXACT_EXCERPT_NOT_FOUND",
      path: `${path}.exactExcerpt`,
      message: "exactExcerpt cannot be resolved by literal or presentation-only matching",
    });
    return { accepted: null, diagnostics };
  }
  const { blockId, charStart, charEnd } = assertion.sourceLocation;
  const suppliedRangeValid = charStart !== null && charEnd !== null
    && charEnd >= charStart
    && text.slice(charStart, charEnd) === assertion.exactExcerpt;
  const suppliedBlockValid = blockId === null || blocks.some(
    (block) => block.blockId === blockId
      && block.charStart <= anchor.charStart
      && block.charEnd >= anchor.charEnd,
  );
  if (anchor.normalizationApplied) {
    diagnostics.push({
      code: "EXCERPT_PRESENTATION_NORMALIZED",
      path: `${path}.exactExcerpt`,
      message: "A source-literal quote was recovered after presentation-only normalization",
      comparison: { returned: assertion.exactExcerpt, persisted: anchor.exactExcerpt },
    });
  }
  if (!suppliedRangeValid || !suppliedBlockValid) {
    diagnostics.push({
      code: "SOURCE_LOCATION_DERIVED",
      path: `${path}.sourceLocation`,
      message: "Host-derived coordinates replaced absent or invalid model coordinates",
      comparison: {
        returned: { blockId, charStart, charEnd },
        persisted: {
          blockId: anchor.blockId,
          charStart: anchor.charStart,
          charEnd: anchor.charEnd,
        },
      },
    });
  }
  return {
    accepted: {
      ...assertion,
      exactExcerpt: anchor.exactExcerpt,
      sourceLocation: {
        ...assertion.sourceLocation,
        blockId: anchor.blockId,
        charStart: anchor.charStart,
        charEnd: anchor.charEnd,
      },
    },
    diagnostics,
  };
}

export function validateCfxDocumentBearingExtraction(input: {
  rawOutput: unknown;
  documentId: string;
  targets: CfxDocumentBearingTarget[];
  access: CfxEvidenceTextAccess;
  blocks: CfxEvidenceBlock[];
}): {
  acceptedTargets: CfxAcceptedDocumentBearingTarget[];
  quarantinedRows: CfxQuarantinedDocumentBearingRow[];
  diagnostics: CfxDocumentBearingDiagnostic[];
  structurallyValid: boolean;
} {
  const diagnostics: CfxDocumentBearingDiagnostic[] = [];
  const quarantinedRows: CfxQuarantinedDocumentBearingRow[] = [];
  const expected = new Map(exactTargets(input.targets).map((target) => [target.propositionId, target]));
  const seen = new Set<string>();
  const acceptedTargets: CfxAcceptedDocumentBearingTarget[] = [];
  const root = input.rawOutput !== null && typeof input.rawOutput === "object"
    && !Array.isArray(input.rawOutput)
    ? input.rawOutput as Record<string, unknown>
    : null;
  if (!root) {
    const diagnostic = {
      code: "DOCUMENT_BEARING_SCHEMA_VIOLATION",
      path: "",
      message: "Provider output must be an object",
    };
    return {
      acceptedTargets: [], quarantinedRows: [{
        propositionId: null, path: "", rawRow: input.rawOutput,
        diagnostics: [diagnostic],
      }], diagnostics: [diagnostic], structurallyValid: false,
    };
  }
  if (root.documentId !== input.documentId) {
    diagnostics.push({
      code: "DOCUMENT_ID_MISMATCH", path: "documentId",
      message: "Returned documentId does not match the immutable input",
      comparison: { expected: input.documentId, returned: root.documentId },
    });
  }
  if (root.accessLevel !== input.access.accessLevel) {
    diagnostics.push({
      code: "ACCESS_LEVEL_MISMATCH", path: "accessLevel",
      message: "The model cannot change the acquired access level",
      comparison: { expected: input.access.accessLevel, returned: root.accessLevel },
    });
  }
  const returnedTargets = Array.isArray(root.targets) ? root.targets : [];
  if (!Array.isArray(root.targets)) {
    diagnostics.push({
      code: "DOCUMENT_BEARING_SCHEMA_VIOLATION", path: "targets",
      message: "targets must be an array",
    });
  }
  returnedTargets.forEach((rawTarget, targetIndex) => {
    const targetPath = `targets.${targetIndex}`;
    const returned = rawTarget !== null && typeof rawTarget === "object"
      && !Array.isArray(rawTarget)
      ? rawTarget as Record<string, unknown>
      : null;
    const propositionId = typeof returned?.propositionId === "string"
      ? returned.propositionId : null;
    const target = propositionId ? expected.get(propositionId) : undefined;
    if (!returned || !propositionId || typeof returned.noBearingAssertionsFound !== "boolean"
      || !Array.isArray(returned.assertions)) {
      const rowDiagnostics: CfxDocumentBearingDiagnostic[] = [{
        code: "DOCUMENT_BEARING_SCHEMA_VIOLATION", path: targetPath,
        message: "Target envelope has an invalid propositionId, flag, or assertions array",
      }];
      diagnostics.push(...rowDiagnostics);
      quarantinedRows.push({ propositionId, path: targetPath, rawRow: rawTarget, diagnostics: rowDiagnostics });
      return;
    }
    if (!target) {
      const rowDiagnostics: CfxDocumentBearingDiagnostic[] = [{
        code: "UNKNOWN_PROPOSITION_ID", path: `targets.${targetIndex}.propositionId`,
        message: `Unknown proposition ${propositionId}`,
      }];
      diagnostics.push(...rowDiagnostics);
      quarantinedRows.push({ propositionId, path: targetPath, rawRow: rawTarget, diagnostics: rowDiagnostics });
      return;
    }
    if (seen.has(propositionId)) {
      const rowDiagnostics: CfxDocumentBearingDiagnostic[] = [{
        code: "DUPLICATE_PROPOSITION_ID", path: `targets.${targetIndex}.propositionId`,
        message: `Duplicate proposition ${propositionId}`,
      }];
      diagnostics.push(...rowDiagnostics);
      quarantinedRows.push({ propositionId, path: targetPath, rawRow: rawTarget, diagnostics: rowDiagnostics });
      return;
    }
    seen.add(propositionId);
    if (returned.noBearingAssertionsFound !== (returned.assertions.length === 0)) {
      diagnostics.push({
        code: "NO_BEARING_CONTRADICTION",
        path: `targets.${targetIndex}.noBearingAssertionsFound`,
        message: "noBearingAssertionsFound must be true exactly when assertions is empty",
      });
    }
    const acceptedAssertions = returned.assertions.flatMap((rawAssertion, assertionIndex) => {
      const assertionPath = `${targetPath}.assertions.${assertionIndex}`;
      const parsedAssertion = cfxDocumentBearingAssertionSchema.safeParse(rawAssertion);
      if (!parsedAssertion.success) {
        const rowDiagnostics = parsedAssertion.error.issues.map((issue) => ({
          code: "DOCUMENT_BEARING_SCHEMA_VIOLATION",
          path: `${assertionPath}.${issue.path.join(".")}`,
          message: issue.message,
        }));
        diagnostics.push(...rowDiagnostics);
        quarantinedRows.push({
          propositionId, path: assertionPath, rawRow: rawAssertion, diagnostics: rowDiagnostics,
        });
        return [];
      }
      const validation = validateAssertion({
        assertion: parsedAssertion.data,
        path: assertionPath,
        text: input.access.text ?? "",
        blocks: input.blocks,
      });
      diagnostics.push(...validation.diagnostics);
      if (!validation.accepted) {
        quarantinedRows.push({
          propositionId, path: assertionPath, rawRow: rawAssertion,
          diagnostics: validation.diagnostics,
        });
      }
      return validation.accepted ? [validation.accepted] : [];
    });
    acceptedTargets.push({
      propositionId,
      claimId: target.claimId,
      noBearingAssertionsFound: acceptedAssertions.length === 0,
      assertions: acceptedAssertions,
    });
  });
  for (const propositionId of expected.keys()) {
    if (!seen.has(propositionId)) {
      diagnostics.push({
        code: "MISSING_PROPOSITION_ID", path: "targets",
        message: `Missing proposition ${propositionId}`,
      });
    }
  }
  const envelopeValid = root.documentId === input.documentId
    && root.accessLevel === input.access.accessLevel
    && seen.size === expected.size
    && !diagnostics.some((diagnostic) => [
      "UNKNOWN_PROPOSITION_ID", "DUPLICATE_PROPOSITION_ID", "MISSING_PROPOSITION_ID",
      "NO_BEARING_CONTRADICTION",
    ].includes(diagnostic.code));
  return { acceptedTargets, quarantinedRows, diagnostics, structurallyValid: envelopeValid };
}

export function cfxDocumentBearingSchemaHash(): string {
  return canonicalHash(CFX_DOCUMENT_BEARING_JSON_SCHEMA);
}

export type CfxMergedEvidenceAssertion = {
  fingerprint: string;
  documentId: string;
  evidenceAssertion: string;
  exactExcerpt: string;
  sourceLocation: CfxBearingExtractionRow["sourceLocation"];
  targetLinks: Array<{
    propositionId: string;
    claimId: number;
    bearingRelation: CfxBearingExtractionRow["bearingRelation"];
    whyItBears: string;
    confidence: number;
    quality: number;
    limitationsVisibleInText: string[];
  }>;
};

export function cfxEvidenceAssertionFingerprint(input: {
  documentId: string;
  assertion: CfxBearingExtractionRow;
}): string {
  return canonicalHash({
    documentId: input.documentId,
    exactExcerpt: input.assertion.exactExcerpt,
    charStart: input.assertion.sourceLocation.charStart,
    charEnd: input.assertion.sourceLocation.charEnd,
    evidenceAssertion: input.assertion.evidenceAssertion.normalize("NFKC")
      .replace(/\s+/gu, " ").trim(),
  });
}

export function mergeCfxDocumentBearingTargets(input: {
  documentId: string;
  targets: CfxDocumentBearingTarget[];
  parts: CfxAcceptedDocumentBearingTarget[][];
}): {
  acceptedTargets: CfxAcceptedDocumentBearingTarget[];
  evidenceAssertions: CfxMergedEvidenceAssertion[];
} {
  const exact = exactTargets(input.targets);
  const byTarget = new Map(exact.map((target) => [target.propositionId, {
    propositionId: target.propositionId,
    claimId: target.claimId,
    noBearingAssertionsFound: true,
    assertions: [] as CfxBearingExtractionRow[],
  }]));
  const scopedSeen = new Set<string>();
  const evidence = new Map<string, CfxMergedEvidenceAssertion>();
  for (const partTargets of input.parts) {
    for (const target of partTargets) {
      const aggregate = byTarget.get(target.propositionId);
      if (!aggregate) continue;
      for (const assertion of target.assertions) {
        const fingerprint = cfxEvidenceAssertionFingerprint({
          documentId: input.documentId, assertion,
        });
        const scoped = `${target.propositionId}\0${fingerprint}\0${assertion.bearingRelation}`;
        if (scopedSeen.has(scoped)) continue;
        scopedSeen.add(scoped);
        aggregate.assertions.push(assertion);
        aggregate.noBearingAssertionsFound = false;
        const merged = evidence.get(fingerprint) ?? {
          fingerprint,
          documentId: input.documentId,
          evidenceAssertion: assertion.evidenceAssertion,
          exactExcerpt: assertion.exactExcerpt,
          sourceLocation: assertion.sourceLocation,
          targetLinks: [],
        };
        merged.targetLinks.push({
          propositionId: target.propositionId,
          claimId: target.claimId,
          bearingRelation: assertion.bearingRelation,
          whyItBears: assertion.whyItBears,
          confidence: assertion.confidence,
          quality: assertion.quality,
          limitationsVisibleInText: assertion.limitationsVisibleInText,
        });
        evidence.set(fingerprint, merged);
      }
    }
  }
  return {
    acceptedTargets: [...byTarget.values()],
    evidenceAssertions: [...evidence.values()],
  };
}

export async function runCfxDocumentBearingExtraction(input: {
  documentId: string;
  targets: CfxDocumentBearingTarget[];
  access: CfxEvidenceTextAccess;
  prompt: CfxGovernedPrompt;
  provider: Cf7StructuredProvider;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maximumDocumentCharactersPerRequest?: number;
  beforeInvoke?: (request: Cf7StructuredModelRequest, part?: CfxDocumentBearingRequestPart) => Promise<void>;
  afterResponse?: (value: { rawResponse: unknown; parsedOutput: unknown; metadata: Record<string, unknown> }, part?: CfxDocumentBearingRequestPart) => Promise<void>;
}) {
  const parts = buildCfxDocumentBearingRequests(input);
  const allBlocks = parts.flatMap((part) => part.blocks);
  const forensicRequests: Array<Record<string, unknown>> = [];
  const forensicResponses: Array<Record<string, unknown>> = [];
  const validations: ReturnType<typeof validateCfxDocumentBearingExtraction>[] = [];
  const providerErrors: Array<Record<string, unknown>> = [];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let latencyMs = 0;
  for (const part of parts) {
    forensicRequests.push({
      partId: part.partId, request: part.request, requestHash: part.requestHash,
    });
    await input.beforeInvoke?.(part.request, part);
    const startedAt = performance.now();
    try {
      const response = await input.provider.invokeStructured(part.request);
      const partLatencyMs = Math.round(performance.now() - startedAt);
      latencyMs += partLatencyMs;
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) {
        usage[key] += response.usage[key];
      }
      const rawResponse = response.rawResponse ?? response;
      const forensicResponse = {
        partId: part.partId,
        rawResponse,
        parsedOutput: response.output,
        responseId: response.responseId,
        providerRequestId: response.requestId,
        model: response.model,
        usage: response.usage,
        latencyMs: partLatencyMs,
        capturedBeforeValidation: true,
      };
      forensicResponses.push(forensicResponse);
      await input.afterResponse?.({
        rawResponse,
        parsedOutput: response.output,
        metadata: forensicResponse,
      }, part);
      validations.push(validateCfxDocumentBearingExtraction({
        rawOutput: response.output,
        documentId: input.documentId,
        targets: input.targets,
        access: input.access,
        blocks: allBlocks,
      }));
    } catch (error) {
      const partLatencyMs = Math.round(performance.now() - startedAt);
      latencyMs += partLatencyMs;
      providerErrors.push({
        partId: part.partId,
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        latencyMs: partLatencyMs,
      });
    }
  }
  const merged = mergeCfxDocumentBearingTargets({
    documentId: input.documentId,
    targets: input.targets,
    parts: validations.map((validation) => validation.acceptedTargets),
  });
  const diagnostics = [
    ...validations.flatMap((validation) => validation.diagnostics),
    ...providerErrors.map((error) => ({
      code: "DOCUMENT_BEARING_PROVIDER_FAILURE",
      path: String(error.partId),
      message: String(error.message),
    })),
  ];
  const structurallyValid = providerErrors.length === 0
    && validations.length === parts.length
    && validations.every((validation) => validation.structurallyValid);
  return {
    status: structurallyValid ? "completed" as const : "failed" as const,
    structurallyValid,
    acceptedTargets: merged.acceptedTargets,
    evidenceAssertions: merged.evidenceAssertions,
    quarantinedRows: validations.flatMap((validation) => validation.quarantinedRows),
    diagnostics,
    forensicRequests,
    forensicResponses,
    rawOutput: forensicResponses.map((response) => response.parsedOutput),
    requestHash: canonicalHash(forensicRequests.map((row) => row.requestHash)),
    requestHashes: parts.map((part) => part.requestHash),
    promptHash: input.prompt.promptHash,
    schemaHash: cfxDocumentBearingSchemaHash(),
    targetInventoryHash: cfxDocumentBearingTargetInventoryHash(input.targets),
    selectedTextVersionHash: cfxSelectedTextVersionHash(input.access),
    responseId: forensicResponses.length === 1 ? forensicResponses[0].responseId : null,
    requestId: forensicResponses.length === 1 ? forensicResponses[0].providerRequestId : null,
    model: input.model,
    usage,
    latencyMs,
    providerCallCount: parts.length,
    requestPartCount: parts.length,
    error: providerErrors.length > 0 ? providerErrors : null,
  };
}
