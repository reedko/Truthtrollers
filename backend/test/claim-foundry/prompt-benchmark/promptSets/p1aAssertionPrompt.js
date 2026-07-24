import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { deriveStructuralArticleRange }
  from "../../../../src/claim-foundry/finalArticleCoverageRange.js";
import { p1aVariantSchema } from "./p1aVariantSchema.js";

export function buildP1aAssertionPrompt({ article, structuralBlocks, sourceUnits,
  label, removeMateriality = false } = {}) {
  const range = deriveStructuralArticleRange({ structuralBlocks, sourceUnits });
  const rangeInstruction = range
    ? `Review every structural block from ${range.firstBlockId} through ${range.lastBlockId}
(${range.firstUnitId} through ${range.lastUnitId}) before finalizing.`
    : "Review the complete supplied article before finalizing.";
  return {
    system: `You are CF1's assertion reader, stage 1A. Read the complete supplied article and return
its theme, thesis, pillars, thesisHinge, and every distinct externally testable factual assertion.
Use only the supplied text.

Extract assertions whether the article endorses, reports, disputes, or rebuts them. Preserve each
assertion in its original polarity. Do not negate it, correct it, characterize it as false or
unsupported, or append the article's response. Do not decide assertion source, posture, article use,
or effect on the thesis; a later stage owns those decisions.

Theme is the article's broad argumentative position. Thesis is its specific central conclusion.
Pillars are the major disputed questions or argumentative axes, not only assertions supporting the
article. Keep theme and thesis distinct. Preserve uncertainty, population, comparison, timing,
numbers, and causal strength.`,
    user: `${rangeInstruction}

For each assertion:
- write assertionText as one atomic, externally testable factual assertion;
- an atomic assertion has one primary subject and one independently testable predicate or relationship;
- a comparison or correlation may name multiple entities only when that relationship is itself the single assertion;
- if the text asserts an additional event, outcome, statistic, classification, effect, or article response, emit it as a separate assertion;
- ground each assertion in its local passage using exact sourceUnitIds;
- preserve only the names, numbers, dates, comparisons, and qualifications belonging to that assertion;
- treat direct quotations, attributed assertions, advertisement statements, and list items as assertions
  when their substantive content is externally testable;
- use relatedPillarLabels only to identify the argumentative axis involved, not endorsement;
- give one short evidenceUsefulnessHint describing evidence that could test the assertion.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual assertion. Do not invent bibliographic details. Do not merge
distinct assertions merely because they occur in the same or nearby passages.

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
    responseSchema: p1aVariantSchema({ label, assertionTerminology: true,
      removeMateriality }),
  };
}
