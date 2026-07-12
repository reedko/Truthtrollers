// backend/src/core/tm4SelectorFeatures.js
//
// TM4 Phase 2b — per-claim selector features.
//
// Everything in this module is a function of ONE claim plus the fixed
// phase2Context. Nothing here may look at other candidates, at input order,
// or at the portfolio being assembled — that is the whole point: claim merit
// is order-independent; redundancy/coverage are portfolio concerns handled
// later in tm4Phase2bSelector.js.
//
// The classifications are generic (predicate families, reasoning moves), not
// article-domain taxonomies. The vaccine-specific families in
// scripts/testing/lib/tm4AnchorTaxonomy.mjs remain test-only gold tooling.

// ---- generic lexical patterns ----------------------------------------------

// Verb classes for institutional-action / data-integrity allegations. The
// verb class is part of the claim-bearing family key, so "destroyed the
// evidence" and "manipulated the data" about the same entity stay DISTINCT
// families ("same topic does not mean same claim").
const VERB_CLASSES = {
  destruction: /\b(destroy\w*|shredd?\w*|delet\w*|purg\w*|dispos\w*|burn\w*|discard\w*)\b/i,
  alteration: /\b(manipulat\w*|alter\w*|falsif\w*|fabricat\w*|doctor\w*|re-?work\w*|massag\w*|cherry.?pick\w*|misrepresent\w*|skew\w*)\b/i,
  concealment: /\b(conceal\w*|suppress\w*|withh?[eo]ld\w*|cover\w*[- ]?up|hid|hidden|hide|omitt?\w*|bur(y|ied))\b/i,
  coercion: /\b(order(ed|s)?|instruct\w*|direct(ed|s)?|forc\w*|pressur\w*|threaten\w*|silenc\w*|retaliat\w*|fired|demot\w*|gagg?\w*)\b/i,
  fraud: /\b(fraud\w*|corrupt\w*|captur\w*|collu\w*|brib\w*|whistleblow\w*|defraud\w*)\b/i,
};

const RX = {
  dataObject: /\b(evidence|data|documents?|records?|results?|stud(y|ies)|findings?|files?|transcripts?|e-?mails?|datasets?|analys[ei]s)\b/i,
  institutionalActor: /\b([A-Z]{2,})\b|\b(officials?|agenc(y|ies)|department|government|regulators?|congress|senate|court|committee|administration|authorit(y|ies)|industry|compan(y|ies)|manufacturers?)\b/,
  studyNoun: /\b(stud(y|ies)|analys[ei]s|trial|report|paper|research|review|survey|meta.?analysis|dataset|transcript|meeting)\b/i,
  resultVerb: /\b(show(ed|s|n)?|found|link(ed|s)?|demonstrat\w*|reveal\w*|conclud\w*|associat\w*|observ\w*|report(ed|s)?|publish\w*|estimat\w*|document\w*)\b/i,
  statTerm: /\b(risk|rate|ratio|odds|percent\w*|%|times\s+(higher|lower|more|less|greater)|incidence|prevalence|deaths?|cases|likelihood|fold|(safety\s+)?limits?|thresholds?|exceed\w*|dos(e|es|ing|age)|per\s+kilogram|mcg|µg|mg)\b/i,
  legalTerm: /\b(act\b|law|statute|congress|legislation|court|ruling|liabilit\w*|immunit\w*|mandat\w*|regulation|policy|amendment|lawsuit|sued?|compensat\w*|passed|repeal\w*|ban(ned)?)\b/i,
  mechVerb: /\b(cross(es|ed|ing)?|penetrat\w*|accumulat\w*|bind(s|ing)?|absorb\w*|persist\w*|inflam\w*|damag\w*|disrupt\w*|toxic\w*|neurotoxic\w*)\b/i,
  bioObject: /\b(brain|blood|barrier|cells?|tissue|immune|neuro\w*|nervous|organs?|gut|liver|kidney|body|dna)\b/i,
  causalVerb: /\b(caus\w*|lead(s|ing)?\s+to|led\s+to|result(s|ed)?\s+in|trigger\w*|induc\w*|contribut\w*\s+to|responsible\s+for)\b/i,
  harmObject: /\b(harm\w*|injur\w*|death|dis(ease|order)|illness|damage|adverse|side.?effects?|condition|syndrome|impairment)\b/i,
  socialProof: /\b\d[\d,]*\s*(\+\s*)?(names?|people|signatures?|members?|families|parents|supporters?|followers?|views?|attendees?|subscribers?)\b|\b(thousands|millions|hundreds)\s+of\s+(people|names|families|parents|supporters|signatures)\b|\b(signed|joined|marched|rall(y|ied|ies)|gathered)\b[^.]{0,60}\b\d/i,
  chronologyVerb: /\b(launch(ed)?|found(ed)?|start(ed)?|began|creat(ed)?|premier(ed)?|releas(ed)?|form(ed)?|establish(ed)?|debut(ed)?)\b/i,
  yearish: /\b(19|20)\d{2}\b|\baround that (period|time)\b|\bthat year\b/i,
  // Named vehicle of a movement/campaign/media outlet — distinguishes
  // movement_history from generic background chronology.
  movementNoun: /\b(movement|campaign|organization|foundation|network|show|program|documentary|film|channel|platform|non-?profit|coalition|group|march|rally|podcast|series)\b/i,
  bioPattern: /\b(is|was)\s+(a|an|the)\s+\w+|\bserves?\s+as\b|\bworked\s+as\b|\bformer\b|\b(producer|director|author|founder|host|professor|physician|attorney)\b/i,
  emotive: /\b(breathtaking|shocking|outrag\w*|devastat\w*|heartbreak\w*|terrif\w*|betray\w*|unconscionab\w*|horrif\w*)\b/i,
  quantifier: /\d+%?|\b(more|less|higher|lower|increase|decrease|significant)\b/i,
  // Regulatory / safety-limit predicate: a claim measured against an allowable
  // exposure limit or dosing threshold (its own lane, not generic statistics).
  safetyLimit: /\b(safety limits?|allowable (limit|amount|level)|regulatory limit|exposure limit|maximum (safe|allowable)|exceed(s|ed|ing)? (the )?(safety )?limit|(higher|greater|more) than the limit|per kilogram|per kg|mcg\s*\/\s*kg|µg\s*\/\s*kg|drinking water)\b/i,
  // Concealment-only verbs (a study/document was hidden or withheld) — the
  // study_suppression lane, distinct from destruction/alteration tampering.
  concealmentVerb: /\b(suppress\w*|conceal\w*|withh?[eo]ld\w*|hid|hidden|hide|bur(y|ied)|cover\w*[- ]?up|omitt?\w*)\b/i,
  // Public-health reassurance framing the article rebuts (opponent claims).
  reassurance: /\b(not harmful|is safe|are safe|perfectly safe|no (credible |peer[- ]reviewed )?stud|never been (a )?stud|tested more|more (rigorous|testing)|can handle|handle a lot|no (link|evidence|proof)|do(es)? not (cause|harm)|is not (linked|associated))\b/i,
  // Ingredient/exposure comparison ("more X from a tomato than from vaccines";
  // "dose based on antibody titers not safety science").
  ingredientExposure: /\b(exposed to (more|less)|more .{0,30} than|exposure (from|to)|dos(e|es|ing|age) (of|is|based)|cumulative (load|dose|exposure)|amount of .{0,20} (in|from))\b/i,
  // Censorship / gatekeeping of information (distinct from data destruction).
  censorship: /\b(censor\w*|deplatform\w*|de-?platform\w*|banned?|ban(ning)?|silenc\w*|removed? (from|by)|taken down|scrubb\w*|shadow[- ]?ban\w*|gatekeep\w*|blacklist\w*|de-?monetiz\w*|flagg\w*|labeled? (as )?(misinformation|false))\b/i,
  // Safety-testing gap ("never safety tested", "not safety science").
  safetyTesting: /\b(never (been )?safety[- ]?tested|not safety[- ]?tested|no safety (test\w*|stud\w*|science|data)|not (based on )?safety science|lack\w* safety (test\w*|data)|untested|without (safety )?testing)\b/i,
};

// ---- evidence-document affordance -------------------------------------------
// Does the claim point to a concrete evidence object an evidence run is likely
// to surface? Generic — never requires the document to be named, only that the
// claim clearly implicates an identifiable document CLASS. All patterns are
// domain-agnostic (a "released/reworked study", a "law", a "database", …).
const EVIDENCE_RX = {
  namedStudyObject: /\b(University of [A-Z][a-z]+|[A-Z][a-z]+ (Study|Report|Trial|Analysis|Transcript|Documentary|Review)|\d{4}\s+(study|report|trial|analysis|paper)|(study|report|trial|analysis|paper)\s+(of|from|in|published)?\s*\d{4})\b/,
  releasedStudy: /\b(re-?work\w*|reissu\w*|retract\w*|republish\w*|releas\w*|withdraw\w*)\b.{0,40}\b(stud(y|ies)|version|paper|report|analysis|data)\b|\b(stud(y|ies)|paper|report|analysis)\b.{0,40}\b(re-?work\w*|retract\w*|republish\w*|releas\w*|withdraw\w*)\b/i,
  studyNoun: /\b(stud(y|ies)|analys[ei]s|trial|paper|report|research|review|meta.?analysis|dataset|data set|transcript|meeting minutes)\b/i,
  lawRegulation: /\b(act\b|law|statute|amendment|section \d|regulation|rule\b|ordinance|directive|code \d|legislation|bill\b|mandate)\b/i,
  courtFiling: /\b(court|lawsuit|filing|ruling|deposition|settlement|verdict|complaint|petition|subpoena|testimony|docket|litigation|sued?)\b/i,
  datasetDatabase: /\b(VAERS|database|dataset|registry|surveillance system|records? (system|database)|reporting system|official (data|records))\b/i,
  govReport: /\b((CDC|FDA|WHO|NIH|EPA|GAO|IOM|HHS|congressional|government|agency|federal) (report|document|memo|review|assessment|findings)|inspector general|oversight report)\b/i,
  packageInsert: /\b(package insert|product (label|insert)|prescribing information|label(l)?ing|monograph|insert\b)\b/i,
  dateInstitutionAction: /\b(19|20)\d{2}\b/,
  sourceLikeStat: /\b(reported to|according to|data (show|reflect|indicate)|per the|documented (in|by)|records? show|figures? from|statistics? (from|show))\b/i,
};

// A rhetorical question that carries no embedded declarative proposition:
// visible text ends in "?" and Phase 1 extracted no substantive claim.
export function isRhetoricalQuestion(claim) {
  const text = String(claim.visibleClaimText || "").trim();
  const embedded = String(claim.embeddedSubstantiveClaim || "").trim();
  return /\?$/.test(text) && !embedded;
}

/**
 * Rebuttal-frame detection (article-level, order-independent). True when the
 * thesis reads like a rebuttal of public-health messaging OR the raw pool
 * contains ≥2 opponent/invert claims. Computed once from the fixed context +
 * pool, never from portfolio state.
 */
export function detectRebuttalFrame(phase2Context = {}, pool = []) {
  const thesis = String(phase2Context.thesis || "").toLowerCase();
  const framey = /rebut|debunk|myth|misinformation|public health messaging|reassur|counter|corrects?|pushes? back|responds? to|challenge|set(s|ting)? the record/.test(thesis);
  const opponentCount = pool.filter((c) => c.articleUse === "used_as_opponent_claim").length;
  return framey || opponentCount >= 2;
}

// Generic hard-predicate test (production sibling of the test-only
// declarativeness lib): does the claim assert something falsifiable?
const HARD_PREDICATE_RE = /\b(manipulat\w*|destroy\w*|order\w*|conceal\w*|suppress\w*|fabricat\w*|falsif\w*|caus\w*|increas\w*|decreas\w*|exceed\w*|contain\w*|remov\w*|reveal(s|ed)?|show(s|ed|n)?|find(s)?|found|report(s|ed)?|demonstrat\w*|conclud\w*|occurred|classif\w*|set the stage|paved the way|link(s|ed)?|is \d|are \d|was|were|did not|does not|higher|lower|times)\b/i;

// Softening phrases that mark topic-summary decay (generic subset only).
const SOFTENING_RE = /\b(raises? concerns? about|questions? whether|debate over|controversy (around|over)|issues? related to|discussion (of|about|around)|the (topic|subject) of|claims? about)\b/i;

// Reasoning moves whose support/refutation would meaningfully move the
// article's credibility (outcome-impact tiers for verificationWorthiness).
// Opponent moves are deliberately NOT high-impact: they carry the article's
// argument structure and are guaranteed a portfolio slot by the opponent
// requirement, but must not out-score the article's own load-bearing claims.
export const HIGH_IMPACT_MOVES = new Set([
  "data_integrity_allegation",
  "study_suppression",
  "institutional_misconduct",
  "study_result",
  "statistical_risk",
  "regulatory_safety_limit",
  "regulatory_safety_testing",
  "legal_policy",
  "causal_safety",
  "mechanistic_toxicology",
  "ingredient_exposure_comparison",
]);

const MOVE_PRIORITY = [
  "data_integrity_allegation",
  "study_suppression",
  "institutional_misconduct",
  "study_result",
  "regulatory_safety_limit",
  "regulatory_safety_testing",
  "statistical_risk",
  "legal_policy",
  "causal_safety",
  "mechanistic_toxicology",
  "ingredient_exposure_comparison",
  "censorship_or_gatekeeping",
  "factual_assertion",
  "opponent_public_health_assurance",
  "opponent_slogan",
  "social_proof",
  "movement_history",
  "background_chronology",
  "source_bio",
  "emotional_framing",
  "rhetorical_question",
  "rhetorical_transition",
];

const WORTHINESS_BASE = {
  data_integrity_allegation: 0.95,
  study_suppression: 0.92,
  institutional_misconduct: 0.90,
  study_result: 0.90,
  statistical_risk: 0.90,
  regulatory_safety_limit: 0.85,
  regulatory_safety_testing: 0.86,
  legal_policy: 0.85,
  causal_safety: 0.85,
  mechanistic_toxicology: 0.80,
  ingredient_exposure_comparison: 0.72,
  censorship_or_gatekeeping: 0.68,
  factual_assertion: 0.55,
  opponent_public_health_assurance: 0.66,
  opponent_slogan: 0.60,
  social_proof: 0.30,
  movement_history: 0.28,
  background_chronology: 0.25,
  source_bio: 0.25,
  emotional_framing: 0.20,
  rhetorical_question: 0.15,
  rhetorical_transition: 0.20,
};

// Broad evidence lanes: generic argument lanes a representative portfolio
// should spread across. Names are domain-agnostic (no article topic). Several
// fine-grained moves fold into one broad lane (e.g. study_result and
// study_suppression both surface study documents → one lane).
const PREDICATE_GROUP = {
  data_integrity_allegation: "institutional_data_integrity",
  institutional_misconduct: "institutional_data_integrity",
  study_suppression: "study_result_or_study_suppression",
  study_result: "study_result_or_study_suppression",
  legal_policy: "legal_policy_or_liability",
  statistical_risk: "statistical_adverse_event_or_population_outcome",
  regulatory_safety_limit: "regulatory_safety_testing",
  regulatory_safety_testing: "regulatory_safety_testing",
  mechanistic_toxicology: "mechanistic_toxicology",
  causal_safety: "mechanistic_toxicology",
  ingredient_exposure_comparison: "ingredient_exposure_comparison",
  censorship_or_gatekeeping: "censorship_or_gatekeeping",
  opponent_public_health_assurance: "opponent_public_health_assurance",
  opponent_slogan: "opponent_public_health_assurance",
  social_proof: "social_proof_or_testimonial_volume",
  movement_history: "background_chronology",
  background_chronology: "background_chronology",
  source_bio: "background_chronology",
  factual_assertion: "factual_assertion",
  emotional_framing: "rhetoric",
  rhetorical_question: "rhetoric",
  rhetorical_transition: "rhetoric",
};

export const predicateGroupFor = (move) => PREDICATE_GROUP[move] || "other";

// Order-independent intrinsic-merit weights. Redundancy/novelty/diversity are
// intentionally ABSENT — those are portfolio constraints, not claim merit.
// evidenceAffordance is a claim-intrinsic property (how searchable its
// evidence is), so it belongs in merit; lane diversity is applied later.
export const INTRINSIC_WEIGHTS = {
  articleCentrality: 0.30,
  verificationWorthiness: 0.26,
  evidenceAffordance: 0.14,
  specificity: 0.15,
  namedAnchorStrength: 0.07,
  sourceExcerptQuality: 0.05,
  articlePositionProminence: 0.03, // explicit, deliberately weak position feature
};

// ---- text helpers ------------------------------------------------------------

export const normText = (t) =>
  String(t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

export const jaccard = (a, b) => {
  const wa = new Set(normText(a).split(" ").filter(Boolean));
  const wb = new Set(normText(b).split(" ").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
};

const STOPWORDS = new Set(("the a an of to in on for and or but with that this those these is are was were be been being it its as by from at not no about into their they he she we you our his her have has had do does did will would can could should than then so such which who whom what when where why how there here also more most other some any all each into over under between after before during against").split(" "));

const contentWords = (t) => new Set(normText(t).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w)));

/** Directed content-word overlap: share of the CLAIM's content words found in the frame text. */
function thesisOverlap(claimText, frameText) {
  const cw = contentWords(claimText);
  if (!cw.size) return 0;
  const fw = contentWords(frameText);
  let hit = 0;
  for (const w of cw) if (fw.has(w)) hit++;
  return hit / cw.size;
}

// ---- deterministic entity derivation ----------------------------------------

/**
 * Union of the Phase-1 named* arrays with entities derived directly from the
 * claim text, so a Phase-1 extraction miss (e.g. an actor named in the text
 * but absent from namedActors) cannot silently depress specificity.
 */
export function deriveEntities(claim) {
  const text = `${claim.visibleClaimText || ""} ${claim.embeddedSubstantiveClaim || ""}`;
  const fromPhase1 = [
    ...(claim.namedActors || []),
    ...(claim.namedOrganizations || []),
    ...(claim.namedLawsOrPolicies || []),
    ...(claim.namedSubstancesOrProducts || []),
    ...(claim.namedStudiesOrDocuments || []),
  ];
  const derived = [
    ...(text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || []), // capitalized phrases
    ...(text.match(/\b[A-Z]{2,}\b/g) || []), // acronyms
  ];
  const numbers = [
    ...(claim.numbersOrStatistics || []),
    ...(text.match(/\b\d[\d,.]*\s*(%|percent|mcg|µg|mg|kg|times|fold)?\b/g) || []).map((s) => s.trim()).filter((s) => s.length > 1),
  ];
  const dedupe = (arr) => [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
  return { entities: dedupe([...fromPhase1, ...derived]), numbers: dedupe(numbers) };
}

/** Most specific entity to key the claim-bearing family on. */
function primaryEntity(claim, derivedEntities) {
  const pick = (arr) => (arr && arr.length ? String(arr[0]).trim() : "");
  const candidate =
    pick(claim.namedStudiesOrDocuments) ||
    pick(claim.namedLawsOrPolicies) ||
    pick(claim.namedOrganizations) ||
    pick(claim.namedSubstancesOrProducts) ||
    pick(claim.namedActors) ||
    derivedEntities.find((e) => /^[A-Z]{2,}$/.test(e)) ||
    derivedEntities[0] ||
    "general";
  return normText(candidate).replace(/\s+/g, "_") || "general";
}

// ---- reasoning-move classification -------------------------------------------

/**
 * Multi-label reasoning-move / claim-role classification. Deterministic, over
 * visibleClaimText + embeddedSubstantiveClaim + searchText + warrantHint.
 */
export function classifyReasoningMoves(claim) {
  const text = [claim.visibleClaimText, claim.embeddedSubstantiveClaim, claim.searchText, claim.warrantHint]
    .filter(Boolean)
    .join(" ");
  const moves = new Set();
  const verbClasses = [];
  for (const [cls, re] of Object.entries(VERB_CLASSES)) if (re.test(text)) verbClasses.push(cls);

  const rhetoricalQuestion = isRhetoricalQuestion(claim);

  const tamperVerb = verbClasses.some((c) => ["destruction", "alteration"].includes(c));
  const concealVerb = RX.concealmentVerb.test(text);
  const misconductVerb = verbClasses.length > 0 || concealVerb;
  const institutional = RX.institutionalActor.test(text) || (claim.namedOrganizations || []).length > 0;
  const hardPredicate = HARD_PREDICATE_RE.test(text);

  // Opponent = a public-health assurance the article quotes to rebut. The
  // `invert` transform alone is NOT sufficient: the article's own misconduct
  // allegations (e.g. "the CDC released a fraudulent study") also carry an
  // invert transform because refuting the embedded opponent conclusion is what
  // supports the article. So `invert` counts as opponent only when the claim
  // carries no institutional misconduct allegation of its own.
  const allegationContent = misconductVerb && institutional;
  const opponentClaim =
    claim.articleUse === "used_as_opponent_claim" ||
    (claim.scoreTransformHint === "invert" &&
      claim.articleUse !== "endorsed_by_article" &&
      !allegationContent);

  if (rhetoricalQuestion) {
    // A bare question carries no falsifiable proposition; classify it as such
    // so the selector can exclude it unless rewritten declaratively.
    moves.add("rhetorical_question");
  } else if (opponentClaim) {
    // The article's rebuttal targets. Reassurance framing vs bare slogan.
    moves.add(RX.reassurance.test(text) ? "opponent_public_health_assurance" : "opponent_slogan");
  } else {
    if (tamperVerb && RX.dataObject.test(text)) moves.add("data_integrity_allegation");
    else if (concealVerb && (RX.studyNoun.test(text) || RX.dataObject.test(text))) moves.add("study_suppression");
    if (misconductVerb && institutional) moves.add("institutional_misconduct");
    if (RX.studyNoun.test(text) && RX.resultVerb.test(text)) moves.add("study_result");
    if (RX.safetyTesting.test(text)) moves.add("regulatory_safety_testing");
    if (/\d/.test(text) && RX.safetyLimit.test(text)) moves.add("regulatory_safety_limit");
    if (/\d/.test(text) && RX.statTerm.test(text)) moves.add("statistical_risk");
    if (RX.legalTerm.test(text)) moves.add("legal_policy");
    if (RX.mechVerb.test(text) && RX.bioObject.test(text)) moves.add("mechanistic_toxicology");
    if (RX.causalVerb.test(text) && RX.harmObject.test(text)) moves.add("causal_safety");
    if (RX.ingredientExposure.test(text) && !moves.size) moves.add("ingredient_exposure_comparison");
    if (RX.censorship.test(text) && !RX.dataObject.test(text)) moves.add("censorship_or_gatekeeping");
    if (RX.socialProof.test(text)) moves.add("social_proof");

    const hasHighImpact = [...moves].some((m) => HIGH_IMPACT_MOVES.has(m));
    if (!hasHighImpact && RX.chronologyVerb.test(text) && RX.yearish.test(text)) {
      moves.add(RX.movementNoun.test(text) ? "movement_history" : "background_chronology");
    }
    if (!hasHighImpact && !moves.size && RX.bioPattern.test(claim.visibleClaimText || "")) moves.add("source_bio");
    if (RX.emotive.test(text) && !hasHighImpact) moves.add("emotional_framing");
    // Fallback: a concrete falsifiable statement that matched no specific move
    // (e.g. a composition claim) is still a real claim, not rhetorical setup.
    if (!moves.size) moves.add(hardPredicate ? "factual_assertion" : "rhetorical_transition");
  }

  const orderedMoves = MOVE_PRIORITY.filter((m) => moves.has(m));
  const primaryMove = orderedMoves[0] || "rhetorical_transition";

  const softening = SOFTENING_RE.test(claim.visibleClaimText || "");
  const topicSummary =
    (softening && !hardPredicate) ||
    (!hardPredicate && !/\d/.test(claim.visibleClaimText || "") && (claim.visibleClaimText || "").length < 90);

  return {
    reasoningMoves: orderedMoves,
    primaryMove,
    predicateGroup: predicateGroupFor(primaryMove),
    verbClasses,
    hardPredicateFlag: hardPredicate,
    opponentClaimFlag: opponentClaim,
    rhetoricalQuestionFlag: rhetoricalQuestion,
    socialProofFlag: moves.has("social_proof"),
    backgroundFlag:
      moves.has("background_chronology") ||
      moves.has("movement_history") ||
      moves.has("source_bio") ||
      claim.phase2Role === "background",
    topicSummaryFlag: topicSummary,
  };
}

/**
 * Generic claim-bearing family key: entity + move (+ allegation verb class for
 * integrity/misconduct claims so distinct hard predicates about the same
 * entity are DIFFERENT families). This is the production generalization of
 * the test-only anchor families — no domain taxonomy involved.
 */
export function deriveClaimBearingFamily(claim, classification, derived) {
  const entity = primaryEntity(claim, derived.entities);
  const move = classification.primaryMove;
  let family = `${entity}::${move}`;
  if (["data_integrity_allegation", "study_suppression", "institutional_misconduct"].includes(move)) {
    const cls = ["destruction", "alteration", "concealment", "coercion", "fraud"]
      .filter((c) => classification.verbClasses.includes(c));
    if (cls.length) family += `:${cls[0]}`;
  }
  return {
    predicateFamily: move,
    claimBearingFamily: family,
    primaryEntity: entity,
    // Narrow lane: one entity + one predicate family (manipulation and
    // destruction about the same entity are distinct FAMILIES but the SAME
    // narrow lane). Broad lane: the coarse predicate group.
    narrowLane: `${entity}::${move}`,
    broadLane: classification.predicateGroup,
  };
}

// ---- score dimensions ---------------------------------------------------------

/**
 * Thesis-spine article centrality. Tiered, NOT a flat role proxy:
 *   1.00 direct thesis claim · 0.85 major pillar claim · 0.70 important
 *   support · 0.45 context/social proof · 0.20 background/chronology/setup.
 */
export function estimateArticleCentrality(claim, classification, phase2Context) {
  const pillar = (phase2Context.pillars || []).find((p) => p.pillarId === claim.phase2PillarId);
  const frameText = `${phase2Context.thesis || ""} ${pillar?.pillarText || ""}`;
  const overlap = thesisOverlap(
    `${claim.visibleClaimText || ""} ${claim.embeddedSubstantiveClaim || ""}`,
    frameText
  );
  const highImpact = classification.reasoningMoves.some((m) => HIGH_IMPACT_MOVES.has(m));
  const { hardPredicateFlag } = classification;
  const rebuttalFrame = phase2Context.rebuttalFrame === true;

  if (classification.rhetoricalQuestionFlag) return 0.20;
  if (classification.backgroundFlag && !highImpact) return 0.20;
  if (classification.primaryMove === "emotional_framing" || classification.primaryMove === "rhetorical_transition") return 0.20;
  if (classification.primaryMove === "social_proof") return 0.45;
  // Opponent claims carry the article's argument structure. In a rebuttal
  // frame they are moderately central (the article is built to refute them),
  // but never high-impact — inclusion is guaranteed by the portfolio's
  // opponent requirement, not by out-scoring the article's own claims.
  if (classification.opponentClaimFlag) return rebuttalFrame ? 0.60 : 0.45;

  if (claim.phase2Role === "pillar" && hardPredicateFlag && overlap >= 0.30) return 1.0;
  if (highImpact && hardPredicateFlag && (claim.phase2Role === "pillar" || overlap >= 0.20 || claim.warrantHint)) return 0.85;
  if (highImpact && hardPredicateFlag) return 0.85;
  if (hardPredicateFlag) return 0.70;
  return 0.45;
}

/**
 * Outcome-impact verification worthiness: would support/refutation of this
 * claim meaningfully change the article's credibility?
 */
export function estimateVerificationWorthiness(claim, classification) {
  let score = WORTHINESS_BASE[classification.primaryMove] ?? 0.50;
  // Secondary high-impact move raises a mid-tier primary slightly.
  if (classification.reasoningMoves.slice(1).some((m) => HIGH_IMPACT_MOVES.has(m))) score += 0.03;
  if ((claim.namedStudiesOrDocuments || []).length) score += 0.05;
  if (claim.searchText) score += 0.05;
  if (["statistical_claim", "study_claim"].includes(claim.claimForm)) score += 0.03;
  if (!classification.hardPredicateFlag) score -= 0.10;
  return Math.max(0, Math.min(1, score));
}

/** Specificity over DERIVED entities/numbers (robust to Phase-1 array misses). */
export function estimateSpecificity(claim, derived) {
  const text = claim.visibleClaimText || "";
  let score = Math.min(0.5, (derived.entities.length + derived.numbers.length) * 0.12);
  if (text.length > 200) score += 0.25;
  else if (text.length > 100) score += 0.15;
  else if (text.length > 50) score += 0.10;
  if (RX.quantifier.test(text)) score += 0.15;
  return Math.min(1, score);
}

export function estimateNamedAnchorStrength(derived, dominantAnchors) {
  if (!derived.entities.length) return 0.3;
  const matches = derived.entities.filter((e) => dominantAnchors.has(e)).length;
  if (!matches) return Math.min(0.7, derived.entities.length * 0.15);
  return Math.min(1, 0.6 + matches * 0.2);
}

export function estimateSourceExcerptQuality(claim) {
  const len = (claim.canonicalExcerpt || "").length;
  if (len < 20) return 0.2;
  if (len < 50) return 0.4;
  if (len < 100) return 0.6;
  if (len < 200) return 0.8;
  return 1.0;
}

/**
 * Evidence-document affordance (0-1): how likely is this claim to surface a
 * concrete evidence object during an evidence run? Rewards claims that point to
 * an identifiable document CLASS (named or not): a study, a released/reworked
 * study, a law/regulation, a court filing, a dataset/database, a government
 * report, a package insert, a specific date+institution+action, or a
 * source-attributed statistic. Fully generic — no article topic referenced.
 *
 * Returns { evidenceAffordance, primaryDocumentAffordance, studyOrDocumentHint }.
 *  - primaryDocumentAffordance: the claim implicates a specific retrievable
 *    primary document (study/law/report/insert/dataset/filing), even if unnamed.
 */
export function estimateEvidenceAffordance(claim, classification, derived) {
  const text = `${claim.visibleClaimText || ""} ${claim.embeddedSubstantiveClaim || ""} ${claim.searchText || ""}`;
  const signals = [];
  let score = 0;
  const add = (pts, label) => { score += pts; signals.push(label); };

  const named = (claim.namedStudiesOrDocuments || []).length > 0 || EVIDENCE_RX.namedStudyObject.test(text);
  const namedLaw = (claim.namedLawsOrPolicies || []).length > 0;

  if (named) add(0.42, "named_or_dated_study");
  if (EVIDENCE_RX.releasedStudy.test(text)) add(0.34, "released_or_reworked_study");
  if (namedLaw || EVIDENCE_RX.lawRegulation.test(text)) add(0.32, "law_or_regulation");
  if (EVIDENCE_RX.courtFiling.test(text)) add(0.30, "court_or_legal_filing");
  if (EVIDENCE_RX.datasetDatabase.test(text)) add(0.34, "dataset_or_database");
  if (EVIDENCE_RX.govReport.test(text)) add(0.30, "government_report");
  if (EVIDENCE_RX.packageInsert.test(text)) add(0.40, "package_insert_or_label");
  // Specific date + institution + action (a locatable event record).
  if (EVIDENCE_RX.dateInstitutionAction.test(text) && (classification.reasoningMoves.length || derived.entities.length)) {
    const institutional = derived.entities.some((e) => /^[A-Z]{2,}$/.test(e)) || (claim.namedOrganizations || []).length;
    if (institutional) add(0.22, "date_institution_action");
  }
  // A statistic phrased with a source ("17% reported to VAERS", "data show …").
  if (/\d/.test(text) && EVIDENCE_RX.sourceLikeStat.test(text)) add(0.22, "source_attributed_statistic");
  // A bare study noun with no other object still has mild affordance.
  if (!signals.length && EVIDENCE_RX.studyNoun.test(text)) add(0.18, "generic_study_reference");

  const evidenceAffordance = Math.max(0, Math.min(1, score));
  // A specific retrievable PRIMARY document (not just a source-attributed stat).
  const primaryDocumentAffordance = signals.some((s) =>
    ["named_or_dated_study", "released_or_reworked_study", "law_or_regulation", "court_or_legal_filing", "dataset_or_database", "government_report", "package_insert_or_label", "generic_study_reference"].includes(s)
  );

  let studyOrDocumentHint = "";
  if (primaryDocumentAffordance) {
    const docClass =
      EVIDENCE_RX.packageInsert.test(text) ? "package insert / product label"
      : (namedLaw || EVIDENCE_RX.lawRegulation.test(text)) ? "law/regulation"
      : EVIDENCE_RX.courtFiling.test(text) ? "court/legal filing"
      : EVIDENCE_RX.datasetDatabase.test(text) ? "dataset/database"
      : EVIDENCE_RX.govReport.test(text) ? "government report"
      : "study/document";
    const entityHint = [
      ...(claim.namedStudiesOrDocuments || []),
      ...(claim.namedOrganizations || []),
      ...(claim.namedSubstancesOrProducts || []),
      ...derived.entities.filter((e) => /^[A-Z]{2,}$/.test(e) || /\s/.test(e)),
    ]
      .slice(0, 3)
      .join(" ");
    studyOrDocumentHint = `${entityHint ? entityHint + " " : ""}${docClass} referenced by the article`.trim();
  }

  return { evidenceAffordance, primaryDocumentAffordance, studyOrDocumentHint, evidenceAffordanceSignals: signals };
}

/** Explicit, weak document-position feature (claimId "S<sec>-C<n>"). */
export function estimateArticlePositionProminence(claim) {
  const sec = Number((String(claim.claimId || "").match(/^S(\d+)/) || [])[1]);
  if (!Number.isFinite(sec)) return 0.5;
  if (sec === 0) return 1.0; // lede
  if (sec <= 2) return 0.7;
  return 0.4;
}

// ---- assembled feature record --------------------------------------------------

/**
 * computeClaimFeatures(claim, phase2Context)
 *
 * Full order-independent feature record for one candidate. Deterministic;
 * safe to compute in any order, in parallel, or twice.
 */
export function computeClaimFeatures(claim, phase2Context = {}) {
  const classification = classifyReasoningMoves(claim);
  const derived = deriveEntities(claim);
  const family = deriveClaimBearingFamily(claim, classification, derived);

  const dominantAnchors = new Set(
    (phase2Context.clusters || [])
      .slice()
      .sort((a, b) => (b.clusterScore || 0) - (a.clusterScore || 0))
      .slice(0, 8)
      .flatMap((cl) => cl.anchors || [])
  );

  const affordance = estimateEvidenceAffordance(claim, classification, derived);

  const dims = {
    articleCentrality: estimateArticleCentrality(claim, classification, phase2Context),
    verificationWorthiness: estimateVerificationWorthiness(claim, classification),
    evidenceAffordance: affordance.evidenceAffordance,
    specificity: estimateSpecificity(claim, derived),
    namedAnchorStrength: estimateNamedAnchorStrength(derived, dominantAnchors),
    sourceExcerptQuality: estimateSourceExcerptQuality(claim),
    articlePositionProminence: estimateArticlePositionProminence(claim),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const [dim, w] of Object.entries(INTRINSIC_WEIGHTS)) {
    weighted += (dims[dim] ?? 0) * w;
    totalWeight += w;
  }
  const intrinsicScore = weighted / totalWeight;

  return {
    claimId: claim.claimId,
    intrinsicScore,
    dims,
    ...classification,
    ...family,
    evidenceAffordance: affordance.evidenceAffordance,
    primaryDocumentAffordance: affordance.primaryDocumentAffordance,
    studyOrDocumentHint: affordance.studyOrDocumentHint,
    evidenceAffordanceSignals: affordance.evidenceAffordanceSignals,
    rebuttalFrame: phase2Context.rebuttalFrame === true,
    derivedEntities: derived.entities,
    derivedNumbers: derived.numbers,
  };
}
