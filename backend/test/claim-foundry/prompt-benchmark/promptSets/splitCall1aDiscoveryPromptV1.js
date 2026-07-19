// Call 1A prompt for the Call-1 split arm (pipeline-y-canonical-relation-split-v1).
// 1A reads the full structured article (identical input/serialization to today's
// Call 1) and returns canonical propositions ONLY. It never decides posture,
// source, or effects — that temptation is exactly what causes fusion. No worked
// examples (documented anchoring / majority-label-bias risk for open extraction).
import { serializeStructuredArticle } from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { deriveStructuralArticleRange } from "../../../../src/claim-foundry/finalArticleCoverageRange.js";
import { splitCall1aDiscoverySchemaForArticle } from "./splitCall1aDiscoverySchemaV1.js";

export function buildSplitCall1aPrompt({ article, structuralBlocks, sourceUnits }) {
  const articleRange = deriveStructuralArticleRange({ structuralBlocks, sourceUnits });
  const completeArticleCheck = articleRange
    ? `COMPLETE-ARTICLE REVIEW RANGE: ${articleRange.firstBlockId} through ${articleRange.lastBlockId}
(${articleRange.blockCount} prepared structural blocks; ${articleRange.firstUnitId} through ${articleRange.lastUnitId}).
Before finalizing candidateClaims, scan every block in this range in source order. CandidateClaims do
not need one claim per block; include every distinct load-bearing, evidence-testable proposition,
including propositions the article quotes, reports, or lists in order to dispute them. Do not finalize
from an opening passage or local list before reviewing the rest of the supplied range.`
    : "Before finalizing candidateClaims, scan the complete supplied article in source order.";
  return {
    system: `You are CF1's proposition reader, stage 1A of a split pipeline. Read the complete
article once and return an argument map plus a comprehensive inventory of evidence-useful
factual propositions. Use only supplied text.

Your ONLY job is to find and preserve each proposition P that external evidence could support
or refute. You do NOT decide how the article feels about P: do not label posture, stance,
endorsement, rebuttal, source, or effect on the thesis. A later stage owns all of that. Deciding
posture now is exactly what causes distant passages to be welded together — do not do it.

Inventory propositions regardless of whether the article endorses, merely reports, disputes, or
rebuts them. A proposition quoted, attributed, or listed so the article can argue against it is still
a load-bearing proposition and must be preserved. State that proposition in its original polarity.
Never negate it, replace it with the article's correction, characterize it as false or unsupported,
or append the article's rebuttal. When a passage lists multiple evidence-testable assertions, preserve
each assertion separately. The later stage—not 1A—will determine source and relationship to thesis.

Theme and thesis must be DISTINCT and must not be identical strings. Theme is the article's overall
argumentative stance stated as a complete proposition (a full sentence with a subject and predicate,
not a topic label or noun phrase); thesis is the specific central conclusion the article argues. The
theme is broader than the thesis; state them in different words. Pillars are concrete article-specific
propositions needed for the thesis, not section labels. thesisHinge classifies the article's central
argument: "attribution" when the point turns on whether a statement was made or who said/authored
something; "substance" when it turns on whether the underlying matters are true; "mixed" only when the
article genuinely rests on both equally. Preserve attribution, uncertainty, population, comparison,
timing, numbers, and causal strength. Exclude navigation and trivia. Do not produce posture, source,
effects, verification questions, evidence cards, queries, IDs, a critic, or a revision trace. The host
owns named-work detection, identity, association, and provenance.`,
    user: `Each claimText is a complete, concise proposition directly supported by its sourceUnitIds.
Do not generalize beyond those units. relatedPillarLabels must exactly match pillar
labels and express real argumentative bearing. Keep routine methods and sample counts low-materiality
unless evaluating them could change a central conclusion. Preserve partial named-work descriptions
without inventing titles, authors, years, or identifiers. Do not inventory named works; deterministic
host preprocessing does that separately.

ATOMICITY AND GROUNDING — ONE PASSAGE PER CLAIM.
Each candidate asserts EXACTLY ONE proposition. A claim's sourceUnitIds must come from ONE tightly
clustered passage. PRESERVE specific numbers, dates, names, and comparisons — do not strip detail.
If a sentence chains multiple claims with "which", "and", "coinciding with", or "suggesting", SPLIT
them into separate atomic candidates grounded in their own units. Separate materially different
thresholds, populations, subgroup results, and causal explanations unless the article explicitly
reports one indivisible result across them.

If the article echoes a theme, allegation, or motif across DISTANT passages, extract EACH occurrence
as its own separate claim grounded in its own local passage. Repetition across the article is expected
and fine. What is NOT fine is welding two or more distant passages into one synthesized proposition
because they share a motif, tone, or topic — never do this. If a passage is purely rhetorical with no
standalone testable proposition, do not extract it at all.

NOT A CLAIM — do NOT extract meta-descriptions of what the article, an advertisement, a source, or a
speaker attempted, tried, sought, aimed, or intended to do, or of HOW something was presented (its
framing, tone, style, or rhetorical purpose). "X tried to reassure readers", "the ad presented Y in a
light-hearted way", "the author frames Z as…" are characterizations of presentation, not externally
verifiable propositions. Extract the substantive factual assertion ITSELF, never a description of how
or why it was said.

evidenceUsefulnessHint is one short sentence explaining what kind of external evidence could test the
proposition.

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}

COMPLETE-ARTICLE INVENTORY CHECK
${completeArticleCheck}`,
    responseSchema: splitCall1aDiscoverySchemaForArticle(),
  };
}
