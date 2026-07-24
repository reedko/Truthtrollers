import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

export const P1A_V12_BOTTOM_UP_ORIENTATION = "P1aV12-bottom-up-orientation";

const strings = (maxLength = 160, values = null) => ({ type: "array",
  items: values?.length ? { type: "string", enum: values }
    : { type: "string", minLength: 1, maxLength } });

const normalized = (value) => String(value ?? "").toLowerCase().normalize("NFKC")
  .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

export function buildP1aV12BottomUpOrientationSchema(structuralBlocks = [],
  sourceUnits = []) {
  const blockIds = structuralBlocks.map((block) => block.blockId);
  const blockProperties = Object.fromEntries(structuralBlocks.map((block) =>
    [block.blockId, {
      type: "object",
      additionalProperties: false,
      required: ["localArgumentQuestions"],
      properties: {
        localArgumentQuestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "sourceUnitIds"],
            properties: {
              question: { type: "string", minLength: 1, maxLength: 500 },
              sourceUnitIds: strings(20, block.sourceUnitIds ?? []),
            },
          },
        },
      },
    }]));
  return {
    name: "p1a_v12_bottom_up_orientation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["blockAnalyses", "evidenceAxes", "thesis", "theme", "thesisHinge"],
      properties: {
        blockAnalyses: {
          type: "object",
          additionalProperties: false,
          required: blockIds,
          properties: blockProperties,
        },
        evidenceAxes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "question", "sourceBlockIds", "sourceUnitIds"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 140 },
              question: { type: "string", minLength: 1, maxLength: 500 },
              sourceBlockIds: { type: "array", minItems: 1,
                items: { type: "string", enum: blockIds } },
              sourceUnitIds: strings(20),
            },
          },
        },
        thesis: {
          type: "object",
          additionalProperties: false,
          required: ["text", "sourceUnitIds"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: strings(20),
          },
        },
        theme: {
          type: "object",
          additionalProperties: false,
          required: ["text", "sourceUnitIds"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: strings(20),
          },
        },
        thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      },
    },
  };
}

export const P1A_V12_SYSTEM = `You are CF1's bottom-up article-argument synthesizer. Work from
the article's local argumentative structure upward. Do not determine the overall thesis or theme
until you have completed the local argument questions and evidence axes. Use only the supplied
article.

For each structural block, identify its specific disputed factual question or questions. Express
each as a neutral question that external evidence could resolve. Do not use broad topics, section
labels, rhetorical descriptions, or chronology summaries. A block may contain no externally
resolvable argument question.

Next, consolidate local argument questions into evidence axes. Combine questions only when
substantially the same body of evidence would resolve them. Keep them separate when they involve
different mechanisms, sources, populations, events, or could stand or fall independently. Each
evidence axis must arise from one or more local questions and cite the blocks and units containing
those questions.

After completing the evidence axes, infer the article's specific central thesis from their combined
argumentative direction. Then state the broader theme. Finally determine thesisHinge: substance
when the truth of underlying factual matters settles the thesis; attribution only when who said,
wrote, or published something settles it; mixed only when both genuinely carry equal central weight.

Preserve the article's actual direction even when it is contrarian. Do not extract, select, rewrite,
classify the stance of, or evaluate individual factual assertions.`;

export function buildP1aV12BottomUpOrientationPrompt({ article, structuralBlocks = [],
  sourceUnits = [] } = {}) {
  return {
    system: P1A_V12_SYSTEM,
    user: `Build the article's argument orientation from the complete structural blocks below.
The response schema contains one required field for every structural block.

TITLE:
${article?.title ?? ""}

COMPLETE STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
    responseSchema: buildP1aV12BottomUpOrientationSchema(structuralBlocks, sourceUnits),
  };
}

export function verifyP1aV12BottomUpOrientation(output, { structuralBlocks = [],
  sourceUnits = [] } = {}) {
  const issues = [];
  const blockIds = structuralBlocks.map((block) => block.blockId);
  const blockSet = new Set(blockIds);
  const unitSet = new Set(sourceUnits.map((unit) => unit.unitId));
  const unitsByBlock = new Map(structuralBlocks.map((block) =>
    [block.blockId, new Set(block.sourceUnitIds ?? [])]));
  const analyses = output?.blockAnalyses ?? {};
  const returnedBlocks = Object.keys(analyses);
  if (returnedBlocks.length !== blockIds.length
    || blockIds.some((blockId) => !returnedBlocks.includes(blockId))) {
    issues.push("block analyses must cover every block exactly once");
  }
  const localQuestions = Object.entries(analyses).flatMap(([blockId, analysis]) =>
    (analysis.localArgumentQuestions ?? []).map((question) => ({ ...question, blockId })));
  for (const local of localQuestions) {
    const allowed = unitsByBlock.get(local.blockId) ?? new Set();
    if (!(local.sourceUnitIds ?? []).length
      || local.sourceUnitIds.some((unitId) => !allowed.has(unitId))) {
      issues.push(`${local.blockId} has a local question citing outside its structural block`);
    }
  }
  const labels = (output?.evidenceAxes ?? []).map((axis) => normalized(axis.label));
  if (!labels.length || labels.some((label) => !label)
    || new Set(labels).size !== labels.length) {
    issues.push("evidence-axis labels must be nonempty and unique");
  }
  const blocksWithQuestions = new Set(localQuestions.map((question) => question.blockId));
  for (const axis of output?.evidenceAxes ?? []) {
    const allowedAxisUnits = new Set((axis.sourceBlockIds ?? []).flatMap((blockId) =>
      structuralBlocks.find((block) => block.blockId === blockId)?.sourceUnitIds ?? []));
    if (!(axis.sourceBlockIds ?? []).length
      || axis.sourceBlockIds.some((blockId) => !blockSet.has(blockId)
        || !blocksWithQuestions.has(blockId))
      || !(axis.sourceUnitIds ?? []).length
      || axis.sourceUnitIds.some((unitId) => !unitSet.has(unitId)
        || !allowedAxisUnits.has(unitId))) {
      issues.push(`evidence axis ${axis.label ?? "[unlabelled]"} has invalid grounding`);
    }
  }
  for (const item of [output?.thesis, output?.theme].filter(Boolean)) {
    if (!item.text || !(item.sourceUnitIds ?? []).length
      || item.sourceUnitIds.some((unitId) => !unitSet.has(unitId))) {
      issues.push("thesis or theme grounding is invalid");
    }
  }
  if (!buildP1aV12BottomUpOrientationSchema(structuralBlocks, sourceUnits)
    .schema.properties.thesisHinge.enum.includes(output?.thesisHinge)) {
    issues.push("thesisHinge is invalid");
  }
  if (issues.length) throw new Error(`Invalid P1aV12 orientation: ${issues.join("; ")}`);
  return structuredClone(output);
}

export function adaptP1aV12ForV7ChunkPrompt(orientation) {
  return {
    theme: orientation.theme,
    thesis: orientation.thesis,
    thesisHinge: orientation.thesisHinge,
    pillars: orientation.evidenceAxes.map((axis) => ({
      label: axis.label,
      text: axis.question,
      importance: "unranked",
      sourceUnitIds: axis.sourceUnitIds,
    })),
  };
}
