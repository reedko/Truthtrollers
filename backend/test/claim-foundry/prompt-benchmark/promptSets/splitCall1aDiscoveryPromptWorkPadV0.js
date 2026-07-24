// EDITABLE CALL 1A WORKPAD — V0
//
// This file is deliberately "fat": the complete system prompt, user-template
// text, response schema, article serialization, and range construction are all
// visible here. It imports no prompt/schema fragments. The initial contents
// reproduce Simple V2; edit this file to create a new test without modifying the
// preserved V1 or Simple V2 baselines.

export const WORKPAD_SYSTEM_PROMPT = `You are CF1's proposition reader, stage 1A. Read the complete supplied article and return
its theme, thesis, pillars, thesisHinge, and every distinct factual proposition that external evidence
could support or refute. Use only the supplied text.

Extract propositions whether the article endorses, reports, disputes, or rebuts them. Preserve each
proposition in its original polarity. Do not negate it, correct it, characterize it as false or
unsupported, or append the article's response. Do not decide assertion source, posture, article use,
or effect on the thesis; a later stage owns those decisions.

Theme is the article's broad argumentative position. Thesis is its specific central conclusion.
Pillars are the major disputed questions or argumentative axes, not only propositions supporting the
article. Keep theme and thesis distinct. Preserve uncertainty, population, comparison, timing,
numbers, and causal strength.`;

export const WORKPAD_USER_PROMPT_TEMPLATE = `{{ARTICLE_RANGE_INSTRUCTION}}

For each candidateClaim:
- state exactly one complete, concise, evidence-testable proposition;
- ground it in one local passage using exact sourceUnitIds;
- split chained propositions rather than combining them;
- preserve specific names, numbers, dates, comparisons, and qualifications;
- treat direct quotations, attributed assertions, advertisement statements, and list items as claims
  when their substantive content is evidence-testable;
- use relatedPillarLabels only to identify the argumentative axis involved, not endorsement;
- give one short evidenceUsefulnessHint describing evidence that could test the proposition.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual proposition. Do not invent bibliographic details or combine
distant passages into a synthesized claim.

TITLE: {{ARTICLE_TITLE}}

STRUCTURED ARTICLE:
{{STRUCTURED_ARTICLE_JSONL}}`;

const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

// Complete Structured Outputs contract sent with the request. CandidateClaims
// has no discovery floor or ceiling; streaming provides the repetition-loop guard.
export const WORKPAD_RESPONSE_SCHEMA = Object.freeze({
  name: "cf1_semantic_inventory_split_discovery_workpad_v0",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["theme", "thesis", "thesisHinge", "pillars", "candidateClaims"],
    properties: {
      thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      theme: {
        type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        },
      },
      thesis: {
        type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        },
      },
      pillars: {
        type: "array", minItems: 1, maxItems: 8,
        items: {
          type: "object", additionalProperties: false,
          required: ["label", "text", "importance", "sourceUnitIds"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 140 },
            text: { type: "string", minLength: 1, maxLength: 500 },
            importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
            sourceUnitIds: strings(12, 20),
          },
        },
      },
      candidateClaims: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["claimText", "sourceUnitIds", "materiality", "relatedPillarLabels",
            "scope", "evidenceUsefulnessHint"],
          properties: {
            claimText: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: strings(12, 20),
            materiality: { type: "string", enum: ["high", "medium", "low"] },
            relatedPillarLabels: strings(4, 140),
            scope: { type: "string", minLength: 1, maxLength: 400 },
            evidenceUsefulnessHint: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
  },
});

function serializeStructuredArticle(structuralBlocks = [], sourceUnits = []) {
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return structuralBlocks.map((block) => JSON.stringify({
    heading: block.heading,
    structuralType: block.structuralType,
    units: (block.sourceUnitIds ?? []).map((id) => units.get(id)).filter(Boolean)
      .map(({ unitId, text }) => ({ unitId, text })),
  })).join("\n");
}

function articleRangeInstruction(structuralBlocks = [], sourceUnits = []) {
  const sourceOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const blocks = structuralBlocks
    .filter((block) => Array.isArray(block?.sourceUnitIds) && block.sourceUnitIds.length);
  const ids = [...new Set(blocks.flatMap((block) => block.sourceUnitIds))]
    .filter((id) => sourceOrder.has(id))
    .sort((left, right) => sourceOrder.get(left) - sourceOrder.get(right));
  if (!blocks.length || !ids.length) return "Review the complete supplied article before finalizing.";
  return `Review every structural block from ${blocks[0].blockId} through ${blocks.at(-1).blockId}
(${ids[0]} through ${ids.at(-1)}) before finalizing.`;
}

function fill(template, placeholder, value) {
  return template.split(placeholder).join(String(value ?? ""));
}

export function buildSplitCall1aWorkPadPrompt({ article, structuralBlocks, sourceUnits }) {
  let user = WORKPAD_USER_PROMPT_TEMPLATE;
  user = fill(user, "{{ARTICLE_RANGE_INSTRUCTION}}",
    articleRangeInstruction(structuralBlocks, sourceUnits));
  user = fill(user, "{{ARTICLE_TITLE}}", article?.title ?? "");
  user = fill(user, "{{STRUCTURED_ARTICLE_JSONL}}",
    serializeStructuredArticle(structuralBlocks, sourceUnits));
  return {
    system: WORKPAD_SYSTEM_PROMPT,
    user,
    responseSchema: structuredClone(WORKPAD_RESPONSE_SCHEMA),
  };
}
