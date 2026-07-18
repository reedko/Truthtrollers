import { CF1_SELECTED_ENRICHMENT_SCHEMA, CF1_SELECTED_ENRICHMENT_WARRANT_SCHEMA }
  from "./selectedEnrichmentSchema.js";

function criticInstructions(selectedClaims, criticReport) {
  return selectedClaims.map((claim) => ({ candidateId: claim.candidateId,
    findings: (criticReport?.findings ?? []).filter((finding) =>
      finding.candidateIds?.includes(claim.candidateId)).map((finding) => ({
      type: finding.type, problem: finding.problem, action: finding.recommendedAction,
    })) }));
}

function selectedPackets(selectedClaims) {
  return selectedClaims.map(({ namedWorkHints = [], ...claim }) => ({
    candidateId: claim.candidateId, claimText: claim.claimText,
    sourceUnitIds: claim.sourceUnitIds, articleRole: claim.articleRole,
    articleUse: claim.articleUse, assertionSource: claim.assertionSource,
    materiality: claim.materiality, relatedPillarLabels: claim.relatedPillarLabels,
    scope: claim.scope, evidenceUsefulnessHint: claim.evidenceUsefulnessHint,
    availableNamedWorkIds: namedWorkHints.map((work) => work.namedWorkId),
  }));
}

// Exported for the prompt-benchmark arms: the five host-supplied blocks must be
// serialized identically, in identical positions, by every arm's Call 2 builder.
export function buildEnrichmentContextBlocks({ orientation, selectedClaims, criticReport,
  sourceUnits, namedWorkPool = [] }) {
  return `ORIENTATION:
${JSON.stringify(orientation)}

SELECTED CLAIM PACKETS:
${JSON.stringify(selectedPackets(selectedClaims))}

ACTIONABLE CRITIC INSTRUCTIONS:
${JSON.stringify(criticInstructions(selectedClaims, criticReport))}

HOST-VALIDATED NAMED WORK POOL:
${JSON.stringify(namedWorkPool.map(({ namedWorkId, mentionText, workType, citationCallout, sourceUnitIds }) =>
    ({ namedWorkId, label: mentionText, workType, citationCallout, sourceUnitIds })))}

ALLOWED SOURCE UNITS:
${JSON.stringify(sourceUnits.map(({ unitId, text }) => ({ unitId, text })))}`;
}

// Exported for the prompt-benchmark arms: every arm pins the enriched-claims
// count to the host selection exactly as the live builder does.
export function selectedEnrichmentSchemaForClaims(selectedClaims) {
  return enrichmentSchemaForClaims(selectedClaims, CF1_SELECTED_ENRICHMENT_SCHEMA);
}

export function selectedEnrichmentWarrantSchemaForClaims(selectedClaims) {
  return enrichmentSchemaForClaims(selectedClaims, CF1_SELECTED_ENRICHMENT_WARRANT_SCHEMA);
}

function enrichmentSchemaForClaims(selectedClaims, baseSchema) {
  const responseSchema = structuredClone(baseSchema);
  responseSchema.schema.properties.enrichedClaims.minItems = selectedClaims.length;
  responseSchema.schema.properties.enrichedClaims.maxItems = selectedClaims.length;
  return responseSchema;
}

export function buildSelectedEnrichmentPrompt({ orientation, selectedClaims, criticReport,
  sourceUnits, namedWorkPool = [] }) {
  const responseSchema = selectedEnrichmentSchemaForClaims(selectedClaims);
  return {
    system: `You are CF1's selected-claim evidence planner. Supply only semantic guidance the host
cannot derive mechanically. Preserve polarity, attribution, scope, comparison, uncertainty, numbers,
and causal strength. Use only supplied source units. Do not browse, invent identifiers or named works,
or write final search queries. Be concise and return exactly one item per candidateId.`,
    user: `For every selected claim, first decide which question is genuinely in dispute and report
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
Emit JSON immediately.

${buildEnrichmentContextBlocks({ orientation, selectedClaims, criticReport, sourceUnits, namedWorkPool })}`,
    responseSchema,
  };
}
