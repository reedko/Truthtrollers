// Attribution-auditable 1B prompt. The established posture instructions are
// preserved; only the source contract and packet field names are updated.
import { CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA_V2 }
  from "./splitCall1bSourcePostureSchemaV2.js";

const orientationText = (orientation = {}) => {
  const pillars = (orientation.pillars ?? [])
    .map((p) => `- ${p.label} (${p.importance ?? "?"})`).join("\n") || "- (none)";
  return `theme: ${orientation.theme?.text ?? ""}
thesis: ${orientation.thesis?.text ?? ""}
thesisHinge: ${orientation.thesisHinge ?? ""}
pillars:
${pillars}`;
};

export function buildSplitCall1bAttributionPrompt(context = {}) {
  const { orientation, articleAuthors = [], packets = [] } = context;
  return {
    system: `You are CF1's stage 1B: source and posture judge. You work ONLY from the compact
packets below — you never see the full article. For each packet, first resolve its assertion source,
then separately judge content stance and article deployment. Never infer one field from another.

CLAIMTEXT IS IMMUTABLE. Never negate it, rebut it, paraphrase it into the article's position, or
append the article's response. Classify the proposition as given.

ASSERTION SOURCE. Decide who the article attributes the complete proposition to. Inspect claimUnits
and attributionContextUnits. alternateOccurrenceUnits contain a strongly matching occurrence and
its attribution context elsewhere in the supplied article; they may establish the supplier when
they state the same proposition. A localResponseUnit may also establish the supplier only when it
completes the grounding passage or explicitly attributes this same proposition; never substitute an
unrelated responder or rebuttal speaker. sourceCandidates are deterministic textual hints, not answers.
sourceCandidateStatus reports only whether the host detected a candidate pattern.
- explicit_external candidates come from positive attribution syntax.
- local_context_external candidates come from positive attribution syntax in bounded continuation
  or local context and must be tied to this proposition before use.
- alternate_occurrence_external candidates come from explicit attribution attached to a strongly
  matching occurrence of the same proposition elsewhere in the article.
- article_voice candidates are known bylines offered only for ordinary unattributed narrative prose.
- If a listed candidate supplies the proposition, return it, cite assertionSourceUnitIds, and use
  resolved_from_candidate.
- If no listed candidate supplies it but the packet text does, return that source, cite its units,
  and use resolved_from_context.
- If status is no_candidates_detected, that means only that the host found no pattern. Still inspect
  all supplied context. If it resolves the supplier, use resolved_from_context. Otherwise return
  exactly unknown, empty assertionSourceUnitIds, and no_candidate_available.
- If candidates are present but none can be tied to the proposition, return exactly unknown, empty
  assertionSourceUnitIds, and candidates_present_unresolved.
- Use not_evaluated_unresolved only when status is not_evaluated.
Do not choose a source merely because it is named nearby. An article_voice candidate is not a default: select it only when the
claimUnits themselves are the author's unattributed narrative assertion.

CONTENT STANCE (contentStance) — judge the CLAIM'S CONTENT against the thesis, and nothing else.
Ignore who asserts it and how authoritative, official, or fringe the source sounds; the source
plays NO part in this field. Two claims with identical content get the same contentStance no matter
who states each one.

FIRST fix the thesis DIRECTION: what conclusion is the article trying to establish? A thesis may be
contrarian — it may hold that something widely accepted is actually false, or that something widely
treated as safe or effective is actually harmful or ineffective. Hold that conclusion fixed.

THEN apply ONE counterfactual to the claim's content: assume the proposition is TRUE. Does the
article's thesis become MORE credible or LESS credible?
- supports_thesis: if true, the thesis is MORE credible — its content advances the article's conclusion.
- contradicts_thesis: if true, the thesis is LESS credible — its content advances the opposite conclusion.
- neutral: its truth would not move the thesis in either direction.

Apply these on CONTENT alone:
- A claim asserting that the very matter the thesis disputes is FINE — safe, effective, sound, or
  properly done — is contradicts_thesis, because if true the article's conclusion is weaker.
- A claim asserting that same matter is NOT fine — unsafe, ineffective, or improperly done — is
  supports_thesis, even when it is alarming or attacks a respected institution.
- A bare background or context-setting fact — a count, rate, date, or descriptive figure — whose
  truth does not itself strengthen or weaken the article's conclusion is neutral.

Decide from claimText and the thesis ALONE. Being attributed to an authority the article criticizes
is NEVER by itself a reason to mark contradicts_thesis.

ARTICLE DEPLOYMENT (articleDeployment) — SEPARATELY, judge how the article itself treats this
claim, using its grounding units and localResponseUnits or possibleResponse when available.
- endorsed: the article advances the claim as its own or affirms it.
- rebutted: the article explicitly answers, disputes, corrects, or refutes it.
- reported_neutral: the article states or quotes it without visibly endorsing or rebutting it.
contentStance and articleDeployment MAY disagree. Do NOT reconcile them. If a packet carries a
possibleResponse, use it ONLY to inform articleDeployment; it must NEVER change contentStance.

articleRole is the claim's argumentative job. Emit NO score transform and NO thesis-effect fields;
the host derives the transform deterministically from contentStance. sourceUnitIds ground the
proposition itself; responseUnitIds cite supplied units where the article responds to it.

For a distant or borderline groundingSpan, check whether the packet fuses separate propositions or
separately attributed occurrences. Set needsSplit.split=true with a short reason only when it does;
otherwise split=false and reason=null. Never rewrite claimText.`,
    user: `ARTICLE AUTHORS (identity only; do not infer posture from them): ${articleAuthors.length
      ? articleAuthors.join("; ") : "unknown"}

ORIENTATION:
${orientationText(orientation)}

PACKETS (compact; the full article is intentionally not included):
${JSON.stringify(packets)}`,
    responseSchema: CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA_V2,
  };
}
