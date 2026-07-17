// Frozen control — COPY of the live CF1 prompts at baseline commit 0d72fc65
// (2026-07-17), per the coder plan §2/§6: copied + hashed, NOT live-imported.
// promptBenchmarkRegistry.test.js pins byte-equality with the live builders at
// freeze time; that pin is REMOVED at promotion (the control keeps this text
// even after the live files change). Do not edit this text for any reason.
import { semanticInventorySchemaForArticle } from "../../../../src/claim-foundry/prompts/semanticInventorySchema.js";
import { serializeStructuredArticle } from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { buildEnrichmentContextBlocks, selectedEnrichmentSchemaForClaims }
  from "../../../../src/claim-foundry/prompts/selectedEnrichmentPrompt.js";

const CALL1_SYSTEM = `You are CF1's semantic reader. Read the complete article once and return a compact
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
or a revision trace. The host owns named-work detection, identity, association, and provenance.`;

const CALL1_USER_BODY = `Extract the FULL set of load-bearing factual claims the article makes, up to 12 candidateClaims.
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
evidenceUsefulnessHint is one short sentence explaining what kind of external evidence could test it.`;

const CALL2_SYSTEM = `You are CF1's selected-claim evidence planner. Supply only semantic guidance the host
cannot derive mechanically. Preserve polarity, attribution, scope, comparison, uncertainty, numbers,
and causal strength. Use only supplied source units. Do not browse, invent identifiers or named works,
or write final search queries. Be concise and return exactly one item per candidateId.`;

const CALL2_USER_BODY = `For every selected claim, first decide which question is genuinely in dispute and report
it in disputedQuestion. If the article itself stipulates that a statement, report, accusation, or
finding was made, and the contested issue is whether the underlying matter is true, set
verificationTarget to substantive, state the underlying matter as disputedProposition, and record
the stipulation in stipulatedByArticle; supportCriteria and refuteCriteria must then address the
underlying matter, and sources that merely repeat the stipulated statement belong in rejectIfOnly.
When a claim reports the article's own analysis or findings, the disputed question is whether
independent evidence corroborates it: the article's own text can never serve as that evidence.
Choose substantive whenever the underlying matter is what is contested; reserve both_needed for
claims where attribution and substance are genuinely inseparable, never to avoid the decision.
Then identify concrete evidence outcomes that would support, refute,
or materially qualify it. mustMatch states the distinctions evidence must share with the claim;
rejectIfOnly identifies tempting but non-bearing material. mustMatch must name concrete entities,
populations, measures, comparisons, places, or time bounds—not pillar labels or section headings.
Qualification criteria must describe a concrete evidentiary outcome that narrows the claim; never answer
with "further studies," "additional analysis," or another proposed activity. Choose sourceStrategy as:
primary_article_result only when truth depends on the target article's own study or analysis and cannot
be checked more directly; named_work_result for an external study or review; official_record whenever
an authoritative event, agency, government, legal, scientific-observation, or administrative record can
directly verify the claim, even if the target article reports it; methodology_review for
a methods or limitation claim; independent_corroboration for a broader claim needing outside research;
or mixed_sources only when two kinds are genuinely required. searchConcepts are short discriminating
concepts for deterministic host query construction, not query sentences or pillar labels.
Set revisedClaimText to null unless a critic finding requires a material correction.
The host will generate verification questions, theme-bearing prose, evidence roles, identifiers, and
query strings. Reference named works only by an allowed namedWorkId, and select only works directly
needed to resolve or test that claim; mere occurrence in the same source unit is not enough.
Do not copy a named-work label into searchConcepts or cautions when its namedWorkId is selected; the
host will build identity-specific queries from that ID. Keep searchConcepts semantic and non-identifying.
Emit JSON immediately.`;

export function buildCall1Prompt({ article, structuralBlocks, sourceUnits }) {
  return { system: CALL1_SYSTEM, user: `${CALL1_USER_BODY}

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
  responseSchema: semanticInventorySchemaForArticle(article) };
}

export function buildCall2Prompt(context) {
  return { system: CALL2_SYSTEM, user: `${CALL2_USER_BODY}

${buildEnrichmentContextBlocks(context)}`,
  responseSchema: selectedEnrichmentSchemaForClaims(context.selectedClaims) };
}

export const SET_CONTROL_CURRENT_V1 = Object.freeze({
  id: "set-control-current-v1", label: "hidden from reviewers", status: "control",
  call1: { version: "control-current-call1-v1", schemaName: "cf1_semantic_inventory_v1",
    schemaHash: "39a324e68236d0a57e04ff8e1e2bc0d0186de53a4b77c94a465913cb8571ecb6",
    build: buildCall1Prompt },
  call2: { version: "control-current-call2-v1", schemaName: "cf1_selected_enrichment_v3",
    schemaHash: "bea861ac720945be9af038dc74b26c89031e8bf7757677d2df8019dbd52a4805",
    build: buildCall2Prompt },
});
