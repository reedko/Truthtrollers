import { semanticInventorySchemaForArticle } from "./semanticInventorySchema.js";

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
Theme is the article's argumentative point; thesis is its central conclusion. Pillars are concrete
article-specific propositions needed for the thesis, not section labels. Preserve attribution,
uncertainty, population, comparison, timing, numbers, and causal strength. Include central results,
important qualifications or subgroup results, consequential explanations, opponent claims the article
rebuts, and named studies/documents it relies upon. Exclude navigation and trivia. Do not produce
verification questions, evidence cards, bearing criteria, queries, excerpts, offsets, IDs, a critic,
or a revision trace. Return namedWorks as a separate text-visible inventory; the host associates them
with claims and performs selection and exact provenance work.`,
    user: `Return 16-20 candidateClaims for a full article so the host can select 8-10.
Each claim must be a complete, concise proposition directly supported by its sourceUnitIds.
Do not generalize beyond those units. relatedPillarLabels must exactly match pillar labels and express
real argumentative bearing. Keep routine methods and sample counts low-materiality unless evaluating
them could change a central conclusion. Preserve partial named-work descriptions without inventing titles,
authors, years, or identifiers. assertionSource identifies who actually supplies the assertion.
Keep evidence tasks atomic: separate materially different thresholds, populations, subgroup results, and
causal explanations unless the article explicitly reports one indivisible result across them.
Treat each distinct numeric threshold, comparison, reported result, and explanatory interpretation as a
separate candidate even when the article joins them with "and" or "or." Separate an overall distribution
finding from a modal range or percentage. Prefer claims produced by the article's own data and analysis.
Cited studies and reviews are context unless the article's argument truly depends on their result.
Independently inventory every text-visible named or described study, case series, cohort, review, report,
dataset, standard/manual, law, or policy in namedWorks, whether or not it becomes a candidate claim.
Recognize author/organization names followed by citation digits, partial descriptions such as a cohort from
a place or population, citation ranges attached to study groups, named diagnostic standards, and named laws.
mentionText must be the concise visible mention, not the current article title and not an entire assertion.
Preserve an attached citation number or range in citationCallout. Cite the exact sourceUnitIds. Set source to
text_mention and linkResolved to false; no URL or bibliography resolution is required. Do not invent formal
titles, authors, years, or identifiers that are absent from those units. Material limitations
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
