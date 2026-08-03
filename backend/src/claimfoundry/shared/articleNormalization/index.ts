import {
  articleDocumentFromText,
  buildArticleSourceBlocks,
} from "../../../claim-foundry/article-document/index.js";

const buildTextDocument = articleDocumentFromText as unknown as
  (input: {
    text: string;
    metadata: Record<string, unknown>;
    sourceDescriptor: Record<string, unknown>;
  }) => NormalizedArticleDocument;

const buildStructuralBlocks = buildArticleSourceBlocks as unknown as
  (
    document: NormalizedArticleDocument,
    options: {
      targetMinChars: number;
      targetMaxChars: number;
      hardMaxChars: number;
      maxBlocks: number;
    },
  ) => NormalizedStructuralBlock[];

export type NormalizedSourceUnit = {
  unitId: string;
  atomId: string;
  order: number;
  type: string;
  text: string;
  sourceOffsets: { start: number; end: number };
  contextUnitIds?: string[];
  resolvedProjection?: string;
};

export type NormalizedAtom = {
  atomId: string;
  order: number;
  type: string;
  text: string;
  sourceOffsets: { start: number; end: number };
};

export type NormalizedArticleDocument = {
  canonicalText: string;
  contentHash: string;
  sourceUnits: NormalizedSourceUnit[];
  atoms: NormalizedAtom[];
  metadata: Record<string, unknown>;
};

const INCOMPLETE_TERMINAL = new RegExp(
  String.raw`(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|U\.S)\.|[“‘"'(]|\b(?:and|or|but|nor|yet|so|because|although|while|whereas|that|which|who|whose|when|if|as)|\b(?:according to|said|says|wrote|stated|reported|asked|replied|argued|explained|noted|warned))\s*$`,
  "i",
);

const CONTEXT_DEPENDENT_START = new RegExp(
  String.raw`^(?:It|Its|They|Their|He|His|She|Her|This|That|These|Those|Such|The former|The latter)\b`,
  "i",
);

function completeCf7SourceUnits(
  document: NormalizedArticleDocument,
): NormalizedArticleDocument {
  const merged: NormalizedSourceUnit[] = [];
  for (let index = 0; index < document.sourceUnits.length; index += 1) {
    const first = document.sourceUnits[index]!;
    let last = first;
    while (
      index + 1 < document.sourceUnits.length
      && INCOMPLETE_TERMINAL.test(last.text)
      && document.sourceUnits[index + 1]!.atomId === first.atomId
    ) {
      index += 1;
      last = document.sourceUnits[index]!;
    }
    const start = first.sourceOffsets.start;
    const end = last.sourceOffsets.end;
    merged.push({
      unitId: "",
      atomId: first.atomId,
      order: 0,
      type: first.type,
      text: document.canonicalText.slice(start, end),
      sourceOffsets: { start, end },
    });
  }
  const completed = merged.map((unit, index) => ({
    ...unit,
    unitId: `U${String(index + 1).padStart(4, "0")}`,
    order: index,
  }));
  return {
    ...document,
    sourceUnits: completed.map((unit, index) => {
      if (
        index === 0
        || !CONTEXT_DEPENDENT_START.test(unit.text)
        || completed[index - 1]!.atomId !== unit.atomId
      ) {
        return unit;
      }
      const antecedent = completed[index - 1]!;
      return {
        ...unit,
        contextUnitIds: [antecedent.unitId],
        resolvedProjection: `${antecedent.text} ${unit.text}`,
      };
    }),
  };
}

export type NormalizedStructuralBlock = {
  blockId: string;
  order: number;
  heading: string;
  text: string;
  structuralType: string;
  sourceOffsets: { start: number; end: number };
  sourceUnitIds: string[];
};

export function normalizeArticleText(input: {
  text: string;
  title: string;
  language?: string;
  url?: string;
}): NormalizedArticleDocument {
  return completeCf7SourceUnits(buildTextDocument({
    text: input.text,
    metadata: { title: input.title, language: input.language },
    sourceDescriptor: { url: input.url },
  }));
}

export function deriveStructuralBlocks(
  document: NormalizedArticleDocument,
): NormalizedStructuralBlock[] {
  return buildStructuralBlocks(document, {
    targetMinChars: 600,
    targetMaxChars: 3_500,
    hardMaxChars: 50_000,
    maxBlocks: 100,
  });
}
