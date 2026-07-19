import { SET_C_CLAIM_CONTRACT_V1 } from "./setCClaimContractV1.js";
import { SET_E_POSTURE_FIRST_ORDER_V1 } from "./setEPostureFirstOrderV1.js";
import { canonicalPropositionInventorySchemaForArticle }
  from "./canonicalPropositionInventorySchemaV1.js";
import { canonicalPropositionInventorySchemaV2ForArticle }
  from "./canonicalPropositionInventorySchemaV1.js";
import { canonicalPropositionInventorySchemaV3ForArticle }
  from "./canonicalPropositionInventorySchemaV1.js";
import { sourcePropositionResponseSchemaForArticle }
  from "./sourcePropositionResponseSchemaV1.js";
import { sourcePropositionResponseSchemaV2ForArticle }
  from "./sourcePropositionResponseSchemaV1.js";

const CANONICAL_CONTRACT = `

CANONICAL PROPOSITION — THIS CONTRACT CONTROLS

For every candidate, propositionCore is the one canonical substantive proposition P
that external evidence could support or refute. It is the exact proposition that the
host will preserve as the live claimText. Do not emit a second wording of P. For a
substantive candidate, remove reporting frames such as "S says" or "according to S"
unless whether S made the statement is itself the genuine proposition. Never replace
P with the article's denial, rebuttal, implied answer, presumed conclusion, or logical
complement. Preserve polarity, negation, comparison direction, quantity, scope,
uncertainty, and causal strength exactly.

Using the stabilized thesis and unchanged P, decide separately what would happen to
the thesis if independent evidence supported P and if independent evidence refuted P.
Then assign articleUse from the article's treatment of P and articleRole from P's
argumentative job. Derive scoreTransformCheck from those effects.

assertionSource identifies the source to whom the article attributes P. Quoting,
paraphrasing, discussing, evaluating, challenging, or rejecting P does not transfer
its source to the article's author. Source identity provides no evidence of posture.
An externally sourced proposition may be endorsed, reported neutrally, qualified,
challenged, or rejected. Decide articleUse only from what the article does with the
unchanged P; decide articleRole from P's argumentative job, not its speaker.

Before returning, verify that propositionCore alone preserves one atomic P;
assertionSource is its attributed supplier; source identity did not determine posture;
and sourceUnitIds ground P itself rather than only the article's response to P.`;

function removeDuplicateClaimInstruction(system) {
  const next = system
    .replace(/\n7\. claimText\n   Now write the final concise, self-contained claim\. It must express the same P as\n   propositionCore\. Use assertionSource and the posture fields to preserve provenance\n   without turning a substantive proposition into the different proposition "S said\n   P\." Do not append the article's rebuttal, a critic's response, or a second\n   independently testable proposition\.\n/, "\n")
    .replace(/ → final claim wording/, "")
    .replace(/\n- claimText expresses propositionCore without an attribution wrapper or appended\n  rebuttal unless attribution itself is the proposition;/, "");
  if (next === system) throw new Error("Canonical proposition arm could not remove duplicate claim instruction");
  return next;
}

function removeAnswerLikeSourcePriming(system) {
  const next = system
    .replace(/6\. assertionSource\n   Identify who actually supplies P: the article voice, a person, institution,\n   document, study, or quoted source\. Do not substitute the person rebutting P, an\n   entity merely mentioned nearby, or a generic topic label\./,
      `6. assertionSource\n   Identify the source to whom the article attributes P. Do not substitute the\n   person rebutting P, an entity merely mentioned nearby, or a generic topic label.`)
    .replace(/Never use reported as a default for quoted or attributed matter\. Never infer\n   endorsement from centrality\./,
      `Quoted or attributed status alone does not determine posture. Use reported for\n   genuinely neutral treatment, regardless of source identity. Never infer endorsement\n   or opposition from centrality or source identity.`);
  if (next === system) throw new Error("Canonical proposition arm could not remove source priming");
  return next;
}

function buildCall1Prompt(context) {
  const prompt = SET_E_POSTURE_FIRST_ORDER_V1.call1.build(context);
  return { ...prompt,
    system: `${removeAnswerLikeSourcePriming(removeDuplicateClaimInstruction(prompt.system))}${CANONICAL_CONTRACT}`,
    responseSchema: canonicalPropositionInventorySchemaForArticle(context.article),
  };
}

function buildCall1PromptV2(context) {
  const prompt = buildCall1Prompt(context);
  return {
    ...prompt,
    system: `${prompt.system}\n\nRECALL PROBE CEILING: Return no more than 20 candidates.`,
    user: prompt.user
      .replace("return 10 to 12 genuine candidateClaims when supported", "return up to 20 genuine candidateClaims when supported")
      .replace("If more than 12 valid candidates exist, prioritize:", "If more than 20 valid candidates exist, prioritize:"),
    responseSchema: canonicalPropositionInventorySchemaV2ForArticle(context.article),
  };
}

function buildCall1PromptV3(context) {
  const prompt = buildCall1Prompt(context);
  return {
    ...prompt,
    system: `${prompt.system}\n\nRECALL PROBE CEILING: Return no more than 30 candidates.`,
    user: prompt.user
      .replace("return 10 to 12 genuine candidateClaims when supported", "return up to 30 genuine candidateClaims when supported")
      .replace("If more than 12 valid candidates exist, prioritize:", "If more than 30 valid candidates exist, prioritize:"),
    responseSchema: canonicalPropositionInventorySchemaV3ForArticle(context.article),
  };
}

function adaptCanonicalOutput(output) {
  const value = structuredClone(output);
  for (const [index, candidate] of (value.candidateClaims ?? []).entries()) {
    const proposition = String(candidate.propositionCore ?? "").trim();
    if (!proposition) {
      throw Object.assign(new Error(`Candidate ${index + 1} omitted propositionCore`),
        { code: "CF1_AGENT_SEMANTIC_INVALID" });
    }
    if (/^(?:the[ _])?article[ _]voice$/i.test(String(candidate.assertionSource ?? "").trim())) {
      throw Object.assign(new Error(`Candidate ${index + 1} copied a prohibited source placeholder`),
        { code: "CF1_AGENT_SEMANTIC_INVALID" });
    }
    candidate.claimText = proposition;
  }
  return value;
}

const SOURCE_RESPONSE_CONTRACT = `

SOURCE-PROPOSITION / ARTICLE-RESPONSE TRACE — THIS CONTRACT CONTROLS

For every candidate, first extract sourceProposition: the exact single P supplied
by the assertionSource and grounded by sourceUnitIds. It becomes the live claimText.
Do not rewrite P as the article's conclusion, criticism, or logical complement.

Then separately identify the article's response to that unchanged P:
- none: the article itself advances P without a distinct response;
- supports, challenges, rejects, qualifies, or defers: select the applicable relation
  and cite the exact articleResponseUnitIds that establish it.
The response must be grounded in the supplied article. Do not infer or invent a
response from general topic knowledge. A broad response may be used only where it
actually applies to P.

Only after P, its named supplier, and its separately grounded article response are
fixed, assign articleUse, articleRole, effects, and scoreTransformCheck.

ASSERTION-SOURCE IDENTITY: ARTICLE AUTHORS supplied in ARTICLE IDENTITY are direct
input identity data, not a fallback. When the article itself supplies P, emit the
exact matching author name. Never emit generic labels such as "article author",
"article voice", "analysis", "article analysis", or "<agency> statements". When another
person, institution, document, or study supplies P, emit its exact usable name.`;

function buildCall1PromptV4(context) {
  const prompt = SET_E_POSTURE_FIRST_ORDER_V1.call1.build(context);
  const authors = Array.isArray(context.article?.authors)
    ? context.article.authors.filter((author) => typeof author === "string" && author.trim()) : [];
  return {
    ...prompt,
    system: `${removeAnswerLikeSourcePriming(removeDuplicateClaimInstruction(prompt.system))}${SOURCE_RESPONSE_CONTRACT}`,
    user: `${prompt.user}\n\nARTICLE IDENTITY (identity only; do not infer posture from it):\nAuthors: ${authors.length ? authors.join("; ") : "unknown"}`
      .replace("return 10 to 12 genuine candidateClaims when supported", "return up to 15 genuine candidateClaims when supported")
      .replace("If more than 12 valid candidates exist, prioritize:", "If more than 15 valid candidates exist, prioritize:"),
    responseSchema: sourcePropositionResponseSchemaForArticle(context.article),
  };
}

function buildSetXCall1Prompt(context) {
  const prompt = buildCall1PromptV4(context);
  return {
    ...prompt,
    system: `${prompt.system}\n\nSET X CANDIDATE CEILING: Return no more than 12 candidates.`,
    user: prompt.user
      .replace("return up to 15 genuine candidateClaims when supported", "return up to 12 genuine candidateClaims when supported")
      .replace("If more than 15 valid candidates exist, prioritize:", "If more than 12 valid candidates exist, prioritize:"),
    responseSchema: sourcePropositionResponseSchemaV2ForArticle(context.article),
  };
}

function adaptSourceResponseOutput(output) {
  const value = structuredClone(output);
  for (const [index, candidate] of (value.candidateClaims ?? []).entries()) {
    const proposition = String(candidate.sourceProposition ?? "").trim();
    const source = String(candidate.assertionSource ?? "").trim();
    if (!proposition) throw Object.assign(new Error(`Candidate ${index + 1} omitted sourceProposition`),
      { code: "CF1_AGENT_SEMANTIC_INVALID" });
    if (/^(?:the )?article(?: |_)?(?:author|voice|analysis)$/i.test(source)
      || /^(?:article )?analysis of /i.test(source) || /^[A-Za-z]+ statements$/i.test(source)) {
      throw Object.assign(new Error(`Candidate ${index + 1} used a generic assertion source label`),
        { code: "CF1_AGENT_SEMANTIC_INVALID" });
    }
    candidate.claimText = proposition;
    delete candidate.sourceProposition;
    delete candidate.articleResponse;
    delete candidate.articleResponseUnitIds;
  }
  return value;
}

export const SET_E_CANONICAL_PROPOSITION_V1 = Object.freeze({
  id: "set-e-canonical-proposition-v1", label: "hidden from reviewers", status: "experimental",
  call1: { version: "posture-first-canonical-proposition-call1-v1",
    schemaName: "cf1_semantic_inventory_canonical_proposition_v1",
    schemaHash: "e6dd6ea47288e3fe44dc666d91a9fbd04b17cba1c5e93b33ed58f6c92360ccd4",
    build: buildCall1Prompt, adaptOutput: adaptCanonicalOutput },
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});

// Separate, one-run recall probe. It changes only the candidate ceiling; V1 is not edited.
export const SET_E_CANONICAL_PROPOSITION_V2 = Object.freeze({
  id: "set-e-canonical-proposition-v2", label: "hidden from reviewers", status: "experimental",
  call1: { version: "posture-first-canonical-proposition-call1-v2-20-candidate-probe",
    schemaName: "cf1_semantic_inventory_canonical_proposition_v2",
    schemaHash: "98f65771116c025fc420d76021c4bb52e710b46d884a9bb532fdc42fdb2b2f3d", build: buildCall1PromptV2, adaptOutput: adaptCanonicalOutput },
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});

export const SET_E_CANONICAL_PROPOSITION_V3 = Object.freeze({
  id: "set-e-canonical-proposition-v3", label: "hidden from reviewers", status: "experimental",
  call1: { version: "posture-first-canonical-proposition-call1-v3-30-candidate-probe",
    schemaName: "cf1_semantic_inventory_canonical_proposition_v3",
    schemaHash: "65c76fa4fd6beb463b7b12b8f09c6d324ba33f5934270f36f264937b17262dd7", build: buildCall1PromptV3, adaptOutput: adaptCanonicalOutput },
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});

export const SET_E_SOURCE_PROPOSITION_RESPONSE_V1 = Object.freeze({
  id: "set-e-source-proposition-response-v1", label: "hidden from reviewers", status: "experimental",
  call1: { version: "posture-first-source-proposition-response-call1-v1-15-candidate",
    schemaName: "cf1_semantic_inventory_source_proposition_response_v1",
    schemaHash: "f519d8b54a9c3e3fba49b4e05b8271a73cc325827202bda8f279be7b8c6830ba", build: buildCall1PromptV4, adaptOutput: adaptSourceResponseOutput },
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});

export const SET_X_SOURCE_PROPOSITION_RESPONSE_V1 = Object.freeze({
  id: "set-x-source-proposition-response-v1", label: "hidden from reviewers", status: "experimental",
  call1: { version: "set-x-source-proposition-response-call1-v1-12-candidate",
    schemaName: "cf1_semantic_inventory_source_proposition_response_v2",
    schemaHash: "ff71570b5001371b9d640850da2271521180770f7841a7a90c160535ad51946d", build: buildSetXCall1Prompt, adaptOutput: adaptSourceResponseOutput },
  call2: SET_C_CLAIM_CONTRACT_V1.call2,
});
