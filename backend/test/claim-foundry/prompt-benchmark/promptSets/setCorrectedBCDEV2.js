import { SET_B_FIDELITY_LADDER_V1 } from "./setBFidelityLadderV1.js";
import { SET_C_CLAIM_CONTRACT_V1 } from "./setCClaimContractV1.js";
import { SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V1 }
  from "./setDOrientationFirstPostureTraceV1.js";
import { SET_E_POSTURE_FIRST_ORDER_V1 } from "./setEPostureFirstOrderV1.js";
import { propositionInventorySchemaForArticle }
  from "./propositionInventorySchemaV2.js";

const CORRECTED_CONTRACT = `

CANONICAL PROPOSITION, SOURCE, AND POSTURE — THIS CONTRACT CONTROLS

For every candidate, first preserve the exact proposition P supplied by the cited
source units. propositionCore and claimText must be textually identical after
trimming. For a substantive candidate, P is the underlying proposition that external
evidence could test, not the fact that somebody stated it. Remove reporting frames
such as "S says" or "according to S" unless whether S made the statement is itself
the genuine proposition. Never replace P with the article's denial, rebuttal, implied
answer, presumed conclusion, or logical complement. Preserve polarity, negation,
comparison direction, quantity, scope, uncertainty, and causal strength exactly.

Using the stabilized thesis and the unchanged P, decide separately what would happen
to the thesis if independent evidence supported P and if independent evidence
refuted P. Record those answers in ifSupportedEffect and ifRefutedEffect. Then assign
articleUse from the article's treatment of P and articleRole from P's argumentative
job. Derive scoreTransformCheck from the effects: invert only when support weakens
and refutation strengthens; normal only when support strengthens and refutation
weakens; none only when neither bears on the thesis; otherwise unresolved.

assertionSource identifies the source to whom the article attributes P. Quoting,
paraphrasing, discussing, evaluating, challenging, or rejecting P does not transfer
its source to the article's author. When the supplied article names the author and
advances P without attributing it to a separate source, use that author's usable
name. When no usable author identity is supplied, use a concise neutral description
of the authorial source. Do not copy wording from these instructions as a source
value. Do not use an evidence category, nearby entity, or rebutting speaker.

Source identity provides no evidence of posture. A proposition attributed to a
source other than the author is not thereby an opponent proposition. An externally
sourced proposition may be endorsed, reported neutrally, qualified, challenged, or rejected. A
proposition appearing in the article author's prose may itself quote or present an
opponent. Decide articleUse only from what the article does with the unchanged P:
endorsed when it adopts P; reported only when it remains neutral;
opponent_to_rebut when it makes P a material target not expressly denied in the
supplied text; rejected when it expressly denies P; otherwise use the applicable
non-opponent value. Decide articleRole from P's argumentative job, not its speaker.

Before returning, verify for every candidate:
- propositionCore and claimText preserve one identical P;
- assertionSource is the attributed supplier of that P;
- source identity did not determine articleUse or articleRole; and
- sourceUnitIds ground P itself rather than only the article's response to P.`;

const SOURCE_PARAGRAPH_D_E = `assertionSource identifies the source to whom the article attributes P.
Quoting, paraphrasing, evaluating, challenging, or rejecting P does not make the
article author its source. Source identity does not determine articleUse or
articleRole.`;

function removeAnswerLikeSourcePriming(system) {
  return system
    .replace(/Record in assertionSource who actually\nsupplies each assertion — a named person, institution, document, study, or the\narticle's own voice — not whoever merely appears nearby\./,
      `Record in assertionSource the source to whom the article attributes the proposition.\nDiscussion or evaluation of a proposition does not transfer its source to the author.`)
    .replace(/assertionSource identifies who actually supplies the proposition\. articleUse records\nwhether the article endorses, reports, rebuts, rejects, qualifies, or merely\nbackgrounds it\. Extracting an allegation does not endorse it\./,
      `${SOURCE_PARAGRAPH_D_E}\nExtracting an allegation does not endorse it.`)
    .replace(/6\. assertionSource\n   Identify who actually supplies P: the article voice, a person, institution,\n   document, study, or quoted source\. Do not substitute the person rebutting P, an\n   entity merely mentioned nearby, or a generic topic label\./,
      `6. assertionSource\n   ${SOURCE_PARAGRAPH_D_E.replace(/\n/g, "\n   ")}`)
    .replace(/2\. assertionSource\n   Identify who actually supplies P: the article voice, a person, institution,\n   document, study, or quoted source\. Do not substitute the person rebutting P, an\n   entity merely mentioned nearby, or a generic topic label\./,
      `2. assertionSource\n   ${SOURCE_PARAGRAPH_D_E.replace(/\n/g, "\n   ")}`)
    .replace(/Never use reported as a default for quoted or attributed matter\. Never infer\n   endorsement from centrality\./,
      `Quoted or attributed status alone does not determine posture. Use reported for\n   genuinely neutral treatment, regardless of source identity. Never infer endorsement\n   or opposition from centrality or source identity.`);
}

function retainedOutput(output) {
  const value = structuredClone(output);
  for (const [index, candidate] of (value.candidateClaims ?? []).entries()) {
    const proposition = String(candidate.propositionCore ?? "").trim();
    const claim = String(candidate.claimText ?? "").trim();
    if (!proposition || proposition !== claim) {
      throw Object.assign(new Error(`Candidate ${index + 1} changed propositionCore in claimText`),
        { code: "CF1_AGENT_SEMANTIC_INVALID" });
    }
    if (/^(?:the[ _])?article[ _]voice$/i.test(String(candidate.assertionSource ?? "").trim())) {
      throw Object.assign(new Error(`Candidate ${index + 1} copied a prohibited source placeholder`),
        { code: "CF1_AGENT_SEMANTIC_INVALID" });
    }
  }
  return value;
}

function correctedBuild(baseBuild, { propositionSchema = false } = {}) {
  return (context) => {
    const prompt = baseBuild(context);
    const system = `${removeAnswerLikeSourcePriming(prompt.system)}${CORRECTED_CONTRACT}`;
    if (/the article voice/i.test(system)) {
      throw new Error("Corrected prompt retained the prohibited answer-like source label");
    }
    return { ...prompt, system,
      responseSchema: propositionSchema
        ? propositionInventorySchemaForArticle(context.article) : prompt.responseSchema };
  };
}

const correctedProfile = ({ base, id, version, propositionSchema = false }) => Object.freeze({
  id, label: "hidden from reviewers", status: "experimental", call1Only: true,
  call1: { version,
    schemaName: propositionSchema ? "cf1_semantic_inventory_proposition_v2" : base.call1.schemaName,
    schemaHash: propositionSchema
      ? "4b54f93ce9f1a986f588888b06df6ad92c67f9ea315c689dbd2dab71ac95e2c0"
      : base.call1.schemaHash,
    build: correctedBuild(base.call1.build, { propositionSchema }), adaptOutput: retainedOutput },
  call2: base.call2,
});

export const SET_B_FIDELITY_LADDER_V2 = correctedProfile({
  base: SET_B_FIDELITY_LADDER_V1,
  id: "set-b-fidelity-ladder-v2",
  version: "fidelity-ladder-corrected-call1-v2",
  propositionSchema: true,
});

export const SET_C_CLAIM_CONTRACT_V2 = correctedProfile({
  base: SET_C_CLAIM_CONTRACT_V1,
  id: "set-c-claim-contract-v2",
  version: "claim-contract-corrected-call1-v2",
  propositionSchema: true,
});

export const SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V2 = correctedProfile({
  base: SET_D_ORIENTATION_FIRST_POSTURE_TRACE_V1,
  id: "set-d-orientation-posture-trace-v2",
  version: "orientation-posture-trace-corrected-call1-v2",
});

export const SET_E_POSTURE_FIRST_ORDER_V2 = correctedProfile({
  base: SET_E_POSTURE_FIRST_ORDER_V1,
  id: "set-e-posture-first-order-v2",
  version: "posture-first-order-corrected-call1-v2",
});

// Full-pipeline benchmark pair: corrected E2 Call 1 with the unchanged Set C
// Call 2 component. The original E2 profile remains Call-1-only.
export const SET_E2_C_FULL_V1 = Object.freeze({
  id: "set-e-posture-first-c-full-v1",
  label: "hidden from reviewers",
  status: "experimental",
  call1: SET_E_POSTURE_FIRST_ORDER_V2.call1,
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});
