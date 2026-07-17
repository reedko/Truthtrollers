// Deliberately separate from frozen Set C v1: this is the audited Call 2 v4
// warrant experiment paired with corrected E2 Call 1.
import { buildCall2Prompt as buildSetCCall2Prompt }
  from "./setCClaimContractV1.js";
import { SET_E_POSTURE_FIRST_ORDER_V2 } from "./setCorrectedBCDEV2.js";
import { selectedEnrichmentWarrantSchemaForClaims }
  from "../../../../src/claim-foundry/prompts/selectedEnrichmentPrompt.js";

const WARRANT_INSTRUCTION = `

EMIT WARRANT

For every selected claim, emit warrant as one concise factual bridge that must hold
for evidence to resolve the disputed proposition in the article's argument. Use null
only when the claim is a direct factual, quotation, record-existence, or simple
measured claim with no additional inferential bridge. Do not invent a warrant merely
to fill the field.`;

export function buildCall2Prompt(context) {
  const base = buildSetCCall2Prompt(context);
  return { ...base,
    user: base.user.replace(`Do not output a new warrant field. Encode the needed link through mustMatch and the
support, refute, qualify, and rejection criteria.

For a direct factual claim, quotation, record-existence claim, or simple measured
result, skip warrant analysis rather than manufacturing one.`, WARRANT_INSTRUCTION.trim()),
    responseSchema: selectedEnrichmentWarrantSchemaForClaims(context.selectedClaims) };
}

export const SET_E2_C_WARRANT_V1 = Object.freeze({
  id: "set-e-posture-first-c-warrant-v1",
  label: "hidden from reviewers",
  status: "experimental",
  call1: SET_E_POSTURE_FIRST_ORDER_V2.call1,
  call2: { version: "claim-contract-warrant-call2-v1", schemaName: "cf1_selected_enrichment_v4",
    schemaHash: "41142129b829cac0b3e8de805aa11d320739da5257baa22231e70019edc3afb0", build: buildCall2Prompt },
});
