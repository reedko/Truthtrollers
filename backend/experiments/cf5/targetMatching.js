// CF5 Prompt Experiment 2 — target matching against sealed CF4 gold cruxes. Matching
// method: deterministic keyword-group matching, NOT semantic/NLI matching and NOT
// fact-checking. A target is "present" only when every required keyword group for
// that target has a hit within a single claim's text. A target is "ambiguous" when a
// claim hits some but not all required groups, or hits only a weaker secondary signal
// — these are exposed for human review rather than asserted as present. Everything
// else is "absent". This is a coarse, auditable proxy, not ground truth — every run of
// this method should be spot-checked, per the experiment's own instruction not to
// treat lexical matching as authoritative.
import { readFileSync } from "node:fs";
import path from "node:path";

const MATCHING_METHOD_DESCRIPTION =
  "Deterministic keyword-group matching (not semantic/NLI, not fact-checking). "
  + "'Present' requires every required keyword group to match within one claim's text. "
  + "'Ambiguous' means a partial/weaker signal was found and needs human review. "
  + "'Absent' means no signal was found in any claim.";

// Each target: requiredGroups = array of arrays of regexes; ALL groups must have at
// least one match (an OR within the group, an AND across groups) for "present".
// weakSignals = additional regexes that, if hit without satisfying requiredGroups,
// produce "ambiguous" rather than "absent".
const TARGET_PATTERNS = {
  "CF1-F02": {
    G01: { requiredGroups: [[/1,?000|thousand times/i], [/toxic/i]], weakSignals: [/glyphosate.{0,40}formulation/i] },
    G02: { requiredGroups: [[/long.?term/i], [/test/i]], weakSignals: [/regulat/i] },
    G05: { requiredGroups: [[/industry.?(sponsored|funded)/i], [/research|stud/i]], weakSignals: [/industry/i] },
    G12: { requiredGroups: [[/cancer/i], [/rat/i]], weakSignals: [] },
  },
  "CF1-F03": {
    G02: { requiredGroups: [[/mmr|measles/i], [/manipulat|alter|falsif|fraud/i]], weakSignals: [/mmr|measles/i] },
    G03: { requiredGroups: [[/destroy/i], [/evidence|thompson/i]], weakSignals: [/thompson/i] },
    G09: { requiredGroups: [[/aluminum/i], [/cumulative|never|not been|no safety/i], [/test/i]], weakSignals: [/aluminum/i] },
    G10: { requiredGroups: [[/thimerosal/i], [/7\.6/]], weakSignals: [/thimerosal/i] },
  },
  "CF1-F06": {
    G05: { requiredGroups: [[/1981/], [/bleach/i]], weakSignals: [/1981/] },
    G06: { requiredGroups: [[/eject|expel/i], [/algae/i]], weakSignals: [/algae/i] },
    G08: { requiredGroups: [[/acid/i], [/dissolv|carbon/i]], weakSignals: [/acid/i] },
    G09: { requiredGroups: [[/450/]], weakSignals: [] },
    G12: { requiredGroups: [[/half|50 ?percent|50%/i], [/coral/i]], weakSignals: [/coral/i] },
  },
};

let goldCache = null;
export function loadGoldTargets(root) {
  if (goldCache) return goldCache;
  goldCache = {};
  for (const fixture of Object.keys(TARGET_PATTERNS)) {
    const goldPath = path.join(root, "backend/experiments/cf4/gold", `${fixture}.gold.json`);
    const gold = JSON.parse(readFileSync(goldPath, "utf8"));
    goldCache[fixture] = {};
    for (const assertion of gold.assertions) {
      if (assertion.crux) {
        goldCache[fixture][assertion.goldId] = assertion.testableAssertion;
      }
    }
  }
  return goldCache;
}

// Returns per-target: { targetId, targetDescription, present, matchingClaimIds,
// ambiguousClaimIds, reviewerNote, method }
export function matchTargetsForRun(fixture, claims, root) {
  const gold = loadGoldTargets(root);
  const patterns = TARGET_PATTERNS[fixture] ?? {};
  const targets = gold[fixture] ?? {};
  const results = [];
  for (const [targetId, description] of Object.entries(targets)) {
    const pattern = patterns[targetId];
    const matchingClaimIds = [];
    const ambiguousClaimIds = [];
    for (const claim of claims) {
      const text = claim.claim;
      const allGroupsHit = pattern.requiredGroups.every((group) => group.some((re) => re.test(text)));
      if (allGroupsHit) {
        matchingClaimIds.push(claim.claimId);
        continue;
      }
      const someGroupsHit = pattern.requiredGroups.some((group) => group.some((re) => re.test(text)));
      const weakHit = pattern.weakSignals.some((re) => re.test(text));
      if (someGroupsHit || weakHit) {
        ambiguousClaimIds.push(claim.claimId);
      }
    }
    const present = matchingClaimIds.length > 0;
    const ambiguous = !present && ambiguousClaimIds.length > 0;
    results.push({
      targetId, targetDescription: description,
      present, ambiguous,
      matchingClaimIds, ambiguousClaimIds,
      reviewerNote: present
        ? "Automated match — verify by reading the claim text in context."
        : ambiguous
          ? "Partial/weak signal only — flagged for human review, not counted as present."
          : "No signal found by the automated matcher.",
      method: MATCHING_METHOD_DESCRIPTION,
    });
  }
  return results;
}

export { MATCHING_METHOD_DESCRIPTION, TARGET_PATTERNS };
