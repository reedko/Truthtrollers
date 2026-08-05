/**
 * Option-A packet-selection alias contract: build assertion-relative packet-
 * selection aliases only from fields already persisted in production
 * (claim_evaluation_targets.query_hints_json, as returned by
 * loadProductionCfxEvidenceInputs' literalIdentifiers/lookupHints). This
 * generates no new vocabulary and makes no model call -- it flattens the
 * existing, already-model-produced S2 handoff fields in one fixed order.
 *
 * Field order (fixed, not configurable):
 *   literalIdentifiers.people, .organizations, .acronyms, .studyTitles,
 *   lookupHints.populations, .exposures, .outcomes, .interventions,
 *   .geography, .documentTypes, .topics
 *
 * Rules: normalize whitespace only, preserve first occurrence, remove exact
 * duplicates. Never synthesizes synonyms, never expands acronyms, never
 * inspects query strings, never adds rhetorical vocabulary, never uses the
 * fixture-only expansion_terms/BASELINE_CONCEPT_GROUPS this contract
 * replaced. requiredConceptGroups is always [] under Option A -- that is a
 * caller-level constant, not derived by this function.
 */

const ALIAS_FIELD_ORDER = Object.freeze([
  ["literalIdentifiers", "people"],
  ["literalIdentifiers", "organizations"],
  ["literalIdentifiers", "acronyms"],
  ["literalIdentifiers", "studyTitles"],
  ["lookupHints", "populations"],
  ["lookupHints", "exposures"],
  ["lookupHints", "outcomes"],
  ["lookupHints", "interventions"],
  ["lookupHints", "geography"],
  ["lookupHints", "documentTypes"],
  ["lookupHints", "topics"],
]);

/**
 * @param {{literalIdentifiers?: Record<string, string[]>, lookupHints?: Record<string, string[]>}} evidenceInput
 * @returns {string[]}
 */
export function buildCfxOptionAAliases(evidenceInput) {
  const ordered = [];
  for (const [group, field] of ALIAS_FIELD_ORDER) {
    const values = evidenceInput?.[group]?.[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const normalized = String(value).replace(/\s+/gu, " ").trim();
      if (normalized) ordered.push(normalized);
    }
  }
  const seen = new Set();
  const result = [];
  for (const term of ordered) {
    if (seen.has(term)) continue;
    seen.add(term);
    result.push(term);
  }
  return result;
}
