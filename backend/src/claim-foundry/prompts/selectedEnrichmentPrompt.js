import { CF1_SELECTED_ENRICHMENT_SCHEMA } from "./selectedEnrichmentSchema.js";

export function buildSelectedEnrichmentPrompt({ orientation, selectedClaims, criticReport,
  sourceUnits, namedWorkPool = [] }) {
  const responseSchema = structuredClone(CF1_SELECTED_ENRICHMENT_SCHEMA);
  responseSchema.schema.properties.enrichedClaims.minItems = selectedClaims.length;
  responseSchema.schema.properties.enrichedClaims.maxItems = selectedClaims.length;
  return {
    system: `You are CF1's selected-claim evidence planner. Enrich only the host-selected claims into
strong ER1 tasks. Use only supplied source units. Preserve claim polarity, attribution, uncertainty,
scope, comparison, and causal strength. Be concise. Do not browse, search, score evidence, or invent
identifiers or named works. Return exactly one enriched claim for each candidateId and no others.`,
    user: `Revise wording only where the host critic requires it. claimText must be a brief declarative
proposition. verificationQuestion asks whether that exact proposition is true. claimTrueIf,
claimFalseIf, and claimQualifiedIf describe concrete evidence outcomes for the claim itself.
themeBearing explains how refuting it affects a named pillar or thesis. mustMatch prevents topical drift;
rejectIfOnly names evidence that looks relevant but does not bear. Prefer primary sources in
bestSourceTypes and requiredEvidenceRoles. Query seeds should use discriminating entities, named works,
scope, dates, or identifiers—not repeat a long claim. Keep identifierHints empty unless grounded in the
supplied units. The host owns the validated namedWorkPool. You may associate a claim only by returning
relevantNamedWorkIds chosen verbatim from that pool and an optional short note using IDs, not work names.
Never create, rename, quote, expand, or repeat a work title, author, organization, or the current article
title. Do not put U#### source-unit IDs into identifiers. Every string must be concise; emit JSON immediately
with no trailing commentary or whitespace.

ORIENTATION:
${JSON.stringify(orientation)}

HOST CRITIC AND SELECTION:
${JSON.stringify(criticReport)}

SELECTED CLAIMS:
${JSON.stringify(selectedClaims.map(({ namedWorkHints: _hints, ...claim }) => ({ ...claim,
  availableNamedWorkIds: (_hints ?? []).map((work) => work.namedWorkId) })))}

HOST-VALIDATED NAMED WORK POOL (reference by namedWorkId only):
${JSON.stringify(namedWorkPool.map(({ namedWorkId, mentionText, workType, citationCallout, sourceUnitIds }) =>
    ({ namedWorkId, label: mentionText, workType, citationCallout, sourceUnitIds })))}

REQUIRED CANDIDATE IDS (exactly once each):
${selectedClaims.map((claim) => claim.candidateId).join(", ")}

ALLOWED SOURCE UNITS:
${JSON.stringify(sourceUnits.map(({ unitId, text }) => ({ unitId, text })))}`,
    responseSchema,
  };
}
