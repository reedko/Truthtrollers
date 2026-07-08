/**
 * phase3Targetizer.js
 *
 * Phase 3 (audit-only, deterministic): turn Phase 3-ready claim OCCURRENCES
 * into target records that a future bearing/evidence run can consume.
 *
 * No LLM. No evidence retrieval. No persistence. No reducer.
 *
 * Targetization is per claim OCCURRENCE (claimId + its context), NOT per
 * unique claim string — the same sentence in two sections is two occurrences
 * and may yield different targets/stances.
 *
 * A single occurrence can spawn multiple targets, e.g. an attributed slogan
 * produces both an attribution target (who said it) and a substantive target
 * (is the underlying proposition true). A named-study claim adds a
 * study_identity target. A broad causal leap may add an inference target.
 */

const STUDY_TERM_RE =
  /\b(stud(?:y|ies)|report|meeting|dataset|data set|analysis|analyses|trial|paper|documentary|compilation|transcript|review|survey)\b/i;

// ---- study_identity gating (quality-audit fix 1) --------------------------
// study_identity requires a CONCRETE identifiable object. These detect one:
const KNOWN_REGISTER_RE = /\bVAERS\b|\bSimpsonwood\b/i;
const YEAR_PUBLICATION_RE =
  /\b(19|20)\d{2}\b[^.!?]*\b(stud(?:y|ies)|report|trial|paper|analysis|survey|documentary|film|meeting|dataset|transcript|compilation|document)\b|\b(stud(?:y|ies)|report|trial|paper|analysis|survey|documentary|film|meeting|dataset|transcript|compilation|document)\b[^.!?]*\b(19|20)\d{2}\b/i;
const NAMED_INSTITUTION_STUDY_RE =
  /\bUniversity of [A-Z][a-z]+\b|\b[A-Z][a-z]+ (?:Study|Report|Transcript|Documentary|Act)\b/;
// ...and these disqualify:
const LITERATURE_EXISTENCE_RE =
  /\bno (?:credible |peer[- ]reviewed )?stud(?:y|ies)\b|there (?:are|is|have been) no\b|has never been (?:a )?stud/i;
const LOGICAL_MAXIM_RE = /correlation does not imply causation|correlation (?:is|does) not equal/i;

// ---- inference synthesis (quality-audit fix 2) -----------------------------
// Inference targets must state a DISTINCT inferred proposition. We only emit
// when a cause→effect structure can be deterministically parsed and restated.
const LEAP_PATTERNS = [
  { re: /(.+?)\s+set the stage for\s+(.+)/i, verb: "causally enabled" },
  { re: /(.+?)\s+paved the way for\s+(.+)/i, verb: "causally enabled" },
  { re: /(.+?)\s+opened the door (?:to|for)\s+(.+)/i, verb: "causally enabled" },
  { re: /(.+?)\s+created the conditions for\s+(.+)/i, verb: "causally enabled" },
  { re: /(.+?)\s+gave rise to\s+(.+)/i, verb: "gave rise to" },
  { re: /(.+?)\s+led to\s+(.+)/i, verb: "caused or led to" },
  { re: /(.+?)\s+resulted in\s+(.+)/i, verb: "caused or resulted in" },
];
// Editorial framing stripped from synthesized inference text.
const RHETORIC_STRIP_RE = /\b(breathtaking|loudly trumpeting|bombardment of|so-called|shocking(?:ly)?)\s*/gi;
// Diagnostics-only: broad cue detector used to REPORT dropped inference
// candidates (cue present but no distinct proposition). Never used to emit.
const INFERENCE_CUE_RE =
  /\b(set the stage|paved the way|enabled|led to|opened the door|resulted in|gave rise|created the conditions|misled|mislead|deceiv|cover[- ]?up|captured|industry capture|because of this|as a result)\b/i;

const CAUSAL_SAFETY_FORMS = new Set(["causal_claim"]);
const SUBSTANTIVE_FORMS = new Set([
  "direct_assertion",
  "statistical_claim",
  "study_claim",
  "legal_policy_claim",
  "causal_claim",
  "comparison_claim",
]);

function firstNonEmpty(...vals) {
  for (const v of vals) if (v && String(v).trim().length) return v;
  return "";
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(x => x != null && String(x).trim().length)));
}

/** Infer scoreTransform from articleUse when no explicit hint is present. */
function inferScoreTransform(claim) {
  const explicit = claim.scoreTransformHint || claim.targetHints?.likelyScoreTransform;
  if (explicit && ["normal", "invert", "none", "review"].includes(explicit)) return explicit;
  switch (claim.articleUse) {
    case "endorsed_by_article":
      return "normal";
    case "used_as_opponent_claim":
      return "invert";
    case "rejected_by_article":
      return "invert";
    case "reported_neutrally":
    case "used_as_background":
      return "none";
    default:
      return "review";
  }
}

function isBackground(claim) {
  return (
    claim.articleUse === "used_as_background" ||
    claim.evaluationLaneHint === "context" ||
    claim.evaluationLaneHint === "ignore" ||
    claim.claimForm === "background_claim"
  );
}

/**
 * Does the occurrence identify a concrete study/document/dataset/law/report/
 * film/meeting object? Required for study_identity (fix 1).
 */
function hasConcreteStudyObject(claim) {
  const text = `${claim.visibleClaimText || ""} ${claim.embeddedSubstantiveClaim || ""}`;
  return (
    uniq(claim.namedStudiesOrDocuments).length > 0 ||
    uniq(claim.namedLawsOrPolicies).length > 0 ||
    KNOWN_REGISTER_RE.test(text) ||
    YEAR_PUBLICATION_RE.test(text) ||
    NAMED_INSTITUTION_STUDY_RE.test(text)
  );
}

/**
 * Restate a literature-existence claim as an existence proposition for an
 * evidence_landscape target (alias: literature_existence).
 * "There are no credible studies linking X to Y."
 *   → "Credible studies linking X to Y exist or do not exist."
 */
function literatureExistenceText(proposition) {
  const m = (proposition || "").match(
    /no ((?:credible |peer[- ]reviewed )?stud(?:y|ies)[^.!?]*)/i
  );
  if (m) {
    const body = m[1].trim().replace(/[.!?]+$/, "");
    return body.charAt(0).toUpperCase() + body.slice(1) + " exist or do not exist.";
  }
  return `The claimed body of literature exists or does not exist: ${proposition}`;
}

/**
 * Deterministically synthesize a distinct inferred proposition from a
 * cause→effect visible claim. Returns null when no distinct proposition can
 * be built (in which case NO inference target is emitted — fix 2).
 */
function synthesizeInference(visibleClaimText) {
  const text = (visibleClaimText || "").trim();
  for (const p of LEAP_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const cause = m[1].trim().replace(RHETORIC_STRIP_RE, "").replace(/[,;]+$/, "").trim();
    const effect = m[2].trim().replace(RHETORIC_STRIP_RE, "").replace(/[.!?]+$/, "").trim();
    if (cause.length < 6 || effect.length < 10) return null;
    const synthesized = `${cause} ${p.verb} ${effect}.`;
    if (synthesized.trim() === text) return null; // must be distinct
    return synthesized;
  }
  return null;
}

/** Build queryHints shared shape from an occurrence + a chosen query text. */
function buildQueryHints(claim, primaryQueryText) {
  return {
    primaryQueryText: primaryQueryText || claim.visibleClaimText || "",
    requiredEntities: uniq([
      ...(claim.namedActors || []),
      ...(claim.namedOrganizations || []),
    ]),
    optionalEntities: uniq([claim.speakerOrSource]),
    substancesOrProducts: uniq(claim.namedSubstancesOrProducts),
    studiesOrDocuments: uniq(claim.namedStudiesOrDocuments),
    lawsOrPolicies: uniq(claim.namedLawsOrPolicies),
    numbersOrStatistics: uniq(claim.numbersOrStatistics),
    clusterAnchors: uniq(claim.clusterAnchors),
  };
}

// Curated domain vocabulary for deterministic topic extraction (fix 5).
const DOMAIN_TERMS = [
  ["autism", /\bautism\b/i],
  ["MMR", /\bMMR\b/i],
  ["cover-up", /cover[- ]?up/i],
  ["thimerosal", /\bthimerosal\b/i],
  ["ethylmercury", /\bethylmercury\b/i],
  ["aluminum", /\baluminum\b/i],
  ["mercury", /\bmercury\b/i],
  ["placenta", /\bplacenta\b/i],
  ["blood-brain barrier", /blood[- ]brain/i],
  ["SIDS", /\bSIDS\b/i],
  ["infant mortality", /infant mortalit/i],
  ["vaccine injury", /vaccine injur/i],
  ["Vaxxed", /\bVaxxed\b/i],
  ["William Thompson", /thompson/i],
  ["Well Baby Visit", /well baby visit/i],
];
function topicTerms(text) {
  return DOMAIN_TERMS.filter(([, re]) => re.test(text)).map(([t]) => t);
}
const SUBSTANCE_IN_TEXT_RE = /\b(aluminum|thimerosal|mercury|ethylmercury|formaldehyde|polysorbate)\b/gi;

/** bearingCriteria builder — always includes weak + bearingNotes (fix 5). */
function bc(mustMatch, shouldMatch, rejectIfOnly, weak = false, bearingNotes = "") {
  return {
    mustMatch: uniq(mustMatch),
    shouldMatch: uniq(shouldMatch),
    rejectIfOnly: uniq(rejectIfOnly),
    weak: !!weak,
    bearingNotes: bearingNotes || "",
  };
}

/**
 * Bearing criteria derived from target type, named entities, claim form and
 * targetText content — never a generic fallback. When nothing specific can be
 * derived, returns weak=true with keyword shouldMatch (no generic mustMatch).
 */
function buildBearingCriteria(claim, targetType, propositionText) {
  const numbers = uniq(claim.numbersOrStatistics);
  const substances = uniq(claim.namedSubstancesOrProducts);
  const studies = uniq(claim.namedStudiesOrDocuments);
  const laws = uniq(claim.namedLawsOrPolicies);
  const orgs = uniq(claim.namedOrganizations);
  const actors = uniq(claim.namedActors);
  const text = String(
    propositionText || firstNonEmpty(claim.embeddedSubstantiveClaim, claim.visibleClaimText) || ""
  );
  const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const topics = topicTerms(text);
  const subsInText = uniq([...substances, ...(text.match(SUBSTANCE_IN_TEXT_RE) || [])]);

  // ---- study_identity: entity/object-derived (never generic) --------------
  if (targetType === "study_identity") {
    const isFilm = /\b(film|documentary|Vaxxed)\b/i.test(text);
    const objectPhrase = isFilm
      ? `the ${year ? year + " " : ""}documentary/film described`
      : `the ${year ? year + " " : ""}${firstNonEmpty(studies.join("; "), (NAMED_INSTITUTION_STUDY_RE.exec(text) || [])[0], "study/document")} described`;
    const must = [objectPhrase];
    if (year) must.push(`the year ${year}`);
    topics.slice(0, 3).forEach(t => must.push(t));
    if (!topics.length && (orgs.length || actors.length))
      must.push(`${[...orgs, ...actors].join("/")} as the named subject/source`);
    return bc(
      must,
      [...orgs, ...actors, ...studies, isFilm ? "filmmaker/producer/release context" : "authors, institution, journal, dataset, or agency"],
      isFilm
        ? ["an unrelated film/article on the same topic", "generic vaccine/CDC discussion that does not identify the specific film"]
        : ["an unrelated study on the same broad topic", "a source that mentions the topic but not the specific study/document"],
      false,
      isFilm ? "study_identity: film/documentary object" : "study_identity: study/document object"
    );
  }

  if (targetType === "evidence_landscape") {
    return bc(
      [
        "evidence about the existence/quality of a BODY of literature (systematic review, meta-analysis, literature survey, or expert consensus statement)",
        "the specific exposure–outcome relationship claimed",
      ],
      ["number/quality of studies surveyed", ...subsInText, ...topics],
      [
        "a single named study on the topic without addressing the broader literature",
        "a source that repeats the claim without surveying the evidence base",
      ],
      false,
      "evidence_landscape: body-of-literature question"
    );
  }

  if (targetType === "attribution") {
    return bc(
      [
        `${firstNonEmpty(claim.speakerOrSource, "the named source")} stated, conveyed, published, classified, or alleged the claim`,
        "the underlying proposition attributed to the source",
      ],
      [claim.speakerOrSource, ...orgs, ...actors, "date/context of the statement"],
      ["the source only discusses the topic without making the specific claim"],
      false,
      "attribution: provenance of who asserted the claim"
    );
  }

  if (targetType === "inference") {
    return bc(
      [
        "the causal/interpretive link asserted (not merely the underlying fact)",
        "evidence addressing whether the leap holds",
      ],
      [...laws, ...subsInText, ...topics],
      ["confirmation of the underlying fact without addressing the inferred consequence"],
      false,
      "inference: verifies the causal/interpretive leap"
    );
  }

  // ===== substantive =======================================================

  // Form/entity-specific branches first (already specific).
  if (claim.claimForm === "statistical_claim" || numbers.length) {
    return bc(
      [
        "population or scope of the statistic",
        numbers.length ? `the statistic/numeric claim (${numbers.join(", ")})` : "the statistic/numeric claim",
        year ? `timeframe (${year})` : "timeframe if present",
      ],
      [...subsInText, "measurement method"],
      ["generic discussion of the same topic without the statistic"],
      false,
      "statistical claim"
    );
  }
  if (claim.claimForm === "legal_policy_claim" || laws.length) {
    return bc(
      [laws.length ? `law/policy (${laws.join(", ")})` : "law/policy name or year", "the legal effect claimed"],
      ["jurisdiction", year ? `effective date (${year})` : "effective date"],
      ["general discussion without the specific legal effect"],
      false,
      "legal/policy claim"
    );
  }

  // Content-pattern detectors (derive concrete criteria from targetText).
  // A) media / film event or aftermath
  if (/\b(film|documentary|Vaxxed)\b/i.test(text)) {
    const film = /\bVaxxed\b/i.test(text) ? "the film Vaxxed" : `the ${year ? year + " " : ""}documentary/film`;
    const aftermath = /(came out of the woodwork|share (their )?stories|wanting to share|uproar)/i.test(text);
    return bc(
      [
        film,
        aftermath
          ? "the specific aftermath described (parents publicly sharing vaccine-injury stories / public response)"
          : "the specific event or allegation described",
        year ? `timeframe (${year} or the film's release period)` : "timeframe/context relative to the film",
        ...topics.slice(0, 2),
      ],
      ["filmmaker/producer", "release or distribution context"],
      [
        `generic discussion of ${/\bVaxxed\b/i.test(text) ? "Vaxxed" : "the film"} without the claimed event`,
        "generic vaccine-injury anecdotes not tied to the film's aftermath",
      ],
      false,
      "media/film event or aftermath claim"
    );
  }
  // B) platform / show launch
  if (/\b(launched|hosted by|produced|The HighWire)\b/i.test(text) && /(host|launch|produced|platform|show|program)/i.test(text)) {
    return bc(
      [
        orgs.length ? `launch of ${orgs.join("/")}` : "the launch of the named platform/show",
        actors.length ? `${actors.join(", ")} as host/producer` : "the named host/producer relationship",
        /Vaxxed/i.test(text) ? "connection to Vaxxed" : "the stated production/host connection",
      ],
      [...actors, ...orgs, "launch date/period"],
      [
        actors.length ? `generic profile of ${actors[0]} without the launch/host relationship` : "generic profile without the launch/host relationship",
        orgs.length ? `generic mention of ${orgs[0]}` : "generic mention of the platform",
      ],
      false,
      "media platform/launch claim"
    );
  }
  // C) legislative / jurisdictional scope
  if (
    /\b(bills?|legislation|legislative|mandate|exemption)\b/i.test(text) ||
    (/\b(forty|hundred)\b/i.test(text) && /states?\b/i.test(text))
  ) {
    const nums = uniq([...numbers, ...(text.match(/\b(one hundred|hundred|forty|\d[\d,]*)\b/gi) || [])]);
    return bc(
      [
        nums.length ? `the number/scope of bills (${nums.slice(0, 3).join(", ")})` : "the number/scope of bills",
        "vaccination choice / mandate / exemption issue",
        /forty|states/i.test(text) ? "the jurisdictional scope (state count)" : "jurisdictional scope",
        year ? `timeframe (${year})` : "timeframe if present",
      ],
      ["specific bill numbers or state names", "legislative session/year"],
      ["generic discussion of vaccine legislation", "a single-state bill without the national count/scope"],
      false,
      "legislative/jurisdictional-scope claim"
    );
  }
  // D) censorship / suppression
  if (/\b(censor|censorship|suppress|refus|banned|silenc|not permitted to publish|letters to the editor)\b/i.test(text)) {
    const medium = /letters to the editor/i.test(text)
      ? "letters to the editor"
      : /flyer/i.test(text)
        ? "flyer"
        : /article/i.test(text)
          ? "article"
          : "the target medium/platform";
    return bc(
      ["the specific act of censorship/suppression/refusal", `the target medium (${medium})`, "vaccine-related content"],
      ["publisher/platform involved", "date/context"],
      ["generic claims about censorship", "editorial discretion/disagreement without the specific asserted act"],
      false,
      "censorship/suppression claim"
    );
  }
  // E) mechanism / bypass
  if (/\b(bypass|bypasses|bloodstream|systemic|intramuscular)\b/i.test(text) && /(bypass|protective|barrier|bloodstream|systemic|mechanism)/i.test(text)) {
    return bc(
      [
        /intramuscular|inject/i.test(text) ? "intramuscular injection / injected delivery" : "the delivery route",
        subsInText.length ? `bypassing protective barriers for ${subsInText.join(", ")}` : "bypassing protective barriers/mechanisms",
        "delivery into the bloodstream / systemic circulation",
      ],
      [...subsInText, "dose/route"],
      ["a generic injection/vaccine-administration source that does not address bypass/systemic delivery"],
      false,
      "mechanism/bypass causal claim"
    );
  }
  // F) SIDS / infant mortality
  if (/\bSIDS\b|infant mortalit/i.test(text)) {
    return bc(
      ["vaccine exposure", "SIDS or infant mortality", "the causal/temporal relationship claimed"],
      ["timeframe / vaccination-program introduction", ...topics],
      ["a source that only discusses SIDS generally", "a source that only discusses vaccines generally"],
      false,
      "SIDS / infant-mortality causal claim"
    );
  }
  // G) dosing / safety-testing / schedule
  if (/\b(safety test|safety-test|never .*test|not .*test|antibody titers|cumulative load|exceed|dosing|Well Baby Visit|administered on the same day|multiple shots|numerous vaccines)\b/i.test(text)) {
    const nums = uniq([...numbers, ...(text.match(/\b\d[\d,]*\s*mcg\b|\b\d{2,4}\b/gi) || [])]);
    const schedule = /Well Baby Visit|same day|multiple shots|numerous vaccines|schedule/i.test(text);
    const testing = /safety test|never .*test|not .*test/i.test(text);
    const must = [];
    if (subsInText.length) must.push(`the substance/dose (${subsInText.join(", ")})`);
    if (testing) must.push("the claimed absence/inadequacy of safety testing");
    if (/exceed|limit|850|1000|dosing|titers/i.test(text))
      must.push(nums.length ? `the numeric dose/limit (${nums.slice(0, 3).join(", ")})` : "the numeric dose/limit/threshold");
    if (schedule) must.push("the CDC childhood vaccination schedule / Well Baby Visit context");
    if (!must.length) must.push("the specific dosing/testing proposition");
    return bc(
      must,
      [...subsInText, "regulator/agency (e.g., CDC)", "study or standard cited"],
      [
        subsInText.length ? `a generic ${subsInText[0]} discussion without the dose/testing comparison` : "a generic discussion without the dose/testing comparison",
        "a general vaccine-safety page that does not address the specific claim",
      ],
      false,
      "dosing / safety-testing / schedule claim"
    );
  }

  // Entity-form causal-safety and opponent (specific).
  if (CAUSAL_SAFETY_FORMS.has(claim.claimForm) || substances.length) {
    return bc(
      [
        substances.length ? `exposure/substance (${substances.join(", ")})` : "exposure/substance/product",
        "the claimed mechanism or pathway",
        "the claimed outcome/harm",
      ],
      ["dose/route", "affected population"],
      ["mere mention of the substance without a harm/outcome"],
      false,
      "causal/safety claim"
    );
  }
  if (claim.articleUse === "used_as_opponent_claim" || inferScoreTransform(claim) === "invert") {
    return bc(
      ["the exact underlying proposition", "the public-health/ad/source claim when relevant"],
      [claim.speakerOrSource, ...subsInText],
      ["the source only confirms the claim was said, not the truth of the underlying proposition"],
      false,
      "opponent/invert claim"
    );
  }

  // H) substance-harm derived from text (substance mentioned + harm asserted).
  if (subsInText.length && /(toxic|brain damage|poison|harm|damage|cause|carcinogen|neurotox)/i.test(text)) {
    return bc(
      [`exposure to ${subsInText.join(", ")}`, "the claimed mechanism or pathway", "the claimed outcome/harm"],
      ["dose/route", "affected population (infants/children)"],
      [`mere mention of ${subsInText[0]} without the claimed outcome`, "generic safety discussion that does not address the mechanism"],
      false,
      "substance-harm causal claim"
    );
  }

  // I) hypothetical standards / classification ("would be considered/classified").
  if (/\bwould be (considered|classified)\b/i.test(text)) {
    return bc(
      [],
      uniq([...topics, ...subsInText]),
      ["a source that only discusses the broad topic without addressing the specific standards/classification claim"],
      true,
      "hypothetical standards/classification comparison; not a directly verifiable factual proposition — bearing intentionally weak"
    );
  }

  // Weak fallback: no specific pattern/entities — no generic mustMatch.
  const kw = uniq([...subsInText, ...topics, ...orgs, ...actors]);
  return bc(
    [],
    kw.length ? kw : [text.split(/\s+/).filter(w => w.length > 5).slice(0, 5).join(" ")].filter(Boolean),
    ["source only discusses the broad topic without addressing the specific target proposition"],
    true,
    "no specific entities or claim-pattern detected; bearing marked weak so evidence search down-weights tangential sources"
  );
}

function makeTargetId(claimId, targetType, seq) {
  return `${claimId}::${targetType}::${seq}`;
}

// ---- substantive atomicity / rhetoric cleanup (quality-audit fix 4) -------

// Editorial framing rewritten to neutral wording (order matters).
const RHETORIC_REWRITES = [
  [/\bloudly trumpeting\b/gi, "stating"],
  [/\bloudly trumpeted\b/gi, "stated"],
  [/\bbreathtaking\s+/gi, ""],
  [/\bbombardment of\s+/gi, ""],
  [/\bso-called\s+/gi, ""],
  [/\bshockingly\s+/gi, ""],
  [/\bshocking\s+/gi, ""],
];

// Mirror of the quality audit's broad/rhetorical detector so the targetizer
// can self-check whether a (possibly rewritten) proposition is still broad.
const TARGET_RHETORIC_RE =
  /\b(set the stage|paved the way|breathtaking|bombardment|uproar|loudly trumpeting|deadliest|inexplicably|would be considered|would be classified)\b/i;

function looksBroadOrRhetorical(text) {
  const commas = (text.match(/,/g) || []).length;
  const conj = (text.match(/\b(and|as well as|along with)\b/gi) || []).length;
  return (
    TARGET_RHETORIC_RE.test(text) ||
    (commas >= 3 && text.length > 120) ||
    (conj >= 2 && text.length > 150)
  );
}

// Trailing non-targetable "reaction" clauses to drop (per fix-4 examples):
// "created an uproar" is a reaction, not a targetable factual proposition.
const CLAUSE_DROPS = [/\s+created an uproar(?:\s+in the news)?/gi];

function stripRhetoric(text) {
  let out = text;
  for (const [re, rep] of RHETORIC_REWRITES) out = out.replace(re, rep);
  for (const re of CLAUSE_DROPS) out = out.replace(re, "");
  // grammar fixup after clause drop: participle → past tense for a clean claim
  out = out.replace(/\bfilm disclosing\b/gi, "film disclosed");
  // dosing schedule: "2-, 4-, and 6-month" → "2/4/6-month"
  out = out.replace(/(\d)-,\s*(\d)-,\s*and\s*(\d)-month/gi, "$1/$2/$3-month");
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").replace(/\s*\.?$/, ".").trim();
}

/** Split a list on commas/"and" WITHOUT breaking inside quoted spans. */
function splitList(s) {
  const quotes = [];
  const protectedStr = s.replace(/'[^']*'|"[^"]*"|‘[^’]*’|“[^”]*”/g, m => {
    quotes.push(m);
    return ` ${quotes.length - 1} `;
  });
  return protectedStr
    .split(/,\s*|\s+and\s+/)
    .map(x => x.replace(/ (\d+) /g, (_, i) => quotes[+i]).trim())
    .map(x => x.replace(/^the\s+/i, "")) // drop leading article for cleanliness
    .filter(x => x.length > 2);
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Attempt to split a cleaned substantive proposition into atomic children.
 * Returns an array of atomic proposition strings, or null if no safe split.
 * Deterministic, structure-driven (no LLM, no claimId matching).
 */
function splitProposition(text) {
  // A) "{cause} set the stage for {A, B and C}"
  let m = text.match(/^(.*?)\s+set the stage for\s+(.+?)\.?$/i);
  if (m) {
    const cause = m[1].trim().replace(/[,;]+$/, "");
    const effects = splitList(m[2].replace(/\s+that followed$/i, ""));
    if (cause.length > 4 && effects.length >= 2) {
      return effects.map(e => `${cause} contributed to ${e.replace(/\.$/, "")}.`);
    }
  }
  // B) "{subject} released a reworked[, fraudulent] version of the study {trumpeting|stating|claiming} that {Z}"
  m = text.match(
    /^(.*?\breleased a reworked)(?:,?\s*fraudulent)?(\s+version of the study)\s+(?:trumpeting|stating|claiming|announcing)\s+that\s+(.+?)\.?$/i
  );
  if (m) {
    const subject = `${m[1]}${m[2]}`.trim();
    const z = m[3].trim();
    return [`${cap(subject)}.`, `The reworked study stated that ${z}.`];
  }
  // C) "{X} metabolizes to [the ...,] {substance}, and {remains ...}"
  m = text.match(
    /^(.*?)\s+metabolizes to\s+(?:the\s+[^,]+,\s*)?([a-z][a-z\s]+?),?\s+and\s+(remains\b.+?)\.?$/i
  );
  if (m) {
    const x = m[1].trim();
    const substance = m[2].trim();
    const rest = m[3].trim();
    if (x.length > 4 && substance.length > 3) {
      return [`${cap(x)} metabolizes to ${substance}.`, `${cap(substance)} ${rest}.`];
    }
  }
  return null;
}

/**
 * Post-pass: rewrite/split/flag broad or rhetorical substantive targets.
 * Preserves sourceClaimId, sourceSentenceIds, canonicalExcerpt, scoreTransform,
 * verdictEligible, bearingCriteria and queryHints entities. Splits re-sequence
 * substantive targetIds per source claim. Non-substantive targets pass through.
 */
function cleanupSubstantiveTargets(targets, diag) {
  const out = [];
  const subSeq = new Map(); // sourceClaimId -> running substantive index

  const emit = (base, text, extra) => {
    const claimId = base.sourceClaimId;
    const seq = (subSeq.get(claimId) || 0) + 1;
    subSeq.set(claimId, seq);
    const queryHints = {
      ...base.queryHints,
      primaryQueryText: text, // entities preserved; query text tracks atomic proposition
    };
    out.push({
      ...base,
      targetId: makeTargetId(claimId, "substantive", seq),
      targetText: text,
      queryHints,
      derivedFromTargetId: base.targetId,
      needsAtomicSplit: false,
      qualityStatus: "ok",
      ...extra,
    });
  };

  for (const t of targets) {
    if (t.targetType !== "substantive") {
      out.push(t);
      continue;
    }

    const cleaned = stripRhetoric(t.targetText);

    // 1) safe structural split
    const parts = splitProposition(cleaned);
    if (parts && parts.length >= 2) {
      diag.substantiveSplit.push({ from: t.targetId, into: parts.length });
      parts.forEach(p =>
        emit(t, p, {
          qualityStatus: "split",
          mappingReason: `${t.mappingReason} — split into atomic propositions (fix 4)`,
        })
      );
      continue;
    }

    // 2) classification / hypothetical standard ("would be considered")
    if (/\bwould be (considered|classified)\b/i.test(cleaned)) {
      diag.substantiveMarkedReview.push({ targetId: t.targetId, reason: "classification/standards claim" });
      emit(t, cleaned, {
        needsAtomicSplit: false,
        qualityStatus: "review",
        mappingReason:
          `${t.mappingReason} — preserved as a standards/classification claim (hypothetical "would be considered"), not a direct factual proposition; not split (fix 4)`,
      });
      continue;
    }

    // 3) compound multi-jurisdiction scope (leading enumerated prepositional phrase)
    if (/^(?:In|Across)\s+[^,]+(?:,\s*[^,]+){2,}/i.test(cleaned) && looksBroadOrRhetorical(cleaned)) {
      diag.substantiveMarkedReview.push({ targetId: t.targetId, reason: "compound multi-jurisdiction scope" });
      emit(t, cleaned, {
        needsAtomicSplit: true,
        qualityStatus: "review",
        mappingReason:
          `${t.mappingReason} — compound multi-jurisdiction scope cannot be deterministically validated as one regulatory fact; flagged for per-jurisdiction split (fix 4)`,
      });
      continue;
    }

    // 4) rhetoric-only rewrite that is now clean
    if (cleaned !== t.targetText && !looksBroadOrRhetorical(cleaned)) {
      diag.substantiveRewritten.push({ targetId: t.targetId });
      emit(t, cleaned, {
        qualityStatus: "rewritten",
        mappingReason: `${t.mappingReason} — editorial framing removed (fix 4)`,
      });
      continue;
    }

    // 5) still broad and not safely splittable → keep, mark for review
    if (looksBroadOrRhetorical(cleaned)) {
      diag.substantiveMarkedReview.push({ targetId: t.targetId, reason: "not safely splittable" });
      emit(t, cleaned, {
        needsAtomicSplit: true,
        qualityStatus: "review",
        mappingReason: `${t.mappingReason} — could not be safely rewritten or split deterministically (fix 4)`,
      });
      continue;
    }

    // 6) already clean
    emit(t, cleaned, { qualityStatus: "ok" });
  }

  return out;
}

/**
 * Targetize a set of Phase 3-ready claim occurrences.
 *
 * @param {Array<object>} claimOccurrences
 * @param {object} options
 *   - idField (default "claimId")
 *   - emitInferenceTargets (default true)
 * @returns {{targets: Array<object>, diagnostics: object}}
 */
export function targetizeClaimOccurrences(claimOccurrences, options = {}) {
  const idField = options.idField || "claimId";
  const emitInference = options.emitInferenceTargets ?? true;

  const input = Array.isArray(claimOccurrences) ? claimOccurrences : [];
  const targets = [];
  const warnings = [];
  const claimsWithNoTargets = [];
  const claimsWithMultipleTargets = [];
  const studyIdentitySuppressed = [];
  const inferenceDropped = [];
  const cleanupDiag = {
    substantiveRewritten: [],
    substantiveSplit: [],
    substantiveMarkedReview: [],
  };

  for (const claim of input) {
    const claimId = claim[idField] || claim.claimId || "";
    if (!claimId) {
      warnings.push("occurrence missing claimId; skipped");
      continue;
    }

    const perClaimTargets = [];
    const transform = inferScoreTransform(claim);
    const th = claim.targetHints || {};
    const hasEmbedded = Boolean(claim.embeddedSubstantiveClaim && claim.embeddedSubstantiveClaim.trim().length);
    const isAttributed =
      claim.claimForm === "attributed_assertion" ||
      claim.claimForm === "quoted_claim" ||
      th.needsAttributionTarget === true;

    // shared context copied onto every target
    const ctx = {
      sourceClaimId: claimId,
      sourceContentClaimId: claim.sourceContentClaimId || null,
      visibleClaimText: claim.visibleClaimText || "",
      sourceSentenceIds: claim.sourceSentenceIds || [],
      canonicalExcerpt: claim.canonicalExcerpt || claim.localSourceExcerpt || "",
      warrant: claim.warrantHint || "",
    };

    // ---- literature-existence detection (fix 1) ----------------------
    // "There are no credible studies linking X to Y" asserts the state of a
    // BODY of literature. It becomes an evidence_landscape target (the verdict
    // carrier for this occurrence) — never study_identity, and it replaces the
    // plain substantive target to avoid double-carrying the same verdict.
    const litExistence =
      LITERATURE_EXISTENCE_RE.test(claim.visibleClaimText || "") ||
      LITERATURE_EXISTENCE_RE.test(claim.embeddedSubstantiveClaim || "");

    // ---- (3) Substantive candidacy (computed FIRST for the guard) ----
    let substantiveText = "";
    let substantiveReason = "";
    if (hasEmbedded) {
      substantiveText = claim.embeddedSubstantiveClaim;
      substantiveReason = "embedded substantive proposition extracted from an attributed/quoted claim";
    } else if (SUBSTANTIVE_FORMS.has(claim.claimForm) && claim.evaluationLaneHint === "candidate") {
      substantiveText = claim.visibleClaimText;
      substantiveReason = `direct ${claim.claimForm} candidate; visible text is the substantive proposition`;
    }
    // Will this occurrence have a verdict-carrying sibling?
    const verdictSiblingWillExist =
      Boolean(substantiveText && substantiveText.trim().length) || litExistence;

    // ---- (2) Attribution target (double-verdict guard — fix 3) -------
    // Default: scoreTransform none, verdictEligible false (provenance only).
    // Attribution becomes verdict-bearing ONLY when the attribution itself is
    // the article's core allegation AND no sibling already carries the verdict.
    if (isAttributed && claim.speakerOrSource && claim.speakerOrSource.trim().length) {
      const proposition = firstNonEmpty(claim.embeddedSubstantiveClaim, claim.visibleClaimText);
      const attributionCentral =
        th.needsAttributionTarget === true &&
        claim.articleUse === "endorsed_by_article" &&
        !verdictSiblingWillExist;
      perClaimTargets.push({
        targetType: "attribution",
        targetText: `${claim.speakerOrSource} made or conveyed the claim that ${proposition}`,
        scoreTransform: attributionCentral ? transform : "none",
        searchEligible: true,
        verdictEligible: attributionCentral,
        bearingCriteria: buildBearingCriteria(claim, "attribution", proposition),
        queryHints: buildQueryHints(claim, `${claim.speakerOrSource} ${proposition}`),
        mappingReason: attributionCentral
          ? "attribution itself is the article's core allegation and no sibling target carries the verdict"
          : "attributed/quoted claim; attribution provenance only (verdict carried by sibling target)",
        mappingConfidence: 0.9,
      });
    }

    // ---- (3b) Substantive target push (suppressed for lit-existence) --
    if (substantiveText && substantiveText.trim().length && !litExistence) {
      const background = isBackground(claim);
      perClaimTargets.push({
        targetType: "substantive",
        targetText: substantiveText,
        scoreTransform: transform,
        searchEligible: true,
        verdictEligible: !background,
        bearingCriteria: buildBearingCriteria(claim, "substantive", substantiveText),
        queryHints: buildQueryHints(claim, firstNonEmpty(claim.searchText, substantiveText)),
        mappingReason: substantiveReason,
        mappingConfidence: hasEmbedded ? 0.9 : 0.8,
      });
    }

    // ---- (4) evidence_landscape OR study_identity (fix 1) ------------
    const namedStudies = uniq(claim.namedStudiesOrDocuments);
    const studyTriggered =
      claim.claimForm === "study_claim" ||
      th.needsStudyIdentityTarget === true ||
      namedStudies.length > 0 ||
      STUDY_TERM_RE.test(claim.visibleClaimText || "");

    if (litExistence) {
      const proposition = firstNonEmpty(claim.embeddedSubstantiveClaim, claim.visibleClaimText);
      perClaimTargets.push({
        targetType: "evidence_landscape", // alias: literature_existence
        targetText: literatureExistenceText(proposition),
        scoreTransform: transform === "none" ? "review" : transform,
        searchEligible: true,
        verdictEligible: transform !== "none",
        bearingCriteria: buildBearingCriteria(claim, "evidence_landscape", proposition),
        queryHints: buildQueryHints(claim, firstNonEmpty(claim.searchText, proposition)),
        mappingReason:
          "claim asserts the existence/absence of a body of literature; assessed as an evidence-landscape question, not a single-study identity",
        mappingConfidence: 0.85,
      });
    } else if (studyTriggered) {
      const isMaxim = LOGICAL_MAXIM_RE.test(claim.visibleClaimText || "");
      const concrete = hasConcreteStudyObject(claim);
      if (!isMaxim && concrete) {
        // Identifier must come from the text that actually CONTAINS the
        // concrete object (the gate may have passed on visible while the
        // embedded claim drops the identifying details, or vice versa).
        const containsObject = s =>
          s &&
          (KNOWN_REGISTER_RE.test(s) || YEAR_PUBLICATION_RE.test(s) || NAMED_INSTITUTION_STUDY_RE.test(s));
        const identifier = namedStudies.length
          ? namedStudies.join("; ")
          : containsObject(claim.visibleClaimText)
            ? claim.visibleClaimText
            : containsObject(claim.embeddedSubstantiveClaim)
              ? claim.embeddedSubstantiveClaim
              : firstNonEmpty(claim.embeddedSubstantiveClaim, claim.visibleClaimText);
        perClaimTargets.push({
          targetType: "study_identity",
          targetText: `Identify the study/document: ${identifier}`,
          scoreTransform: "none",
          searchEligible: true,
          verdictEligible: false,
          bearingCriteria: buildBearingCriteria(claim, "study_identity"),
          queryHints: buildQueryHints(
            claim,
            firstNonEmpty(namedStudies.join(" "), claim.searchText, claim.visibleClaimText)
          ),
          mappingReason:
            "resolves the study/document object identity needed before substantive evidence scoring",
          mappingConfidence: namedStudies.length ? 0.85 : 0.7,
        });
      } else {
        studyIdentitySuppressed.push({
          claimId,
          reason: isMaxim
            ? "logical maxim, not a study/document"
            : "no concrete identifiable study/document/dataset/law/report/film/meeting object",
          text: (claim.visibleClaimText || "").slice(0, 100),
        });
      }
    }

    // ---- (5) Inference target (fix 2) ---------------------------------
    // Emit ONLY when a distinct inferred proposition can be synthesized from
    // an explicit cause→effect structure. Never copy visibleClaimText.
    if (emitInference) {
      const synthesized = synthesizeInference(claim.visibleClaimText);
      if (synthesized) {
        const infTransform = transform === "none" || transform === "review" ? "review" : transform;
        perClaimTargets.push({
          targetType: "inference",
          targetText: synthesized,
          scoreTransform: infTransform,
          searchEligible: true,
          verdictEligible: infTransform !== "review",
          bearingCriteria: buildBearingCriteria(claim, "inference"),
          queryHints: buildQueryHints(claim, firstNonEmpty(claim.searchText, synthesized)),
          mappingReason:
            "distinct inferred cause→effect proposition synthesized from the visible claim's causal leap",
          mappingConfidence: 0.55,
        });
      } else if (INFERENCE_CUE_RE.test(claim.visibleClaimText || "")) {
        inferenceDropped.push({
          claimId,
          reason:
            "causal/interpretive cue present but no distinct inferred proposition could be synthesized (dramatic wording only)",
          text: (claim.visibleClaimText || "").slice(0, 100),
        });
      }
    }

    // Finalize per-claim targets with IDs + shared context.
    const typeSeq = {};
    for (const t of perClaimTargets) {
      typeSeq[t.targetType] = (typeSeq[t.targetType] || 0) + 1;
      targets.push({
        targetId: makeTargetId(claimId, t.targetType, typeSeq[t.targetType]),
        ...ctx,
        // ctx.warrant is the default; targets keep the occurrence warrant
        ...t,
        warrant: t.warrant || ctx.warrant || "",
      });
    }

    if (perClaimTargets.length === 0) {
      claimsWithNoTargets.push({
        claimId,
        claimForm: claim.claimForm,
        articleUse: claim.articleUse,
        lane: claim.evaluationLaneHint,
        reason: "no attribution/substantive/study/inference trigger matched",
      });
    } else if (perClaimTargets.length > 1) {
      claimsWithMultipleTargets.push({
        claimId,
        count: perClaimTargets.length,
        types: perClaimTargets.map(t => t.targetType),
      });
    }
  }

  // Substantive atomicity / rhetoric cleanup (fix 4). Splits/rewrites are
  // applied here; non-substantive targets pass through untouched.
  const finalTargets = cleanupSubstantiveTargets(targets, cleanupDiag);

  // Diagnostics
  const targetsByType = {};
  const targetsByScoreTransform = {};
  for (const t of finalTargets) {
    targetsByType[t.targetType] = (targetsByType[t.targetType] || 0) + 1;
    targetsByScoreTransform[t.scoreTransform] = (targetsByScoreTransform[t.scoreTransform] || 0) + 1;
  }
  const searchEligibleCount = finalTargets.filter(t => t.searchEligible).length;
  const verdictEligibleCount = finalTargets.filter(t => t.verdictEligible).length;

  if (targetsByType.inference === undefined || targetsByType.inference === 0) {
    warnings.push(
      `no inference targets created: no occurrence yielded a distinct inferred cause→effect proposition` +
        (inferenceDropped.length
          ? ` (${inferenceDropped.length} cue-bearing candidate(s) dropped: ${inferenceDropped.map(d => d.claimId).join(", ")})`
          : "")
    );
  }
  if (studyIdentitySuppressed.length) {
    warnings.push(
      `${studyIdentitySuppressed.length} study_identity candidate(s) suppressed by concrete-object gating: ${studyIdentitySuppressed.map(d => d.claimId).join(", ")}`
    );
  }

  return {
    targets: finalTargets,
    diagnostics: {
      inputClaimCount: input.length,
      targetCount: finalTargets.length,
      targetsByType,
      targetsByScoreTransform,
      searchEligibleCount,
      verdictEligibleCount,
      claimsWithNoTargets,
      claimsWithMultipleTargets,
      studyIdentitySuppressed,
      inferenceDropped,
      substantiveCleanup: cleanupDiag,
      warnings,
    },
  };
}

export default targetizeClaimOccurrences;
