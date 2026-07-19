// Call 1B prompt for the Call-1 split arm (pipeline-y-canonical-relation-split-v1).
// 1B receives orientation + compact host packets (both streams) and decides SOURCE,
// POSTURE, and EFFECTS only. It never sees the full article, never rewrites an
// existing claimText, and emits no scoreTransform (the host derives it) and no
// warrant. No worked examples (anchoring / majority-label-bias risk).
import { CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA }
  from "./splitCall1bSourcePostureSchemaV1.js";

const orientationText = (orientation = {}) => {
  const pillars = (orientation.pillars ?? [])
    .map((p) => `- ${p.label} (${p.importance ?? "?"})`).join("\n") || "- (none)";
  return `theme: ${orientation.theme?.text ?? ""}
thesis: ${orientation.thesis?.text ?? ""}
thesisHinge: ${orientation.thesisHinge ?? ""}
pillars:
${pillars}`;
};

export function buildSplitCall1bPrompt(context = {}) {
  const { orientation, articleAuthors = [], packets = [] } = context;
  return {
    system: `You are CF1's stage 1B: source and posture judge. You work ONLY from the compact
packets below — you never see the full article. For each packet you decide who the article
attributes the proposition to, whether its CONTENT supports or contradicts the thesis, and how
the article itself deploys it.

CLAIMTEXT IS IMMUTABLE. For an existing candidateId, claimText is immutable. Never negate it,
rebut it, paraphrase it into the article's position, or append the article's response. Your job
is to classify the proposition as given, not to rewrite it.

ASSERTION SOURCE. Identify the actual entity the article attributes the proposition to — a named
institution, document, study, or quoted person distinct from the article's own authors. Never
default to the article's byline (ARTICLE AUTHORS) unless the article's own voice, with no cited
source underneath it, is genuinely the only supplier of the proposition. Source identity never
determines stance or deployment: a quoted or attributed proposition may be endorsed, reported, or
rejected, and a claim from an authoritative-sounding source may still contradict the thesis.

CONTENT STANCE (contentStance) — judge the CLAIM'S CONTENT against the thesis, and nothing else.
Ignore who asserts it and how authoritative, official, or fringe the source sounds; the source
plays NO part in this field (it belongs to assertionSource and articleDeployment). Two claims with
identical content get the same contentStance no matter who states each one.

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
  properly done — is contradicts_thesis, because if true the article's conclusion is weaker. (For a
  thesis that a product is unsafe, the content "the product is safe and well tested" is
  contradicts_thesis — regardless of who states it.)
- A claim asserting that same matter is NOT fine — unsafe, ineffective, or improperly done — is
  supports_thesis, even when it is alarming or attacks a respected institution; that is the article's
  own case.
- A bare background or context-setting fact — a count, rate, date, or descriptive figure — whose
  truth does not itself strengthen or weaken the article's conclusion is neutral, regardless of which
  institution reported it and regardless of whether it names an entity the article criticizes.

Decide from claimText and the thesis ALONE — no rebuttal or opposing passage is required, and being
attributed to an authority the article criticizes is NEVER by itself a reason to mark contradicts_thesis.

ARTICLE DEPLOYMENT (articleDeployment) — SEPARATELY, judge how the article itself treats this
claim, using its grounding units and whatever response window / possibleResponse is available.
- endorsed: the article advances the claim as its own or affirms it.
- rebutted: the article explicitly answers, disputes, corrects, or refutes it.
- reported_neutral: the article states/quotes it without visibly endorsing or rebutting it.
contentStance and articleDeployment MAY disagree (e.g. contradicts_thesis + reported_neutral is a
common, correct combination when the article presents an opponent claim it never explicitly
rebuts). Do NOT reconcile them — emit each independently. If a packet carries a possibleResponse
(a distant passage that may be the article's answer to the claim), use it ONLY to inform
articleDeployment; it must NEVER change contentStance.

articleRole is the claim's argumentative job. Emit NO score transform and NO thesis-effect fields
— the host derives the transform deterministically from contentStance. sourceUnitIds ground the
proposition itself; responseUnitIds cite the units where the article responds to it (empty if none).

FLAGGED PACKETS (groundingSpan distant OR borderline). For a flagged packet, check not only
whether distant or borderline passages share one proposition, but whether they carry different
assertionSources. If so, treat them as separate claims even if their claimText would otherwise
look similar, and classify each source independently. Record needsSplit.split=true with a
one-sentence reason when the packet fuses separate assertions; otherwise split=false, reason=null.
You never rewrite claimText yourself — only flag it for host handling.

`,
    user: `ARTICLE AUTHORS (identity only; do not infer posture from them): ${articleAuthors.length
      ? articleAuthors.join("; ") : "unknown"}

ORIENTATION:
${orientationText(orientation)}

PACKETS (compact; the full article is intentionally not included):
${JSON.stringify(packets)}`,
    responseSchema: CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA,
  };
}
