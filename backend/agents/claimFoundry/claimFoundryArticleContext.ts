import { createHash } from "node:crypto";
import type { AgentInputItem } from "@openai/agents";
import type { ArticleDocument, SourceUnit } from "./claimFoundryContext.js";

export const CF6_WHOLE_ARTICLE_CONTEXT_VERSION =
  "cf6.wholeArticleContext.v2.1" as const;
export const CF6_ARTICLE_CONTEXT_OPEN = "<CF6_WHOLE_ARTICLE_CONTEXT>";
export const CF6_ARTICLE_CONTEXT_CLOSE = "</CF6_WHOLE_ARTICLE_CONTEXT>";

export function supportsExplicitPromptCacheBreakpoint(model: string) {
  return /^gpt-5\.(?:[6-9]|[1-9]\d)(?:-|$)/.test(model) ||
    /^gpt-(?:[6-9]|[1-9]\d)(?:[.-]|$)/.test(model);
}

export type WholeArticleContextMetadata = {
  title?: string | null;
  url?: string | null;
  language?: string | null;
};

export type WholeArticleContextPayload = {
  version: typeof CF6_WHOLE_ARTICLE_CONTEXT_VERSION;
  contentHash: string;
  sourceFamily: string;
  metadata: WholeArticleContextMetadata;
  structureProfile: Record<string, unknown>;
  sourceUnits: Array<{
    unitId: string;
    atomId: string;
    order: number;
    type: string;
    text: string;
    sourceOffsets: { start: number; end: number };
    linkIds: string[];
    citationMarkerIds: string[];
    articleReferenceIds: string[];
    layoutSignals: Record<string, unknown> | null;
  }>;
  links: ArticleDocument["links"];
  citationMarkers: ArticleDocument["citationMarkers"];
  references: ArticleDocument["references"];
};

export type WholeArticleContext = {
  text: string;
  payload: WholeArticleContextPayload;
  serializedPayloadHash: string;
  unitCount: number;
  canonicalTextCharacters: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateUnit(document: ArticleDocument, unit: SourceUnit, index: number) {
  if (!/^U\d{4,}$/.test(unit.unitId)) {
    throw new Error(`Invalid source-unit ID at index ${index}: ${unit.unitId}`);
  }
  if (unit.order !== index) {
    throw new Error(
      `Source-unit order is not canonical for ${unit.unitId}: ${unit.order} !== ${index}`,
    );
  }
  const { start, end } = unit.sourceOffsets;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new Error(`Invalid source offsets for ${unit.unitId}`);
  }
  if (document.canonicalText.slice(start, end) !== unit.text) {
    throw new Error(`Source-unit text does not match canonical content for ${unit.unitId}`);
  }
}

export function buildWholeArticleContext(input: {
  document: ArticleDocument;
  metadata?: WholeArticleContextMetadata;
}): WholeArticleContext {
  const { document } = input;
  if (!document.sourceUnits.length) {
    throw new Error("Whole-article context requires at least one source unit");
  }
  const seen = new Set<string>();
  const atomSignals = new Map(document.atoms.map(atom => [
    atom.atomId,
    atom.layoutSignals ?? null,
  ]));
  for (const [index, unit] of document.sourceUnits.entries()) {
    validateUnit(document, unit, index);
    if (seen.has(unit.unitId)) {
      throw new Error(`Duplicate source-unit ID ${unit.unitId}`);
    }
    seen.add(unit.unitId);
  }

  const payload: WholeArticleContextPayload = {
    version: CF6_WHOLE_ARTICLE_CONTEXT_VERSION,
    contentHash: document.contentHash,
    sourceFamily: document.sourceFamily,
    metadata: {
      title: input.metadata?.title ?? null,
      url: input.metadata?.url ?? null,
      language: input.metadata?.language ?? null,
    },
    structureProfile: document.structureProfile,
    sourceUnits: document.sourceUnits.map(unit => ({
      unitId: unit.unitId,
      atomId: unit.atomId,
      order: unit.order,
      type: unit.type,
      text: unit.text,
      sourceOffsets: {
        start: unit.sourceOffsets.start,
        end: unit.sourceOffsets.end,
      },
      linkIds: [...(unit.linkIds ?? [])],
      citationMarkerIds: [...(unit.citationMarkerIds ?? [])],
      articleReferenceIds: [...(unit.articleReferenceIds ?? [])],
      layoutSignals: atomSignals.get(unit.atomId) ?? null,
    })),
    links: structuredClone(document.links),
    citationMarkers: structuredClone(document.citationMarkers),
    references: structuredClone(document.references),
  };
  const serialized = JSON.stringify(payload);
  return {
    text: `${CF6_ARTICLE_CONTEXT_OPEN}\n${serialized}\n${CF6_ARTICLE_CONTEXT_CLOSE}`,
    payload,
    serializedPayloadHash: sha256(serialized),
    unitCount: payload.sourceUnits.length,
    canonicalTextCharacters: document.canonicalText.length,
  };
}

export function assertWholeArticleContext(
  context: WholeArticleContext,
  document: ArticleDocument,
) {
  if (context.payload.contentHash !== document.contentHash) {
    throw new Error("Whole-article context content hash mismatch");
  }
  if (context.payload.sourceUnits.length !== document.sourceUnits.length) {
    throw new Error("Whole-article context source-unit count mismatch");
  }
  for (const [index, expected] of document.sourceUnits.entries()) {
    const actual = context.payload.sourceUnits[index];
    if (!actual ||
      actual.unitId !== expected.unitId ||
      actual.order !== expected.order ||
      actual.type !== expected.type ||
      actual.text !== expected.text ||
      actual.sourceOffsets.start !== expected.sourceOffsets.start ||
      actual.sourceOffsets.end !== expected.sourceOffsets.end) {
      throw new Error(`Whole-article context differs at source-unit index ${index}`);
    }
  }
  const serialized = JSON.stringify(context.payload);
  if (sha256(serialized) !== context.serializedPayloadHash) {
    throw new Error("Whole-article context serialized payload hash mismatch");
  }
  if (!context.text.startsWith(`${CF6_ARTICLE_CONTEXT_OPEN}\n`) ||
    !context.text.endsWith(`\n${CF6_ARTICLE_CONTEXT_CLOSE}`)) {
    throw new Error("Whole-article context boundary markers are invalid");
  }
}

export function buildWholeArticleAgentInput(input: {
  article: WholeArticleContext;
  trailingWorkbench: unknown;
  explicitCacheBreakpoint?: boolean;
}): AgentInputItem[] {
  const articleBlock = {
    type: "input_text" as const,
    text: input.article.text,
    ...(input.explicitCacheBreakpoint === false
      ? {}
      : { promptCacheBreakpoint: { mode: "explicit" as const } }),
  };
  return [{
    type: "message",
    role: "user",
    content: [
      articleBlock,
      {
        type: "input_text",
        text: `<CF6_TRAILING_WORKBENCH>\n${
          JSON.stringify(input.trailingWorkbench)
        }\n</CF6_TRAILING_WORKBENCH>`,
      },
    ],
  }];
}
