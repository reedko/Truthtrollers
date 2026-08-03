import {
  normalizeDoi,
  normalizeLiteralText,
  normalizePmid,
  normalizeUrl,
} from "../../shared/evidenceSearch/identityNormalization.js";
import type {
  CfxUnitAwareInventory,
  CfxUnitAwareProposition,
} from "../discoveryWithUnits/types.js";
import type {
  CfxSubstantiveReviewInventory,
  CfxSubstantiveReviewRow,
} from "../substantiveReview/types.js";
import type {
  CfxFrozenArticle,
} from "../types/index.js";
import type {
  CfxArticleReference,
  CfxCitationLink,
  CfxCitationMetadata,
  CfxEvidenceSearchHandoff,
} from "./types.js";

type LinkedCitationContext = {
  markers: CfxCitationMetadata["citationMarkers"];
  references: CfxArticleReference[];
  links: CfxCitationLink[];
};

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/giu;
const PMID_RE = /\bPMID\s*[:#]?\s*(\d{4,12})\b/giu;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/giu;
const DATE_RANGE_RE =
  /\b(?:18|19|20)\d{2}\s*(?:-|–|—|to)\s*(?:18|19|20)\d{2}\b/giu;
const YEAR_RE = /\b(?:18|19|20)\d{2}s?\b/giu;
const ACRONYM_RE =
  /(?<![\p{L}\p{N}])(?:[A-Z]{2,}(?:[0-9]+)?|(?:[A-Z]\.){2,})(?![\p{L}\p{N}])/gu;
const QUOTED_PHRASE_RE =
  /“([^”\n]{2,500})”|‘([^’\n]{2,500})’|"([^"\n]{2,500})"/gu;
const PERSON_WITH_TITLE_RE =
  /\b((?:Dr|Mr|Mrs|Ms|Prof)\.?\s+[A-Z][\p{L}.-]+(?:\s+[A-Z][\p{L}.-]+){0,3})\b/gu;
const PERSON_POSSESSIVE_RE =
  /\b((?:[A-Z][\p{L}.-]+\s+){1,4}[A-Z][\p{L}.-]+)[’']s\b/gu;
const PERSON_ROLE_RE =
  /\b((?:[A-Z][\p{L}.-]+\s+){1,3}[A-Z][\p{L}.-]+)(?=\s+(?:argued|authored|explained|found|reported|revealed|said|stated|testified|warned|wrote)\b)/gu;
const ROLE_BEFORE_PERSON_RE =
  /\b(?:author|epidemiologist|researcher|scientist|whistleblower)\s+((?:[A-Z][\p{L}.-]+\s+){1,3}[A-Z][\p{L}.-]+)\b/gu;
const ORGANIZATION_RE =
  /\b[A-Z][\p{L}\p{N}'’.-]*(?:\s+(?:of|the|and|for|in|on|&|[A-Z][\p{L}\p{N}'’.-]*)){0,7}\s+(?:Administration|Agency|Association|Academy|Center|Centre|Committee|Company|Corporation|Council|Department|Foundation|Government|Institute|Institution|Laboratory|Ministry|Organization|Programme|Program|Public Health|Service|Services|University)\b/gu;
const LAW_RE =
  /\b(?:[A-Z0-9][\p{L}\p{N}'’.-]*)(?:\s+(?:of|the|and|for|in|on|to|[A-Z0-9][\p{L}\p{N}'’.-]*)){1,11}\s+(?:Act|Amendment|Code|Law|Regulation|Statute)\b/gu;
const PUBLISHED_IN_RE =
  /\bpublished\s+in\s+(?:the\s+)?([A-Z][\p{L}\p{N}'’&.-]+(?:\s+[A-Z][\p{L}\p{N}'’&.-]+){0,6})/gu;
const STUDY_TITLE_FORWARD_RE =
  /\b(?:study|report|paper|analysis|review|meta-analysis|document)\b\s+(?:titled|entitled|called|named)\s*[“"]([^”"\n]{3,500})[”"]/giu;
const STUDY_TITLE_REVERSE_RE =
  /[“"]([^”"\n]{3,500})[”"][^.\n]{0,50}\b(?:study|report|paper|analysis|review|meta-analysis|document)\b/giu;
const POPULATION_RE =
  /\b(?:American school children|school children|unvaccinated children|vaccinated children|pregnant women|Baby Boomers?|parents|infants?|babies|children|toddlers|adolescents?|adults?|women|men|patients?|participants?|subjects?)\b/giu;
const EXPOSURE_RELATION_RE =
  /\b(received\s+(?:the\s+)?(?:most|fewest|more|fewer|\d+)?\s*(?:vaccine doses?|vaccines?|shots?)|exposed\s+to\s+[\p{L}\p{N}][\p{L}\p{N} /-]{0,80}|injected\s+(?:with\s+)?[\p{L}\p{N}][\p{L}\p{N} /-]{0,80}|given\s+[\p{L}\p{N}][\p{L}\p{N} /-]{0,80})\b/giu;
const INTERVENTION_RE =
  /\b(?:childhood vaccination schedule|childhood vaccines?|MMR vaccin(?:e|es|ation)|DPT shots?|hepatitis B shots?|flu shots?|vaccination program|vaccination schedule|vaccination|vaccines?|vaccine doses?|shots?|ethylmercury|methylmercury|thimerosal|aluminum|mercury)\b/giu;
const OUTCOME_RE =
  /\b(?:chronic diseases?|chronic illnesses?|hospitalizations?|death rates?|mortality|autism|ADHD|allergies|asthma|injury|harm|neurodevelopmental disorders?)\b/giu;
const GEOGRAPHY_RE =
  /(?:\bU\.S\.(?=\s|$)|\b(?:United States|United Kingdom|USA|UK)\b)|(?:\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2},\s+[A-Z][a-z]+\b)/gu;
const DOCUMENT_TYPE_RE =
  /\b(?:analysis|case-control study|cohort study|dataset|document|law|meta-analysis|paper|randomized trial|records|report|review|study|trial)\b/giu;
const TOPIC_RE =
  /\b(?:vaccine hesitancy|vaccine safety|chronic diseases?|chronic illnesses?|childhood vaccination schedule|data manipulation|liability|aluminum safety|mercury toxicity|thimerosal toxicity)\b/giu;
const DATA_MANIPULATION_RE =
  /\bdata\b.{0,60}\b(?:manipulated|altered|omitted|suppressed|concealed)\b|\b(?:manipulated|altered|omitted|suppressed|concealed)\b.{0,60}\bdata\b/giu;

const ACRONYM_STOP = new Set([
  "ARE",
  "FACTS",
  "MERCURY",
  "NEVER",
  "NOT",
  "SHOULD",
  "THE",
]);
const NON_ORGANIZATION_ACRONYMS = new Set([
  "ADHD",
  "ASD",
  "DPT",
  "MMR",
  "TCLP",
]);

function unique(
  values: Array<string | null | undefined>,
  limit = 64,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeLiteralText(value);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeLookupTerm(value: string): string {
  return value.toLocaleLowerCase().replace(
    /\b(?:adhd|asd|dpt|mmr|tclp)\b/giu,
    (token) => token.toLocaleUpperCase(),
  );
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]!);
}

function capture(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(
    (match) => match.slice(1).find(Boolean) ?? "",
  ).filter(Boolean);
}

function linkedCitationContext(
  metadata: CfxCitationMetadata | undefined,
  groundingUnitIds: string[],
): LinkedCitationContext {
  if (!metadata) return { markers: [], references: [], links: [] };
  const units = new Set(groundingUnitIds);
  const markers = metadata.citationMarkers.filter(
    (marker) => marker.sourceUnitId && units.has(marker.sourceUnitId),
  );
  const referenceIds = new Set(
    markers.map((marker) => marker.resolvedReferenceId).filter(
      (value): value is string => Boolean(value),
    ),
  );
  for (const reference of metadata.references) {
    if (reference.sourceUnitId && units.has(reference.sourceUnitId)) {
      referenceIds.add(reference.referenceId);
    }
  }
  const references = metadata.references.filter(
    (reference) => referenceIds.has(reference.referenceId),
  );
  const linkIds = new Set(references.flatMap(
    (reference) => reference.linkIds ?? [],
  ));
  const links = metadata.links.filter((link) =>
    linkIds.has(link.linkId)
    || Boolean(
      (link.unitId && units.has(link.unitId))
      || (link.sourceUnitId && units.has(link.sourceUnitId)),
    ));
  return { markers, references, links };
}

function metadataStrings(citations: LinkedCitationContext): string[] {
  return [
    ...citations.markers.map((marker) => marker.displayText),
    ...citations.references.flatMap((reference) => [
      reference.label,
      reference.text,
      reference.title,
      ...(reference.authors ?? []),
      ...(reference.organizations ?? []),
      reference.journal,
      reference.publicationVenue,
      reference.publicationYear == null
        ? ""
        : String(reference.publicationYear),
      ...(reference.geography ?? []),
      ...(reference.identifiers?.doi ?? []),
      ...(reference.identifiers?.pmid ?? []),
      ...(reference.identifiers?.urls ?? []),
    ]),
    ...citations.links.flatMap((link) => [
      link.anchorText,
      link.url,
    ]),
  ].filter((value): value is string => typeof value === "string");
}

function quotedPhrases(text: string): string[] {
  return unique(capture(text, QUOTED_PHRASE_RE), 32);
}

function explicitStudyTitles(
  text: string,
  references: CfxArticleReference[],
): string[] {
  return unique([
    ...references.map((reference) => reference.title),
    ...capture(text, STUDY_TITLE_FORWARD_RE),
    ...capture(text, STUDY_TITLE_REVERSE_RE),
  ], 24);
}

function acronyms(text: string): string[] {
  return unique(matches(text, ACRONYM_RE).filter(
    (value) => !ACRONYM_STOP.has(value),
  ), 32);
}

function organizationAcronyms(
  text: string,
  assertionSource: string,
  values: string[],
): string[] {
  return values.filter((value) => {
    if (NON_ORGANIZATION_ACRONYMS.has(value)) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "u").test(assertionSource)) return true;
    if (new RegExp(
      `\\b(?:the|senior)\\s+${escaped}\\b(?!\\s+(?:vaccine|vaccines|shot|shots))`,
      "iu",
    ).test(text)) return true;
    return new RegExp(
      `\\b${escaped}\\b(?=\\s+(?:agency|data|department|officials?|scientist|schedule|website|mantra))`,
      "iu",
    ).test(text);
  });
}

function literalIdentifiers(
  text: string,
  assertionSource: string,
  citations: LinkedCitationContext,
): CfxEvidenceSearchHandoff["literalIdentifiers"] {
  const referenceDois = citations.references.flatMap(
    (reference) => reference.identifiers?.doi ?? [],
  );
  const referencePmids = citations.references.flatMap(
    (reference) => reference.identifiers?.pmid ?? [],
  );
  const referenceUrls = citations.references.flatMap(
    (reference) => reference.identifiers?.urls ?? [],
  );
  const doi = unique([
    ...referenceDois,
    ...matches(text, DOI_RE).map((value) =>
      value.replace(/[.,;:)\]}]+$/u, "")),
  ]).map(normalizeDoi).filter(
    (value) => /^10\.\d{4,9}\/\S+$/iu.test(value),
  );
  const pmid = unique([
    ...referencePmids,
    ...capture(text, PMID_RE),
  ]).map(normalizePmid).filter(
    (value): value is string => Boolean(value),
  );
  const urls = unique([
    ...referenceUrls,
    ...citations.links.map((link) => link.url),
    ...matches(text, URL_RE).map((value) =>
      value.replace(/[.,;:!?]+$/u, "")),
  ]).map(normalizeUrl).filter(
    (value): value is string => Boolean(value),
  );
  const citationNumbers = unique([
    ...citations.markers.map((marker) =>
      /^\[?\d+(?:\s*[-,]\s*\d+)*\]?$/u.test(marker.displayText.trim())
        ? marker.displayText
        : ""),
    ...citations.references.map((reference) =>
      reference.label && /^\[?\d+\]?$/u.test(reference.label.trim())
        ? reference.label
        : ""),
  ]);
  const acronymValues = acronyms(text);
  const dateRanges = unique(matches(text, DATE_RANGE_RE), 24);
  const rangeYears = new Set(
    dateRanges.flatMap((range) => matches(range, YEAR_RE))
      .map((value) => value.toLocaleLowerCase()),
  );
  const years = unique(matches(text, YEAR_RE).filter(
    (value) => !rangeYears.has(value.toLocaleLowerCase()),
  ), 24);
  const laws = unique(matches(text, LAW_RE), 24);
  const people = unique([
    ...citations.references.flatMap(
      (reference) => reference.authors ?? [],
    ),
    ...capture(text, PERSON_WITH_TITLE_RE),
    ...capture(assertionSource, PERSON_POSSESSIVE_RE),
    ...capture(text, PERSON_ROLE_RE),
    ...capture(text, ROLE_BEFORE_PERSON_RE),
  ], 32).filter((value) =>
    !laws.some((law) => law.includes(value))
    && !/(?:Department|Public Health|University|Association|Agency|Institute|Committee)\b/u.test(
      value,
    ),
  );
  const organizations = unique([
    ...citations.references.flatMap(
      (reference) => reference.organizations ?? [],
    ),
    ...matches(text, ORGANIZATION_RE),
    ...organizationAcronyms(text, assertionSource, acronymValues),
  ], 32);
  const journals = unique([
    ...citations.references.flatMap((reference) => [
      reference.journal,
      reference.publicationVenue,
    ]),
    ...capture(text, PUBLISHED_IN_RE),
  ], 24);
  return {
    people,
    organizations,
    laws,
    studyTitles: explicitStudyTitles(text, citations.references),
    journals,
    years,
    dateRanges,
    doi: unique(doi),
    pmid: unique(pmid),
    urls: unique(urls),
    citationNumbers,
    acronyms: acronymValues,
  };
}

function lookupHints(
  text: string,
  citations: LinkedCitationContext,
): CfxEvidenceSearchHandoff["lookupHints"] {
  const exposures = unique([
    ...capture(text, EXPOSURE_RELATION_RE).map((value) =>
      value.replace(/[.,;:!?]+$/u, "")),
  ], 32);
  const topics = unique([
    ...matches(text, TOPIC_RE),
    ...(DATA_MANIPULATION_RE.test(text) ? ["data manipulation"] : []),
  ], 32);
  DATA_MANIPULATION_RE.lastIndex = 0;
  return {
    populations: unique(
      matches(text, POPULATION_RE).map((value) =>
        value.toLocaleLowerCase()),
      32,
    ),
    exposures: exposures.map(normalizeLookupTerm),
    outcomes: unique(
      matches(text, OUTCOME_RE).map((value) =>
        value.toLocaleLowerCase()),
      32,
    ),
    interventions: unique(
      matches(text, INTERVENTION_RE).map(normalizeLookupTerm),
      32,
    ),
    geography: unique([
      ...citations.references.flatMap(
        (reference) => reference.geography ?? [],
      ),
      ...matches(text, GEOGRAPHY_RE),
    ], 24),
    documentTypes: unique(
      matches(text, DOCUMENT_TYPE_RE).map((value) =>
        value.toLocaleLowerCase()),
      24,
    ),
    topics: topics.map((value) => value.toLocaleLowerCase()),
  };
}

function quoteSearchLiteral(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function queryParts(
  values: Array<string | null | undefined>,
  maximumCharacters = 260,
): string {
  const parts = unique(values, 24);
  const accepted: string[] = [];
  for (const part of parts) {
    if ([...accepted, part].join(" ").length > maximumCharacters) break;
    accepted.push(part);
  }
  return accepted.join(" ");
}

function searchInterventionAlias(
  hints: CfxEvidenceSearchHandoff["lookupHints"],
): string {
  if (hints.exposures.some((value) => /\bmost vaccines\b/iu.test(value))) {
    return "vaccine doses";
  }
  return hints.interventions[0] ?? "";
}

function searchOutcomeAlias(
  hints: CfxEvidenceSearchHandoff["lookupHints"],
): string {
  if (hints.outcomes.some((value) => /\bdeath rates?\b/iu.test(value))) {
    return "mortality";
  }
  return hints.outcomes[0] ?? "";
}

function lineContainingLiteral(text: string, literal: string): string {
  const normalizedLiteral = normalizeLiteralText(literal);
  if (!normalizedLiteral) return "";
  return text.split(/\n+/u).find((line) =>
    normalizeLiteralText(line).includes(normalizedLiteral)
  ) ?? "";
}

function buildQueries(input: {
  normalizedAssertion: string;
  assertionSource: string;
  text: string;
  identifiers: CfxEvidenceSearchHandoff["literalIdentifiers"];
  hints: CfxEvidenceSearchHandoff["lookupHints"];
}): CfxEvidenceSearchHandoff["queries"] {
  const literal = input.normalizedAssertion
    ? [quoteSearchLiteral(input.normalizedAssertion)]
    : [];
  const sourceQualified =
    input.normalizedAssertion && normalizeLiteralText(input.assertionSource)
      ? [queryParts([
          quoteSearchLiteral(input.normalizedAssertion),
          quoteSearchLiteral(normalizeLiteralText(input.assertionSource)),
        ])]
      : [];
  const organizations = input.identifiers.organizations;
  const nonOrganizationAcronyms = input.identifiers.acronyms.filter(
    (value) => !organizations.includes(value)
      && !input.hints.geography.includes(value),
  );
  const primaryYear =
    input.identifiers.dateRanges[0] ?? input.identifiers.years[0] ?? "";
  const studyLookup: string[] = [
    ...input.identifiers.doi,
    ...input.identifiers.pmid.map((value) => `PMID ${value}`),
    ...input.identifiers.urls,
    ...input.identifiers.studyTitles.map((title) => queryParts([
      quoteSearchLiteral(title),
      input.identifiers.people[0],
      primaryYear,
      input.identifiers.journals[0],
    ])),
  ];
  if (input.identifiers.dateRanges.length > 0) {
    const anchoredText = lineContainingLiteral(
      input.text,
      input.identifiers.dateRanges[0]!,
    );
    const anchoredHints = anchoredText
      ? lookupHints(anchoredText, {
          markers: [],
          references: [],
          links: [],
        })
      : input.hints;
    studyLookup.push(
      queryParts([
        quoteSearchLiteral(input.identifiers.dateRanges[0]!),
        anchoredHints.populations[0] ?? input.hints.populations[0],
        anchoredHints.interventions.find(
          (value) => /vaccines?/iu.test(value),
        ) ?? anchoredHints.interventions[0]
          ?? input.hints.interventions[0],
        ...(anchoredHints.outcomes.length > 0
          ? anchoredHints.outcomes.slice(0, 2)
          : input.hints.outcomes.slice(0, 2)),
      ]),
      queryParts([
        anchoredHints.geography[0] ?? input.hints.geography[0],
        anchoredHints.populations[0] ?? input.hints.populations[0],
        searchInterventionAlias(anchoredHints)
          || searchInterventionAlias(input.hints),
        anchoredHints.outcomes.find(
          (value) => !/death rates?/iu.test(value),
        ) ?? input.hints.outcomes.find(
          (value) => !/death rates?/iu.test(value),
        ),
        searchOutcomeAlias(anchoredHints)
          || searchOutcomeAlias(input.hints),
        "study",
      ]),
      queryParts([
        anchoredHints.populations[0] ?? input.hints.populations[0],
        anchoredHints.exposures[0] ?? input.hints.exposures[0],
        /\bworst\b/iu.test(anchoredText || input.text) ? "worst" : "",
        ...(anchoredHints.outcomes.length > 0
          ? anchoredHints.outcomes.slice(0, 2)
          : input.hints.outcomes.slice(0, 2)),
        anchoredHints.documentTypes[0]
          ?? input.hints.documentTypes[0],
      ]),
    );
  } else {
    studyLookup.push(
      queryParts([
        organizations[0],
        nonOrganizationAcronyms[0],
        ...input.hints.outcomes.slice(0, 2),
        input.hints.topics[0],
        input.identifiers.people[0],
      ]),
      queryParts([
        input.identifiers.people[0],
        organizations[0],
        nonOrganizationAcronyms[0],
        input.hints.outcomes[0],
        input.hints.documentTypes[0] ?? "study",
      ]),
      queryParts([
        organizations[0],
        input.hints.interventions[0],
        input.hints.outcomes[0],
        input.hints.topics[0],
        input.identifiers.years[0],
      ]),
    );
  }
  return {
    literal,
    sourceQualified,
    studyLookup: unique(studyLookup.filter((query) =>
      query.split(/\s+/u).filter(Boolean).length >= 3
    ), 12),
  };
}

export function buildCfxEvidenceSearchHandoff(input: {
  review: CfxSubstantiveReviewRow;
  source: CfxUnitAwareProposition;
  article: Pick<CfxFrozenArticle, "sourceUnits" | "citationMetadata">;
}): CfxEvidenceSearchHandoff {
  if (input.review.propositionId !== input.source.propositionId) {
    throw new Error("CFX evidence-search proposition ID mismatch");
  }
  const unitById = new Map(
    input.article.sourceUnits.map((unit) => [unit.unitId, unit]),
  );
  const groundingUnits = input.source.groundingUnitIds.map((unitId) => {
    const unit = unitById.get(unitId);
    if (!unit) {
      throw new Error(
        `CFX evidence-search handoff references unknown unit ${unitId}`,
      );
    }
    return unit;
  });
  const groundingText = groundingUnits.map(
    (unit) => `[${unit.unitId}]\n${unit.text}`,
  ).join("\n\n");
  const citations = linkedCitationContext(
    input.article.citationMetadata,
    input.source.groundingUnitIds,
  );
  const corpus = [
    input.review.substantiveAssertion,
    input.review.assertionSource,
    groundingText,
    ...metadataStrings(citations),
  ].join("\n");
  const normalizedAssertion = normalizeLiteralText(
    input.review.substantiveAssertion,
  );
  const identifiers = literalIdentifiers(
    corpus,
    input.review.assertionSource,
    citations,
  );
  const hints = lookupHints(corpus, citations);
  const queries = buildQueries({
    normalizedAssertion,
    assertionSource: input.review.assertionSource,
    text: corpus,
    identifiers,
    hints,
  });
  return {
    normalizedAssertion,
    groundingUnitIds: [...input.source.groundingUnitIds],
    groundingText,
    explicitStudyIdentityFound: Boolean(
      identifiers.doi.length
      || identifiers.pmid.length
      || identifiers.urls.length
      || identifiers.studyTitles.length
    ),
    literalIdentifiers: identifiers,
    lookupHints: hints,
    queries,
  };
}

export function attachCfxEvidenceSearchHandoffs(input: {
  reviewInventory: Omit<CfxSubstantiveReviewInventory, "results"> & {
    results: CfxSubstantiveReviewRow[];
  };
  sourceInventory: CfxUnitAwareInventory;
  article: Pick<CfxFrozenArticle, "sourceUnits" | "citationMetadata">;
}): CfxSubstantiveReviewInventory {
  const sourceById = new Map(
    input.sourceInventory.propositions.map(
      (proposition) => [proposition.propositionId, proposition],
    ),
  );
  return {
    ...input.reviewInventory,
    results: input.reviewInventory.results.map((review) => {
      const source = sourceById.get(review.propositionId);
      if (!source) {
        throw new Error(
          `CFX evidence-search handoff missing source ${review.propositionId}`,
        );
      }
      return {
        ...review,
        evidenceSearchHandoff: buildCfxEvidenceSearchHandoff({
          review,
          source,
          article: input.article,
        }),
      };
    }),
  };
}
