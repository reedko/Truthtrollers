// Minimal attribution-preserving experiment based on Simple V2. Simple V2 is
// intentionally left byte-for-byte unchanged as the benchmark baseline.
import { serializeStructuredArticle } from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { deriveStructuralArticleRange } from "../../../../src/claim-foundry/finalArticleCoverageRange.js";
import { splitCall1aAttributionSchemaForArticle }
  from "./splitCall1aDiscoverySchemaAttributionV2.js";

export function buildSplitCall1aAttributionPrompt({ article, structuralBlocks, sourceUnits }) {
  const range = deriveStructuralArticleRange({ structuralBlocks, sourceUnits });
  const rangeInstruction = range
    ? `Review every structural block from ${range.firstBlockId} through ${range.lastBlockId}
(${range.firstUnitId} through ${range.lastUnitId}) before finalizing.`
    : "Review the complete supplied article before finalizing.";

  return {
    system: `You are CF1's proposition reader, stage 1A. Read the complete supplied article and return
its theme, thesis, pillars, thesisHinge, and every distinct factual proposition that external evidence
could support or refute. Use only the supplied text.

Extract propositions whether the article endorses, reports, disputes, or rebuts them. Preserve each
proposition in its original polarity. Do not negate it, correct it, characterize it as false or
unsupported, or append the article's response. Do not decide assertion source, posture, article use,
or effect on the thesis; a later stage owns those decisions.

Theme is the article's broad argumentative position. Thesis is its specific central conclusion.
Pillars are the major disputed questions or argumentative axes, not only propositions supporting the
article. Keep theme and thesis distinct. Preserve uncertainty, population, comparison, timing,
numbers, and causal strength.`,
    user: `${rangeInstruction}

For each candidateClaim:
- state exactly one complete, concise, evidence-testable proposition;
- ground it in one local passage using exact sourceUnitIds;
- when local units name or introduce the proposition's possible supplier, include those unit IDs in
  attributionContextUnitIds; otherwise return an empty array;
- if equivalent propositions occur with different named or quoted suppliers, return separate
  candidates with their own grounding and attribution context; do not merge them;
- split chained propositions rather than combining them;
- preserve specific names, numbers, dates, comparisons, and qualifications;
- treat direct quotations, attributed assertions, advertisement statements, and list items as claims
  when their substantive content is evidence-testable;
- use relatedPillarLabels only to identify the argumentative axis involved, not endorsement;
- give one short evidenceUsefulnessHint describing evidence that could test the proposition.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual proposition. Do not invent bibliographic details or combine
distant passages into a synthesized claim.

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
    responseSchema: splitCall1aAttributionSchemaForArticle(),
  };
}
