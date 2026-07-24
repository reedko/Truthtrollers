const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const OPERATOR_PATTERN = [
  "said",
  "says",
  "claimed",
  "claims",
  "reported",
  "reports",
  "revealed",
  "reveals",
  "alleged",
  "alleges",
  "found",
  "finds",
  "concluded",
  "concludes",
  "stated",
  "states",
  "denied",
  "denies",
  "wrote",
  "writes",
  "testified",
  "testifies",
  "announced",
  "announces",
  "declared",
  "declares",
  "proved",
  "proves",
  "showed",
  "shows",
  "demonstrated",
  "demonstrates",
].join("|");

const CANONICAL_OPERATOR = {
  said: "said",
  says: "said",
  claimed: "claimed",
  claims: "claimed",
  reported: "reported",
  reports: "reported",
  revealed: "revealed",
  reveals: "revealed",
  alleged: "alleged",
  alleges: "alleged",
  found: "found",
  finds: "found",
  concluded: "concluded",
  concludes: "concluded",
  stated: "stated",
  states: "stated",
  denied: "denied",
  denies: "denied",
  wrote: "wrote",
  writes: "wrote",
  testified: "testified",
  testifies: "testified",
  announced: "announced",
  announces: "announced",
  declared: "declared",
  declares: "declared",
  proved: "proved",
  proves: "proved",
  showed: "showed",
  shows: "showed",
  demonstrated: "demonstrated",
  demonstrates: "demonstrated",
};

const OPERATOR_UNIT_PATTERN = {
  said: /\b(?:said|says)\b/i,
  claimed: /\bclaim(?:ed|s)?\b/i,
  reported: /\breport(?:ed|s)?\b/i,
  revealed: /\breveal(?:ed|s)?\b/i,
  alleged: /\ballege(?:d|s)?\b/i,
  found: /\b(?:found|finds)\b/i,
  concluded: /\bconclude(?:d|s)?\b/i,
  stated: /\bstate(?:d|s)?\b/i,
  denied: /\bden(?:ied|ies)\b/i,
  wrote: /\b(?:wrote|writes)\b/i,
  testified: /\btestif(?:ied|ies)\b/i,
  announced: /\bannounce(?:d|s)?\b/i,
  declared: /\bdeclare(?:d|s)?\b/i,
  proved: /\b(?:proved|proves|proven)\b/i,
  showed: /\b(?:showed|shows|shown)\b/i,
  demonstrated: /\bdemonstrate(?:d|s)?\b/i,
};

function supplierOverlap(supplier, unitText) {
  const supplierTokens = [...new Set(normalizedKey(supplier).split(" ")
    .filter((token) => token.length > 1
      && !["the", "a", "an", "by", "of", "in"].includes(token)))];
  if (supplierTokens.length === 0) return 0;
  const unitTokens = new Set(normalizedKey(unitText).split(" "));
  return supplierTokens.filter((token) => unitTokens.has(token)).length
    / supplierTokens.length;
}

export function detectAttributionCues(candidate) {
  const assertion = normalized(candidate.rawAssertion);
  const accordingTo = assertion.match(
    /^According to (?<supplier>.+?),\s*(?<content>.+)$/iu,
  );
  if (accordingTo?.groups) {
    const supplierText = normalized(accordingTo.groups.supplier);
    const sourceUnitIds = candidate.contextUnits
      .filter((unit) => supplierOverlap(supplierText, unit.text) >= 0.5
        && /\baccording to\b/i.test(unit.text))
      .map((unit) => unit.unitId);
    if (sourceUnitIds.length > 0) {
      return [{
        supplierText,
        operator: "according_to",
        embeddedContent: normalized(accordingTo.groups.content)
          .replace(/[.!?]+$/g, ""),
        sourceUnitIds,
        basis: "explicit according-to attribution frame",
      }];
    }
  }
  const pattern = new RegExp(
    `^(?<supplier>.+?)\\s+(?<operator>${OPERATOR_PATTERN})\\b`
      + `(?<bridge>.{0,100}?)\\bthat\\s+(?<content>.+)$`,
    "iu",
  );
  const match = assertion.match(pattern);
  if (!match?.groups) return [];
  const supplierText = normalized(match.groups.supplier);
  const operatorText = normalized(match.groups.operator).toLocaleLowerCase();
  const embeddedContent = normalized(match.groups.content)
    .replace(/[.!?]+$/g, "");
  if (!supplierText || !embeddedContent
    || supplierText.split(/\s+/).length > 14) return [];
  const sourceUnitIds = candidate.contextUnits
    .filter((unit) => {
      const operator = CANONICAL_OPERATOR[operatorText];
      return supplierOverlap(supplierText, unit.text) >= 0.5
        && OPERATOR_UNIT_PATTERN[operator]?.test(unit.text);
    })
    .map((unit) => unit.unitId);
  if (sourceUnitIds.length === 0) return [];
  return [{
    supplierText,
    operator: CANONICAL_OPERATOR[operatorText],
    embeddedContent,
    sourceUnitIds,
    basis: "explicit supplier + reporting operator + that-clause",
  }];
}

export function attachAttributionCues(candidates) {
  return candidates.map((candidate) => ({
    ...candidate,
    attributionCues: detectAttributionCues(candidate),
  }));
}
