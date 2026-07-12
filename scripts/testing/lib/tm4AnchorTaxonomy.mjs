// scripts/testing/lib/tm4AnchorTaxonomy.mjs
//
// Two-tier anchor taxonomy for TM4 claim tuning (test-only, not production):
//
//   AUDIT_PROBE_TAGS — loose topic probes. Presence proves only that a topic
//   word appears somewhere; it says nothing about whether a claim-bearing
//   proposition survived. Used for coverage dashboards and regression
//   tripwires, never as a quality pass.
//
//   CLAIM_BEARING_ANCHOR_FAMILIES — each family requires a PREDICATE to
//   co-occur with its topic (allegation verb, statistic, legal action,
//   mechanism…). A selected claim "passes" a family only when the falsifiable
//   proposition survived selection, not merely the topic word.

export const AUDIT_PROBE_TAGS = {
  CDC: /\bCDC\b/,
  MMR: /\bMMR\b/i,
  autism: /autism/i,
  aluminum: /alumin(um|ium)/i,
  thimerosal: /thimerosal/i,
  VAERS: /\bVAERS\b/i,
  Thompson: /thompson/i,
  Hooker: /hooker/i,
  Simpsonwood: /simpsonwood/i,
  Verstraeten: /verstraeten/i,
  tomato: /tomato/i,
  "blood-brain barrier": /blood.brain barrier/i,
  "1986": /\b1986\b/,
  liability: /liabilit/i,
};

// Each family: topic + predicate must BOTH hold (predicates are per-family).
export const CLAIM_BEARING_ANCHOR_FAMILIES = {
  thompson_cdc_mmr_data_manipulation: {
    label: "Thompson/CDC/MMR data manipulation allegation",
    topic: /thompson|(\bMMR\b[\s\S]{0,120}\bCDC\b)|(\bCDC\b[\s\S]{0,120}\bMMR\b)|cdc (scientist|whistleblower)/i,
    predicate: /manipulat|fraud|re-?work|omitt?|alter|conceal|cover.?up|whistleblower|revealed/i,
  },
  cdc_destruction_of_evidence: {
    label: "CDC destruction-of-evidence allegation",
    topic: /\bCDC\b|thompson|officials/i,
    predicate: /destroy(ed)?\s+(all\s+)?(the\s+)?(evidence|documents|data)|ordered the destruction/i,
  },
  hooker_reanalysis_original_cdc_study: {
    label: "Hooker reanalysis of the original CDC study",
    topic: /hooker|2004 (cdc )?study|original (cdc )?study/i,
    predicate: /re-?analy|reexamin|obtained|published|showed|found/i,
  },
  thimerosal_simpsonwood_verstraeten_data_integrity: {
    label: "Thimerosal/Simpsonwood/Verstraeten data-integrity claims",
    topic: /thimerosal|simpsonwood|verstraeten/i,
    predicate: /\d|suppress|conceal|rework|meeting|transcript|study|risk|higher|times/i,
  },
  act_1986_liability_shield: {
    label: "1986 Act removed liability from drug companies",
    topic: /\b1986\b|childhood vaccine injury act/i,
    predicate: /liabilit|immun(e|ity)|shield|removed|protect|lawsuit|sue/i,
  },
  industry_capture_causal_claim: {
    label: "1986 Act → industry capture causal claim",
    topic: /\b1986\b|industry capture/i,
    predicate: /set the stage|paved the way|led to|enabled|capture|cover.?up/i,
  },
  aluminum_tomato_opponent_claim: {
    label: "Aluminum-from-a-tomato opponent slogan (invert)",
    topic: /alumin(um|ium)/i,
    predicate: /tomato/i,
  },
  aluminum_blood_brain_barrier: {
    label: "Aluminum crosses/affects the blood-brain barrier",
    topic: /alumin(um|ium)/i,
    predicate: /blood.brain barrier|cross(es|ing)?|brain/i,
  },
  aluminum_dosing_safety_limits: {
    label: "Aluminum dosing exceeds safety limits",
    topic: /alumin(um|ium)/i,
    predicate: /\d+\s*(mcg|µg|microgram)|safety limit|per kilogram|exceed|dose|dosing/i,
  },
  vaers_same_day_death_statistic: {
    label: "VAERS same-day death timing statistic",
    topic: /\bVAERS\b/i,
    predicate: /\d+\s*%|\bsame day\b|day of|within \d+ day/i,
  },
};

export function probeTagsFor(text) {
  const t = String(text || "");
  return Object.entries(AUDIT_PROBE_TAGS).filter(([, re]) => re.test(t)).map(([k]) => k);
}

/**
 * Families whose topic AND predicate both survive in `text`.
 * Returns [{ family, label, topicOnly }] — topicOnly=true means the topic
 * word appears but the claim-bearing predicate was lost (a failure signal
 * for selected claims).
 */
export function anchorFamiliesFor(text) {
  const t = String(text || "");
  const out = [];
  for (const [family, def] of Object.entries(CLAIM_BEARING_ANCHOR_FAMILIES)) {
    const topic = def.topic.test(t);
    if (!topic) continue;
    out.push({ family, label: def.label, pass: def.predicate.test(t), topicOnly: !def.predicate.test(t) });
  }
  return out;
}

export function bestAnchorFamilyGuess(text) {
  const fams = anchorFamiliesFor(text);
  return fams.find((f) => f.pass)?.family || fams[0]?.family || "";
}
