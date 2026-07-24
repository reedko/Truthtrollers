// Simple V3 Claim Language. Prompt-only ablation of Simple V2: the schema and
// downstream flow are unchanged. Model-facing prose uses claim/claimText
// consistently and defines atomicity without a rationale or audit field.
import { serializeStructuredArticle } from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { deriveStructuralArticleRange } from "../../../../src/claim-foundry/finalArticleCoverageRange.js";
import { splitCall1aDiscoverySchemaForArticle } from "./splitCall1aDiscoverySchemaV1.js";

export function buildSplitCall1aClaimLanguagePrompt({ article, structuralBlocks, sourceUnits }) {
  const range = deriveStructuralArticleRange({ structuralBlocks, sourceUnits });
  const rangeInstruction = range
    ? `Review every structural block from ${range.firstBlockId} through ${range.lastBlockId}
(${range.firstUnitId} through ${range.lastUnitId}) before finalizing.`
    : "Review the complete supplied article before finalizing.";

  return {
    system: `You are CF1's claim reader, stage 1A. Read the complete supplied article and return
its theme, thesis, pillars, thesisHinge, and every distinct factual claim that external evidence
could support or refute. Use only the supplied text.

Extract claims whether the article endorses, reports, disputes, or rebuts them. Preserve each claim
in its original polarity. Do not negate it, correct it, characterize it as false or unsupported, or
append the article's response. Do not decide assertion source, posture, article use, or effect on the
thesis; a later stage owns those decisions.

Theme is the article's broad argumentative position. Thesis is its specific central conclusion.
Pillars are the major disputed questions or argumentative axes, not only claims supporting the
article. Keep theme and thesis distinct. Preserve uncertainty, population, comparison, timing,
numbers, and causal strength.`,
    user: `${rangeInstruction}

For each candidateClaim:
- write claimText as one atomic, evidence-testable factual claim;
- an atomic claim has one primary subject and one independently testable predicate or relationship;
- a comparison or correlation may name multiple entities only when that relationship is itself the single claim;
- if the text asserts an additional event, outcome, statistic, classification, effect, or article response, emit it as a separate candidateClaim;
- ground each claim in its local passage using exact sourceUnitIds;
- preserve only the names, numbers, dates, comparisons, and qualifications belonging to that claim;
- treat direct quotations, attributed assertions, advertisement statements, and list items as claims
  when their substantive content is evidence-testable;
- use relatedPillarLabels only to identify the argumentative axis involved, not endorsement;
- give one short evidenceUsefulnessHint describing evidence that could test the claim.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual claim. Do not invent bibliographic details. Do not merge distinct
claims merely because they occur in the same or nearby passages.

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
    responseSchema: splitCall1aDiscoverySchemaForArticle(),
  };
}
