import { semanticInventorySchemaForArticle } from "./semanticInventorySchema.js";

// Exported for the prompt-benchmark arms: every arm must serialize the
// structured article identically to the live builder.
export function serializeStructuredArticle(blocks, sourceUnits) {
  return source(blocks, sourceUnits);
}

function source(blocks, sourceUnits) {
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return blocks.map((block) => JSON.stringify({ heading: block.heading,
    structuralType: block.structuralType,
    units: (block.sourceUnitIds ?? []).map((id) => units.get(id)).filter(Boolean)
      .map(({ unitId, text }) => ({ unitId, text })) })).join("\n");
}

export function buildSemanticInventoryPrompt({ article, structuralBlocks, sourceUnits }) {
  return {
    system: `You are CF1's semantic reader. Read the complete article once and return a compact
argument map plus a broad inventory of evidence-useful factual claims. Use only supplied text.
Theme and thesis must be DISTINCT and must not be identical strings. Theme is the article's overall
argumentative stance stated as a complete proposition (a full sentence with a subject and predicate,
not a topic label or noun phrase); thesis is the specific central conclusion the article argues. The
theme is broader than the thesis; state them in different words. Pillars are concrete article-specific
propositions needed for the thesis, not section labels. thesisHinge classifies the
article's central argument: "attribution" when the point turns on whether a statement was made or who
said/authored something (grading the saying settles the thesis); "substance" when it turns on whether
the underlying matters are true; "mixed" only when the article genuinely rests on both equally. Preserve attribution,
uncertainty, population, comparison, timing, numbers, and causal strength. Include central results,
important qualifications or subgroup results, consequential explanations, opponent claims the article
rebuts, and factual claims about named studies/documents when they are load-bearing. Exclude navigation
and trivia. Do not produce
verification questions, evidence cards, bearing criteria, queries, excerpts, offsets, IDs, a critic,
or a revision trace. The host owns named-work detection, identity, association, and provenance.`,
    user: `Extract the FULL set of load-bearing factual claims the article makes, up to 12 candidateClaims.
For a dense article, produce the upper end of the allowed range; never invent filler merely to
reach a count.
Each claim must be a complete, concise proposition directly supported by its sourceUnitIds.
Do not generalize beyond those units. relatedPillarLabels must exactly match pillar labels and express
real argumentative bearing. Keep routine methods and sample counts low-materiality unless evaluating
them could change a central conclusion. Preserve partial named-work descriptions without inventing titles,
authors, years, or identifiers. assertionSource identifies who actually supplies the assertion.
Each candidate claim asserts EXACTLY ONE proposition. PRESERVE specific numbers, dates, names,
and comparisons — do not strip detail. But if a sentence chains multiple claims with "which",
"and", "coinciding with", or "suggesting", SPLIT them into separate atomic candidates. One
proposition = one evidence search. Separate materially different thresholds, populations,
subgroup results, and causal explanations unless the article explicitly reports one indivisible
result across them. Treat each distinct numeric threshold, comparison, reported result, and
explanatory interpretation as a separate candidate even when the article joins them with "and"
or "or." Separate an overall distribution finding from a modal range or percentage. Prefer claims produced by the article's own data and analysis.
Cited studies and reviews are context unless the article's argument truly depends on their result.
Do not inventory named works; deterministic host preprocessing does that separately. Material limitations
of the article's own analysis should remain candidates; for an empirical article, include at least one
author-stated material limitation when present, ahead of routine validation methods. Do not invent or
privilege any particular limitation.
evidenceUsefulnessHint is one short sentence explaining what kind of external evidence could test it.

TITLE: ${article.title}

STRUCTURED ARTICLE:
${source(structuralBlocks, sourceUnits)}`,
    responseSchema: semanticInventorySchemaForArticle(article),
  };
}
