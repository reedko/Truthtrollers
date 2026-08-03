import type {
  CfxEvidenceInput,
  CfxQueryId,
  CfxQueryIntent,
} from "./types.js";

export type CfxCompiledPubmedQuery = {
  query: string;
  components: {
    populations: string[];
    interventionsOrExposures: string[];
    outcomes: string[];
    predicates: string[];
    dateRanges: string[];
    purposeTerms: string[];
  };
  fallbacks: Array<{
    step: 2 | 3 | 4;
    label:
      | "remove_date_or_exact_phrase"
      | "relax_outcome_to_or"
      | "core_relationship";
    query: string | null;
    skippedReason: string | null;
  }>;
};

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function unique(values: string[], maximum = 4): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(normalize)) {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

function isBoundedComponent(value: string): boolean {
  const normalized = normalize(value);
  return normalized.split(/\s+/u).length <= 7 &&
    !/[.!?;:]/u.test(normalized);
}

function boundedComponents(values: string[]): string[] {
  return values.filter(isBoundedComponent);
}

function appears(text: string, value: string): boolean {
  return text.toLocaleLowerCase().includes(value.toLocaleLowerCase());
}

function anchoredValues(
  input: CfxEvidenceInput,
  values: string[],
): string[] {
  const anchor = [
    ...input.lookupHints.exposures,
    ...input.literalIdentifiers.dateRanges,
  ].find((value) => input.groundingText.includes(value));
  if (!anchor) return values;
  const line = input.groundingText.split(/\n+/u).find(
    (candidate) => candidate.includes(anchor),
  );
  if (!line) return values;
  const local = values.filter((value) => appears(line, value));
  return local.length > 0 ? local : values;
}

function literalPredicates(assertion: string): string[] {
  const patterns = [
    /\bsafety tested\b/giu,
    /\bdietary exposure\b/giu,
    /\bnot harmful\b/giu,
    /\bharmful\b/giu,
    /\bneurotoxicity\b/giu,
    /\bdata manipulation\b/giu,
    /\bmanipulated data\b/giu,
    /\bremoved\b/giu,
    /\bsafe\b/giu,
    /\bsafety\b/giu,
  ];
  return unique(patterns.flatMap((pattern) =>
    [...assertion.matchAll(pattern)].map((match) => match[0]!)
  ), 3);
}

function pubmedTerm(value: string): string {
  const escaped = normalize(value).replace(/"/gu, '\\"');
  const term = /[^\p{L}\p{N}]/u.test(escaped)
    ? `"${escaped}"`
    : escaped;
  return `${term}[Title/Abstract]`;
}

function group(values: string[]): string {
  const terms = values.map(pubmedTerm);
  if (terms.length === 1) return terms[0]!;
  return `(${terms.join(" OR ")})`;
}

function uniqueFallback(input: {
  seen: Set<string>;
  step: 2 | 3 | 4;
  label: CfxCompiledPubmedQuery["fallbacks"][number]["label"];
  groups: string[][];
}): CfxCompiledPubmedQuery["fallbacks"][number] {
  const query = input.groups
    .filter((values) => values.length > 0)
    .map(group)
    .join(" AND ");
  const key = query.toLocaleLowerCase();
  if (!query || input.seen.has(key)) {
    return {
      step: input.step,
      label: input.label,
      query: null,
      skippedReason: query ? "DUPLICATE_FALLBACK_QUERY" : "NO_LITERAL_COMPONENTS",
    };
  }
  input.seen.add(key);
  return {
    step: input.step,
    label: input.label,
    query,
    skippedReason: null,
  };
}

export function compileLiteralPubmedQuery(input: {
  evidenceInput: CfxEvidenceInput;
  queryId: CfxQueryId;
  queryIntent?: CfxQueryIntent;
}): CfxCompiledPubmedQuery | null {
  const source = input.evidenceInput;
  const localPopulations = anchoredValues(
    source,
    boundedComponents(source.lookupHints.populations),
  );
  const localInterventions = anchoredValues(source, [
    ...boundedComponents(source.lookupHints.interventions),
    ...boundedComponents(source.lookupHints.exposures),
  ]);
  const localOutcomes = anchoredValues(
    source,
    boundedComponents(source.lookupHints.outcomes),
  );
  const predicates = literalPredicates(source.substantiveAssertion);
  const narrow = input.queryId === "Q2";
  const populations = unique(localPopulations, narrow ? 1 : 2);
  const interventionsOrExposures = unique(
    localInterventions,
    narrow ? 1 : 3,
  );
  const outcomes = unique(localOutcomes, narrow ? 1 : 3);
  const dateRanges = input.queryId === "Q2"
    ? unique(source.literalIdentifiers.dateRanges, 1)
    : [];
  const purposeTerms = input.queryId !== "Q5" ? []
    : input.queryIntent === "qualification"
      ? ["methodological limitations", "confounding", "subgroup"]
      : ["replication", "reanalysis", "correction", "retraction"];
  const components = {
    populations,
    interventionsOrExposures,
    outcomes,
    predicates,
    dateRanges,
    purposeTerms,
  };
  const requiredGroups: string[][] = [];
  if (populations.length > 0) requiredGroups.push(populations);
  if (interventionsOrExposures.length > 0) {
    // The first literal intervention/exposure is the stable biomedical
    // subject. Requiring it prevents a secondary term such as "vaccines" or
    // "mercury" from broadening the query away from "aluminum" or
    // "thimerosal".
    requiredGroups.push([interventionsOrExposures[0]!]);
    if (
      populations.length === 0 &&
      outcomes.length === 0 &&
      interventionsOrExposures.length > 1
    ) {
      requiredGroups.push([interventionsOrExposures[1]!]);
    }
  }
  if (outcomes.length > 0) requiredGroups.push(outcomes);
  if (outcomes.length === 0 && predicates.length > 0) {
    requiredGroups.push(predicates);
  }
  if (dateRanges.length > 0) requiredGroups.push(dateRanges);
  if (purposeTerms.length > 0) requiredGroups.push(purposeTerms);
  if (requiredGroups.length < 2) return null;
  const query = requiredGroups.map(group).join(" AND ");
  const seen = new Set([query.toLocaleLowerCase()]);
  const core = interventionsOrExposures[0]
    ? [interventionsOrExposures[0]]
    : [];
  const firstOutcome = outcomes[0] ? [outcomes[0]] : [];
  const predicateOrOutcome = outcomes.length > 0 ? outcomes : predicates;
  const step2Groups = requiredGroups.filter(
    (values) => values !== dateRanges,
  );
  const fallbacks: CfxCompiledPubmedQuery["fallbacks"] = [
    uniqueFallback({
      seen,
      step: 2,
      label: "remove_date_or_exact_phrase",
      groups: step2Groups,
    }),
    uniqueFallback({
      seen,
      step: 3,
      label: "relax_outcome_to_or",
      groups: [core, predicateOrOutcome, purposeTerms.slice(0, 2)],
    }),
    uniqueFallback({
      seen,
      step: 4,
      label: "core_relationship",
      groups: [
        core,
        firstOutcome.length > 0 ? firstOutcome : predicates.slice(0, 1),
        purposeTerms.slice(0, 1),
      ],
    }),
  ];
  return {
    query,
    components,
    fallbacks,
  };
}
